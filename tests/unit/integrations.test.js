import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {integrationsStorageReadTools,integrationsStorageWriteTools} from '../../src/tools/integrations-storage.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_SEAT',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog',
  kind:'connector'};
const PLANTED='partner-secret-value';
const config={id:'icfg_FAKE1',integrationId:'oac_FAKE',slug:'neon',
  scopes:['read-write:postgres'],projects:['prj_FAKE1'],status:'ready',
  installationType:'marketplace',source:'marketplace',teamId:'team_SEAT',
  createdAt:1761000000000,updatedAt:1761000000000,
  integration:{name:'Neon',icon:'x',isLegacy:false}};
const resources={resources:[{internalId:'res_FAKE1',name:'main-db',
  productId:'postgres',status:'ready',billingPlanId:'plan_pro',
  metadata:{apiKey:PLANTED},protocolSettings:{key:PLANTED}}]};
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
  return {api,audit,rows,
    list:(args,c=conn)=>integrationsStorageReadTools.handlers.vercel_integration_list(args,ctx(c)),
    get:(args,c=conn)=>integrationsStorageReadTools.handlers.vercel_integration_get(args,ctx(c)),
    remove:(args,c=conn)=>integrationsStorageWriteTools.handlers.vercel_integration_remove(args,ctx(c)),
    connect:(args,c=conn)=>integrationsStorageWriteTools.handlers.vercel_integration_connect_resource(args,ctx(c)),
    createStore:(args,c=conn)=>integrationsStorageWriteTools.handlers.vercel_integration_create_store(args,ctx(c))};
}
const read=r=>JSON.parse(r.content[0].text);
describe('M-3 integrations',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('lists installations across both contract variants and counts skipped rows',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configurations')
     .resolves([config,{slug:'lean-no-id'},{id:'icfg_FAKE2',status:'ready'}]);
   const r=read(await f.list({}));
   expect(r.shown).toBe(2);
   expect(r.skipped).toBe(1);
   expect(r.integrations[0]).toMatchObject({id:'icfg_FAKE1',name:'Neon',
     status:'ready',projects:['prj_FAKE1']});
   const call=f.api.calls[0];
   expect(call.query.view).toBe('account');
   f.api.verify();
 });
 it('gets one installation with resources shaped and partner secrets dropped',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configuration/{id}').resolves(config);
   f.api.when('GET','/v1/installations/{integrationConfigurationId}/resources')
     .resolves(resources);
   const r=read(await f.get({id:'icfg_FAKE1'}));
   expect(r.resources).toEqual([{resourceId:'res_FAKE1',name:'main-db',
     productId:'postgres',status:'ready',billingPlanId:'plan_pro'}]);
   expect(r.billingPlanIds).toEqual(['plan_pro']);
   expect(JSON.stringify(r)).not.toContain(PLANTED);
   f.api.verify();
 });
 it('remove previews resources and projects, and is production-class with projects connected',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configuration/{id}').resolves(config);
   f.api.when('GET','/v1/installations/{integrationConfigurationId}/resources')
     .resolves(resources);
   const r=read(await f.remove({id:'icfg_FAKE1'}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.mode).toBe('PRODUCTION');
   expect(r.preview).toMatch(/main-db/);
   expect(r.preview).toMatch(/prj_FAKE1/);
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('removes an installation and confirms via the 404 read-back',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configuration/{id}')
     .resolves(config)
     .rejects(404,vercelError(404,'not_found'));
   f.api.when('GET','/v1/installations/{integrationConfigurationId}/resources')
     .resolves(resources);
   f.api.when('DELETE','/v1/integrations/configuration/{id}').resolves(null,204);
   const r=read(await f.remove({id:'icfg_FAKE1',confirm:true,
     requestKey:'int-remove-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   f.api.verify();
 });
 it('connects a resource to production as a production-class write and verifies the listing',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configuration/{id}')
     .resolves({...config,projects:[]}).resolves(config);
   f.api.when('GET','/v9/projects/{idOrName}')
     .resolves({id:'prj_FAKE1',name:'demo'});
   f.api.when('POST','/v1/integrations/installations/{integrationConfigurationId}/resources/{resourceId}/connections')
     .resolves({},201);
   const r=read(await f.connect({configurationId:'icfg_FAKE1',
     resourceId:'res_FAKE1',project:'demo',environments:['production'],
     confirm:true,requestKey:'int-connect-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true,mode:'PRODUCTION'});
   const post=f.api.calls.find(c=>c.method==='POST');
   expect(post.body).toEqual({projectId:'prj_FAKE1',
     envVarEnvironments:['production']});
   f.api.verify();
 });
 it('a preview-only connect is not production-class',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configuration/{id}').resolves(config);
   f.api.when('GET','/v9/projects/{idOrName}')
     .resolves({id:'prj_FAKE1',name:'demo'});
   const r=read(await f.connect({configurationId:'icfg_FAKE1',
     resourceId:'res_FAKE1',project:'demo',environments:['preview']}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.mode).toBe('PREVIEW');
 });
 it('create-store preview lists the plans with provider price strings; the response secrets never surface',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configuration/{id}').resolves(config);
   f.api.when('GET','/v1/integrations/integration/{integrationIdOrSlug}/products/{productIdOrSlug}/plans')
     .resolves({plans:[{id:'plan_pro',name:'Pro',description:'d',
       type:'subscription',scope:'resource',paymentMethodRequired:true,
       cost:'$19/month'}]});
   const plan=read(await f.createStore({configurationId:'icfg_FAKE1',
     product:'postgres',name:'Orders DB',billingPlanId:'plan_pro'}));
   expect(plan.status).toBe('needs_confirmation');
   expect(plan.preview).toMatch(/plan_pro/);
   expect(plan.preview).toMatch(/\$19\/month/);
   f.api.when('POST','/v1/storage/stores/integration/direct')
     .resolves({store:{id:'store_FAKE1',externalResourceId:'ext_1',
       product:{id:'postgres'},status:'ready',
       secrets:{token:PLANTED},projectsMetadata:[],usageQuotaExceeded:false}});
   f.api.when('GET','/storage/stores/{id}').resolves({store:{
     id:'store_FAKE1',status:'ready',projectsMetadata:[],
     usageQuotaExceeded:false}});
   const r=read(await f.createStore({configurationId:'icfg_FAKE1',
     product:'postgres',name:'Orders DB',billingPlanId:'plan_pro',
     confirm:true,requestKey:'int-store-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{storeId:'store_FAKE1'}});
   const surfaces=JSON.stringify(r)+JSON.stringify(f.audit)+
     JSON.stringify([...f.rows.values()]);
   expect(surfaces).not.toContain(PLANTED);
   f.api.verify();
 });
 it('create-store refuses an unknown billing plan and a prepayment without an amount',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/integrations/configuration/{id}').resolves(config);
   f.api.when('GET','/v1/integrations/integration/{integrationIdOrSlug}/products/{productIdOrSlug}/plans')
     .resolves({plans:[{id:'plan_pre',name:'Pre',type:'prepayment',
       scope:'resource',paymentMethodRequired:true}]});
   const bad=read(await f.createStore({configurationId:'icfg_FAKE1',
     product:'postgres',name:'X',billingPlanId:'plan_nope',confirm:true}));
   expect(bad.status).toBe('refused_by_guard');
   expect(JSON.stringify(bad)).toMatch(/Billing plan was not found/);
   const noAmount=read(await f.createStore({configurationId:'icfg_FAKE1',
     product:'postgres',name:'X',billingPlanId:'plan_pre',confirm:true}));
   expect(noAmount.status).toBe('refused_by_guard');
   expect(JSON.stringify(noAmount)).toMatch(/prepaymentAmountCents/);
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(0);
 });
});
