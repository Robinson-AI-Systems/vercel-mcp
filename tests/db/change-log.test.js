import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
let db;
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname)) {
    throw new Error('Only disposable localhost Postgres is permitted');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => closeIsolatedSchema());
describe('durable write audit with zero secret values', () => {
  const base = { account: 'account_FAKE', mode: 'preview', tool: 'fixture_update',
    summary: 'Fixture preview', dryRun: true, production: false,
    requestKey: 'request_FAKE_123', targets: [{ kind: 'project', id: 'prj_FAKE' }],
    before: { version: 'a' }, after: { version: 'b' },
    result: { status: 'preview' }, inverse: { tool: 'fixture_restore' } };
  it('persists safe preview record without a secret or provider token', async () => {
    const id = await db.recordChange(base);
    expect(id).toBeTruthy();
    const rows = await rawQuery('SELECT dry_run, production, result, before, request_key FROM change_log WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].dry_run).toBe(true);
    expect(rows[0].production).toBe(false);
    expect(rows[0].result).toEqual({ status: 'preview' });
    expect(rows[0].before.targets[0].id).toBe('prj_FAKE');
    expect(rows[0].request_key).toBe('request_FAKE_123');
  });
  it('stores exact cents for applied operations, but never charges a preview',async()=>{
    const preview=await db.recordChange({...base,requestKey:'previewSpendFAKE',spendCents:450});
    const applied=await db.recordChange({...base,requestKey:'appliedSpendFAKE',
      dryRun:false,spendCents:450});
    const rows=await rawQuery('SELECT id, spend_cents FROM change_log WHERE id IN ($1,$2) ORDER BY id',
      [preview,applied]);
    expect(rows[0].spend_cents).toBeNull();
    expect(Number(rows[1].spend_cents)).toBe(450);
    expect(await db.getTodaySpendCents('account_FAKE')).toBeGreaterThanOrEqual(450);
    await expect(db.recordChange({...base,spendCents:-1})).rejects.toThrow(/Spend audit/);
  });
  it('rejects nested secrets, credential strings and oversized output before insert', async () => {
    await expect(db.recordChange({ ...base, after: { token: 'fixture' } }))
      .rejects.toThrow(/sensitive field/);
    await expect(db.recordChange({ ...base, result: { data: ['vcp_FAKEcredentialvalue'] } }))
      .rejects.toThrow(/sensitive credential/);
    await expect(db.recordChange({ ...base, summary: 'x'.repeat(9000) }))
      .rejects.toThrow(/8 KB/);
    const rows = await rawQuery('SELECT count(*)::integer AS count FROM change_log');
    expect(rows[0].count).toBe(3);
  });
  it('AUD-A2: persists the owner-word delegation block in the result JSONB and refuses malformed blocks', async () => {
    const delegation = { basis: 'owner_word', budgetCents: 2500, quotedCents: 500, overBudget: false };
    const id = await db.recordChange({ ...base, dryRun: false, spendCents: 500,
      requestKey: 'ownerWordDbFAKE1', result: { status: 'applied' }, delegation });
    const rows = await rawQuery('SELECT result, spend_cents FROM change_log WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toEqual({ status: 'applied', delegation });
    expect(Number(rows[0].spend_cents)).toBe(500);
    await expect(db.recordChange({ ...base, delegation: { basis: 'owner_word', budgetCents: -1, quotedCents: 500, overBudget: false } }))
      .rejects.toThrow(/delegation/);
    await expect(db.recordChange({ ...base, delegation: { basis: 'caller_says_so', budgetCents: null, quotedCents: null, overBudget: false } }))
      .rejects.toThrow(/delegation/);
  });
});
