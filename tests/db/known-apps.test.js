import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createDb, APPLIANCE_DESK_PROFILE } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let db;
beforeAll(async () => {
  const u = process.env.TEST_DATABASE_URL;
  if (!u || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(u).hostname)) {
    throw new Error('Only disposable localhost PostgreSQL permitted');
  }
  await openIsolatedSchema(u);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => closeIsolatedSchema());

// P-1 (BATCH-P): known_apps storage — the shipped default seed, the
// source='default' refresh rule, account scoping and upsert validation.
describe('known_apps storage and profile seed', () => {
  it('seeds the Appliance Desk profile exactly once, from the default', async () => {
    await db.initSchema();
    const rows = await db.listKnownApps('acct_ANY');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'appliance-desk',
      status: 'active', source: 'default', account: null });
    expect(rows[0].profile.release_rule).toBe('branch');
    expect(rows[0].profile.expected_crons).toHaveLength(19);
    const got = await db.getKnownApp('acct_ANY', 'appliance-desk');
    expect(got.profile.id).toBe('appliance-desk');
    expect(await db.getKnownApp('acct_ANY', 'missing-app')).toBe(null);
  });
  it('never overwrites an owner-edited row when the seed re-runs', async () => {
    await db.upsertKnownApp({ account: 'acct_OWNER', id: 'appliance-desk',
      name: 'Appliance Desk', status: 'active', source: 'setup_page',
      profile: { ...APPLIANCE_DESK_PROFILE, cost_target_cents: 5000 } });
    await db.initSchema();
    const rows = await db.listKnownApps('acct_OWNER');
    const mine = rows.find(r => r.account === 'acct_OWNER');
    expect(mine.profile.cost_target_cents).toBe(5000);
    expect(mine.source).toBe('setup_page');
  });
  it('scopes rows to their account; global rows apply everywhere', async () => {
    await db.upsertKnownApp({ account: 'acct_A', id: 'a-only-app',
      name: 'A Only', status: 'draft', source: 'draft',
      profile: { id: 'a-only-app', name: 'A Only', release_rule: 'promote' } });
    const forA = await db.listKnownApps('acct_A');
    expect(forA.map(r => r.id)).toContain('a-only-app');
    expect(forA.map(r => r.id)).toContain('appliance-desk');
    const forB = await db.listKnownApps('acct_B');
    expect(forB.map(r => r.id)).not.toContain('a-only-app');
    expect(forB.map(r => r.id)).toContain('appliance-desk');
  });
  it('rejects malformed upserts', async () => {
    await expect(db.upsertKnownApp({ id: 'Bad Id', name: 'X',
      profile: { id: 'Bad Id' } })).rejects.toThrow();
    await expect(db.upsertKnownApp({ id: 'ok-app', name: 'X',
      profile: { id: 'other-app' } })).rejects.toThrow();
    await expect(db.upsertKnownApp({ id: 'ok-app', name: 'X',
      status: 'paused', profile: { id: 'ok-app' } })).rejects.toThrow();
  });
  it('the table exists with the expected columns', async () => {
    const cols = await rawQuery(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'known_apps' ORDER BY column_name`);
    expect(cols.map(c => c.column_name)).toEqual(
      ['id', 'name', 'profile', 'source', 'status', 'updated_at',
       'vercel_account']);
  });
});
