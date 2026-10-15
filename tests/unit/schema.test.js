import { afterEach, expect, it, vi } from 'vitest';
import { CONNECTION_FIELDS, connectionSettings, createDb, SCHEMA_TABLES } from '../../src/db.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('exports the frozen fifteen-table schema and the four connection fields', () => {
  expect(Object.isFrozen(SCHEMA_TABLES)).toBe(true);
  expect(SCHEMA_TABLES).toEqual([
    'vercel_accounts', 'oauth_clients', 'oauth_codes', 'oauth_tokens', 'login_attempts',
    'change_log', 'one_time_secrets', 'pending_inputs', 'protected_resources', 'request_replay', 'result_store', 'purchase_intents', 'rtc_passes', 'dev_runs', 'dev_run_objects'
  ]);
  expect(CONNECTION_FIELDS).toEqual(['vercel_account', 'mode', 'profile', 'listing']);
  expect(Object.isFrozen(CONNECTION_FIELDS)).toBe(true);
});

it('copies only the connection settings from a row', () => {
  expect(connectionSettings({
    vercel_account: 'team_fixture',
    mode: 'preview',
    profile: 'everyday',
    listing: 'catalog',
    token_hash: 'must-not-copy'
  })).toEqual({
    vercel_account: 'team_fixture',
    mode: 'preview',
    profile: 'everyday',
    listing: 'catalog'
  });
  expect(() => connectionSettings(null)).toThrow(/connection row/i);
});

it('rejects a non-function query argument', () => {
  expect(() => createDb({})).toThrow(/Neon-shaped query function/);
});

it('does not require DATABASE_URL until schema initialization', async () => {
  vi.stubEnv('DATABASE_URL', '');
  const db = createDb();
  expect(db).toHaveProperty('initSchema');
  await expect(db.initSchema()).rejects.toThrow(/DATABASE_URL is not configured/);
});

it('initializes the fake schema idempotently', async () => {
  const db = createFakeDb();
  await db.initSchema();
  const first = db.listTables();
  await db.initSchema();
  expect(db.listTables()).toEqual(first);
  expect(first).toEqual([...SCHEMA_TABLES].sort());
});
