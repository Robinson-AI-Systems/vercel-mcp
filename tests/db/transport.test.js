import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  openIsolatedSchema, closeIsolatedSchema, rawQuery,
} from '../../test/helpers/pg-neon-adapter.js';

// RACK-STAGING S-1: the production store seam itself, exercised the
// way production calls it — createDb() with NO injected handle, the
// environment selecting the pg transport (src/db-transport.js)
// against a plain PostgreSQL store. Every other db test injects the
// test adapter; this one proves the promoted production path end to
// end: selection, schema init, a write/read round trip, and the
// store probe through the same transport. The isolated schema is
// reached by carrying search_path in the connection string's options
// parameter, which node-postgres forwards to the server at startup.
let db;
let schema;
let storeUrl;
let savedEnv;
let SCHEMA_TABLES;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) {
    throw new Error('RACK-STAGING transport test requires disposable localhost PostgreSQL');
  }
  schema = await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  storeUrl = url.toString();
  savedEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    STORE_TRANSPORT: process.env.STORE_TRANSPORT,
  };
  process.env.DATABASE_URL = storeUrl;
  process.env.STORE_TRANSPORT = 'pg';
  // Imported only after the environment is set: src/db.js builds the
  // production handle from the environment at first use.
  const mod = await import('../../src/db.js');
  SCHEMA_TABLES = mod.SCHEMA_TABLES;
  db = mod.createDb();
  await db.initSchema();
});

afterAll(async () => {
  const { pgStoreSql } = await import('../../src/db-transport.js');
  await pgStoreSql(storeUrl).end();
  if (savedEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedEnv.DATABASE_URL;
  if (savedEnv.STORE_TRANSPORT === undefined) delete process.env.STORE_TRANSPORT;
  else process.env.STORE_TRANSPORT = savedEnv.STORE_TRANSPORT;
  await closeIsolatedSchema();
});

describe('RACK-STAGING S-1 production pg transport (no injected handle)', () => {
  it('initializes the full enumerated schema through the seam', async () => {
    const rows = await rawQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`);
    const names = rows.map((r) => r.table_name);
    for (const table of SCHEMA_TABLES) expect(names).toContain(table);
    expect(names.length).toBe(SCHEMA_TABLES.length);
  });

  it('round-trips a registration write and read through createDb()', async () => {
    await db.createOAuthClient({
      clientId: 'rack-staging-transport',
      clientSecret: 'FAKE-secret',
      redirectUris: ['https://fixture.example/cb'],
      clientName: 'RACK-STAGING transport proof',
      tokenEndpointAuthMethod: 'client_secret_post',
    });
    const got = await db.getOAuthClient('rack-staging-transport');
    expect(got).toBeTruthy();
    expect(got.client_id).toBe('rack-staging-transport');
    const listed = await db.listOAuthClients();
    expect(listed.map((c) => c.client_id)).toContain('rack-staging-transport');
    // Independent read-back through the test client, same schema.
    const rows = await rawQuery(
      "SELECT data->>'client_name' AS client_name FROM oauth_clients WHERE client_id = $1",
      ['rack-staging-transport']);
    expect(rows).toHaveLength(1);
    expect(rows[0].client_name).toBe('RACK-STAGING transport proof');
  });

  it('answers the store probe through the same transport', async () => {
    await expect(db.storeReachable()).resolves.toBe(true);
  });
});
