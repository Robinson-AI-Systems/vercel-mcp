import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const conn={account:'acct_FAKE',mode:'production',profile:'full',listing:'catalog'};
const token={token:'vcp_FAKE_resources',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
const project={id:'prj_FAKE_RESOURCE',name:'demo-site',
  resourceConfig:{buildMachineType:'standard',buildMachineSelection:'fixed',
    elasticConcurrencyEnabled:false,fluid:false,
    functionDefaultMemoryType:'standard',functionDefaultTimeout:30,
    functionDefaultRegions:['iad1'],buildQueue:{configuration:'WAIT_FOR_NAMESPACE_QUEUE'}}};
const parse=r=>JSON.parse(r.content[0].text);
function fixture({limit=10000,protectedName=null,scope='team'}={}){
  const fake=makeFakeVercel(),ledger=new Map(),audits=[],spendCalls=[];
  const db={
    getAccountCredential:async()=>({}),
    getVercelAccountSafe:async id=>{spendCalls.push(id);return {id,spend_limit_cents:limit};},
    getTodaySpendCents:async()=>0,
    listProtectedResources:async()=>protectedName?
      [{kind:'project',match:protectedName}]:[],
    recordChange:async x=>audits.push(x),
    requestReplayStore:()=>({
      claim:async({key})=>ledger.has(key)?{state:'completed',result:ledger.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>ledger.set(key,result)
    })
  };
  loadToken.mockResolvedValue({...token,account:{...token.account,scope}});
  const call=(args,c=conn)=>dispatchReadOnlyTool({registry,
    name:'vercel_project_set_build_resources',args,db,connection:c,fetchImpl:fake.fetch});
  return {fake,db,call,spendCalls,ledger,audits};
}
describe('D-1q billed project resource configuration',()=>{
  beforeEach(()=>loadToken.mockResolvedValue(token));
  it('advertises a genuine billed write with full-profile isolation',()=>{
    const t=registry.tools.find(x=>x.name==='vercel_project_set_build_resources');
    expect(t.writeContract).toMatchObject({production:true,targets:true,spend:true,access:false});
    expect(t.annotations.readOnlyHint).toBe(false);
    expect(listMcpTools(registry,{...conn,profile:'read_only'})
      .some(x=>x.name===t.name)).toBe(false);
  });
  it('sends one partial grouped PATCH, bound to team, with independent GET confirmation',async()=>{
    const f=fixture();
    const changes={buildMachineType:'enhanced',buildMachineSelection:'elastic',
      elasticConcurrencyEnabled:true,fluid:true,
      functionDefaultMemoryType:'performance',functionDefaultTimeout:60,
      functionDefaultRegions:['sfo1'],
      buildQueueConfiguration:'SKIP_NAMESPACE_QUEUE'};
    const resourceConfig={buildMachineType:'enhanced',buildMachineSelection:'elastic',
      elasticConcurrencyEnabled:true,fluid:true,
      functionDefaultMemoryType:'performance',functionDefaultTimeout:60,
      functionDefaultRegions:['sfo1'],
      buildQueue:{configuration:'SKIP_NAMESPACE_QUEUE'}};
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(project)
      .resolves({...project,resourceConfig:{...project.resourceConfig,...resourceConfig}});
    f.fake.when('PATCH','/v9/projects/{idOrName}').resolves({id:project.id});
    const result=parse(await f.call({project:project.id,expectedName:project.name,
      ...changes,confirm:true}));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','PATCH','GET']);
    expect(f.fake.calls[1].query.teamId).toBe('team_FAKE');
    expect(f.fake.calls[1].body).toEqual({resourceConfig});
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0].spendCents).toBeNull();
    expect(f.ledger.size).toBe(2);
    expect(f.spendCalls).toEqual(['acct_FAKE']);
    f.fake.verify();
  });
  it('blocks default zero budget, missing confirmation, preview-mode and read-only',async()=>{
    for(const scenario of ['zero','noConfirm','preview','readOnly']){
      const f=fixture({limit:scenario==='zero'?0:20000});
      f.fake.when('GET','/v9/projects/{idOrName}').resolves(project);
      const args={project:project.id,expectedName:project.name,
        buildMachineType:'enhanced',confirm:scenario!=='noConfirm'};
      const c={...conn,...(scenario==='preview'?{mode:'preview'}:
        scenario==='readOnly'?{profile:'read_only'}:{})};
      const out=await f.call(args,c);
      expect(out.isError||['spend_limit','needs_confirmation','refused_by_guard'].includes(parse(out).status))
        .toBe(true);
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    }
  });
  it('rejects malformed scope/values before network and unknown project snapshot',async()=>{
    const f=fixture();
    const base={project:project.id,expectedName:project.name,confirm:true};
    for(const args of [
      {...base,buildMachineType:'unlimited'},
      {...base,fluid:'true'},
      {...base,functionDefaultTimeout:1200},
      {...base,functionDefaultRegions:['../../abc']},
      {...base,fluid:true,teamId:'team_OTHER'},
      {...base}
    ]){
      const out=await f.call(args);
      expect(out.isError||parse(out).status==='refused_by_guard').toBe(true);
    }
    expect(f.fake.calls).toHaveLength(0);
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves({...project,resourceConfig:undefined});
    expect(parse(await f.call({...base,fluid:true})).status)
      .toBe('refused_by_guard');
    f.fake.verify();
  });
  it('does not mutate on an already-matched setting or unconfirmed spend preview',async()=>{
    const f=fixture({limit:20000});
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(project)
      .resolves(project);
    const noop=parse(await f.call({project:project.id,expectedName:project.name,
      fluid:false,confirm:true}));
    expect(noop.status).toBe('refused_by_guard');
    const preview=parse(await f.call({project:project.id,expectedName:project.name,
      fluid:true,dryRun:true}));
    expect(preview.status).toBe('preview');
    expect(preview.moneyLine).toContain('usage-based');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('refuses app/production privilege widening without explicit settings and read-back',async()=>{
    const f=fixture({limit:20000,scope:'project'});
    const res=parse(await f.call({project:project.id,expectedName:project.name,
      fluid:true,confirm:true}));
    expect(res.status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
    const ok=fixture();
    ok.fake.when('GET','/v9/projects/{idOrName}').resolves(project)
      .resolves({...project,resourceConfig:project.resourceConfig});
    ok.fake.when('PATCH','/v9/projects/{idOrName}').resolves({id:project.id});
    const result=parse(await ok.call({project:project.id,expectedName:project.name,
      fluid:true,confirm:true}));
    expect(result.status).toBe('applied');
    expect(result.confirmed).toBe(false);
    ok.fake.verify();
  });
});
