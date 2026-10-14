import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async mod=>({...await mod(),loadToken:vi.fn()}));

const project='prj_FAKE_ONE',deployment='dpl_FAKE_BUILD';
const token={token:'vcp_FAKE_cancel',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'project',project_id:project}};
const connection={account:'acct_FAKE',profile:'everyday',mode:'preview',listing:'catalog'};
const building={uid:deployment,projectId:project,readyState:'BUILDING',target:'preview'};
const result=r=>JSON.parse(r.content[0].text);
function fixture(){
 const fake=makeFakeVercel(),memo=new Map(),audits=[];
 const db={
  getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
  recordChange:async row=>audits.push(row),
  requestReplayStore:()=>({
   claim:async({key})=>memo.has(key)?
     {state:'completed',result:memo.get(key)}:{state:'claimed',claimId:key},
   complete:async({key,result})=>memo.set(key,result),
   release:async()=>true
  })
 };
 const call=(args,conn=connection)=>dispatchReadOnlyTool({
   registry,name:'vercel_deploy_cancel',args,connection:conn,db,fetchImpl:fake.fetch
 });
 return {fake,call,db,memo,audits};
}
function responses(f,after={...building,readyState:'CANCELED'}){
 f.fake.when('GET','/v13/deployments/{idOrUrl}')
   .resolves(building).resolves(building).resolves(building).resolves(after);
 f.fake.when('PATCH','/v12/deployments/{id}/cancel').resolves({...building,readyState:'CANCELED'});
}
describe('D-3 guarded preview deployment cancellation',()=>{
 beforeEach(()=>loadToken.mockResolvedValue(token));
 it('declares a guarded non-read-only tool, not visible to read-only profile',()=>{
   const item=registry.tools.find(x=>x.name==='vercel_deploy_cancel');
   expect(item).toMatchObject({writes:true,guardedWrite:true,
     writeContract:{production:true,targets:true,spend:false,access:false,secretOut:false}});
   expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .find(x=>x.name==='vercel_deploy_cancel')).toBeUndefined();
 });
 it('uses independently scoped before, predispatch, provider PATCH, after and replay once',async()=>{
   const f=fixture();responses(f);
   const args={deployment,confirm:true,requestKey:'cancelPreviewFAKE01'};
   const first=result(await f.call(args));
   expect(first).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
   expect(result(await f.call(args))).toEqual(first);
   expect(f.fake.calls.filter(x=>x.method==='PATCH')).toHaveLength(1);
   expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','GET','PATCH','GET','GET','GET']);
   expect(f.fake.calls[3].path).toBe('/v12/deployments/'+deployment+'/cancel');
   expect(f.fake.calls[3].query.teamId).toBe('team_FAKE');
   expect(f.fake.calls[3].body).toBeUndefined();
   expect(f.memo.size).toBe(2);expect(f.audits).toHaveLength(1);
   f.fake.verify();
 });
 it('keeps dry-run and unconfirmed previews free of PATCH',async()=>{
   for(const args of [{deployment,dryRun:true},{deployment}]){
     const f=fixture();responses(f);
     const x=result(await f.call(args));
     expect(x.status).toBe(args.dryRun?'preview':'needs_confirmation');
     expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
   }
 });
 it('refuses production, unknown target and completed deployments',async()=>{
   for(const row of [{...building,target:'production'},{...building,target:undefined},
     {...building,readyState:'READY'},{...building,readyState:'ERROR'}]){
     const f=fixture();
     f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(row);
     const x=result(await f.call({deployment,confirm:true}));
     expect(x.status).toBe('refused_by_guard');
     expect(f.fake.calls.some(c=>c.method==='PATCH')).toBe(false);
   }
 });
 it('refuses state and owner identity changes immediately before dispatch',async()=>{
   for(const modified of [{...building,readyState:'READY'},
     {...building,projectId:'prj_FAKE_OTHER'}, {...building,uid:'dpl_FAKE_DIFFERENT'},
     {...building,target:'production'}]){
     const f=fixture();
     f.fake.when('GET','/v13/deployments/{idOrUrl}')
       .resolves(building).resolves(building).resolves(modified);
     const x=result(await f.call({deployment,confirm:true,requestKey:'cancelChangeFAKE01'}));
     expect(x.status).toBe('refused_by_guard');
     expect(f.fake.calls.some(c=>c.method==='PATCH')).toBe(false);
   }
 });
 it('blocks forged arguments, project scope escape and read-only profile',async()=>{
   const f=fixture();
   for(const args of [{deployment,teamId:'team_OTHER',confirm:true},
     {deployment:'../unsafe',confirm:true},
     {deployment,project:'prj_FAKE_OTHER',confirm:true},
     {deployment,confirm:'yes'}]){
     const x=await f.call(args);
     expect(x.isError||result(x).status==='refused_by_guard').toBe(true);
   }
   const denied=await f.call({deployment,confirm:true},
     {...connection,profile:'read_only'});
   expect(denied.isError).toBe(true);
   expect(f.fake.calls).toHaveLength(0);
 });
 it('does not claim confirmation when GET readback remains building',async()=>{
   const f=fixture();responses(f,building);
   const x=result(await f.call({deployment,confirm:true,requestKey:'cancelPendingFAKE01'}));
   expect(x).toMatchObject({status:'applied',confirmed:null});
   expect(f.fake.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);
 });
 it('guards protected deployments before provider mutation',async()=>{
   const f=fixture();responses(f);
   f.db.listProtectedResources=async()=>[{match:deployment,note:'protected in test'}];
   const x=result(await f.call({deployment,confirm:true}));
   expect(x.status).toBe('refused_by_guard');
   expect(f.fake.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
 });
});
