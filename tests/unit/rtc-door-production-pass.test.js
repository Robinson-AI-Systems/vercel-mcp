// AUD-BT: on a PRODUCTION pass the result shaper wraps every payload
// in the production envelope ({mode:'PRODUCTION', banner, result}),
// so AUD-BQ's top-level refusal check missed every structured
// refusal and the door answered 503 (AUD-BM3, live). AUD-BQ's suite
// used a preview pass, where payloads stay bare. This suite drives
// the real registry through the real door in AUD-BM3's exact pass
// shape (full profile, production mode, $0.00 ceiling,
// project-restricted) and pins the typed outcomes.
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {rtcDoor} from '../../src/rtc/door.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
vi.mock('../../src/vercel/tokens.js',async x=>({...await x(),loadToken:vi.fn()}));
const project='prj_FAKEBT';
const other='prj_FAKEOTHER';
const account={id:'acct_FAKE',team_id:'team_FAKE',scope:'full'};
const row={id:project,name:'the-app',accountId:'team_FAKE',hasDeployments:true,framework:null};
const PASS_TOKEN='rtc_'+'pass_'+'q'.repeat(43);
const prodPass={id:'pass_'+'b'.repeat(20),account:'acct_FAKE',profile:'full',
  mode:'production',areas:['server','deployments','projects','env','registrar'],
  listing:'catalog',rateLimitPerMinute:120,allowWrites:true,
  spendLimitCents:0,projectIds:[project]};
function fixture(pass=prodPass){
  const fake=makeFakeVercel(),audits=[];
  fake.when('GET','/v9/projects/{idOrName}').resolves(row);
  fake.when('GET','/v5/domains/{domain}').resolves({domain:{
    name:'example-probe.com',autoRenew:false,expiresAt:1790000000000}});
  fake.when('GET','/v1/registrar/domains/{domain}/price').resolves({
    years:1,purchasePrice:12.99,renewalPrice:12.99,transferPrice:12.99});
  const db={inspectRtcPass:async()=>({status:'ok',...pass,
      expiresAt:Date.now()+3600000}),
    authorizeRtcPass:async()=>({status:'ok',...pass}),
    getAccountCredential:async()=>({}),
    getVercelAccountSafe:async()=>({id:'acct_FAKE',spend_limit_cents:0}),
    listProtectedResources:async()=>[],recordChange:async a=>audits.push(a),
    getPurchasePolicy:async()=>({grantRequired:false,budgetCents:null}),
    getTodaySpendCents:async()=>0,
    putResult:async()=>({handle:'res_'+'0'.repeat(32),
      expiresAt:'2030-01-01T00:00:00.000Z'}),
    requestReplayStore:()=>({claim:async c=>({state:'claimed',claimId:c.key}),
      complete:async()=>{},release:async()=>true})};
  return {fake,db,audits};
}
async function call(d,route,method='GET',query={},body){
  const r={headers:{},code:0,body:null,
    status(n){this.code=n;return this;},
    setHeader(k,v){this.headers[k]=v;return this;},
    send(t){this.body=JSON.parse(t);return this;}};
  await d({method,query,body,headers:{authorization:'Bearer '+PASS_TOKEN}},r,route);
  return {status:r.code,...(r.body||{})};
}
const door=(pass)=>{const f=fixture(pass);
  return {door:rtcDoor({db:f.db,registry,env:{},fetchImpl:f.fake.fetch}),...f};};
describe('AUD-BT typed outcomes on a production write pass (real registry)',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  it('plans an in-scope project rename: 200 with the preview, never 503',async()=>{
    const {door:d}=door();
    const res=await call(d,'invoke','POST',
      {name:'vercel_project_update_settings'},
      {project,name:'renamed-app',dryRun:true,requestKey:'audbtCASE001'});
    expect(res.status).toBe(200);
    expect(res.result?.result?.status).toBe('preview');
    expect(res.result?.result?.preview).toContain('rename to renamed-app');
  });
  it('refuses a rename of a project outside the pass restriction: 403, not 503',async()=>{
    const {door:d}=door({...prodPass,projectIds:[other]});
    const res=await call(d,'invoke','POST',
      {name:'vercel_project_update_settings'},
      {project,name:'renamed-app',dryRun:true,requestKey:'audbtCASE002'});
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('refused_by_guard');
  });
  it('surfaces the registrar buy by-design refusal typed: 403, no provider call',async()=>{
    const {door:d,fake}=door();
    const res=await call(d,'invoke','POST',{name:'vercel_registrar_buy'},
      {domain:'example-probe.com',years:1,autoRenew:false,outsideApp:true,
        dryRun:true,requestKey:'audbtCASE003'});
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('refused_by_guard');
    expect(fake.calls).toHaveLength(0);
  });
  it('proves the priced-refusal atom: a fixed price over the $0 ceiling refuses 403',async()=>{
    const {door:d}=door();
    const res=await call(d,'invoke','POST',{name:'vercel_registrar_renew'},
      {domain:'example-probe.com',years:1,outsideApp:true,
        dryRun:true,requestKey:'audbtCASE004'});
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('refused_by_guard');
  });
  it('surfaces a preflight refusal under a production pass (AUD-BQ tool, production mode)',async()=>{
    const {door:d}=door();
    const res=await call(d,'invoke','POST',
      {name:'vercel_deploy_create_from_files'},
      {project,expectedName:'the-app',
        files:[{path:'index.html',content:'<h1>probe</h1>'}],
        target:'preview',outsideApp:true,dryRun:true,
        requestKey:'audbtCASE005'});
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('refused_by_guard');
  });
});
