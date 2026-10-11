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
  it('rejects nested secrets, credential strings and oversized output before insert', async () => {
    await expect(db.recordChange({ ...base, after: { token: 'fixture' } }))
      .rejects.toThrow(/sensitive field/);
    await expect(db.recordChange({ ...base, result: { data: ['vcp_FAKEcredentialvalue'] } }))
      .rejects.toThrow(/sensitive credential/);
    await expect(db.recordChange({ ...base, summary: 'x'.repeat(9000) }))
      .rejects.toThrow(/8 KB/);
    const rows = await rawQuery('SELECT count(*)::integer AS count FROM change_log');
    expect(rows[0].count).toBe(1);
  });
});
