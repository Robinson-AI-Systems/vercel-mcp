// R-1W: write-capable RTC passes in the database layer (throwaway Postgres).
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
describe('R-1W write-capable RTC passes (database)',()=>{
 it('issues, inspects and authorizes a write pass with its full scope intact',async()=>{
  const issued=await db.issueWriteRtcPass({account:'team_FAKE',profile:'full',
    mode:'production',hours:2,areas:['server','deployments'],spendLimitCents:2500,
    projectIds:['prj_FAKEONE','prj_FAKETWO'],rateLimitPerMinute:30});
  expect(issued.token).toMatch(/^rtc_pass_[A-Za-z0-9_-]{43}$/);
  const rows=await rawQuery('SELECT * FROM rtc_passes');
  expect(JSON.stringify(rows)).not.toContain(issued.token);
  const expected={status:'ok',account:'team_FAKE',profile:'full',mode:'production',
    areas:['server','deployments'],allowWrites:true,spendLimitCents:2500,
    projectIds:['prj_FAKEONE','prj_FAKETWO'],rateLimitPerMinute:30};
  expect(await db.inspectRtcPass(issued.token)).toMatchObject(expected);
  expect(await db.authorizeRtcPass(issued.token)).toMatchObject(expected);
  // The issuance is journaled under its own tool name.
  const log=await rawQuery("SELECT tool FROM change_log WHERE tool='vercel_owner_issue_write_pass'");
  expect(log.length).toBe(1);
 });
 it('defaults a write pass to no project restriction and a zero ceiling',async()=>{
  const issued=await db.issueWriteRtcPass({account:'team_FAKE',areas:['server']});
  expect(await db.inspectRtcPass(issued.token)).toMatchObject({
    profile:'everyday',mode:'preview',allowWrites:true,spendLimitCents:0,projectIds:null});
 });
 it('refuses invalid write issuance shapes',async()=>{
  for(const bad of [
    {account:'team_FAKE',areas:['server'],profile:'read_only'},
    {account:'team_FAKE',areas:['server'],mode:'test'},
    {account:'team_FAKE',areas:['server'],spendLimitCents:-1},
    {account:'team_FAKE',areas:['server'],spendLimitCents:1.5},
    {account:'team_FAKE',areas:['server'],projectIds:['bad id!']},
    {account:'team_FAKE',areas:[]}
  ])await expect(db.issueWriteRtcPass(bad)).rejects.toThrow();
  // An unknown account issues nothing (null), exactly like read issuance.
  expect(await db.issueWriteRtcPass({account:'team_MISSING',areas:['server']})).toBeNull();
 });
 it('keeps read passes byte-compatible: no write fields leak into read results',async()=>{
  const read=await db.issueReadOnlyRtcPass({account:'team_FAKE',hours:1,areas:['server']});
  const inspected=await db.inspectRtcPass(read.token);
  expect(inspected).toMatchObject({status:'ok',profile:'read_only',mode:'preview'});
  expect(inspected).not.toHaveProperty('allowWrites');
  expect(inspected).not.toHaveProperty('spendLimitCents');
  expect(inspected).not.toHaveProperty('projectIds');
  const authorized=await db.authorizeRtcPass(read.token);
  expect(authorized).not.toHaveProperty('allowWrites');
 });
 it('refuses corrupted rows that mix the read and write shapes',async()=>{
  const write=await db.issueWriteRtcPass({account:'team_FAKE',areas:['server']});
  // allow_writes stripped from a delegated-profile row.
  await rawQuery('UPDATE rtc_passes SET allow_writes=false WHERE pass_id=$1',[write.id]);
  expect((await db.inspectRtcPass(write.token)).status).toBe('permission');
  expect((await db.authorizeRtcPass(write.token)).status).toBe('permission');
  await rawQuery('UPDATE rtc_passes SET allow_writes=true WHERE pass_id=$1',[write.id]);
  // TEST mode can never carry writes.
  await rawQuery("UPDATE rtc_passes SET mode='test' WHERE pass_id=$1",[write.id]);
  expect((await db.inspectRtcPass(write.token)).status).toBe('permission');
  expect((await db.authorizeRtcPass(write.token)).status).toBe('permission');
  await rawQuery("UPDATE rtc_passes SET mode='preview' WHERE pass_id=$1",[write.id]);
  // A read-only profile can never carry writes either.
  const read=await db.issueReadOnlyRtcPass({account:'team_FAKE',hours:1,areas:['server']});
  await rawQuery('UPDATE rtc_passes SET allow_writes=true WHERE pass_id=$1',[read.id]);
  expect((await db.inspectRtcPass(read.token)).status).toBe('permission');
  expect((await db.authorizeRtcPass(read.token)).status).toBe('permission');
 });
 it('enforces the per-minute window for write passes and revokes them like any pass',async()=>{
  const issued=await db.issueWriteRtcPass({account:'team_FAKE',areas:['server'],rateLimitPerMinute:1});
  expect((await db.authorizeRtcPass(issued.token)).status).toBe('ok');
  expect((await db.authorizeRtcPass(issued.token)).status).toBe('rate_limited');
  expect(await db.revokeRtcPass({account:'team_OTHER',id:issued.id})).toBe(false);
  expect(await db.revokeRtcPass({account:'team_FAKE',id:issued.id})).toBe(true);
  expect((await db.inspectRtcPass(issued.token)).status).toBe('pass_revoked');
 });
});
