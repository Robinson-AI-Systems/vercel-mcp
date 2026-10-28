import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery }
  from '../../test/helpers/pg-neon-adapter.js';

// AUD-A1 (design D-A, ruling OP-2): standing purchase policy storage.
// The beforeAll builds a PRE-AUD-A1 vercel_accounts table by hand — the
// shape every existing deployment has — so initSchema's marker-gated carry
// is exercised exactly as it will run on deploy.
let db;
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname)) {
    throw new Error('Disposable localhost Postgres only');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await rawQuery(`CREATE TABLE vercel_accounts (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, team_slug TEXT NOT NULL, label TEXT NOT NULL,
    scope TEXT NOT NULL, project_id TEXT, project_name TEXT, token_enc TEXT NOT NULL,
    token_last4 TEXT NOT NULL, token_expires_at TIMESTAMPTZ, token_checked_at TIMESTAMPTZ,
    token_probe JSONB, production_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    spend_limit_cents INTEGER NOT NULL DEFAULT 0, sandbox_minutes_per_day INTEGER,
    is_default BOOLEAN NOT NULL DEFAULT FALSE, added_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await rawQuery(`INSERT INTO vercel_accounts
    (id,team_id,team_slug,label,scope,token_enc,token_last4,spend_limit_cents)
    VALUES ('team_POS','team_POS','pos','Positive','team','ciphertext_FAKE_pos','1111',2500),
           ('team_ZERO','team_ZERO','zero','Zero','team','ciphertext_FAKE_zero','2222',0)`);
});
afterAll(async () => { await closeIsolatedSchema(); });
const policies = () => rawQuery(
  'SELECT id,purchase_budget_cents,purchase_grant_required FROM vercel_accounts ORDER BY id');
const audits = () => rawQuery(
  "SELECT vercel_account,tool,summary,after,dry_run,production FROM change_log WHERE tool='vercel_set_purchase_policy' ORDER BY id");

it('carries a positive legacy limit into the budget; zero becomes no budget', async () => {
  await db.initSchema();
  expect(await policies()).toEqual([
    { id:'team_POS', purchase_budget_cents:2500, purchase_grant_required:false },
    { id:'team_ZERO', purchase_budget_cents:null, purchase_grant_required:false }
  ]);
  expect(await db.getPurchasePolicy('team_POS')).toEqual({ budgetCents:2500, grantRequired:false });
  expect(await db.getPurchasePolicy('team_ZERO')).toEqual({ budgetCents:null, grantRequired:false });
  const markers = await rawQuery('SELECT name FROM schema_migrations');
  expect(markers).toEqual([{ name:'aud_a1_purchase_policy_carry_v1' }]);
  // A fresh account created after the migration has the safe defaults.
  await rawQuery(`INSERT INTO vercel_accounts
    (id,team_id,team_slug,label,scope,token_enc,token_last4)
    VALUES ('team_FRESH','team_FRESH','fresh','Fresh','team','ciphertext_FAKE_fresh','3333')`);
  expect(await db.getPurchasePolicy('team_FRESH')).toEqual({ budgetCents:null, grantRequired:false });
});

it('re-running initSchema changes nothing once the marker exists', async () => {
  await rawQuery('UPDATE vercel_accounts SET purchase_budget_cents = 9999 WHERE id = $1', ['team_POS']);
  await db.initSchema();
  await db.initSchema();
  expect(await db.getPurchasePolicy('team_POS')).toEqual({ budgetCents:9999, grantRequired:false });
  expect(await rawQuery('SELECT name FROM schema_migrations')).toHaveLength(1);
});

it('clear-after-migrate: a cleared budget is never resurrected by initSchema', async () => {
  expect(await db.setPurchasePolicy('team_POS', { budgetCents:null, grantRequired:false })).toBe(true);
  expect(await db.getPurchasePolicy('team_POS')).toEqual({ budgetCents:null, grantRequired:false });
  await db.initSchema();
  expect(await db.getPurchasePolicy('team_POS')).toEqual({ budgetCents:null, grantRequired:false });
  expect((await policies()).find(r => r.id === 'team_POS').purchase_budget_cents).toBeNull();
});

it('setPurchasePolicy round-trips and journals every successful set', async () => {
  expect(await db.setPurchasePolicy('team_POS', { budgetCents:2500, grantRequired:true })).toBe(true);
  expect(await db.getPurchasePolicy('team_POS')).toEqual({ budgetCents:2500, grantRequired:true });
  expect(await db.setPurchasePolicy('team_ZERO', { budgetCents:0, grantRequired:false })).toBe(true);
  expect(await db.getPurchasePolicy('team_ZERO')).toEqual({ budgetCents:0, grantRequired:false });
  const logs = await audits();
  // One row from the clear-after-migrate test plus these two sets.
  expect(logs).toHaveLength(3);
  expect(logs[0].summary).toContain('no agent budget');
  expect(logs[0].after).toEqual({ budgetCents:null, grantRequired:false });
  expect(logs[1].summary).toContain('$25.00');
  expect(logs[1].summary).toContain('per-purchase grant required');
  expect(logs[1].after).toEqual({ budgetCents:2500, grantRequired:true });
  expect(logs.every(r => r.production === true && r.dry_run === false)).toBe(true);
});

it('rejects invalid policies and missing accounts without journaling', async () => {
  for (const invalid of [
    { budgetCents:-1, grantRequired:false }, { budgetCents:1.5, grantRequired:false },
    { budgetCents:2147483648, grantRequired:false }, { budgetCents:'2500', grantRequired:false },
    { budgetCents:NaN, grantRequired:false }, { budgetCents:2500, grantRequired:'yes' },
    { budgetCents:2500 }, {}, null, undefined
  ]) {
    await expect(db.setPurchasePolicy('team_POS', invalid)).rejects.toThrow();
  }
  await expect(db.setPurchasePolicy('bad name', { budgetCents:1, grantRequired:false })).rejects.toThrow();
  await expect(db.getPurchasePolicy('bad name')).rejects.toThrow();
  expect(await db.setPurchasePolicy('team_UNKNOWN', { budgetCents:1, grantRequired:false })).toBe(false);
  expect(await db.getPurchasePolicy('team_UNKNOWN')).toBeNull();
  expect(await audits()).toHaveLength(3);
  expect(await db.getPurchasePolicy('team_POS')).toEqual({ budgetCents:2500, grantRequired:true });
});
