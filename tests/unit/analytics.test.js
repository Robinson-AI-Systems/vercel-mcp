import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {analyticsToggleTools} from '../../src/tools/logs-analytics.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_SEAT',scope:'team'};
const conn={account:account.id,profile:'full',mode:'preview',listing:'catalog',
  kind:'connector'};
const project={id:'prj_FAKE1',name:'demo'};
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
    web:(args,connection=conn)=>analyticsToggleTools.handlers
      .vercel_analytics_set_web_analytics(args,ctx(connection)),
    speed:(args,connection=conn)=>analyticsToggleTools.handlers
      .vercel_analytics_set_speed_insights(args,ctx(connection))};
}
const read=r=>JSON.parse(r.content[0].text);
describe('M-1 analytics toggles (guarded $ writes)',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('previews turning Web Analytics on with the pricing link and dispatches nothing',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   const r=read(await f.web({project:'demo',enabled:true}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.preview).toMatch(/Turn Web Analytics ON/);
   expect(r.preview).toMatch(/https:\/\/vercel\.com\/pricing/);
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(0);
   const dry=read(await f.web({project:'demo',enabled:true,dryRun:true}));
   expect(dry.status).toBe('preview');
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(0);
   f.api.verify();
 });
 it('turns Web Analytics on under the owner word and verifies the applied value',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   f.api.when('POST','/web/insights/toggle').resolves({value:true});
   const r=read(await f.web({project:'demo',enabled:true,confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{projectId:'prj_FAKE1',enabled:true}});
   const post=f.api.calls.find(c=>c.method==='POST');
   expect(post.body).toEqual({value:true});
   expect(post.query).toMatchObject({projectId:'prj_FAKE1'});
   expect(post.query).not.toHaveProperty('teamId');
   f.api.verify();
 });
 it('turns Speed Insights off as a $0 write with no purchase policy needed',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   f.api.when('POST','/speed-insights/toggle').resolves({value:false});
   const r=read(await f.speed({project:'demo',enabled:false,confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{projectId:'prj_FAKE1',enabled:false}});
   f.api.verify();
 });
 it('surfaces a documented 402 as an unknown outcome, never applied',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   f.api.when('POST','/web/insights/toggle')
     .rejects(402,vercelError(402,'payment_required'));
   const r=read(await f.web({project:'demo',enabled:true,confirm:true}));
   expect(r.status).toBe('outcome_unknown');
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(1);
 });
 it('refuses malformed toggles and read-only connections before dispatch',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   expect(read(await f.web({project:'demo'})).status).toBe('refused_by_guard');
   expect(read(await f.web({project:'demo',enabled:'yes',confirm:true})).status)
     .toBe('refused_by_guard');
   expect(read(await f.web({project:'demo',enabled:true,confirm:true},
     {...conn,profile:'read_only'})).status).toBe('refused_by_guard');
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(0);
 });
 it('a provider value that contradicts the request is not confirmed',async()=>{
   const f=fixture();
   f.api.when('GET','/v9/projects/{idOrName}').resolves(project);
   f.api.when('POST','/web/insights/toggle').resolves({value:false});
   const r=read(await f.web({project:'demo',enabled:true,confirm:true}));
   expect(r.status).not.toBe('applied');
 });
});
