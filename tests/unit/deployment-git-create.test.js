import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async x=>({...await x(),loadToken:vi.fn()}));
const project='prj_FAKE',account={id:'acct_FAKE',team_id:'team_FAKE',
  scope:'project',project_id:project};
const connection={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const row={id:project,name:'the-app',accountId:'team_FAKE',
  link:{type:'github',org:'example-org',repo:'my-repo',productionBranch:'main'}};
const args={project,expectedName:'the-app',gitRef:'feature/preview',
  gitSha:'a'.repeat(40),target:'preview',outsideApp:true,
  confirm:false,requestKey:'gitDeployFAKE01'};
const decode=x=>JSON.parse(x.content[0].text);
function fixture(override=row){
  const fake=makeFakeVercel(),audits=[],claims=[];
  fake.when('GET','/v9/projects/{idOrName}').resolves(override);
  const db={getAccountCredential:async()=>({}),
    listProtectedResources:async()=>[],recordChange:async a=>audits.push(a),
    requestReplayStore:()=>({claim:async c=>{claims.push(c);return {state:'claimed',claimId:c.key}},
      complete:async()=>{},release:async()=>true})};
  const call=(input=args,c=connection)=>dispatchReadOnlyTool({
    registry,name:'vercel_deploy_create_from_git',args:input,
    connection:c,db,fetchImpl:fake.fetch});
  return {fake,db,audits,claims,call};
}
describe('D-3 Git deployment source and cost-safe nonproduction gates',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  it('registers full-profile guarded spend operation',()=>{
    expect(registry.tools.find(x=>x.name==='vercel_deploy_create_from_git'))
      .toMatchObject({writes:true,guardedWrite:true,profiles:['full'],
        writeContract:{spend:true,production:true,targets:true}});
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .some(x=>x.name==='vercel_deploy_create_from_git')).toBe(false);
  });
  it('proves project Git source, exact immutable commit and displays safe preview',async()=>{
    const f=fixture(),view=decode(await f.call({...args,dryRun:true}));
    expect(view).toMatchObject({status:'preview',mode:'PREVIEW'});
    expect(view.preview).toContain(args.gitSha);
    expect(view.moneyLine).toMatch(/total ceiling/);
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
    expect(f.fake.calls[0].query.teamId).toBe('team_FAKE');
    expect(f.audits).toHaveLength(1);expect(f.claims).toHaveLength(0);
    f.fake.verify();
  });
  it('denies unbounded metered build even with tool confirmation',async()=>{
    const f=fixture(),view=decode(await f.call({...args,confirm:true}));
    expect(view).toMatchObject({status:'refused_by_guard'});
    expect(view.reason).toMatch(/enforceable/i);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    expect(f.claims).toHaveLength(0);
  });
  it('validates official Git create request envelope before dispatch',()=>{
    expect(()=>validateRequest('deployments_create',{
      query:{teamId:'team_FAKE_validation'},
      body:{name:'the-app',project:'the-app',
        gitSource:{type:'github',org:'example-org',repo:'my-repo',
          ref:'feature/preview',sha:'a'.repeat(40)},target:'preview'}
    })).not.toThrow();
  });
  it('rejects production target from a preview connection',async()=>{
    const f=fixture();
    expect(decode(await f.call({...args,target:'production',confirm:true}))
      .status).toBe('refused_by_guard');
    expect(f.fake.calls.some(x=>x.method==='POST')).toBe(false);
  });
  it('classifies owner-authorized production preview without writing or charging',async()=>{
    const f=fixture();
    expect(decode(await f.call({...args,target:'production',dryRun:true},
      {...connection,mode:'production'})))
      .toMatchObject({status:'preview',mode:'PRODUCTION'});
    expect(f.fake.calls.some(x=>x.method==='POST')).toBe(false);
  });
  it('refuses unlinked and contradictory provider Git scope',async()=>{
    for(const other of [
      {...row,id:'prj_OTHER'}, {...row,name:'foreign'},
      {...row,accountId:'team_OTHER'}, {...row,link:null},
      {...row,link:{...row.link,type:'gitlab'}},
      {...row,link:{...row.link,org:'bad/owner'}},
      {...row,link:{...row.link,repo:'../wrong'}}
    ]){
      const f=fixture(other),out=decode(await f.call());
      expect(out.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(c=>c.method!=='POST')).toBe(true);
    }
  });
  it('refuses unverified refs, targets, roles and extra selector fields',async()=>{
    for(const patch of [
      {project:'prj_OTHER'},{gitSha:'0000'}, {gitRef:'../main'},
      {gitRef:'feature//broken'}, {gitRef:'feature?token=x'},
      {target:'staging'},{outsideApp:false},{teamId:'team_OTHER'},
      {confirm:'yes'},{requestKey:'bad!'}
    ]){
      const f=fixture(),answer=await f.call({...args,...patch});
      expect(answer.isError||decode(answer).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.every(c=>c.method!=='POST')).toBe(true);
    }
    const f=fixture();
    expect((await f.call(args,{...connection,profile:'read_only'})).isError).toBe(true);
  });
  it('guarded protected fixture refuses before any spending',async()=>{
    const f=fixture();f.db.listProtectedResources=async()=>[{match:project}];
    expect(decode(await f.call({...args,confirm:true})).status)
      .toBe('refused_by_guard');
    expect(f.fake.calls.some(x=>x.method==='POST')).toBe(false);
  });
});
describe('AUD-H real provider shapes (VMCP-023)',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  it('applies a confirmed preview deployment whose object carries target:null',async()=>{
    const f=fixture();
    f.db.getPurchasePolicy=async()=>({grantRequired:false,budgetCents:null});
    f.db.getTodaySpendCents=async()=>0;
    const deploymentRow={id:'dpl_FAKEGITDEP01',projectId:project,target:null,
      readyState:'QUEUED'};
    f.fake.when('POST','/v13/deployments').resolves(deploymentRow);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(deploymentRow);
    const out=decode(await f.call({...args,confirm:true},
      {...connection,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
});

describe('AUD-L in-progress create shape (VMCP-023)',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  it('applies a confirmed preview deployment answered in the in-progress shape',async()=>{
    const f=fixture();
    f.db.getPurchasePolicy=async()=>({grantRequired:false,budgetCents:null});
    f.db.getTodaySpendCents=async()=>0;
    // Branch 0 of the documented create response: still building —
    // id, target and readyState, and NO projectId. The full shape
    // arrives on verify()'s read-back instead.
    f.fake.when('POST','/v13/deployments').resolves({
      id:'dpl_FAKEGITDEP01',target:null,readyState:'BUILDING',
      aliasAssigned:false,duration:0});
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      id:'dpl_FAKEGITDEP01',projectId:project,target:null,
      readyState:'QUEUED'});
    const out=decode(await f.call({...args,confirm:true},
      {...connection,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
});

describe('AUD-M verify read-back shapes (VMCP-023)',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  it('confirms when the read-back arrives in the in-progress shape',async()=>{
    const f=fixture();
    f.db.getPurchasePolicy=async()=>({grantRequired:false,budgetCents:null});
    f.db.getTodaySpendCents=async()=>0;
    f.fake.when('POST','/v13/deployments').resolves({
      id:'dpl_FAKEGITDEP01',projectId:project,target:null,
      readyState:'QUEUED'});
    // The verify read-back is still building: no projectId carried.
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      id:'dpl_FAKEGITDEP01',target:null,readyState:'BUILDING'});
    const out=decode(await f.call({...args,confirm:true},
      {...connection,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
});
