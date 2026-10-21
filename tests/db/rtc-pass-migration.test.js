import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery}
  from '../../test/helpers/pg-neon-adapter.js';

const url=process.env.TEST_DATABASE_URL;
let db;
beforeAll(async()=>{
  if(!url||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw new Error('Disposable local Postgres required');
  await openIsolatedSchema(url);
  // Faithful original column set without the new rate_limit_per_minute.
  await rawQuery(`CREATE TABLE rtc_passes (
    pass_id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
    vercel_account TEXT NOT NULL, profile TEXT NOT NULL DEFAULT 'read_only',
    mode TEXT NOT NULL DEFAULT 'preview', listing TEXT NOT NULL DEFAULT 'compact',
    areas JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ,
    window_started TIMESTAMPTZ NOT NULL DEFAULT now(),
    window_count INTEGER NOT NULL DEFAULT 0)`);
  await rawQuery(`INSERT INTO rtc_passes(pass_id,token_hash,vercel_account,areas,expires_at)
    VALUES('pass_aaaaaaaaaaaaaaaaaaaa','legacy-hash','team_FAKE','["server"]',now()+interval '1 hour')`);
  db=createDb(neonShapedQuery());
});
afterAll(async()=>closeIsolatedSchema());
describe('RTC grant migration never widens existing authority',()=>{
  it('backfills the original 60-per-minute limit and defaults new passes to 120',async()=>{
    await db.initSchema();
    const preserved=await rawQuery("SELECT rate_limit_per_minute,window_count FROM rtc_passes WHERE token_hash='legacy-hash'");
    expect(preserved).toEqual([{rate_limit_per_minute:60,window_count:0}]);
    const def=await rawQuery(`SELECT column_default,is_nullable FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='rtc_passes' AND column_name='rate_limit_per_minute'`);
    expect(def).toEqual([{column_default:'120',is_nullable:'NO'}]);
    await db.initSchema();
    const repeated=await rawQuery("SELECT rate_limit_per_minute FROM rtc_passes WHERE token_hash='legacy-hash'");
    expect(repeated).toEqual([{rate_limit_per_minute:60}]);
  });
});
