import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {drainsWebhooksReadTools,drainsWebhooksWriteTools} from '../../src/tools/drains-webhooks.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_SEAT',scope:'team'};
const conn={account:account.id,profile:'full',mode:'preview',listing:'catalog',
  kind:'connector'};
const SECRET='whsec_'+'PLANTED'.repeat(4);
const hook={id:'hook_FAKE1',url:'https://hooks.example.com/events',
  events:['deployment.created'],projectIds:['prj_FAKE1'],ownerId:'team_SEAT',
  createdAt:1761000000000,updatedAt:1761000000000};
function fixture(){
  const api=makeFakeVercel(),rows=new Map(),audit=[],secrets=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async row=>audit.push(row),
    insertOneTimeSecret:async row=>secrets.push(row),
    consumeOneTimeSecret:async()=>null,
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
    env:{VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:'00'.repeat(32)}});
  return {api,audit,secrets,rows,
    list:(args,c=conn)=>drainsWebhooksReadTools.handlers.vercel_webhook_list(args,ctx(c)),
    create:(args,c=conn)=>drainsWebhooksWriteTools.handlers.vercel_webhook_create(args,ctx(c)),
    remove:(args,c=conn)=>drainsWebhooksWriteTools.handlers.vercel_webhook_delete(args,ctx(c))};
}
const read=r=>JSON.parse(r.content[0].text);
describe('M-2 webhooks',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('lists webhooks by host with no secret anywhere',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/webhooks').resolves([hook]);
   const r=read(await f.list({}));
   expect(r.webhooks).toHaveLength(1);
   expect(r.webhooks[0]).toMatchObject({id:'hook_FAKE1',
     urlHost:'hooks.example.com',events:['deployment.created'],eventCount:1,
     projects:['prj_FAKE1'],createdAt:1761000000000,updatedAt:1761000000000});
   expect(r.webhooks[0]).not.toHaveProperty('secret');
   f.api.verify();
 });
 it('creates a webhook and delivers the signing secret only via the one-time store',async()=>{
   const f=fixture();
   f.api.when('POST','/v1/webhooks').resolves({...hook,secret:SECRET});
   f.api.when('GET','/v1/webhooks/{id}').resolves(hook);
   const r=read(await f.create({url:'https://hooks.example.com/events',
     events:['deployment.created'],confirm:true,
     requestKey:'webhook-create-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{webhookId:'hook_FAKE1',urlHost:'hooks.example.com'}});
   expect(r.ownerRevealRef).toMatch(/^[0-9a-f-]{36}$/i);
   // The planted secret appears in NO surface: result, journal,
   // replay record. It exists only as ciphertext in the one-time store.
   const surfaces=JSON.stringify(r)+JSON.stringify(f.audit)+
     JSON.stringify([...f.rows.values()]);
   expect(surfaces).not.toContain(SECRET);
   expect(f.secrets).toHaveLength(1);
   expect(f.secrets[0].kind).toBe('webhook_signing_secret');
   expect(JSON.stringify(f.secrets[0])).not.toContain(SECRET);
   f.api.verify();
 });
 it('refuses an event the pinned contract does not know, by name',async()=>{
   const f=fixture();
   const r=read(await f.create({url:'https://hooks.example.com/events',
     events:['deployment.exploded'],confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(JSON.stringify(r)).toMatch(/Unknown webhook event: deployment\.exploded/);
   expect(f.api.calls).toHaveLength(0);
 });
 it('refuses non-public webhook endpoints before dispatch',async()=>{
   const f=fixture();
   for(const url of ['http://hooks.example.com/x','https://10.1.2.3/x',
     'https://hooks.internal/x']){
     const r=read(await f.create({url,events:['deployment.created'],confirm:true}));
     expect(r.status).toBe('refused_by_guard');
   }
   expect(f.api.calls).toHaveLength(0);
 });
 it('a plan-gate refusal at create is an unknown outcome, never applied',async()=>{
   const f=fixture();
   f.api.when('POST','/v1/webhooks')
     .rejects(403,vercelError(403,'webhook_plan_required'));
   const r=read(await f.create({url:'https://hooks.example.com/events',
     events:['deployment.created'],confirm:true,
     requestKey:'webhook-create-plan-1'}));
   expect(r.status).toBe('outcome_unknown');
   expect(f.secrets).toHaveLength(0);
 });
 it('deletes a webhook and confirms via the 404 read-back',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/webhooks/{id}')
     .resolves(hook).rejects(404,vercelError(404,'not_found'));
   f.api.when('DELETE','/v1/webhooks/{id}').resolves(null,204);
   const r=read(await f.remove({id:'hook_FAKE1',confirm:true,
     requestKey:'webhook-delete-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   f.api.verify();
 });
});
