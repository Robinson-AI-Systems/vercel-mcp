import {describe,it,expect,beforeEach,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));

const project='prj_ROLLING_TEST',team='team_ROLLING_TEST';
const old='dpl_ROLLING_LIVE',canary='dpl_ROLLING_CANARY';
const config={rollingRelease:{target:'production',enabled:true,
  advancementType:'manual-approval',
  stages:[{targetPercentage:10,requireApproval:true},
    {targetPercentage:100,requireApproval:false}]}};
const active=(index=0,updatedAt=1234,state='ACTIVE')=>({rollingRelease:{
  state,substate:'RUNNING',currentDeployment:{id:old},
  canaryDeployment:{id:canary},advancementType:'manual-approval',
  activeStage:{index,requireApproval:index===0,isFinalStage:index===1,
    targetPercentage:index===0?10:100},
  nextStage:index===0?{index:1}:null,updatedAt}});
const owner={account:'acct_ROLLING',profile:'full',mode:'production',listing:'catalog'};
const preview={...owner,mode:'preview'};
const parse=r=>JSON.parse(r.content?.[0]?.text??'{}');
function setup({configuration=config,stages=[active()],aliases=null}={}){
  const fake=makeFakeVercel(),ledger=new Map(),claims=new Set(),audits=[];
  const db={
    getAccountCredential:async()=>({}),
    getVercelAccountSafe:async()=>({id:owner.account,spend_limit_cents:0}),
    getTodaySpendCents:async()=>0,
    listProtectedResources:async()=>[],
    recordChange:async row=>audits.push(row),
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(ledger.has(key))return {state:'completed',result:ledger.get(key)};
        if(claims.has(key))return {state:'pending'};
        claims.add(key);return {state:'claimed',claimId:key};
      },
      complete:async({key,result})=>{claims.delete(key);ledger.set(key,result);},
      release:async({key})=>{claims.delete(key);return true;}
    })
  };
  loadToken.mockResolvedValue({token:'vcp_ROLLING_FAKE',
    account:{id:owner.account,scope:'project',team_id:team,project_id:project}});
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,accountId:team,name:'rolling-fake'});
  fake.when('GET','/v1/projects/{idOrName}/rolling-release/config')
    .resolves(configuration);
  const activeAnswers=fake.when('GET','/v1/projects/{idOrName}/rolling-release');
  for(const s of stages)activeAnswers.resolves(s);
  fake.when('GET','/v1/projects/{idOrName}/rolling-release/billing')
    .resolves({availableSlots:1,reason:'approved plan'});
  fake.when('GET','/v4/aliases').resolves({aliases:aliases??[
    {id:'al_FAKE_ROLLING',alias:'live.example.test',projectId:project,
      deploymentId:old}],pagination:{next:null}});
  for(const [id,created,served] of [[old,100,150],[canary,200,null]]){
    fake.when('GET','/v13/deployments/'+id).resolves({
      uid:id,projectId:project,target:'production',readyState:'READY',
      created,aliasAssigned:served,meta:{githubCommitSha:'a'.repeat(40)}
    });
  }
  const call=(name,args={},connection=owner)=>dispatchReadOnlyTool({
    registry,name,args,db,connection,fetchImpl:fake.fetch});
  const writes=()=>fake.calls.filter(x=>['PATCH','POST','DELETE'].includes(x.method));
  return {fake,db,call,writes,ledger,audits};
}
describe('D-4 rolling-release guarded lifecycle',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('registers five genuine release tools with four guarded writes',()=>{
    for(const name of ['vercel_rolling_update_config','vercel_rolling_start',
      'vercel_rolling_approve_stage','vercel_rolling_complete']){
      const item=registry.tools.find(x=>x.name===name);
      expect(item).toMatchObject({writes:true,guardedWrite:true,
        writeContract:{production:true,targets:true}});
      expect(listMcpTools(registry,{...preview,profile:'read_only'})
        .some(x=>x.name===name)).toBe(false);
    }
    expect(registry.tools.find(x=>x.name==='vercel_rolling_get'))
      .toMatchObject({writes:false,area:'releases'});
  });
  it('pins exact REST GET/POST paths and bodies to the vendored schema',()=>{
    for(const operation of ['rolling_billing_get','rolling_config_get',
      'rolling_active_get'])expect(validateRequest(operation,
      {path:{idOrName:project},query:{teamId:team}})).toBe(true);
    expect(validateRequest('rolling_start',{
      path:{idOrName:project},query:{teamId:team},
      body:{canaryDeploymentId:canary}})).toBe(true);
    expect(validateRequest('rolling_approve',{
      path:{idOrName:project},query:{teamId:team},
      body:{nextStageIndex:1,canaryDeploymentId:canary}})).toBe(true);
    expect(validateRequest('rolling_complete',{
      path:{idOrName:project},query:{teamId:team},
      body:{canaryDeploymentId:canary}})).toBe(true);
  });
  it('returns scoped configuration hash, active canary and billing slots',async()=>{
    const f=setup();
    const result=parse(await f.call('vercel_rolling_get',{project},preview));
    expect(result).toMatchObject({project,billing:{availableSlots:1,eligible:true},
      active:{canary,current:old,stageIndex:0}});
    expect(result.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.writes()).toHaveLength(0);
    expect(f.fake.calls.every(x=>x.query.teamId===team)).toBe(true);
    f.fake.verify();
  });
  it('does not initiate a paid rolling release in preview or production with no provider ceiling',async()=>{
    const f=setup({stages:[{rollingRelease:null}]});
    const args={project,deployment:canary,expectedCurrent:old,
      outsideApp:true,confirm:true,requestKey:'rollingStartFake01'};
    expect(parse(await f.call('vercel_rolling_start',args,preview)).status)
      .toBe('refused_by_guard');
    const production=parse(await f.call('vercel_rolling_start',args,owner));
    expect(production.status).toBe('refused_by_guard');
    expect(production.reason).toContain('provider-enforceable');
    expect(f.writes()).toHaveLength(0);
  });
  it('refuses stale or mismatched stage and leaves provider untouched',async()=>{
    const f=setup();
    const args={project,deployment:canary,expectedCurrent:old,
      expectedStageIndex:2,expectedUpdatedAt:1234,
      outsideApp:true,confirm:true,requestKey:'rollingApproveFake01'};
    const result=parse(await f.call('vercel_rolling_approve_stage',args,owner));
    expect(result.status).toBe('refused_by_guard');
    expect(f.writes()).toHaveLength(0);
  });
  it('advances only the specific manual stage and independently verifies the next stage',async()=>{
    const f=setup({stages:[active(0,1234),active(0,1234),active(1,1235)]});
    f.fake.when('POST','/v1/projects/{idOrName}/rolling-release/approve-stage')
      .resolves(active(1,1235));
    const args={project,deployment:canary,expectedCurrent:old,
      expectedStageIndex:0,expectedUpdatedAt:1234,
      outsideApp:true,confirm:true,requestKey:'rollingApproveFake02'};
    const result=parse(await f.call('vercel_rolling_approve_stage',args,owner));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0]).toMatchObject({
      method:'POST',path:'/v1/projects/'+project+'/rolling-release/approve-stage',
      body:{canaryDeploymentId:canary,nextStageIndex:1},
      query:{teamId:team}});
    expect((await f.call('vercel_rolling_approve_stage',args,owner)).content)
      .toEqual(expect.any(Array));
    expect(f.writes()).toHaveLength(1);
    f.fake.verify();
  });
  it('completes the exact canary but keeps unverified alias propagation unresolved',async()=>{
    const f=setup({stages:[active(0,1234),active(0,1234),
      active(1,1235,'COMPLETED')]});
    f.fake.when('POST','/v1/projects/{idOrName}/rolling-release/complete')
      .resolves(active(1,1235,'COMPLETED'));
    const args={project,deployment:canary,expectedCurrent:old,
      expectedStageIndex:0,expectedUpdatedAt:1234,
      outsideApp:true,confirm:true,requestKey:'rollingCompleteFake01'};
    const out=parse(await f.call('vercel_rolling_complete',args,owner));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(null);
    expect(f.writes()).toHaveLength(1);
  });
  it('disables idle rollout configuration only from a confirmed production owner',async()=>{
    const f=setup({stages:[{rollingRelease:null}]});
    const initial=parse(await f.call('vercel_rolling_get',{project}));
    const args={project,expectedConfigHash:initial.configHash,enabled:false,
      outsideApp:true,confirm:true,requestKey:'rollingDisableFake01'};
    f.fake.when('PATCH','/v1/projects/{idOrName}/rolling-release/config')
      .resolves({rollingRelease:null});
    const out=parse(await f.call('vercel_rolling_update_config',args,preview));
    expect(out.status).toBe('refused_by_guard');
    expect(f.writes()).toHaveLength(0);
    const changing=parse(await f.call('vercel_rolling_update_config',args,owner));
    expect(changing.status).toBe('applied');
    expect(changing.confirmed).toBe(null);
    expect(f.writes()).toHaveLength(1);
  });
});
