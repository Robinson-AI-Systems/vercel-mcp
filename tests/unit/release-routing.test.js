import {describe,it,expect,beforeEach,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));

const project='prj_FAKE_RELEASE',team='team_FAKE_RELEASE';
const old='dpl_FAKE_CURRENT',next='dpl_FAKE_STAGED';
const domain='live.example.test',aliasId='alias_FAKE_ONE';
const oldDeployment={uid:old,projectId:project,target:'production',
  readyState:'READY',created:100,aliasAssigned:150,meta:{githubCommitSha:'a'.repeat(40)}};
const targetDeployment={uid:next,projectId:project,target:'production',
  readyState:'READY',created:200,meta:{githubCommitSha:'b'.repeat(40)}};
const linked={id:aliasId,projectId:project,alias:domain,deploymentId:old};
const migrated={...linked,deploymentId:next};
const conn={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const production={...conn,mode:'production'};
const token={token:'vcp_FAKE_RELEASE_ONLY',account:{
  id:'acct_FAKE',scope:'project',team_id:team,project_id:project}};
const promote={project,deployment:next,expectedCurrent:old,
  outsideApp:true,confirm:true,requestKey:'promoteFake01'};
const rollback={project,deployment:next,expectedCurrent:old,
  reason:'Restore previous revision',outsideApp:true,
  confirm:true,requestKey:'rollbackFake01'};
const assigned={project,alias:domain,aliasId,expectedCurrent:old,
  deployment:next,outsideApp:true,confirm:true,requestKey:'aliasAssignFake01'};
const removed={project,alias:domain,aliasId,expectedCurrent:old,
  outsideApp:true,confirm:true,requestKey:'aliasDeleteFake01'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture({aliases=[linked],oldRow=oldDeployment,newRow=targetDeployment}={}){
  const fake=makeFakeVercel(),audit=[],memo=new Map(),claim=new Set();
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async x=>audit.push(x),requestReplayStore:()=>({
      claim:async({key})=>{
        if(memo.has(key))return {state:'completed',result:memo.get(key)};
        if(claim.has(key))return {state:'pending'};
        claim.add(key);return {state:'claimed',claimId:key};
      },
      complete:async({key,result})=>{claim.delete(key);memo.set(key,result);},
      release:async({key})=>{claim.delete(key);return true;}
    })};
  loadToken.mockResolvedValue(token);
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,accountId:team,name:'fake-release'});
  fake.when('GET','/v4/aliases')
    .resolves({aliases,pagination:{next:null}});
  fake.when('GET','/v4/aliases/{idOrAlias}')
    .resolves(aliases[0]);
  fake.when('GET','/v1/projects/{projectId}/promote/aliases')
    .resolves({aliases:aliases.map(x=>({...x,status:'assigned'}))});
  const detail=fake.when('GET','/v13/deployments/{idOrUrl}');
  const deployments=[newRow,newRow,oldRow,oldRow,
    newRow,newRow,oldRow,oldRow,newRow,newRow,oldRow,oldRow];
  for(const d of deployments)detail.resolves(d);
  const call=(name,args={},c=conn)=>dispatchReadOnlyTool({
    registry,name,args,db,connection:c,fetchImpl:fake.fetch
  });
  const mutations=()=>fake.calls.filter(x=>x.method==='POST'||x.method==='DELETE');
  return {fake,db,call,audit,memo,mutations};
}
describe('D-4 production releases, aliases and guarded routing',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('registers production traffic writes and pinned real Vercel paths',()=>{
    for(const name of ['vercel_deploy_promote','vercel_deploy_rollback',
      'vercel_alias_assign','vercel_alias_delete']){
      expect(registry.tools.find(t=>t.name===name))
        .toMatchObject({writes:true,guardedWrite:true,
          writeContract:{production:true,targets:true}});
      expect(listMcpTools(registry,{...conn,profile:'read_only'})
        .some(x=>x.name===name)).toBe(false);
    }
    expect(validateRequest('release_promote',{
      path:{projectId:project,deploymentId:next},query:{teamId:team}})).toBe(true);
    expect(validateRequest('release_rollback',{
      path:{projectId:project,deploymentId:old},query:{teamId:team,
        description:'Restore previous revision'}})).toBe(true);
    expect(validateRequest('release_promote_aliases',{
      path:{projectId:project},query:{teamId:team,limit:100}})).toBe(true);
    expect(validateRequest('release_aliases_list',{
      query:{teamId:team,projectId:project,limit:100}})).toBe(true);
    expect(validateRequest('release_alias_get',{path:{idOrAlias:aliasId},
      query:{teamId:team,projectId:project}})).toBe(true);
    expect(validateRequest('release_alias_assign',{path:{id:next},
      body:{alias:domain},query:{teamId:team}})).toBe(true);
    expect(validateRequest('release_alias_delete',{path:{aliasId},
      query:{teamId:team}})).toBe(true);
  });
  it('lists only selected-project aliases, exact lookup and pending promotion status',async()=>{
    const f=fixture();
    const list=parse(await f.call('vercel_alias_list',{project}));
    expect(list).toMatchObject({project,complete:true,
      aliases:[{domain,id:aliasId,deployment:old}]});
    const found=parse(await f.call('vercel_alias_get',{project,alias:aliasId}));
    expect(found.alias).toMatchObject({domain,id:aliasId,deployment:old});
    const status=parse(await f.call('vercel_deploy_list_promote_aliases',{project}));
    expect(status).toMatchObject({project,complete:false,
      aliases:[{domain,status:'assigned'}]});
    expect(f.mutations()).toHaveLength(0);
    expect(f.fake.calls.every(x=>x.query.teamId===team)).toBe(true);
  });
  it('denies production promotion from a preview connection despite valid staging metadata',async()=>{
    const f=fixture();
    const out=parse(await f.call('vercel_deploy_promote',promote));
    expect(out.status).toBe('refused_by_guard');
    expect(f.mutations()).toHaveLength(0);
  });
  it('promotes only staged production builds after fresh project/alias proof',async()=>{
    const f=fixture();
    f.fake.when('GET','/v4/aliases')
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[migrated],pagination:{next:null}});
    f.fake.when('POST','/v10/projects/{projectId}/promote/{deploymentId}')
      .resolves({},201);
    const out=parse(await f.call('vercel_deploy_promote',promote,production));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0]).toMatchObject({method:'POST',
      path:'/v10/projects/'+project+'/promote/'+next,
      query:{teamId:team}});
    expect(out.preview).toContain(domain);
    expect(f.memo.size).toBe(2);
  });
  it('supports instant rollback only to a proven earlier serving deployment',async()=>{
    const f=fixture({oldRow:{...oldDeployment,aliasAssigned:null},
      newRow:{...targetDeployment,created:75,aliasAssigned:40}});
    const noHistorical=fixture();
    expect(parse(await noHistorical.call('vercel_deploy_rollback',
      rollback,production)).status).toBe('refused_by_guard');
    f.fake.when('POST','/v1/projects/{projectId}/rollback/{deploymentId}')
      .resolves({},201);
    f.fake.when('GET','/v4/aliases')
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[migrated],pagination:{next:null}});
    const result=parse(await f.call('vercel_deploy_rollback',rollback,production));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()[0]).toMatchObject({method:'POST',
      path:'/v1/projects/'+project+'/rollback/'+next,
      query:{description:'Restore previous revision',teamId:team}});
  });
  it('reassigns an exact existing live alias but never silently creates a domain',async()=>{
    const f=fixture();
    f.fake.when('GET','/v4/aliases')
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[migrated],pagination:{next:null}});
    f.fake.when('POST','/v2/deployments/{id}/aliases')
      .resolves({alias:domain,id:aliasId},200);
    const result=parse(await f.call('vercel_alias_assign',assigned,production));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0]).toMatchObject({method:'POST',
      path:'/v2/deployments/'+next+'/aliases',body:{alias:domain}});
    const foreign=fixture({aliases:[{...linked,projectId:'prj_FOREIGN'}]});
    expect(parse(await foreign.call('vercel_alias_assign',assigned,production))
      .status).toBe('refused_by_guard');
    expect(foreign.mutations()).toHaveLength(0);
  });
  it('deletes only an exact owned alias after confirmation and complete readback',async()=>{
    const f=fixture();
    f.fake.when('GET','/v4/aliases')
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[linked],pagination:{next:null}})
      .resolves({aliases:[],pagination:{next:null}});
    f.fake.when('DELETE','/v2/aliases/{aliasId}').resolves(null,204);
    const result=parse(await f.call('vercel_alias_delete',removed,production));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()[0]).toMatchObject({method:'DELETE',
      path:'/v2/aliases/'+aliasId,query:{teamId:team}});
  });
  it('denies unproven pagination, stale mapping and protected resources without POST',async()=>{
    const f=fixture();
    f.fake.when('GET','/v4/aliases')
      .resolves({aliases:[linked],pagination:{next:'more'}});
    expect(parse(await f.call('vercel_deploy_promote',promote,production))
      .status).toBe('refused_by_guard');
    const other=fixture();
    expect(parse(await other.call('vercel_alias_delete',
      {...removed,expectedCurrent:next},production)).status)
      .toBe('refused_by_guard');
    const protectedOne=fixture();
    protectedOne.db.listProtectedResources=async()=>[{match:project,note:'protected'}];
    expect(parse(await protectedOne.call('vercel_deploy_promote',
      promote,production)).status).toBe('refused_by_guard');
    for(const x of [f,other,protectedOne])expect(x.mutations()).toHaveLength(0);
  });
  it('dry-run/no-confirm do not change serving aliases or spend',async()=>{
    for(const name of ['vercel_deploy_promote','vercel_alias_assign','vercel_alias_delete']){
      for(const flags of [{dryRun:true,confirm:false},{confirm:false}]){
        const f=fixture(),args=name==='vercel_deploy_promote'?promote:
          name==='vercel_alias_assign'?assigned:removed;
        const out=parse(await f.call(name,{...args,...flags},production));
        expect(out.status).toBe(flags.dryRun?'preview':'needs_confirmation');
        expect(f.mutations()).toHaveLength(0);
      }
    }
  });
});
