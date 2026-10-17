import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery}
  from '../../test/helpers/pg-neon-adapter.js';
let db;
const account='acct_sandbox_fixture',runId='run_20261016_sandboxfixture';
beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw new Error('Local disposable Postgres required');
  const url=new URL(process.env.TEST_DATABASE_URL);
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))
    throw new Error('Refusing any non-local account DB');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery(`INSERT INTO vercel_accounts
    (id,team_id,team_slug,label,scope,token_enc,token_last4,sandbox_minutes_per_day)
    VALUES ($1,'team_fake','team-fake','Synthetic accounting','team','encrypted-fixture','fake',60)`,[account]);
});
afterAll(async()=>closeIsolatedSchema());
it('atomically records all concurrent sessions, never blocking on the legacy 60-minute column',async()=>{
  const day='2026-10-16';
  const rows=await Promise.all(Array.from({length:4},
    ()=>db.recordDevSandboxMinutes({account,minutes:20,day})));
  expect(rows.every(x=>x.recorded)).toBe(true);
  expect((await rawQuery('SELECT minutes FROM dev_sandbox_usage WHERE vercel_account=$1 AND day=$2',
    [account,day]))).toEqual([{minutes:80}]);
  expect(await db.recordDevSandboxMinutes({account:'acct_foreign',minutes:1,day}))
    .toEqual({recorded:false});
  expect((await db.recordDevSandboxMinutes({account,minutes:1440,day})))
    .toMatchObject({recorded:true,used:1520});
  expect((await db.recordDevSandboxMinutes({account,minutes:20,day:'2026-10-17'})))
    .toMatchObject({recorded:true,used:20});
});
it('wipes encrypted webhook secret metadata on exact owned cleanup only',async()=>{
  await db.createDevRun({id:runId,account,connection:'builder_preview',description:'Synthetic webhook'});
  await db.addDevRunObject({id:runId,account,type:'webhook',objectId:'webhook-secret',
    projectId:'prj_owner_fixture',detail:{ciphertext:'sealed-only'}});
  expect(await db.setDevRunObjectOutcome({id:runId,account:'foreign',
    type:'webhook',objectId:'webhook-secret',status:'cleaned'})).toBe(false);
  const before=await db.listDevRunObjects({id:runId,account});
  expect(before[0].detail.ciphertext).toBe('sealed-only');
  expect(await db.setDevRunObjectOutcome({id:runId,account,
    type:'webhook',objectId:'webhook-secret',status:'cleaned'})).toBe(true);
  const after=await db.listDevRunObjects({id:runId,account});
  expect(after[0].detail).toEqual({});
  expect(await db.completeDevRunCleanup({account,id:runId})).toBe(true);
});
it('ignores legacy sandbox quotas irrespective of their stored value',async()=>{
  await rawQuery('UPDATE vercel_accounts SET sandbox_minutes_per_day=1 WHERE id=$1',[account]);
  const day='2026-10-18';
  expect((await db.recordDevSandboxMinutes({account,minutes:45,day})).recorded).toBe(true);
  expect((await db.recordDevSandboxMinutes({account,minutes:30,day})).recorded).toBe(true);
  expect((await rawQuery('SELECT minutes FROM dev_sandbox_usage WHERE vercel_account=$1 AND day=$2',
    [account,day]))[0].minutes).toBe(75);
});
