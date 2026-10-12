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
  issueReadOnlyRtcPass:vi.fn(async()=>({token:issued,id:'pass_'+'a'.repeat(20)})),
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
const common={action:'issue_rtc_pass',account:'team_FAKE',hours:'24',
  areas:'server,projects',csrf,confirm:'yes',passphrase:env.ADMIN_PASSPHRASE};
describe('RTC owner setup issue and revoke',()=>{
 it('refuses forged CSRF, absent session, wrong passphrase, production bypass and overbroad lifetime',async()=>{
  const f=fixture();
  for(const [body,c,e] of [
   [{...common,csrf:'wrong'},cookie,env],[common,'',env],
   [{...common,passphrase:'wrong'},cookie,env],
   [common,cookie,{...env,VERCEL_ENV:'preview'}],
   [{...common,hours:'721'},cookie,env],
   [{...common,areas:'unknown'} ,cookie,env]
  ])expect((await f.send(body,c,e)).statusCode).not.toBe(200);
  expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();
 });
 it('issues pass only into encrypted one-time secret, never HTML',async()=>{
  const f=fixture(),res=await f.send(common);
  expect(res.statusCode).toBe(200);
  expect(f.db.issueReadOnlyRtcPass).toHaveBeenCalledExactlyOnceWith({
   account:'team_FAKE',hours:24,areas:['server','projects'],mode:'preview'});
  expect(f.db.insertOneTimeSecret).toHaveBeenCalledOnce();
  expect(res.body).not.toContain(f.issued);
 });
 it('issues TEST only for service identity and refuses area/mode escalation',async()=>{
  const f=fixture();
  expect((await f.send({...common,mode:'test',areas:'server'})).statusCode).toBe(200);
  expect(f.db.issueReadOnlyRtcPass).toHaveBeenCalledWith({
    account:'team_FAKE',hours:24,areas:['server'],mode:'test'});
  for(const bad of [
    {...common,mode:'test',areas:'projects'},
    {...common,mode:'test',areas:'server,projects'},
    {...common,mode:'production',areas:'server'}
  ])expect((await f.send(bad)).statusCode).toBe(400);
  expect(f.db.issueReadOnlyRtcPass).toHaveBeenCalledTimes(1);
 });
 it('revokes only exact owner-scoped references after fresh reauthentication',async()=>{
  const f=fixture(),id='pass_'+'a'.repeat(20);
  expect((await f.send({action:'revoke_rtc_pass',id,account:'team_FAKE',csrf,
    confirm:'yes',passphrase:env.ADMIN_PASSPHRASE})).statusCode).toBe(200);
  expect(f.db.revokeRtcPass).toHaveBeenCalledExactlyOnceWith({account:'team_FAKE',id});
 });
});
