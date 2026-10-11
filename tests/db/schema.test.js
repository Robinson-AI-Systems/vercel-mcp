import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb, SCHEMA_TABLES } from '../../src/db.js';
import { closeIsolatedSchema, neonShapedQuery, openIsolatedSchema, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let db;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres');
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error('Refusing non-local Postgres in test');
  }
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
});

afterAll(async () => { await closeIsolatedSchema(); });

it('creates exactly the eleven tables and is idempotent for tables, columns, and indexes', async () => {
  await db.initSchema();
  const firstTables = await rawQuery(
    'SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename'
  );
  const firstColumns = await rawQuery(
    'SELECT table_name, column_name, column_default, is_nullable, data_type FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position'
  );
  const firstIndexes = await rawQuery(
    'SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY tablename, indexname'
  );

  expect(firstTables.map((row) => row.tablename)).toEqual([...SCHEMA_TABLES].sort());
  await db.initSchema();
  expect(await rawQuery(
    'SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename'
  )).toEqual(firstTables);
  expect(await rawQuery(
    'SELECT table_name, column_name, column_default, is_nullable, data_type FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position'
  )).toEqual(firstColumns);
  expect(await rawQuery(
    'SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY tablename, indexname'
  )).toEqual(firstIndexes);
});

it('enforces safe defaults and has no plaintext token columns', async () => {
  const accounts = await rawQuery(
    "SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'vercel_accounts'"
  );
  const accountDefaults = Object.fromEntries(accounts.map((row) => [row.column_name, row.column_default]));
  expect(accountDefaults.production_enabled).toMatch(/false/i);
  expect(accountDefaults.spend_limit_cents).toBe('0');
  expect(accountDefaults.sandbox_minutes_per_day).toBe('60');
  expect(accounts.find((row) => row.column_name === 'scope').is_nullable).toBe('NO');

  for (const table of ['oauth_codes', 'oauth_tokens']) {
    const rows = await rawQuery(
      'SELECT column_name, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
      [table]
    );
    const defaults = Object.fromEntries(rows.map((row) => [row.column_name, row.column_default]));
    expect(defaults.mode).toMatch(/preview/);
    expect(defaults.profile).toMatch(/everyday/);
    expect(defaults.listing).toMatch(/catalog/);
    if (table === 'oauth_tokens') expect(defaults.kind).toMatch(/connector/);
  }

  const productionDefault = await rawQuery(
    "SELECT column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'change_log' AND column_name = 'production'"
  );
  expect(productionDefault[0].column_default).toMatch(/false/i);
  const protectedDefault = await rawQuery(
    "SELECT column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'protected_resources' AND column_name = 'source'"
  );
  expect(protectedDefault[0].column_default).toMatch(/default/);

  const plaintextColumns = await rawQuery(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name IN ('access_token', 'refresh_token', 'token', 'value', 'plaintext')"
  );
  expect(plaintextColumns).toEqual([]);
});

it('rejects duplicate protected resources globally and per account', async () => {
  await rawQuery(
    "INSERT INTO protected_resources (vercel_account, kind, match) VALUES (NULL, 'project', 'vercel-mcp')"
  );
  await expect(rawQuery(
    "INSERT INTO protected_resources (vercel_account, kind, match) VALUES (NULL, 'project', 'vercel-mcp')"
  )).rejects.toMatchObject({ code: '23505' });

  await rawQuery(
    "INSERT INTO protected_resources (vercel_account, kind, match) VALUES ('team_fixture', 'project', 'vercel-mcp')"
  );
  await expect(rawQuery(
    "INSERT INTO protected_resources (vercel_account, kind, match) VALUES ('team_fixture', 'project', 'vercel-mcp')"
  )).rejects.toMatchObject({ code: '23505' });
});

it('creates the change-log request-key index', async () => {
  const rows = await rawQuery(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'change_log_request_key'"
  );
  expect(rows).toHaveLength(1);
});
