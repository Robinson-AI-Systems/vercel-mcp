import {describe,it,expect,vi,beforeEach} from 'vitest';
import {deploymentReadTools} from '../../src/tools/deployments.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const conn={account:'acct_ONE',profile:'read_only',mode:'preview',listing:'catalog'};
const db={getAccountCredential:async()=>({})};
const registry=mergeNamespaces([deploymentReadTools]);
const deployment='dpl_ABC123',project='prj_ONE',at=Date.now();
const call=(args,fetchImpl)=>dispatchReadOnlyTool({registry,
  name:'vercel_deploy_get_runtime_logs',args,connection:conn,db,fetchImpl});
const obj=result=>JSON.parse(result.content[0].text);
function makeFetch(rows,contentType='application/x-ndjson'){
 const f=makeFakeVercel();
 f.when('GET','/v13/deployments/{idOrUrl}').resolves({uid:deployment,projectId:project});
 const original=f.fetch;
 const lines=rows.map(x=>JSON.stringify(x)).join('\n')+'\n';
 f.fetch=async(url,init)=>{
   if(new URL(url).pathname.includes('/runtime-logs'))return new Response(lines,{
     headers:{'content-type':contentType}});
   return original(url,init);
 };
 return f;
}
const log=(changes={})=>({timestampInMs:at-120000,level:'error',
 responseStatusCode:500,requestPath:'/api/health',
 message:'vcp_FAKE_NEVER_SHOW_any_sensitive_message',...changes});
describe('D-2 project-verified bounded runtime logs',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE_token',
 account:{id:'acct_ONE',team_id:'team_ONE',scope:'project',project_id:project}});});
 it('filters locally and never exposes messages, URLs or raw request metadata',async()=>{
   const f=makeFetch([log(),log({level:'info',responseStatusCode:200}),log({timestampInMs:at-99999999})]);
   const got=obj(await call({deployment,sinceMs:at-1800000,untilMs:at,level:'error',status:500,
     path:'/api/health'},f.fetch));
   expect(got).toMatchObject({project,deployment,matched:1,inWindow:2,
     levels:{error:1,warning:0},containsRawLogText:false});
   expect(got.transport).toMatchObject({complete:false,cutoff:'stream_end'});
   expect(JSON.stringify(got)).not.toMatch(/vcp_FAKE_NEVER_SHOW|\/api\/health|sensitive_message/);
 });
 it('accepts finite JSON objects without newline and cannot infer full availability',async()=>{
   const f=makeFetch([log()]);
   const original=f.fetch;
   const fetch=async(url,init)=>new URL(url).pathname.includes('/runtime-logs')?
     new Response(JSON.stringify(log())):original(url,init);
   const got=obj(await call({deployment},fetch));
   expect(got).toMatchObject({matched:1,transport:{complete:false}});
 });
 it('negotiates Vercel streaming media type without changing ordinary read headers',async()=>{
   const f=makeFetch([]);
   const original=f.fetch;
   let requestedAccept;
   const fetch=async(url,init)=>{
     if(new URL(url).pathname.includes('/runtime-logs')){
       requestedAccept=init.headers.accept;
       return new Response(JSON.stringify(log())+'\n',{
         headers:{'content-type':'application/stream+json'}});
     }
     return original(url,init);
   };
   const got=obj(await call({deployment},fetch));
   expect(got.matched).toBe(1);
   expect(requestedAccept).toBe('application/stream+json');
   expect(f.calls[0].headers.accept).toBe('application/json');
   expect(JSON.stringify(got)).not.toContain('vcp_FAKE_NEVER_SHOW');
 });
 it('accepts HTTP 204 as an explicitly incomplete empty sample, not an exception',async()=>{
   const f=makeFetch([]);
   const fetch=async(url,init)=>new URL(url).pathname.includes('/runtime-logs')?
     new Response(null,{status:204}):f.fetch(url,init);
   const got=obj(await call({deployment},fetch));
   expect(got).toMatchObject({scanned:0,matched:0,
     transport:{bytesRead:0,received:0,cutoff:'no_content',complete:false},
     containsRawLogText:false});
   expect(got.note).toMatch(/does not certify/i);
 });
 it('refuses changed project identity before streaming',async()=>{
   const f=makeFakeVercel();
   f.when('GET','/v13/deployments/{idOrUrl}').resolves({uid:deployment,projectId:'prj_OTHER'});
   const result=await call({deployment},f.fetch);
   expect(result.isError).toBe(true);expect(f.calls).toHaveLength(1);
 });
 it('refuses forged resource IDs inside streamed rows',async()=>{
   const f=makeFetch([log({projectId:'prj_OTHER'})]);
   expect((await call({deployment},f.fetch)).isError).toBe(true);
 });
 it('refuses invalid windows and filters before a provider request',async()=>{
   const f=makeFakeVercel();
   for(const args of [
     {deployment,sinceMs:at-86400001,untilMs:at},
     {deployment,sinceMs:at+10000,untilMs:at},
     {deployment,level:'trace'},
     {deployment,status:0},
     {deployment,path:'https://evil.test'},
     {deployment,path:'/secret?token=abc'},
     {deployment,teamId:'team_OTHER'}
   ])expect((await call(args,f.fetch)).isError).toBe(true);
   expect(f.calls).toHaveLength(0);
 });
 it('supports provider log wire aliases and rejects contradictory alias values',async()=>{
   const f=makeFetch([{
     timestamp:at-120000,level:'error',statusCode:503,path:'/api/health',
     message:'vcp_FAKE_NEVER_SHOW_any_sensitive_message'
   }]);
   const got=obj(await call({deployment,sinceMs:at-1800000,untilMs:at,
     status:503,path:'/api/health'},f.fetch));
   expect(got).toMatchObject({matched:1,statuses:{503:1}});
   expect(JSON.stringify(got)).not.toContain('/api/health');
   for(const conflict of [
     {timestampInMs:at-1,timestamp:at-2},
     {responseStatusCode:500,statusCode:503},
     {requestPath:'/api/health',path:'/api/other'}
   ]){
     const bad=makeFetch([log(conflict)]);
     expect((await call({deployment},bad.fetch)).isError).toBe(true);
   }
 });
 it('distinguishes complete JSON arrays from genuinely truncated frames',async()=>{
   const f=makeFetch([]);
   const stream=length=>async(url,init)=>new URL(url).pathname.includes('/runtime-logs')?
     new Response(JSON.stringify(Array.from({length},()=>log()))):f.fetch(url,init);
   const got=obj(await call({deployment},stream(30)));
   expect(got).toMatchObject({scanned:30,transport:{cutoff:'stream_end',complete:false}});
   const capped=obj(await call({deployment},stream(51)));
   expect(capped).toMatchObject({scanned:50,transport:{cutoff:'row_limit'}});
 });
 it('does not reflect malformed upstream stream contents in errors',async()=>{
   const f=makeFetch([]);
   const fetch=async(url,init)=>new URL(url).pathname.includes('/runtime-logs')?
     new Response('{"message":"vcp_FAKE_NEVER_SHOW'):f.fetch(url,init);
   const result=await call({deployment},fetch);
   expect(result.isError).toBe(true);
   expect(JSON.stringify(result)).not.toContain('vcp_FAKE_NEVER_SHOW');
 });
 it('caps a large provider stream and never exceeds the safe response budget',async()=>{
   const f=makeFetch(Array.from({length:70},()=>log()));
   const got=obj(await call({deployment},f.fetch));
   expect(got.scanned).toBeLessThanOrEqual(50);
   expect(got.transport).toMatchObject({cutoff:'row_limit',complete:false});
   expect(Buffer.byteLength(JSON.stringify(got))).toBeLessThan(8192);
 });
});
