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
 it('caps a large provider stream and never exceeds the safe response budget',async()=>{
   const f=makeFetch(Array.from({length:70},()=>log()));
   const got=obj(await call({deployment},f.fetch));
   expect(got.scanned).toBeLessThanOrEqual(50);
   expect(got.transport).toMatchObject({cutoff:'row_limit',complete:false});
   expect(Buffer.byteLength(JSON.stringify(got))).toBeLessThan(8192);
 });
});
