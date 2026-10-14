import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const project='prj_FAKE',team='team_FAKE',secret='vcp_FAKE_ABSOLUTELY_PRIVATE_VALUE';
const conn={account:'acct_FAKE',profile:'read_only',mode:'preview',listing:'catalog'};
const shared={id:'env_SHARED',key:'DATABASE_URL',value:secret,
  type:'sensitive',target:['preview'],projectId:[project],ownerId:team,
  updatedAt:1792010000000};
const custom={id:'env_CUSTOM',slug:'staging',type:'preview',description:'staging tests',
  projectId:project,branchMatcher:{type:'equals',pattern:'staging'},
  domains:[{name:secret}],value:secret,createdAt:1792010000000};
function setup(scope='team'){
  const fake=makeFakeVercel();
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,name:'sample',accountId:team});
  fake.when('GET','/v1/env')
    .resolves({data:[shared],pagination:{next:null}});
  fake.when('GET','/v9/projects/{idOrName}/custom-environments')
    .resolves({environments:[custom]});
  loadToken.mockResolvedValue({token:'vcp_FAKE_connection',
    account:{id:'acct_FAKE',team_id:team,scope,
      ...(scope==='project'?{project_id:project}:{})}});
  const db={getAccountCredential:async()=>({})};
  const call=(name,args)=>dispatchReadOnlyTool({
    registry,name,args,connection:conn,db,fetchImpl:fake.fetch});
  return {fake,call};
}
const view=res=>JSON.parse(res.content[0].text);
describe('E-2 safe, project and team scoped environment metadata reads',()=>{
  beforeEach(()=>{vi.clearAllMocks();});
  it('exposes read-only selected-team list and environment tools in catalog',()=>{
    for(const name of ['vercel_shared_env_list','vercel_environment_list']){
      expect(registry.tools.find(x=>x.name===name))
        .toMatchObject({writes:false,profiles:['read_only','everyday','full']});
      expect(listMcpTools(registry,conn).some(x=>x.name===name)).toBe(true);
    }
  });
  it('projects shared metadata and omits planted values, even at full detail',async()=>{
    const f=setup(),r=view(await f.call('vercel_shared_env_list',{project,detail:'full'}));
    expect(r).toMatchObject({selectedTeam:true,hasValues:false,hasDigests:false,
      complete:true,items:[{key:'DATABASE_URL',kind:'Secret'}]});
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(r.items[0]).not.toHaveProperty('value');
    expect(f.fake.calls.map(c=>c.path)).toEqual([
      '/v9/projects/'+project,'/v1/env']);
    expect(f.fake.calls[1].query).toMatchObject({teamId:team,projectId:project});
  });
  it('verifies selected project before custom environments and drops private fields',async()=>{
    const f=setup('project'),r=view(await f.call('vercel_environment_list',
      {project,detail:'full'}));
    expect(r).toMatchObject({project,shown:1,complete:false,
      items:[{slug:'staging',domainCount:1}]});
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(r.items[0]).not.toHaveProperty('value');
    expect(f.fake.calls.map(c=>c.path)).toEqual([
      '/v9/projects/'+project,
      '/v9/projects/'+project+'/custom-environments']);
  });
  it('shared env list needs selected team credential',async()=>{
    const f=setup('project');
    expect((await f.call('vercel_shared_env_list',{})).isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
  });
  it('denies caller-controlled team IDs, foreign project and invalid page cursor',async()=>{
    const f=setup();
    for(const bad of [
      {teamId:'team_OTHER'},{project:'prj_OTHER'},{project:'../bad'},
      {next:-1},{slug:'foreign'}
    ])expect((await f.call('vercel_shared_env_list',bad)).isError).toBe(true);
  });
  it('rejects shared env duplicates, owner mismatch, link mismatch, malformed cursors',async()=>{
    for(const page of [
      {data:[shared,shared],pagination:{next:null}},
      {data:[{...shared,ownerId:'team_OTHER'}],pagination:{next:null}},
      {data:[{...shared,projectId:['prj_OTHER']}],pagination:{next:null}},
      {data:[shared],pagination:{next:'privateCursor'}},
      {data:[{...shared,projectId:[project,project]}],pagination:{next:null}}
    ]){
      const f=setup();f.fake.when('GET','/v1/env').resolves(page);
      expect((await f.call('vercel_shared_env_list',{project})).isError).toBe(true);
    }
  });
  it('reports provider pagination but never invents completeness',async()=>{
    const f=setup();
    f.fake.when('GET','/v1/env').resolves({
      data:[shared],pagination:{next:1792010000000}});
    expect(view(await f.call('vercel_shared_env_list',{})))
      .toMatchObject({complete:false,next:1792010000000});
    const another=setup();
    another.fake.when('GET','/v1/env').resolves({data:[shared]});
    expect(view(await another.call('vercel_shared_env_list',{})))
      .toMatchObject({complete:false,next:null});
  });
  it('fails closed on foreign or duplicate custom environments',async()=>{
    for(const items of [
      [custom,custom],[{...custom,projectId:'prj_OTHER'}],
      [{...custom,slug:'Production'}],[{...custom,id:'bad'}],
      [{...custom,branchMatcher:{type:'equals',pattern:'../hidden'}}]
    ]){
      const f=setup();
      f.fake.when('GET','/v9/projects/{idOrName}/custom-environments')
        .resolves({environments:items});
      expect((await f.call('vercel_environment_list',{project})).isError).toBe(true);
    }
  });
  it('makes only documented GET calls, no writes or provider value reads',async()=>{
    const f=setup();
    await f.call('vercel_shared_env_list',{});
    await f.call('vercel_environment_list',{project});
    expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
    f.fake.verify();
  });
});
