import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {integrationsStorageReadTools,integrationsStorageWriteTools} from '../../src/tools/integrations-storage.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_SEAT',scope:'team'};
const conn={account:account.id,profile:'full',mode:'preview',listing:'catalog',
  kind:'connector'};
const linkedStore={store:{status:'ready',usageQuotaExceeded:false,
  totalConnectedProjects:1,
  projectsMetadata:[{id:'link1',projectId:'prj_FAKE1',name:'demo',
    environments:['production'],
    environmentVariables:['DATABASE_URL','BLOB_READ_WRITE_TOKEN'],
    envVarPrefix:'NEON_'}]}};
const bareStore={store:{id:'store_FAKE2',status:'ready',
  usageQuotaExceeded:false,projectsMetadata:[],region:'iad1',size:2048,
  type:'blob'}};
function fixture(){
  const api=makeFakeVercel(),rows=new Map(),audit=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async row=>audit.push(row),
    getPurchasePolicy:async()=>({grantRequired:false,budgetCents:null}),
    getTodaySpendCents:async()=>0,
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(rows.has(key))return rows.get(key);
        rows.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};
      },
      complete:async({key,result})=>rows.set(key,{state:'completed',result}),
      release:async({key})=>rows.delete(key)
    })};
  const ctx=connection=>({db,connection,fetchImpl:api.fetch,
    env:{VERCEL_ENV:'production'}});
  return {api,audit,
    get:(args,c=conn)=>integrationsStorageReadTools.handlers.vercel_storage_get_store(args,ctx(c)),
    create:(args,c=conn)=>integrationsStorageWriteTools.handlers.vercel_storage_create_blob_store(args,ctx(c)),
    remove:(args,c=conn)=>integrationsStorageWriteTools.handlers.vercel_storage_delete_blob_store(args,ctx(c))};
}
const read=r=>JSON.parse(r.content[0].text);
describe('M-3 storage',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('reads a store in the pinned lossy shape: documented fields always, identity only when reported',async()=>{
   const f=fixture();
   f.api.when('GET','/storage/stores/{id}').resolves(linkedStore);
   const r=read(await f.get({storeId:'store_FAKE1'}));
   expect(r.store.idReported).toBe(false);
   expect(r.store.storeId).toBe('store_FAKE1');
   expect(r.store.status).toBe('ready');
   expect(r.store.connectedProjectIds).toEqual(['prj_FAKE1']);
   expect(r.store.projects[0].environmentVariableNames)
     .toEqual(['DATABASE_URL','BLOB_READ_WRITE_TOKEN']);
   expect(r.store.region).toBeNull();
   expect(r.store.size).toBeNull();
   f.api.verify();
 });
 it('reads identity, region and size when the provider includes them',async()=>{
   const f=fixture();
   f.api.when('GET','/storage/stores/{id}').resolves(bareStore);
   const r=read(await f.get({storeId:'store_FAKE2'}));
   expect(r.store).toMatchObject({idReported:true,region:'iad1',size:2048,
     type:'blob',connectedProjectIds:[]});
   f.api.verify();
 });
 it('creates a Blob store as a metered write and verifies by read-back',async()=>{
   const f=fixture();
   f.api.when('POST','/storage/stores/blob')
     .resolves({store:{id:'store_FAKE3',region:'iad1',access:'public',
       kind:'user-created',count:0,isTokenExpired:false,size:0}});
   f.api.when('GET','/storage/stores/{id}').resolves({store:{
     id:'store_FAKE3',status:'ready',projectsMetadata:[],
     usageQuotaExceeded:false}});
   const plan=read(await f.create({name:'uploads',region:'iad1'}));
   expect(plan.status).toBe('needs_confirmation');
   expect(plan.preview).toMatch(/billed beyond included usage/);
   const r=read(await f.create({name:'uploads',region:'iad1',confirm:true,
     requestKey:'blob-create-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{storeId:'store_FAKE3',region:'iad1'}});
   const post=f.api.calls.find(c=>c.method==='POST');
   expect(post.body).toEqual({name:'uploads',region:'iad1'});
   expect(post.query).not.toHaveProperty('teamId');
   f.api.verify();
 });
 it('refuses to delete a connected store without outsideApp, naming the projects',async()=>{
   const f=fixture();
   f.api.when('GET','/storage/stores/{id}').resolves(linkedStore);
   const r=read(await f.remove({storeId:'store_FAKE1',confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(JSON.stringify(r)).toMatch(/prj_FAKE1/);
   expect(JSON.stringify(r)).toMatch(/outsideApp/);
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('delete preview always carries the every-file sentence; delete verifies by read-back',async()=>{
   const f=fixture();
   f.api.when('GET','/storage/stores/{id}')
     .resolves(linkedStore).resolves(linkedStore)
     .rejects(404,vercelError(404,'not_found'));
   const plan=read(await f.remove({storeId:'store_FAKE1',outsideApp:true}));
   expect(plan.status).toBe('needs_confirmation');
   expect(plan.preview).toMatch(/every file in the store is deleted; this cannot be undone/);
   f.api.when('DELETE','/storage/stores/blob/{id}').resolves({id:'store_FAKE1'});
   const r=read(await f.remove({storeId:'store_FAKE1',outsideApp:true,
     confirm:true,requestKey:'blob-delete-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   f.api.verify();
 });
 it('deleting an unconnected store needs no outsideApp',async()=>{
   const f=fixture();
   f.api.when('GET','/storage/stores/{id}')
     .resolves(bareStore).resolves(bareStore)
     .rejects(404,vercelError(404,'not_found'));
   f.api.when('DELETE','/storage/stores/blob/{id}').resolves({id:'store_FAKE2'});
   const r=read(await f.remove({storeId:'store_FAKE2',confirm:true,
     requestKey:'blob-delete-test-2'}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   f.api.verify();
 });
});
