import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery}
  from '../../test/helpers/pg-neon-adapter.js';
let db;const url=process.env.TEST_DATABASE_URL;
beforeAll(async()=>{
 if(!url||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
   throw new Error('Disposable local Postgres required');
 await openIsolatedSchema(url);
 db=createDb(neonShapedQuery());await db.initSchema();
 await rawQuery("INSERT INTO vercel_accounts(id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES ('team_FAKE','team_FAKE','fake','Fake','team','fake','fake')");
});
afterAll(async()=>closeIsolatedSchema());
describe('RTC database-scoped credential lifecycle',()=>{
 it('issues 32 cryptographically random bytes in the wire format and never stores plaintext',async()=>{
  const a=await db.issueReadOnlyRtcPass({account:'team_FAKE',hours:1,areas:['server']});
  const b=await db.issueReadOnlyRtcPass({account:'team_FAKE',hours:1,areas:['server']});
  expect(a.token).toMatch(/^rtc_pass_[A-Za-z0-9_-]{43}$/);
  expect(a.token).not.toBe(b.token);
  const rows=await rawQuery('SELECT * FROM rtc_passes ORDER BY created_at');
  expect(JSON.stringify(rows)).not.toContain(a.token);
  expect((await db.authorizeRtcPass(a.token))).toMatchObject({
   status:'ok',account:'team_FAKE',profile:'read_only',mode:'preview',areas:['server']});
  expect(await db.revokeRtcPass({account:'team_OTHER',id:a.id})).toBe(false);
  expect(await db.revokeRtcPass({account:'team_FAKE',id:a.id})).toBe(true);
  expect((await db.authorizeRtcPass(a.token)).status).toBe('pass_revoked');
  expect(await db.revokeRtcPass({account:'team_FAKE',id:a.id})).toBe(false);
 });
 it('expires, caps, and limits passes across calls with no memory counter',async()=>{
  const a=await db.issueReadOnlyRtcPass({account:'team_FAKE',hours:1,areas:['server']});
  for(let i=0;i<60;i++)expect((await db.authorizeRtcPass(a.token)).status).toBe('ok');
  expect((await db.authorizeRtcPass(a.token)).status).toBe('rate_limited');
  await rawQuery('UPDATE rtc_passes SET expires_at=now()-interval \'1 second\' WHERE pass_id=$1',[a.id]);
  expect((await db.authorizeRtcPass(a.token)).status).toBe('pass_expired');
  expect(await db.issueReadOnlyRtcPass({account:'team_FAKE',hours:721})).rejects.toThrow();
 });
});
