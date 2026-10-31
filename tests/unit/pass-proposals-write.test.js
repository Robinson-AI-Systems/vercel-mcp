// R-1W: write-capable pass proposals (payload v2) and owner approval.
import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {encryptSecret} from '../../src/core/secret-box.js';
import {handleSetup} from '../../src/vercel/setup.js';
const account='team_ALPHA',csrf='a'.repeat(43);
function fixture(){
 const rows=new Map(),replays=new Map(),passes=new Map();
 const env={VERCEL_ENV:'production',ADMIN_PASSPHRASE:'fixture-passphrase',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
 const db={listVercelAccounts:async()=>[{id:account,label:'Test account'}],
  listProtectedResources:async()=>[],recordChange:vi.fn(async()=>{}),
  insertOneTimeSecret:vi.fn(async row=>rows.set(row.id,{...row,vercel_account:row.account,expires_at:row.expiresAt})),
  getRtcPassRequest:async({account:a,reference})=>{
    const r=rows.get(reference);return r?.vercel_account===a&&r.kind==='rtc_pass_request'&&r.expiresAt>Date.now()?r:null;
  },
  consumeOneTimeSecret:async({id,account:a})=>{
    const r=rows.get(id);if(!r||r.vercel_account!==a||r.expiresAt<=Date.now())return null;
    rows.delete(id);return r;
  },
  requestReplayStore:()=>({claim:async({key})=>{
    if(replays.has(key))return replays.get(key);replays.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};
  },complete:async({key,result})=>replays.set(key,{state:'completed',result})}),
  issueReadOnlyRtcPass:vi.fn(async()=>null),
  issueWriteRtcPass:vi.fn(async scope=>{
    const token='rtc_pass_'+randomBytes(32).toString('base64url'),id='pass_'+'b'.repeat(20);
    passes.set(token,{status:'ok',id,account:scope.account,profile:scope.profile,mode:scope.mode,
      areas:scope.areas,rateLimitPerMinute:scope.rateLimitPerMinute,allowWrites:true,
      spendLimitCents:scope.spendLimitCents,projectIds:scope.projectIds});
    return {id,token};
  }),inspectRtcPass:vi.fn(async token=>passes.get(token)),revokeRtcPass:vi.fn(async()=>true),
  countRecentFailedLogins:async()=>0,recordLoginAttempt:async()=>1,markLoginAttemptSucceeded:async()=>{}
 };
 const connection={account,profile:'full',mode:'production',listing:'catalog'};
 const call=(args,c=connection,e=env)=>dispatchReadOnlyTool({registry,name:'vercel_create_pass',args,connection:c,db,env:e});
 const cookie='rmcp_owner='+encryptSecret(JSON.stringify({csrf,exp:Date.now()+600000}),'setup:session',env);
 const send=async(body,c=cookie,e=env)=>{
   const res={statusCode:0,body:'',headers:{},setHeader(k,v){this.headers[k]=v;return this;},
     status(n){this.statusCode=n;return this;},send(v){this.body=v;return this;},end(){return this;}};
   await handleSetup({method:'POST',headers:{cookie:c,'x-real-ip':'127.0.0.1'},body},res,{db,env:e});return res;
 };
 return {db,env,rows,connection,call,send,passes};
}
const parse=x=>JSON.parse(x.content[0].text);
const writeArgs={writes:true,profile:'full',mode:'production',hours:48,
  areas:['server','deployments'],spendLimitCents:2500,projectIds:['prj_FAKEONE']};
describe('R-1W write-capable pass proposals',()=>{
 it('previews the write scope in plain words and proposes without issuing',async()=>{
   const f=fixture();
   const dry=parse(await f.call({...writeArgs,dryRun:true}));
   expect(dry.status).toBe('preview');
   expect(dry.preview).toMatch(/48-hour write-capable production pass \(full profile\)/);
   expect(dry.preview).toMatch(/spend ceiling \$25\.00/);
   expect(dry.preview).toMatch(/projects: prj_FAKEONE/);
   const r=parse(await f.call({...writeArgs,confirm:true}));
   expect(r).toMatchObject({status:'awaiting_owner_approval',ownerApprovalRequired:true});
   expect(f.db.issueWriteRtcPass).not.toHaveBeenCalled();
   expect(JSON.stringify(r)).not.toMatch(/rtc_pass_[A-Za-z0-9_-]{20,}/);
 });
 it('refuses malformed write scopes and write-only arguments on a read proposal',async()=>{
   const f=fixture();
   for(const args of [
     {...writeArgs,mode:'test'},
     {...writeArgs,areas:['unknown']},
     {...writeArgs,areas:['server','server']},
     {...writeArgs,spendLimitCents:-1},
     {...writeArgs,projectIds:['bad id!']},
     {...writeArgs,projectIds:[]},
     {spendLimitCents:100},
     {profile:'full'},
     {projectIds:['prj_FAKEONE']},
     {writes:false,spendLimitCents:100},
     {mode:'production'}
   ])expect(parse(await f.call({...args,confirm:true})).status).toBe('refused_by_guard');
   expect(f.db.issueWriteRtcPass).not.toHaveBeenCalled();
   expect(f.rows.size).toBe(0);
 });
 it('owner review states the write scope; approval issues exactly that scope',async()=>{
   const f=fixture();
   const r=parse(await f.call({...writeArgs,confirm:true}));
   const review=await f.send({action:'review_rtc_pass_request',account,reference:r.reference,csrf});
   expect(review.statusCode).toBe(200);
   expect(review.body).toMatch(/Write-capable production pass \(full profile\)/);
   expect(review.body).toMatch(/Spend ceiling \$25\.00/);
   expect(review.body).toMatch(/prj_FAKEONE/);
   const approved=await f.send({action:'approve_rtc_pass_request',account,reference:r.reference,
     csrf,confirm:'yes',passphrase:f.env.ADMIN_PASSPHRASE});
   expect(approved.statusCode).toBe(200);
   expect(approved.body).toMatch(/Owner-approved write-capable production pass issued/);
   expect(f.db.issueWriteRtcPass).toHaveBeenCalledExactlyOnceWith({
     account,profile:'full',mode:'production',hours:48,areas:['deployments','server'],
     spendLimitCents:2500,projectIds:['prj_FAKEONE'],rateLimitPerMinute:120});
   expect(approved.body).not.toMatch(/rtc_pass_[A-Za-z0-9_-]{20,}/);
   // The request is consumed: a second approval cannot reissue.
   const again=await f.send({action:'approve_rtc_pass_request',account,reference:r.reference,
     csrf,confirm:'yes',passphrase:f.env.ADMIN_PASSPHRASE});
   expect(again.statusCode).toBe(409);
   expect(f.db.issueWriteRtcPass).toHaveBeenCalledTimes(1);
 });
 it('defaults a minimal write proposal to everyday/preview with a zero ceiling',async()=>{
   const f=fixture();
   const dry=parse(await f.call({writes:true,areas:['server'],dryRun:true}));
   expect(dry.preview).toMatch(/write-capable preview pass \(everyday profile\)/);
   expect(dry.preview).toMatch(/spend ceiling \$0\.00 \(spending refused\)/);
   expect(dry.preview).toMatch(/projects: no restriction/);
 });
});
