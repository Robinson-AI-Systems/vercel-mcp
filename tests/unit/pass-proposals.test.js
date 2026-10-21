import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
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
  issueReadOnlyRtcPass:vi.fn(async scope=>{
    const token='rtc_pass_'+randomBytes(32).toString('base64url'),id='pass_'+'a'.repeat(20);
    passes.set(token,{status:'ok',id,account:scope.account,profile:'read_only',mode:scope.mode,areas:scope.areas,rateLimitPerMinute:scope.rateLimitPerMinute});
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
const approve=(reference,env)=>({action:'approve_rtc_pass_request',account,reference,csrf,confirm:'yes',passphrase:env.ADMIN_PASSPHRASE});
describe('R-1 service-owned owner-reviewed read-only pass requests',()=>{
 it('previews and proposes without issuing a bearer or granting access',async()=>{
   const f=fixture();expect(parse(await f.call({dryRun:true})).status).toBe('preview');
   expect(parse(await f.call({})).status).toBe('needs_confirmation');
   const r=parse(await f.call({confirm:true}));expect(r).toMatchObject({status:'awaiting_owner_approval',confirmed:false,ownerApprovalRequired:true});
   expect(r.preview).toMatch(/24-hour read-only preview/);expect(r.preview).toMatch(/areas: server/);
   expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();expect(f.rows.size).toBe(1);
   expect(JSON.stringify(r)).not.toMatch(/rtc_pass_/);
 });
 it('denies narrow profiles, preview server/connection and scope widening inputs',async()=>{
   const f=fixture();for(const profile of ['read_only','everyday']){
    expect(listMcpTools(registry,{profile}).map(x=>x.name)).not.toContain('vercel_create_pass');
    expect((await f.call({confirm:true},{...f.connection,profile})).isError).toBe(true);
   }
   expect(parse(await f.call({confirm:true},{...f.connection,mode:'preview'})).status).toBe('refused_by_guard');
   expect(parse(await f.call({confirm:true},f.connection,{...f.env,VERCEL_ENV:'preview'})).status).toBe('refused_by_guard');
   for(const args of [{mode:'production'},{mode:'test',areas:['projects']},{areas:['unknown']},
    {areas:['server','server']},{hours:721},{rateLimitPerMinute:0},{rateLimitPerMinute:601},{allow_writes:true},{spendLimit:100},{account:'team_OTHER'}])
    expect(parse(await f.call({...args,confirm:true})).status).toBe('refused_by_guard');
   expect(f.rows.size).toBe(0);
 });
 it('reviews exact sealed scope without consuming or issuing',async()=>{
   const f=fixture(),r=parse(await f.call({mode:'test',areas:['server'],hours:1,confirm:true}));
   const res=await f.send({action:'review_rtc_pass_request',account,reference:r.reference,csrf});
   expect(res.statusCode).toBe(200);expect(res.body).toContain('Read-only test; 1 hours; areas: server; 120 calls/minute');
   expect(f.rows.size).toBe(1);expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();
 });
 it('requires owner session, CSRF, fresh passphrase and exact account before consumption',async()=>{
   const f=fixture(),r=parse(await f.call({confirm:true})),body=approve(r.reference,f.env);
   for(const x of [{...body,csrf:'wrong'},{...body,passphrase:'wrong'},{...body,confirm:'no'},
     {...body,account:'team_OTHER'}])expect((await f.send(x)).statusCode).not.toBe(200);
   expect((await f.send(body,'')).statusCode).toBe(403);
   expect(f.rows.size).toBe(1);expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();
 });
 it('issues exact scope once, independently verifies it and encrypts bearer for one-time delivery',async()=>{
   const f=fixture(),r=parse(await f.call({mode:'test',hours:1,areas:['server'],confirm:true}));
   const body={...approve(r.reference,f.env),mode:'production',hours:'720',areas:'projects'};
   const res=await f.send(body);expect(res.statusCode).toBe(200);
   expect(f.db.issueReadOnlyRtcPass).toHaveBeenCalledExactlyOnceWith({account,mode:'test',hours:1,areas:['server'],rateLimitPerMinute:120});
   expect(f.db.inspectRtcPass).toHaveBeenCalledOnce();
   expect(res.body).not.toContain([...f.passes.keys()][0]);
   expect([...f.rows.values()][0].kind).toBe('rtc_pass');
   expect((await f.send(body)).statusCode).toBe(409);expect(f.db.issueReadOnlyRtcPass).toHaveBeenCalledOnce();
 });
 it('refuses expired requests and concurrent approval replay',async()=>{
   const f=fixture(),r=parse(await f.call({confirm:true}));f.rows.get(r.reference).expiresAt=new Date(Date.now()-1);
   expect((await f.send(approve(r.reference,f.env))).statusCode).toBe(409);
   const g=fixture(),s=parse(await g.call({confirm:true}));
   const results=await Promise.all([g.send(approve(s.reference,g.env)),g.send(approve(s.reference,g.env))]);
   expect(results.map(x=>x.statusCode).sort()).toEqual([200,409]);expect(g.db.issueReadOnlyRtcPass).toHaveBeenCalledOnce();
 });
 it('revokes an unverified scope or failed one-time delivery without showing a bearer',async()=>{
   for(const failure of ['scope','readback','delivery']){
    const f=fixture(),r=parse(await f.call({confirm:true}));
    if(failure==='scope')f.db.inspectRtcPass.mockResolvedValue({status:'ok',mode:'production'});
    else if(failure==='readback')f.db.inspectRtcPass.mockRejectedValue(new Error('read failed'));
    else f.db.insertOneTimeSecret.mockRejectedValueOnce(new Error('storage unavailable'));
    const res=await f.send(approve(r.reference,f.env));expect(res.statusCode).toBe(409);
    expect(f.db.revokeRtcPass).toHaveBeenCalledOnce();expect(res.body).not.toContain([...f.passes.keys()][0]);
   }
 });
});
