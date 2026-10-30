import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {drainsWebhooksReadTools,drainsWebhooksWriteTools} from '../../src/tools/drains-webhooks.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_SEAT',scope:'team'};
const conn={account:account.id,profile:'full',mode:'preview',listing:'catalog',
  kind:'connector'};
const PLANTED='drain-header-secret-value';
const drain={id:'drn_FAKE1',name:'Logs out',ownerId:'team_SEAT',
  createdAt:1761000000000,updatedAt:1761000000000,status:'enabled',
  schemas:{log:{version:'v2'}},source:{type:'self-served'},
  delivery:{type:'http',endpoint:'https://hooks.example.com/ingest',
    encoding:'json',headers:{Authorization:'Bearer '+PLANTED,'X-Team':'ops'},
    secret:'whsec_'+'z'.repeat(24)},
  projectIds:['prj_FAKE1'],sampling:[{type:'head_sampling',rate:0.5}]};
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
    list:(args,c=conn)=>drainsWebhooksReadTools.handlers.vercel_drain_list(args,ctx(c)),
    create:(args,c=conn)=>drainsWebhooksWriteTools.handlers.vercel_drain_create(args,ctx(c)),
    update:(args,c=conn)=>drainsWebhooksWriteTools.handlers.vercel_drain_update(args,ctx(c)),
    remove:(args,c=conn)=>drainsWebhooksWriteTools.handlers.vercel_drain_delete(args,ctx(c)),
    test:(args,c=conn)=>drainsWebhooksWriteTools.handlers.vercel_drain_test(args,ctx(c))};
}
const read=r=>JSON.parse(r.content[0].text);
describe('M-2 drains',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('lists drains with host and header names only — never the secret or header values',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/drains').resolves({drains:[drain]});
   const r=read(await f.list({}));
   expect(r.drains).toHaveLength(1);
   expect(r.drains[0]).toMatchObject({id:'drn_FAKE1',status:'enabled',
     types:['log'],projects:['prj_FAKE1']});
   expect(r.drains[0].destination).toEqual({type:'http',
     host:'hooks.example.com',encoding:'json',
     headerNames:['Authorization','X-Team']});
   const text=JSON.stringify(r);
   expect(text).not.toContain(PLANTED);
   expect(text).not.toContain('whsec_');
   f.api.verify();
 });
 it('previews a create with host, kinds and the per-GB pricing link; dispatches nothing',async()=>{
   const f=fixture();
   const r=read(await f.create({name:'Logs out',endpoint:'https://hooks.example.com/ingest'}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.preview).toMatch(/hooks\.example\.com/);
   expect(r.preview).toMatch(/billed per GB/);
   expect(r.preview).toMatch(/log/);
   expect(f.api.calls).toHaveLength(0);
 });
 it('creates a drain on the pinned contract and verifies by read-back',async()=>{
   const f=fixture();
   f.api.when('POST','/v1/drains').resolves(drain);
   f.api.when('GET','/v1/drains/{id}').resolves(drain);
   const r=read(await f.create({name:'Logs out',
     endpoint:'https://hooks.example.com/ingest',confirm:true,
     requestKey:'drain-create-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{drainId:'drn_FAKE1',host:'hooks.example.com'}});
   const post=f.api.calls.find(c=>c.method==='POST');
   expect(post.body).toMatchObject({name:'Logs out',projects:'all',
     schemas:{log:{version:'v2'}},
     delivery:{type:'http',endpoint:'https://hooks.example.com/ingest',
       encoding:'json'}});
   f.api.verify();
 });
 it('refuses private, loopback and non-HTTPS destinations before dispatch',async()=>{
   const f=fixture();
   for(const endpoint of ['http://hooks.example.com/x',
     'https://127.0.0.1/x','https://10.0.0.5/x','https://192.168.1.9/x',
     'https://localhost/x','https://[::1]/x','https://intranet/x',
     'https://172.16.4.4/x']){
     const r=read(await f.create({name:'X',endpoint,confirm:true}));
     expect(r.status).toBe('refused_by_guard');
   }
   expect(f.api.calls).toHaveLength(0);
 });
 it('update preview is before/after and names widening on resume',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/drains/{id}').resolves({...drain,status:'disabled'});
   const r=read(await f.update({id:'drn_FAKE1',status:'enabled'}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.preview).toMatch(/status disabled -> enabled/);
   expect(r.preview).toMatch(/WIDENS/);
   const narrow=read(await f.update({id:'drn_FAKE1',samplingRate:0.1}));
   expect(narrow.preview).toMatch(/narrows/);
   expect(f.api.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
 });
 it('update with no effective change refuses with the reason',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/drains/{id}').resolves(drain);
   const r=read(await f.update({id:'drn_FAKE1',status:'enabled',confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(JSON.stringify(r)).toMatch(/Nothing to change/);
 });
 it('applies an update and verifies the new status',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/drains/{id}')
     .resolves(drain).resolves({...drain,status:'disabled'});
   f.api.when('PATCH','/v1/drains/{id}').resolves({...drain,status:'disabled'});
   const r=read(await f.update({id:'drn_FAKE1',status:'disabled',confirm:true,
     requestKey:'drain-update-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   f.api.verify();
 });
 it('deletes a drain and confirms via the 404 read-back',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/drains/{id}')
     .resolves(drain).resolves(drain)
     .rejects(404,vercelError(404,'not_found'));
   f.api.when('DELETE','/v1/drains/{id}').resolves(null,204);
   const r=read(await f.remove({id:'drn_FAKE1',confirm:true,
     requestKey:'drain-delete-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   f.api.verify();
 });
 it('a failed test delivery is reported as failed, not as a success',async()=>{
   const f=fixture();
   f.api.when('POST','/v1/drains/test')
     .resolves({endpoint:'https://hooks.example.com/ingest',
       error:'connection refused',status:502});
   const r=read(await f.test({endpoint:'https://hooks.example.com/ingest',
     confirm:true,requestKey:'drain-test-fail-1'}));
   expect(r.status).toBe('applied');
   expect(r.confirmed).toBe(false);
   // The provider's own error text is journaled in the verification
   // record, never dressed up as a success.
   expect(JSON.stringify(f.audit)).toContain('connection refused');
   const ok=fixture();
   ok.api.when('POST','/v1/drains/test').resolves({});
   const r2=read(await ok.test({endpoint:'https://hooks.example.com/ingest',
     confirm:true,requestKey:'drain-test-ok-1'}));
   expect(r2).toMatchObject({status:'applied',confirmed:true,
     receipt:{delivered:true}});
 });
 it('deleting a missing drain refuses with the reason before dispatch',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/drains/{id}').rejects(404,vercelError(404,'not_found'));
   const r=read(await f.remove({id:'drn_GONE',confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(JSON.stringify(r)).toMatch(/Drain was not found/);
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
});
