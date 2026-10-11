import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery }
  from '../../test/helpers/pg-neon-adapter.js';

let db;
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname)) {
    throw new Error('Disposable localhost Postgres only');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery(`INSERT INTO vercel_accounts
    (id,team_id,team_slug,label,scope,token_enc,token_last4)
    VALUES ('team_ALPHA','team_ALPHA','a','Alpha','team','ciphertext_FAKE_a','1234'),
           ('team_BETA','team_BETA','b','Beta','team','ciphertext_FAKE_b','5678')`);
  await rawQuery(`INSERT INTO oauth_tokens
    (token_hash,client_id,vercel_account,kind,expires_at)
    VALUES ('hash_FAKE_a','client_a','team_ALPHA','connector',now()+interval '1 day')`);
});
afterAll(async () => { await closeIsolatedSchema(); });
const rows = () => rawQuery('SELECT id,spend_limit_cents,token_enc,production_enabled FROM vercel_accounts ORDER BY id');
const audits = () => rawQuery("SELECT vercel_account,tool,summary,after,dry_run,production FROM change_log WHERE tool='vercel_set_spend_limit' ORDER BY id");

it('retains safe default zero; rejects invalid amounts and missing account without audit', async () => {
  expect((await rows()).map(r => r.spend_limit_cents)).toEqual([0,0]);
  for (const invalid of [-1,1.5,2147483648,'1125',NaN,Infinity]) {
    await expect(db.setOwnerSpendLimit('team_ALPHA',invalid)).rejects.toThrow();
  }
  await expect(db.setOwnerSpendLimit('bad name',1125)).rejects.toThrow();
  expect(await db.setOwnerSpendLimit('team_UNKNOWN',1125)).toBe(false);
  expect(await audits()).toHaveLength(0);
  expect((await rows()).map(r => r.spend_limit_cents)).toEqual([0,0]);
});
it('changes only selected limit; audits same transaction and preserves credentials, bearer and production', async () => {
  const before = await rows();
  const bearerBefore = await rawQuery('SELECT * FROM oauth_tokens');
  expect(await db.setOwnerSpendLimit('team_ALPHA',1125)).toBe(true);
  expect((await rows()).map(r => r.spend_limit_cents)).toEqual([1125,0]);
  expect(await db.setOwnerSpendLimit('team_ALPHA',0)).toBe(true);
  const after = await rows();
  expect(after.map(r => r.spend_limit_cents)).toEqual([0,0]);
  expect(after.map(r => [r.token_enc,r.production_enabled]))
    .toEqual(before.map(r => [r.token_enc,r.production_enabled]));
  expect(await rawQuery('SELECT * FROM oauth_tokens')).toEqual(bearerBefore);
  const logs = await audits();
  expect(logs).toHaveLength(2);
  expect(logs.map(r => r.after)).toEqual([{limitCents:1125},{limitCents:0}]);
  expect(logs.every(r => r.summary === 'Owner changed the daily spend limit' &&
    r.production === true && r.dry_run === false)).toBe(true);
  expect(await rawQuery("SELECT count(*)::int AS n FROM change_log WHERE spend_cents IS NOT NULL"))
    .toMatchObject([{n:0}]);
});
