import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE',mode:'production',profile:'full',listing:'catalog'};
const token={token:'vcp_FAKE_project',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
const project={id:'prj_FAKE_EMPTY',name:'empty-site',hasDeployments:false,
  link:null,crons:{definitions:[]}};
const request={project:project.id,expectedName:project.name,outsideApp:true,
  confirm:true,requestKey:'FAKE_empty_delete_key'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture({deploymentResponse={deployments:[],pagination:{next:null,count:0}}}={}){
  const fake=makeFakeVercel(),replay=new Map(),audits=[];
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async row=>audits.push(row),
    requestReplayStore:()=>({
      claim:async({key})=>replay.has(key)?
        {state:'completed',result:replay.get(key)}:{state:'claimed',claimId:key},
      complete:async({key,result})=>{replay.set(key,result);},
      release:async()=>{}
    })
  };
  const call=(args=request,c=connection)=>dispatchReadOnlyTool({registry,
    name:'vercel_project_delete',args,db,connection:c,fetchImpl:fake.fetch});
  const projectRule=fake.when('GET','/v9/projects/{idOrName}');
  const domainRule=fake.when('GET','/v9/projects/{idOrName}/domains');
  const envRule=fake.when('GET','/v10/projects/{idOrName}/env');
  const deploymentRule=fake.when('GET','/v7/deployments')
    .resolves(deploymentResponse);
  const deleteRule=fake.when('DELETE','/v9/projects/{idOrName}');
  const empty=()=>{projectRule.resolves(project);
    domainRule.resolves({domains:[],pagination:{next:null,count:0}});
    envRule.resolves({envs:[],pagination:{next:null,count:0}});};
  return {fake,call,projectRule,domainRule,envRule,deploymentRule,deleteRule,empty,audits,replay};
}
describe('D-1m destructive empty-project deletion',()=>{
  beforeEach(()=>loadToken.mockResolvedValue(token));
  it('deletes a documented-shape project that omits every optional field (AUD-K)',async()=>{
    // The documented project schema does not require link, crons or
    // hasDeployments and has no storage fields at all (VMCP-027): a
    // minimal real record must pass the proof on its list inventories.
    const minimal={id:project.id,name:project.name,accountId:'team_FAKE'};
    const f=fixture();
    f.projectRule.resolves(minimal).resolves(minimal).rejects(404);
    f.domainRule.resolves({domains:[],pagination:{next:null,count:0}})
      .resolves({domains:[],pagination:{next:null,count:0}});
    f.envRule.resolves({envs:[],pagination:{next:null,count:0}})
      .resolves({envs:[],pagination:{next:null,count:0}});
    f.deleteRule.resolves(undefined,204);
    const result=parse(await f.call());
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('refuses a cron-carrying or git-linked record on the confirm path (AUD-K)',async()=>{
    for(const extra of [
      {crons:{definitions:[{path:'/job',schedule:'0 0 * * *'}]}},
      {link:{type:'github',repo:'owner/repo'}}
    ]){
      const f=fixture();
      f.projectRule.resolves({...project,...extra});
      f.domainRule.resolves({domains:[],pagination:{next:null,count:0}});
      f.envRule.resolves({envs:[],pagination:{next:null,count:0}});
      const result=parse(await f.call());
      expect(result.status).toBe('refused_by_guard');
      expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
      f.fake.verify();
    }
  });
  it('requires full impact inspection twice, one DELETE and independent 404 proof',async()=>{
    const f=fixture();
    f.projectRule.resolves(project).resolves(project).rejects(404);
    f.domainRule.resolves({domains:[],pagination:{next:null,count:0}}).resolves({domains:[],pagination:{next:null,count:0}});
    f.envRule.resolves({envs:[],pagination:{next:null,count:0}}).resolves({envs:[],pagination:{next:null,count:0}});
    f.deleteRule.resolves(undefined,204);
    const result=parse(await f.call());
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.map(x=>x.method)).toEqual(
      ['GET','GET','GET','GET','GET','GET','GET','GET','DELETE','GET']);
    expect(f.fake.calls[8].params.idOrName).toBe(project.id);
    expect(f.fake.calls.filter(x=>x.path==='/v7/deployments')).toHaveLength(2);
    expect(f.fake.calls.find(x=>x.path==='/v7/deployments').query.projectId).toBe(project.id);
    expect(f.fake.calls.every(x=>x.query.teamId==='team_FAKE')).toBe(true);
    expect(f.replay.size).toBe(2);
    expect(loadToken).toHaveBeenCalledTimes(3);
    expect(f.audits).toHaveLength(1);
    f.fake.verify();
  });
  it('refuses a scope rotation before irreversible DELETE and frees the safe retry claim',async()=>{
    const f=fixture();f.empty();
    loadToken.mockResolvedValueOnce(token).mockResolvedValueOnce({
      token:'vcp_FAKE_project_rotated',account:{...token.account,scope:'project',project_id:project.id}
    });
    const result=parse(await f.call());
    expect(result).toMatchObject({status:'refused_by_guard',confirmed:false});
    expect(loadToken).toHaveBeenCalledTimes(2);
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('keeps hasDeployments a conservative denial even with a complete zero-count deployment page',async()=>{
    const f=fixture();f.projectRule.resolves({...project,hasDeployments:true});
    f.domainRule.resolves({domains:[],pagination:{next:null,count:0}});
    f.envRule.resolves({envs:[],pagination:{next:null,count:0}});
    const result=parse(await f.call({...request,dryRun:true,confirm:false}));
    expect(result.status).toBe('preview');
    expect(result.preview).toContain('deployments: 0');
    expect(result.preview).toContain('NOT ELIGIBLE');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('previews irreversible zero-count impact but does not DELETE without confirmation',async()=>{
    for(const args of [{...request,confirm:false},{...request,confirm:false,dryRun:true}]){
      const f=fixture();f.empty();
      const result=parse(await f.call(args));
      expect(result.status).toBe(args.dryRun?'preview':'needs_confirmation');
      expect(JSON.stringify(result)).toContain('IRREVERSIBLE');
      expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','GET','GET']);
      f.fake.verify();
    }
  });
  it('shows nonempty impact only in dry-run, without enabling deletion',async()=>{
    const f=fixture();
    f.projectRule.resolves({...project,crons:{definitions:[{path:'/job',schedule:'0 0 * * *'}]}});
    f.domainRule.resolves({domains:[{name:'demo.example'}],pagination:{next:null,count:1}});
    f.envRule.resolves({envs:[{key:'API_KEY',value:'NEVER_OUTPUT'}],pagination:{next:null,count:1}});
    const preview=parse(await f.call({...request,dryRun:true,confirm:false}));
    expect(preview).toMatchObject({status:'preview',dryRun:true});
    expect(preview.preview).toContain('NOT ELIGIBLE');
    expect(preview.preview).toContain('domains: 1');
    expect(preview.preview).toContain('envVariables: 1');
    expect(preview.preview).toContain('crons: 1');
    expect(preview.preview).toContain('deployments: 0');
    expect(JSON.stringify(preview)).not.toContain('NEVER_OUTPUT');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    const g=fixture();g.projectRule.resolves({...project,
      crons:{definitions:[{path:'/job',schedule:'0 0 * * *'}]}});
    g.domainRule.resolves({domains:[],pagination:{next:null,count:0}});
    g.envRule.resolves({envs:[],pagination:{next:null,count:0}});
    expect(parse(await g.call({...request,confirm:true})).status).toBe('refused_by_guard');
    expect(g.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('rejects missing, contradictory or oversized env/domain inventories',async()=>{
    for(const field of ['domains','envs']){
      for(const page of [
        {[field]:[]},
        {[field]:[],pagination:{next:null,hasMore:true}},
        {[field]:[],pagination:{next:null,hasNext:true}},
        {[field]:Array.from({length:101},(_,i)=>({id:'row'+i})),pagination:{next:null,count:0}}
      ]){
        const f=fixture();f.projectRule.resolves(project);
        f.domainRule.resolves(field==='domains'?page:{domains:[],pagination:{next:null,count:0}});
        f.envRule.resolves(field==='envs'?page:{envs:[],pagination:{next:null,count:0}});
        const r=parse(await f.call());
        expect(r.status).toBe('refused_by_guard');
        expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
      }
    }
  });
  it('requires pinned page count to match resource cardinality on every terminal list',async()=>{
    for(const field of ['domains','envs','deployments']){
      for(const count of [undefined,1,-1,'0']){
        const pagination={next:null};
        if(count!==undefined)pagination.count=count;
        const page={[field]:[],pagination};
        const f=fixture({deploymentResponse:field==='deployments'?
          page:{deployments:[],pagination:{next:null,count:0}}});
        f.projectRule.resolves(project);
        f.domainRule.resolves(field==='domains'?page:
          {domains:[],pagination:{next:null,count:0}});
        f.envRule.resolves(field==='envs'?page:
          {envs:[],pagination:{next:null,count:0}});
        const result=parse(await f.call());
        expect(result.status).toBe('refused_by_guard');
        expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
      }
    }
  });
  it('refuses contradictory, nonnumeric and forged resource totals before irreversible deletion',async()=>{
    for(const field of ['domains','envs','deployments']){
      for(const total of [1,'1','not-a-count',-1]){
        for(const location of ['root','pagination']){
          const key=field;
          const forged={[key]:[],pagination:{next:null,count:0}};
          if(location==='root')forged.total=total;
          else forged.pagination.total=total;
          const f=fixture({deploymentResponse:field==='deployments'?
            forged:{deployments:[],pagination:{next:null,count:0}}});
          f.projectRule.resolves(project);
          f.domainRule.resolves(field==='domains'?forged:{domains:[],pagination:{next:null,count:0}});
          f.envRule.resolves(field==='envs'?forged:{envs:[],pagination:{next:null,count:0}});
          const result=parse(await f.call());
          expect(result.status).toBe('refused_by_guard');
          expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
        }
      }
    }
  });
  it('accepts honest optional numeric totals, but catches a late total change',async()=>{
    const f=fixture();
    f.projectRule.resolves(project).resolves(project);
    f.domainRule.resolves({domains:[],total:0,pagination:{next:null,total:'0'}})
      .resolves({domains:[],total:1,pagination:{next:null,count:0}});
    f.envRule.resolves({envs:[],total:'0',pagination:{next:null,count:0}});
    const result=parse(await f.call());
    expect(result.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
  it('denies unknown/partial resource inventories before DELETE',async()=>{
    for(const bad of [
      {...project,storageConnections:undefined},
      {...project,crons:undefined},
      {...project,hasDeployments:undefined}]){
      const f=fixture();f.projectRule.resolves(bad);
      expect(parse(await f.call()).status).toBe('refused_by_guard');
      expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
      f.fake.verify();
    }
  });
  it('denies nonempty domains, envs, cron, storage, Git and deployments',async()=>{
    for(const field of ['domains','envs','crons','storage','git','deployments']){
      const f=fixture();
      f.projectRule.resolves(field==='crons'?{...project,crons:{definitions:[{path:'/api/job'}]}}:
        field==='storage'?{...project,storageConnections:[{id:'store_FAKE'}]}:
        field==='git'?{...project,link:{repo:'example'}}:
        field==='deployments'?{...project,hasDeployments:true}:project);
      f.domainRule.resolves({domains:field==='domains'?[{name:'demo.example'}]:[]});
      f.envRule.resolves({envs:field==='envs'?[{key:'PRIVATE',value:'NEVER_EXPORT'}]:[]});
      const result=parse(await f.call());
      expect(result.status).toBe('refused_by_guard');
      expect(JSON.stringify(result)).not.toContain('NEVER_EXPORT');
      expect(f.fake.calls.some(x=>x.method==='DELETE')).toBe(false);
      f.fake.verify();
    }
  });
  it('refuses retained, ambiguous or cross-project deployment inventory even when project flags say empty',async()=>{
    for(const response of [
      {deployments:[{id:'dpl_FAKE',projectId:project.id}],pagination:{next:null,count:1}},
      {deployments:[],pagination:{next:42}},
      {deployments:[],pagination:{hasNext:true,next:null}},
      {deployments:[{id:'dpl_FAKE',projectId:'prj_OTHER'}],pagination:{next:null,count:1}},
      {deployments:[]}
    ]){
      const f=fixture();f.empty();
      f.fake.when('GET','/v7/deployments').resolves(response);
      const result=parse(await f.call());
      expect(result.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    }
  });
  it('refuses a deployment that appears between preview and final inventory recheck',async()=>{
    const f=fixture();f.empty();
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}})
      .resolves({deployments:[{id:'dpl_FAKE',projectId:project.id}],pagination:{next:null,count:1}});
    const result=parse(await f.call());
    expect(result.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
  it('rejects hidden page cursors and unknown env response',async()=>{
    for(const row of [{domains:[],pagination:{next:123}}, {domains:[],pagination:{hasMore:true}}]){
      const f=fixture();f.projectRule.resolves(project);f.domainRule.resolves(row);
      f.envRule.resolves({envs:[],pagination:{next:null,count:0}});
      expect(parse(await f.call()).status).toBe('refused_by_guard');
      expect(f.fake.calls.some(x=>x.method==='DELETE')).toBe(false);
      f.fake.verify();
    }
  });
  it('rejects wrong typed project, cross-scope, dry-run override and preview/read-only connections',async()=>{
    const f=fixture();
    for(const invalid of [{...request,expectedName:'other'},
      {...request,outsideApp:false},{...request,teamId:'foreign'}]){
      if(invalid.expectedName==='other')f.empty();
      const r=await f.call(invalid);
      expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
    }
    expect(f.fake.calls.some(x=>x.method==='DELETE')).toBe(false);
    const g=fixture();
    expect((await g.call(request,{...connection,profile:'read_only'})).isError).toBe(true);
    g.empty();
    expect(parse(await g.call(request,{...connection,mode:'preview'})).status)
      .toBe('refused_by_guard');
    expect(g.fake.calls.some(x=>x.method==='DELETE')).toBe(false);
    loadToken.mockResolvedValue({...token,account:{...token.account,scope:'project',project_id:project.id}});
    const h=fixture();
    expect(parse(await h.call()).status).toBe('refused_by_guard');
    expect(h.fake.calls).toHaveLength(0);
  });
  it('refuses late inventory changes without ever calling DELETE',async()=>{
    const f=fixture();
    f.projectRule.resolves(project).resolves({...project,hasDeployments:true});
    f.domainRule.resolves({domains:[],pagination:{next:null,count:0}}).resolves({domains:[],pagination:{next:null,count:0}});
    f.envRule.resolves({envs:[],pagination:{next:null,count:0}}).resolves({envs:[],pagination:{next:null,count:0}});
    const result=parse(await f.call());
    expect(result.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
  it('fails confirmation if the project remains present after provider accepted DELETE',async()=>{
    const f=fixture();
    f.projectRule.resolves(project).resolves(project).resolves(project);
    f.domainRule.resolves({domains:[],pagination:{next:null,count:0}}).resolves({domains:[],pagination:{next:null,count:0}});
    f.envRule.resolves({envs:[],pagination:{next:null,count:0}}).resolves({envs:[],pagination:{next:null,count:0}});
    f.deleteRule.resolves(undefined,204);
    const result=parse(await f.call());
    expect(result).toMatchObject({status:'applied',confirmed:false});
    f.fake.verify();
  });
  it('exposes only full-profile destructive write metadata',()=>{
    const entry=listMcpTools(registry,connection).find(x=>x.name==='vercel_project_delete');
    expect(entry.annotations).toMatchObject({readOnlyHint:false,destructiveHint:true,
      idempotentHint:false});
    expect(entry.writes).toBeUndefined();
    expect(entry.inputSchema.properties.fields).toBeUndefined();
    expect(listMcpTools(registry,{...connection,profile:'everyday'})
      .find(x=>x.name==='vercel_project_delete')).toBeUndefined();
  });
});
