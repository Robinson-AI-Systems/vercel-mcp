import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const project='prj_FAKE_CUSTOM',id='env_FAKE_STAGE',team='team_FAKE';
const connection={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const token={token:'vcp_FAKE_custom',account:{id:'acct_FAKE',team_id:team,
  scope:'project',project_id:project}};
const projectRow={id:project,name:'sample',accountId:team,link:{productionBranch:'main'}};
const row={id,slug:'staging',projectId:project,type:'preview',updatedAt:100,
  description:'QA',branchMatcher:{type:'equals',pattern:'release/test'},
  domains:[],currentDeploymentAliases:[],privateValue:'vcp_FAKE_PRIVATE'};
const created={...row,slug:'staging-new',branchMatcher:{type:'equals',pattern:'feature/qa'}};
const updated={...row,slug:'staging-new',updatedAt:101,
  description:'New preview',branchMatcher:{type:'equals',pattern:'feature/qa'}};
const createArgs={project,expectedName:'sample',slug:'staging-new',
  branch:'feature/qa',outsideApp:true,confirm:true,requestKey:'createStageFake01'};
const exactArgs={project,expectedName:'sample',id,expectedSlug:'staging',
  expectedBranch:'release/test',expectedUpdatedAt:100,outsideApp:true,
  confirm:true,requestKey:'mutateStageFake01'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),audit=[],memo=new Map();
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async x=>audit.push(x),
    requestReplayStore:()=>({
      claim:async({key})=>memo.has(key)?{state:'completed',result:memo.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>memo.set(key,result),
      release:async()=>true
    })};
  loadToken.mockResolvedValue(token);
  fake.when('GET','/v9/projects/{idOrName}').resolves(projectRow);
  fake.when('GET','/v9/projects/{idOrName}/custom-environments')
    .resolves({environments:[row]});
  fake.when('GET','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
    .resolves(row);
  const call=(name,args,c=connection)=>dispatchReadOnlyTool({
    registry,name,args,connection:c,db,fetchImpl:fake.fetch
  });
  return {fake,db,audit,memo,call};
}
const changes=x=>x.fake.calls.filter(c=>['PATCH','POST','DELETE'].includes(c.method));
describe('E-2 guarded custom environment lifecycle',()=>{
  beforeEach(()=>{vi.clearAllMocks();});
  it('advertises three real writes only to eligible profiles and official paths',()=>{
    const names=['vercel_environment_create','vercel_environment_update','vercel_environment_delete'];
    for(const name of names){
      const tool=registry.tools.find(t=>t.name===name);
      expect(tool).toMatchObject({writes:true,guardedWrite:true,
        writeContract:{production:true,targets:true}});
      expect(listMcpTools(registry,{...connection,profile:'read_only'})
        .some(t=>t.name===name)).toBe(false);
    }
    expect(listMcpTools(registry,{...connection,profile:'everyday'})
      .some(t=>t.name==='vercel_environment_delete')).toBe(false);
    const path={idOrName:project,environmentSlugOrId:id},query={teamId:team};
    expect(validateRequest('custom_environments_create',{path:{idOrName:project},
      query,body:{slug:'stage',branchMatcher:{type:'equals',pattern:'feature/test'}}})).toBe(true);
    expect(validateRequest('custom_environments_get',{path,query})).toBe(true);
    expect(validateRequest('custom_environments_update',{path,query,
      body:{slug:'stage-two',branchMatcher:{type:'equals',pattern:'qa'}}})).toBe(true);
    expect(validateRequest('custom_environments_delete',{path,query,
      body:{deleteUnassignedEnvironmentVariables:false}})).toBe(true);
  });
  it('creates one branch-scoped preview environment with provider-side nonprod copy',async()=>{
    const f=fixture();
    f.fake.when('POST','/v9/projects/{idOrName}/custom-environments')
      .resolves({id,slug:'staging-new',privateValue:'vcp_FAKE_PRIVATE'});
    f.fake.when('GET','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .resolves(created);
    const out=parse(await f.call('vercel_environment_create',
      {...createArgs,copyFrom:'preview'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const post=changes(f);
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({method:'POST',path:
      '/v9/projects/'+project+'/custom-environments',
      query:{teamId:team},
      body:{slug:'staging-new',branchMatcher:{type:'equals',pattern:'feature/qa'},
        copyEnvVarsFrom:'preview'}});
    expect(JSON.stringify(out)+JSON.stringify(f.audit)).not.toContain('vcp_FAKE_PRIVATE');
    expect(f.memo.size).toBe(2);
    f.fake.verify();
  });
  it('updates exact slug, branch and description after independent revision recheck',async()=>{
    const f=fixture();
    f.fake.when('PATCH','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .resolves(updated);
    f.fake.when('GET','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .resolves(row).resolves(row).resolves(updated);
    const out=parse(await f.call('vercel_environment_update',{
      ...exactArgs,slug:'staging-new',branch:'feature/qa',
      description:'New preview'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(changes(f)).toHaveLength(1);
    expect(changes(f)[0]).toMatchObject({method:'PATCH',
      query:{teamId:team},path:
      '/v9/projects/'+project+'/custom-environments/'+id,
      body:{slug:'staging-new',description:'New preview',
        branchMatcher:{type:'equals',pattern:'feature/qa'}}});
    expect(JSON.stringify(out)).not.toContain('PRIVATE');
    f.fake.verify();
  });
  it('deletes only an empty exact environment, explicitly retains orphan variables',async()=>{
    const f=fixture();
    f.fake.when('DELETE','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .resolves(row);
    f.fake.when('GET','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .resolves(row).resolves(row).rejects(404);
    const out=parse(await f.call('vercel_environment_delete',exactArgs));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(changes(f)).toHaveLength(1);
    expect(changes(f)[0]).toMatchObject({method:'DELETE',
      body:{deleteUnassignedEnvironmentVariables:false}});
    expect(f.fake.calls.every(x=>x.query.teamId===team)).toBe(true);
  });
  it('dry run, missing confirm, protected project and read-only profile never mutate',async()=>{
    for(const t of ['vercel_environment_create','vercel_environment_update',
      'vercel_environment_delete']){
      const args=t==='vercel_environment_create'?createArgs:
        {...exactArgs,...(t.includes('update')?{description:'New preview'}:{})};
      for(const change of [{confirm:false},{confirm:false,dryRun:true}]){
        const f=fixture();const out=parse(await f.call(t,{...args,...change}));
        expect(out.status).toBe(change.dryRun?'preview':'needs_confirmation');
        expect(changes(f)).toHaveLength(0);
      }
      const f=fixture();
      f.db.listProtectedResources=async()=>[{match:project,note:'protected'}];
      expect(parse(await f.call(t,args)).status).toBe('refused_by_guard');
      expect(changes(f)).toHaveLength(0);
      const protectedEnv=fixture();
      protectedEnv.db.listProtectedResources=async()=>[{match:t==='vercel_environment_create'?'staging-new':id,note:'protected env'}];
      expect(parse(await protectedEnv.call(t,args)).status).toBe('refused_by_guard');
      expect(changes(protectedEnv)).toHaveLength(0);
      const h=fixture();
      const denied=await h.call(t,args,{...connection,profile:'read_only'});
      expect(denied.isError||parse(denied).status==='refused_by_guard').toBe(true);
      expect(changes(h)).toHaveLength(0);
    }
  });
  it('refuses production branch, foreign project, duplicate slug and invalid requests',async()=>{
    for(const args of [
      {...createArgs,branch:'main'},
      {...createArgs,project:'prj_OTHER'},
      {...createArgs,branch:'../hidden'},
      {...createArgs,teamId:'team_FOREIGN'},
      {...createArgs,copyFrom:'production'},
      {...createArgs,outsideApp:false}
    ]){
      const f=fixture();expect(parse(await f.call('vercel_environment_create',args))
        .status).toBe('refused_by_guard');
      expect(changes(f)).toHaveLength(0);
    }
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/custom-environments')
      .resolves({environments:[row,{...row,id:'env_FAKE_OTHER',slug:'staging-new'}]});
    expect(parse(await f.call('vercel_environment_create',createArgs)).status)
      .toBe('refused_by_guard');
    expect(changes(f)).toHaveLength(0);
  });
  it('refuses stale updates/deletes, domain links, aliases and production classification',async()=>{
    for(const name of ['vercel_environment_update','vercel_environment_delete']){
      const args={...exactArgs,...(name.includes('update')?{description:'changed'}:{})};
      for(const bad of [
        {...row,updatedAt:101},
        {...row,domains:[{name:'attached.fake'}]},
        {...row,currentDeploymentAliases:['attached.fake']},
        {...row,branchMatcher:{type:'equals',pattern:'main'}},
        {...row,type:'production'},
        {...row,currentDeploymentAliases:undefined}
      ]){
        const f=fixture();
        f.fake.when('GET','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
          .resolves(bad);
        expect(parse(await f.call(name,args)).status).toBe('refused_by_guard');
        expect(changes(f)).toHaveLength(0);
      }
    }
  });
  it('refuses a concurrent revision change at the last proof before dispatch',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .resolves(row).resolves({...row,updatedAt:102});
    const out=parse(await f.call('vercel_environment_update',{
      ...exactArgs,description:'New preview'}));
    expect(out.status).toBe('refused_by_guard');
    expect(changes(f)).toHaveLength(0);
  });
  it('does not claim delete confirmation when project itself disappears',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(projectRow)
      .resolves(projectRow).rejects(404);
    f.fake.when('DELETE','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .resolves(row);
    const out=parse(await f.call('vercel_environment_delete',exactArgs));
    expect(out).toMatchObject({status:'applied',confirmed:null});
  });
  it('write attempts with unknown result never repeat the provider mutation',async()=>{
    const f=fixture();
    f.fake.when('PATCH','/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}')
      .rejects(503);
    const args={...exactArgs,description:'New preview'};
    const a=parse(await f.call('vercel_environment_update',args));
    expect(a).toMatchObject({status:'outcome_unknown'});
    expect(changes(f)).toHaveLength(1);
    const next=parse(await f.call('vercel_environment_update',args));
    expect(next.status).not.toBe('applied');
    expect(changes(f)).toHaveLength(1);
  });
});
