// R-1W: write-capable pass proposals (payload v2) and owner approval.
import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
const account='team_ALPHA';
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
 const connection={account,kind:'connector',profile:'full',mode:'production',listing:'catalog'};
 const call=(args,c=connection,e=env)=>dispatchReadOnlyTool({registry,name:'vercel_create_pass',args,connection:c,db,env:e});
 const apply=(args,c=connection,e=env)=>dispatchReadOnlyTool({registry,
   name:'vercel_apply_owner_approval',args,connection:c,db,env:e});
 return {db,env,rows,connection,call,apply,passes};
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
 it('owner inspection states the write scope; application issues exactly that scope',async()=>{
   const f=fixture();
   const r=parse(await f.call({...writeArgs,confirm:true}));
   const review=parse(await f.apply({reference:r.reference,dryRun:true}));
   expect(review.status).toBe('preview');
   expect(review.family).toBe('rtc_pass_request');
   expect(review.summary).toMatch(/Write-capable production pass \(full profile\)/);
   expect(review.summary).toMatch(/Spend ceiling \$25\.00/);
   expect(review.summary).toMatch(/prj_FAKEONE/);
   const approved=await f.apply({reference:r.reference,confirm:true});
   expect(parse(approved).status).toBe('applied');
   expect(f.db.issueWriteRtcPass).toHaveBeenCalledExactlyOnceWith({
     account,profile:'full',mode:'production',hours:48,areas:['deployments','server'],
     spendLimitCents:2500,projectIds:['prj_FAKEONE'],rateLimitPerMinute:120});
   expect(approved.content[0].text).not.toMatch(/rtc_pass_[A-Za-z0-9_-]{20,}/);
   // The request is consumed: a second application cannot reissue.
   const again=parse(await f.apply({reference:r.reference,confirm:true}));
   expect(again.status).toBe('refused_by_guard');
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
