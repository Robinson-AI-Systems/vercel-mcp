import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE',mode:'production',profile:'full',listing:'catalog'};
const token={token:'vcp_FAKE_traffic',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
const before={id:'prj_FAKE_DEMO',name:'demo-site',paused:false};
const parse=result=>JSON.parse(result.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),completed=new Map(),audits=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async entry=>audits.push(entry),
    requestReplayStore:()=>({
      claim:async({key})=>completed.has(key)?
        {state:'completed',result:completed.get(key)}:{state:'claimed',claimId:key},
      complete:async({key,result})=>{completed.set(key,result);}
    })
  };
  const call=(name,args,c=connection)=>dispatchReadOnlyTool({
    registry,name,args,db,connection:c,fetchImpl:fake.fetch
  });
  return {fake,call,completed,audits,db};
}
describe('D-1k guarded project pause/unpause',()=>{
  beforeEach(()=>loadToken.mockResolvedValue(token));
  it.each([
    ['vercel_project_pause','pause',false,true],
    ['vercel_project_unpause','unpause',true,false]
  ])('executes %s via scoped before POST after, not POST-only success',
    async(name,operation,initial,desired)=>{
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}')
        .resolves({...before,paused:initial}).resolves({...before,paused:desired});
      f.fake.when('POST','/v1/projects/{projectId}/'+operation).resolves({});
      const result=parse(await f.call(name,{project:before.id,confirm:true}));
      expect(result).toMatchObject({status:'applied',confirmed:true});
      expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','POST','GET']);
      expect(f.fake.calls[1].params.projectId).toBe(before.id);
      expect(f.fake.calls[1].query.teamId).toBe('team_FAKE');
      expect(f.fake.calls[1].body).toBeUndefined();
      expect(f.completed.size).toBe(2);
      expect(f.audits).toHaveLength(1);
      f.fake.verify();
    });
  it('never mutates on preview, no-confirm or preview-mode connection',async()=>{
    for(const mode of ['dryRun','needs_confirmation','preview_connection']){
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}').resolves(before);
      const args={project:before.id,...(mode==='dryRun'?{dryRun:true}:
        mode==='preview_connection'?{confirm:true}: {})};
      const c=mode==='preview_connection'?{...connection,mode:'preview'}:connection;
      const result=parse(await f.call('vercel_project_pause',args,c));
      expect(result.status).toBe(mode==='dryRun'?'preview':
        mode==='preview_connection'?'refused_by_guard':'needs_confirmation');
      expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
      f.fake.verify();
    }
  });
  it('returns verified no-op and logical replay without a POST',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves({...before,paused:true}).resolves({...before,paused:true})
      .resolves({...before,paused:true});
    const args={project:before.id,confirm:true,requestKey:'FAKE_pause_replay'};
    const first=parse(await f.call('vercel_project_pause',args));
    expect(first).toMatchObject({status:'applied',confirmed:true});
    expect(parse(await f.call('vercel_project_pause',args))).toEqual(first);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('fails closed for unknown pause state, invalid inputs and project-only tokens',async()=>{
    const f=fixture();
    for(const args of [{project:'../bad',confirm:true},
      {project:before.id,teamId:'other'},
      {project:before.id,confirm:'yes'}]){
      const result=await f.call('vercel_project_pause',args);
      expect(result.isError||parse(result).status==='refused_by_guard').toBe(true);
    }
    f.fake.when('GET','/v9/projects/{idOrName}').resolves({...before,paused:undefined});
    const unknown=parse(await f.call('vercel_project_pause',{project:before.id,confirm:true}));
    expect(unknown.status).toBe('refused_by_guard');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    loadToken.mockResolvedValue({...token,account:{...token.account,scope:'project',project_id:before.id}});
    const blocked=parse(await f.call('vercel_project_pause',{project:before.id,confirm:true}));
    expect(blocked.status).toBe('refused_by_guard');
    f.fake.verify();
  });
  it('does not mistake absent after-state for successful provider verification',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(before)
      .resolves({...before,paused:undefined});
    f.fake.when('POST','/v1/projects/{projectId}/pause').resolves({});
    const result=parse(await f.call('vercel_project_pause',{project:before.id,confirm:true}));
    expect(result.status).toBe('applied');
    expect(result.confirmed).toBeNull();
    f.fake.verify();
  });
  it('advertises both operations as writes without read-only selectors',()=>{
    for(const name of ['vercel_project_pause','vercel_project_unpause']){
      const entry=listMcpTools(registry,connection).find(x=>x.name===name);
      expect(entry.annotations.readOnlyHint).toBe(false);
      expect(entry.annotations.idempotentHint).toBe(false);
      expect(entry.inputSchema.properties.fields).toBeUndefined();
      expect(entry.inputSchema.properties.detail).toBeUndefined();
      expect(entry.writes).toBeUndefined();
    }
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .find(x=>x.name==='vercel_project_pause')).toBeUndefined();
  });
});
