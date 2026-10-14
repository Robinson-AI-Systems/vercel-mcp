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
const row={uid:deployment,projectId:project,readyState:'CANCELED',
  target:'preview',alias:[]};
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
      {...row,target:'production'},{...row,target:null},{...row,target:undefined},
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
