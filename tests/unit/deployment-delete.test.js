import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

const project='prj_FAKE_ONE',deployment='dpl_FAKE_TERMINAL';
const token={token:'vcp_FAKE_delete',account:{
  id:'acct_FAKE',team_id:'team_FAKE',scope:'project',project_id:project}};
const connection={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
// Remodeled on the real read-back (VMCP-028): a preview deployment's
// target reads back null — 'preview' is request-side only.
const row={uid:deployment,projectId:project,readyState:'CANCELED',
  target:null,alias:[]};
const args={deployment,project,expectedState:'CANCELED',outsideApp:true,
  confirm:true,requestKey:'deletePreviewFAKE01'};
const result=x=>JSON.parse(x.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),memo=new Map(),audits=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async entry=>audits.push(entry),
    requestReplayStore:()=>({
      claim:async({key})=>memo.has(key)?
        {state:'completed',result:memo.get(key)}:{state:'claimed',claimId:key},
      complete:async({key,result})=>{memo.set(key,result);},
      release:async()=>true
    })
  };
  const call=(input=args,c=connection)=>dispatchReadOnlyTool({
    registry,name:'vercel_deploy_delete',args:input,connection:c,db,fetchImpl:fake.fetch
  });
  return {fake,db,call,memo,audits};
}
function setup(f,afterStatus=404){
  f.fake.when('GET','/v13/deployments/{idOrUrl}')
    .resolves(row).resolves(row).resolves(row)
    .rejects(afterStatus);
  f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
}
describe('D-3 terminal unaliased preview cleanup',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(token);});
  it('uses a genuine guarded write, not a read-only or everyday tool',()=>{
    const tool=registry.tools.find(x=>x.name==='vercel_deploy_delete');
    expect(tool).toMatchObject({writes:true,guardedWrite:true,
      writeContract:{production:true,targets:true,spend:false,access:false}});
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .some(x=>x.name===tool.name)).toBe(false);
    expect(listMcpTools(registry,{...connection,profile:'everyday'})
      .some(x=>x.name===tool.name)).toBe(false);
  });
  it('deletes one terminal preview after independent project/state/alias proofs and readback',async()=>{
    const f=fixture();setup(f);
    const first=result(await f.call());
    expect(first).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
    // After irreversible cleanup there is no source state to re-prove.
    // Refuse a replay rather than reissuing DELETE or fabricating an outcome.
    expect(result(await f.call())).toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','GET','DELETE','GET','GET']);
    expect(f.fake.calls[3].path).toBe('/v13/deployments/'+deployment);
    expect(f.fake.calls[3].query.teamId).toBe('team_FAKE');
    expect(f.fake.calls[3].body).toBeUndefined();
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    expect(f.memo.size).toBe(2);expect(f.audits).toHaveLength(1);
    f.fake.verify();
  });
  it('accepts the literal preview target where a shape carries it (VMCP-028 tolerant form)',async()=>{
    const f=fixture();
    const literal={...row,target:'preview'};
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves(literal).resolves(literal).resolves(literal).rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    expect(result(await f.call({...args,requestKey:'deleteLiteralFAKE03'})))
      .toMatchObject({status:'applied',confirmed:true});
  });
  it('supports already-failed, unaliased preview cleanup',async()=>{
    const f=fixture();
    const failed={...row,readyState:'ERROR'};
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves(failed).resolves(failed).resolves(failed).rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    expect(result(await f.call({...args,expectedState:'ERROR',
      requestKey:'deleteFailureFAKE02'})))
      .toMatchObject({status:'applied',confirmed:true});
  });
  it('dry-run and no-confirm never DELETE',async()=>{
    for(const patch of [{dryRun:true,confirm:false},{confirm:false}]){
      const f=fixture();setup(f);
      const out=result(await f.call({...args,...patch}));
      expect(out.status).toBe(patch.dryRun?'preview':'needs_confirmation');
      expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
    }
  });
  it('denies production, running, ready, and ambiguous targets or aliases',async()=>{
    const unsafe=[
      {...row,target:'production'},{...row,target:'staging'},{...row,target:undefined},
      {...row,readyState:'READY'},{...row,readyState:'BUILDING'},
      {...row,alias:undefined},{...row,alias:['live.example.test']},
      {...row,aliases:['primary.example.test']},
      {...row,aliases:'unverifiable'},
      {...row,projectId:'prj_OTHER'},
      {...row,id:'dpl_DIFFERENT'},
      {...row,uid:'dpl_OTHER'}
    ];
    for(const changed of unsafe){
      const f=fixture();
      f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(changed);
      const response=await f.call();
      expect(response.isError||result(response).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.some(c=>c.method==='DELETE')).toBe(false);
    }
  });
  it('denies a change between preview and immediate pre-dispatch verification',async()=>{
    for(const changed of [
      {...row,target:'production'},{...row,alias:['live.example.test']},
      {...row,readyState:'READY'},{...row,projectId:'prj_OTHER'}]){
      const f=fixture();
      f.fake.when('GET','/v13/deployments/{idOrUrl}')
        .resolves(row).resolves(row).resolves(changed);
      const out=result(await f.call());
      expect(out.status).toBe('refused_by_guard');
      expect(f.fake.calls.some(c=>c.method==='DELETE')).toBe(false);
    }
  });
  it('refuses forged, incomplete or unauthorized deletion arguments before DELETE',async()=>{
    const f=fixture();
    for(const bad of [
      {...args,teamId:'team_OTHER'},
      {...args,deployment:'../invalid'},
      {...args,project:'prj_OTHER'},
      {...args,outsideApp:false},
      {...args,expectedState:'READY'},
      {...args,confirm:'yes'}
    ]){
      const answer=await f.call(bad);
      expect(answer.isError||result(answer).status==='refused_by_guard').toBe(true);
    }
    const denied=await f.call(args,{...connection,profile:'read_only'});
    expect(denied.isError).toBe(true);
    expect(f.fake.calls.every(x=>x.method!=='DELETE')).toBe(true);
  });
  it('refuses protected deployments even when their provider data looks eligible',async()=>{
    const f=fixture();setup(f);
    f.db.listProtectedResources=async()=>[{match:deployment,note:'protected fixture'}];
    expect(result(await f.call())).toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.some(x=>x.method==='DELETE')).toBe(false);
  });
  it('denies rotated project credentials before irreversible dispatch',async()=>{
    const f=fixture();setup(f);
    loadToken.mockResolvedValueOnce(token).mockResolvedValueOnce({
      ...token,account:{...token.account,project_id:'prj_OTHER'}
    });
    expect(result(await f.call())).toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.some(x=>x.method==='DELETE')).toBe(false);
  });
  it('does not claim deletion when readback is inconclusive',async()=>{
    for(const status of [200,503]){
      const f=fixture();
      const reads=f.fake.when('GET','/v13/deployments/{idOrUrl}')
        .resolves(row).resolves(row).resolves(row);
      if(status===200)reads.resolves(row);else reads.rejects(503).rejects(503);
      f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
      const got=result(await f.call());
      expect(got).toMatchObject({status:'applied',
        confirmed:status===200?false:null});
      expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    }
  });
});

describe('AUD-CJ owner-confirmed deletion of a serving deployment',()=>{
  const prodDeployment='dpl_FAKE_PROD';
  const prodRow={uid:prodDeployment,projectId:project,readyState:'READY',
    target:'production',url:'fake-prod.vercel.app',created:1730000000000,
    alias:['www.example.com'],
    meta:{githubCommitRef:'main',githubCommitSha:'a'.repeat(40)}};
  const prodProject={id:project,name:'fake-prod-project',
    productionDeploymentId:prodDeployment};
  const prodConnection={account:'acct_FAKE',profile:'full',
    mode:'production',listing:'catalog'};
  const prodArgs={deployment:prodDeployment,project,expectedState:'READY',
    outsideApp:true,requestKey:'deleteProdFAKE01'};
  function prodFixture(rowOverride=prodRow,projectOverride=prodProject){
    const f=fixture();
    const reads=f.fake.when('GET','/v13/deployments/{idOrUrl}');
    // Plan (2) + confirm before (2) + apply re-reads (2); the
    // verify read after the DELETE is the one that must 404.
    for(let i=0;i<6;i++)reads.resolves(rowOverride);
    reads.rejects(404);
    const projects=f.fake.when('GET','/v9/projects/{idOrName}');
    for(let i=0;i<6;i++)projects.resolves(projectOverride);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    return f;
  }
  const deletes=f=>f.fake.calls.filter(x=>x.method==='DELETE');
  it('plans a production deletion with the full warning and fingerprint, deleting nothing',async()=>{
    const f=prodFixture();
    const plan=result(await f.call({...prodArgs,dryRun:true},prodConnection));
    expect(plan.status).toBe('preview');
    expect(plan.preview).toContain('OWNER-CONFIRMED DELETION');
    expect(plan.preview).toContain('CURRENT PRODUCTION DEPLOYMENT');
    expect(plan.preview).toContain('www.example.com');
    expect(plan.preview).toMatch(/Evaluation: [0-9a-f]{64}/);
    expect(deletes(f)).toHaveLength(0);
  });
  it('refuses a confirmation that names no evaluation or a stale one',async()=>{
    const f=prodFixture();
    const noId=result(await f.call({...prodArgs,confirm:true,
      requestKey:'deleteProdNoId02'},prodConnection));
    expect(noId).toMatchObject({status:'refused_by_guard'});
    expect(JSON.stringify(noId)).toContain('requires confirming the exact evaluation');
    const stale=result(await f.call({...prodArgs,confirm:true,
      evaluationId:'0'.repeat(64),requestKey:'deleteProdStale3'},prodConnection));
    expect(stale).toMatchObject({status:'refused_by_guard'});
    expect(JSON.stringify(stale)).toContain('no longer current');
    expect(deletes(f)).toHaveLength(0);
  });
  it('deletes the current production deployment on the exact evaluation, verified gone',async()=>{
    const f=prodFixture();
    const plan=result(await f.call({...prodArgs,dryRun:true,
      requestKey:'deleteProdPlan04'},prodConnection));
    const evaluationId=/Evaluation: ([0-9a-f]{64})/.exec(plan.preview)[1];
    const done=result(await f.call({...prodArgs,confirm:true,evaluationId,
      requestKey:'deleteProdDo05'},prodConnection));
    expect(done).toMatchObject({status:'applied',confirmed:true});
    expect(deletes(f)).toHaveLength(1);
    expect(f.audits).toHaveLength(2);
  });
  it('deletes a healthy aliased preview on the exact evaluation',async()=>{
    const previewRow={uid:prodDeployment,projectId:project,readyState:'READY',
      target:null,url:'fake-preview.vercel.app',created:1730000000000,
      alias:['preview.example.com'],meta:{githubCommitRef:'feature'}};
    const otherProject={id:project,name:'fake-prod-project',
      productionDeploymentId:'dpl_SOMEONE_ELSE'};
    const f=prodFixture(previewRow,otherProject);
    const plan=result(await f.call({...prodArgs,dryRun:true,
      requestKey:'deletePrevPlan06'},prodConnection));
    expect(plan.preview).toContain('preview.example.com');
    expect(plan.preview).not.toContain('CURRENT PRODUCTION DEPLOYMENT');
    const evaluationId=/Evaluation: ([0-9a-f]{64})/.exec(plan.preview)[1];
    const done=result(await f.call({...prodArgs,confirm:true,evaluationId,
      requestKey:'deletePrevDo07'},prodConnection));
    expect(done).toMatchObject({status:'applied',confirmed:true});
    expect(deletes(f)).toHaveLength(1);
  });
  it('refuses when an alias appears between the plan and the confirmation',async()=>{
    const f=fixture();
    const plain={...prodRow,alias:[]};
    const aliased={...prodRow,alias:['new.example.com']};
    const reads=f.fake.when('GET','/v13/deployments/{idOrUrl}');
    // plan: scoped + raw; confirm before: scoped + raw (still plain);
    // apply re-reads: fresh + scoped (aliased now).
    reads.resolves(plain).resolves(plain).resolves(plain).resolves(plain)
      .resolves(aliased).resolves(aliased);
    const projects=f.fake.when('GET','/v9/projects/{idOrName}');
    for(let i=0;i<4;i++)projects.resolves(prodProject);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const plan=result(await f.call({...prodArgs,dryRun:true,
      requestKey:'deleteDriftPlan8'},prodConnection));
    const evaluationId=/Evaluation: ([0-9a-f]{64})/.exec(plan.preview)[1];
    const done=result(await f.call({...prodArgs,confirm:true,evaluationId,
      requestKey:'deleteDriftDo9'},prodConnection));
    expect(done).toMatchObject({status:'refused_by_guard'});
    expect(deletes(f)).toHaveLength(0);
  });
});
