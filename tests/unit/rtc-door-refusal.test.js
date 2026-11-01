// AUD-BQ: a guarded write's structured refusal at the RTC door is a
// policy answer (403 refused_by_guard), not a 503 service failure.
// The R-1W door tests exercised fixture tools behind a fixture
// registry; no test had ever dispatched a REAL registry tool under
// the connection the door mints, so the flattening shipped. This
// suite drives the real registry through the real door with the
// live AUD-BM3 pass shape (full profile, preview mode, $0.00
// ceiling, project-restricted).
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {createHash} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {rtcDoor} from '../../src/rtc/door.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {shapeStoredMcpResult} from '../../src/vercel/result-delivery.js';
import {vercelErrorResult} from '../../src/tools/errors.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
vi.mock('../../src/vercel/tokens.js',async x=>({...await x(),loadToken:vi.fn()}));
const project='prj_FAKEBQ';
const account={id:'acct_FAKE',team_id:'team_FAKE',scope:'full'};
const row={id:project,name:'the-app',accountId:'team_FAKE',hasDeployments:true};
const PASS_TOKEN='rtc_'+'pass_'+'p'.repeat(43);
const writePass={id:'pass_'+'a'.repeat(20),account:'acct_FAKE',profile:'full',
  mode:'preview',areas:['server','deployments','projects','env'],
  listing:'catalog',rateLimitPerMinute:120,allowWrites:true,
  spendLimitCents:0,projectIds:[project]};
const deployArgs={project,expectedName:'the-app',
  files:[{path:'index.html',content:'<h1>probe</h1>'}],
  target:'preview',outsideApp:true,requestKey:'audbqREG0001'};
function fixture(){
  const fake=makeFakeVercel(),audits=[];
  fake.when('GET','/v9/projects/{idOrName}').resolves(row);
  const db={inspectRtcPass:async()=>({status:'ok',...writePass,
      expiresAt:Date.now()+3600000}),
    authorizeRtcPass:async()=>({status:'ok',...writePass}),
    getAccountCredential:async()=>({}),
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
const door=()=>{const f=fixture();
  return {door:rtcDoor({db:f.db,registry,env:{},fetchImpl:f.fake.fetch}),...f};};
describe('AUD-BQ guarded-write refusals at the RTC door (real registry)',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  it('answers a metered write under a write pass 403 refused_by_guard, never 503',async()=>{
    const {door:d,fake}=door();
    for(const extra of [{dryRun:true},{confirm:true}]){
      const res=await call(d,'invoke','POST',
        {name:'vercel_deploy_create_from_files'},{...deployArgs,...extra});
      expect(res.status).toBe(403);
      expect(res.error?.code).toBe('refused_by_guard');
    }
    expect(fake.calls.every(c=>c.method==='GET')).toBe(true);
    fake.verify();
  });
  it('keeps the door healthy around the refusal: whoami and listing still answer',async()=>{
    const {door:d}=door();
    const me=await call(d,'whoami');
    expect(me.result).toMatchObject({profile:'full',writes:true,spendLimitCents:0});
    const described=await call(d,'describe','GET',
      {name:'vercel_deploy_create_from_files'});
    expect(described.result.name).toBe('vercel_deploy_create_from_files');
  });
  it('records the side capture: names with no registry row are the catalog 404, never an invoke',async()=>{
    const {door:d}=door();
    for(const name of ['vercel_env_create','vercel_project_update']){
      const res=await call(d,'invoke','POST',{name},{});
      expect(res.status).toBe(404);
      expect(res.error?.code).toBe('not_found');
    }
  });
  it('the shared dispatch is untouched: the owner-shaped connection still previews the same write',async()=>{
    // OAuth-shaped connection, lifted from src/core/mcp-auth.js.
    const record={client_id:'client_FAKE',vercel_account:'acct_FAKE',mode:'preview',
      profile:'full',listing:'catalog',kind:'connector',read_only:false,
      connection_id:'conn_FAKE'};
    const connection={clientId:record.client_id,account:record.vercel_account,
      mode:record.mode,profile:record.profile,listing:record.listing,
      kind:record.kind,readOnly:record.read_only===true};
    Object.defineProperty(connection,'resultOwner',{value:'resown_'+
      createHash('sha256').update('rmcp-result-owner-v1:').update('oauthbearer_'+'B'.repeat(43)).digest('hex')});
    Object.defineProperty(connection,'connectionId',{value:record.connection_id});
    const {db,fake}=fixture();
    const res=await dispatchReadOnlyTool({registry,
      name:'vercel_deploy_create_from_files',
      args:{...deployArgs,dryRun:true},connection:Object.freeze(connection),
      db,env:{},fetchImpl:fake.fetch,formatError:vercelErrorResult,
      shapeResult:shapeStoredMcpResult});
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0].text).status).toBe('preview');
  });
});
