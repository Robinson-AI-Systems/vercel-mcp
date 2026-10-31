// R-1W: direct write-capable pass issuance on owner setup.
import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {encryptSecret} from '../../src/core/secret-box.js';
import {handleSetup} from '../../src/vercel/setup.js';
const env={VERCEL_ENV:'production',ADMIN_PASSPHRASE:'fixture-passphrase',
 TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
const csrf='a'.repeat(43);
const cookie='rmcp_owner='+encryptSecret(JSON.stringify({csrf,exp:Date.now()+600000}),
  'setup:session',env);
function response(){return {headers:{},statusCode:0,body:'',
  setHeader(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},
  send(v){this.body=v;return this;},end(){return this;}};}
function fixture(){
 const issued='rtc_pass_'+randomBytes(32).toString('base64url');
 const db={
  listVercelAccounts:async()=>[{id:'team_FAKE',label:'Fixture',scope:'team'}],
  issueWriteRtcPass:vi.fn(async()=>({token:issued,id:'pass_'+'c'.repeat(20)})),
  revokeRtcPass:vi.fn(async()=>true),
  insertOneTimeSecret:vi.fn(async()=>{}),
  consumeOneTimeSecret:vi.fn(async()=>null),
  recordLoginAttempt:async()=>1,countRecentFailedLogins:async()=>0,
  markLoginAttemptSucceeded:async()=>{}
 };
 const send=async(body,c=cookie,e=env)=>{
  const res=response();
  await handleSetup({method:'POST',headers:{cookie:c,'x-real-ip':'127.0.0.1'},body},
    res,{db,env:e});return res;
 };
 return {db,issued,send};
}
const common={action:'issue_rtc_write_pass',account:'team_FAKE',profile:'everyday',
  mode:'preview',hours:'24',areas:'server,deployments',rateLimitPerMinute:'120',
  spendDollars:'25.50',csrf,confirm:'yes',passphrase:env.ADMIN_PASSPHRASE};
describe('RTC owner setup direct write-pass issuance',()=>{
 it('issues only into the encrypted one-time secret, with the ceiling parsed to cents',async()=>{
  const f=fixture(),res=await f.send(common);
  expect(res.statusCode).toBe(200);
  expect(f.db.issueWriteRtcPass).toHaveBeenCalledExactlyOnceWith({
   account:'team_FAKE',profile:'everyday',hours:24,areas:['server','deployments'],
   mode:'preview',spendLimitCents:2550,projectIds:null,rateLimitPerMinute:120});
  expect(f.db.insertOneTimeSecret).toHaveBeenCalledOnce();
  expect(res.body).not.toContain(f.issued);
  expect(res.body).toMatch(/Write-capable preview pass issued \(everyday profile, spend ceiling \$25\.50\)/);
 });
 it('parses an optional project restriction and a production/full scope',async()=>{
  const f=fixture();
  const res=await f.send({...common,mode:'production',profile:'full',
    projectIds:'prj_FAKEONE, prj_FAKETWO',spendDollars:'0'});
  expect(res.statusCode).toBe(200);
  expect(f.db.issueWriteRtcPass).toHaveBeenCalledExactlyOnceWith({
   account:'team_FAKE',profile:'full',hours:24,areas:['server','deployments'],
   mode:'production',spendLimitCents:0,projectIds:['prj_FAKEONE','prj_FAKETWO'],
   rateLimitPerMinute:120});
 });
 it('refuses forged CSRF, wrong passphrase, preview deployment and malformed scopes',async()=>{
  const f=fixture();
  for(const [body,c,e] of [
   [{...common,csrf:'wrong'},cookie,env],
   [common,'',env],
   [{...common,passphrase:'wrong'},cookie,env],
   [common,cookie,{...env,VERCEL_ENV:'preview'}],
   [{...common,confirm:'no'},cookie,env],
   [{...common,spendDollars:'25.505'},cookie,env],
   [{...common,spendDollars:'-1'},cookie,env],
   [{...common,spendDollars:'abc'},cookie,env],
   [{...common,spendDollars:'1,000'},cookie,env],
   [{...common,areas:'unknown'},cookie,env],
   [{...common,mode:'test'},cookie,env],
   [{...common,profile:'read_only'},cookie,env],
   [{...common,projectIds:'bad id!'},cookie,env],
   [{...common,hours:'721'},cookie,env]
  ])expect((await f.send(body,c,e)).statusCode).not.toBe(200);
  expect(f.db.issueWriteRtcPass).not.toHaveBeenCalled();
 });
});
