import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {projectsTools} from '../../src/tools/projects.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const fakeConn={account:'acct_ALPHA',profile:'read_only',listing:'catalog',mode:'preview'};
const registry=mergeNamespaces([projectsTools]);
const call=(name,args,db,fetchImpl,connection=fakeConn)=>dispatchReadOnlyTool({
  registry,name,args,db,fetchImpl,connection});
const parse=response=>JSON.parse(response.content[0].text);
const fixture=scope=>({token:'vcp_FAKE_project_read',account:{
  id:'acct_ALPHA',team_id:'team_ALPHA',scope,
  project_id:scope==='project'?'prj_ONLY':null}});
describe('D-1a server-selected scoped project reads',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(fixture('team'));});
  const db={getAccountCredential:async()=>({})};
  it('lists one provider page, ignores secret fields and selects authenticated team',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v10/projects').resolves({
      projects:[{id:'prj_A',name:'demo',framework:'nextjs',token:'should-not-expose'}],
      pagination:{next:'cursor_FAKE'}});
    const result=parse(await call('vercel_project_list',{limit:5},db,fake.fetch));
    expect(result.projects).toEqual([{id:'prj_A',name:'demo',framework:'nextjs',
      productionUrl:null,gitRepo:null,productionBranch:null,paused:false,nodeVersion:null}]);
    expect(result.next).toBe('cursor_FAKE');
    expect(JSON.stringify(result)).not.toContain('should-not-expose');
    expect(fake.calls[0].query).toMatchObject({teamId:'team_ALPHA',limit:'5'});
    expect(fake.calls[0].headers.authorization).toBe('Bearer [hidden]');
    expect(loadToken).toHaveBeenCalledWith(expect.objectContaining({accountId:'acct_ALPHA'}));
  });
  it('pages project listing using only a safe numeric cursor',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v10/projects').resolves({projects:[],pagination:{next:null}});
    const result=parse(await call('vercel_project_list',{limit:8,until:1699999999999},db,fake.fetch));
    expect(result.count).toBe(0);
    expect(fake.calls[0].query).toMatchObject({teamId:'team_ALPHA',limit:'8',until:'1699999999999'});
    expect((await call('vercel_project_list',{until:'not-numeric'},db,fake.fetch)).isError).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });
  it('lists bounded project membership safely with server-selected team',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v1/projects/{idOrName}/members').resolves({
      members:[{uid:'user_A',email:'a@example.test',role:'ADMIN',name:'A',
        token:'sensitive-never-display'}],pagination:{next:1700000000000}});
    const data=parse(await call('vercel_project_list_members',{project:'prj_DEMO',limit:10},db,fake.fetch));
    expect(data.members).toEqual([{id:'user_A',email:'a@example.test',role:'ADMIN',
      name:'A',createdAt:null}]);
    expect(data.next).toBe(1700000000000);
    expect(JSON.stringify(data)).not.toContain('sensitive-never-display');
    expect(fake.calls[0].query).toMatchObject({teamId:'team_ALPHA',limit:'10'});
    expect(fake.calls[0].params.idOrName).toBe('prj_DEMO');
  });
  it('denies project-member traversal, caller token and forged scope before network',async()=>{
    const fake=makeFakeVercel();
    for(const args of [{project:'prj_DEMO',teamId:'other'},
      {project:'../steal'},{project:'prj_DEMO',until:-1},{project:'prj_DEMO',limit:200}]){
      expect((await call('vercel_project_list_members',args,db,fake.fetch)).isError).toBe(true);
    }
    loadToken.mockResolvedValue(fixture('project'));
    expect((await call('vercel_project_list_members',{project:'prj_OTHER'},db,fake.fetch)).isError).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
  it('gets safe build and Git fields by a validated project identifier',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:'prj_DEMO',name:'site',link:{repo:'repo',productionBranch:'main'},
      buildCommand:'npm run build',secret:'hidden'});
    const data=parse(await call('vercel_project_get',{project:'prj_DEMO'},db,fake.fetch));
    expect(data.buildCommand).toBe('npm run build');
    expect(data.gitRepo).toBe('repo');
    expect(data).not.toHaveProperty('secret');
    expect(fake.calls[0].params).toEqual({idOrName:'prj_DEMO'});
  });
  it('avoids team enumeration for a project-scoped connection',async()=>{
    loadToken.mockResolvedValue(fixture('project'));
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_ONLY',name:'only'});
    expect(parse(await call('vercel_project_list',{},db,fake.fetch)).projects[0].id).toBe('prj_ONLY');
    expect((await call('vercel_project_get',{project:'prj_OTHER'},db,fake.fetch)).isError).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });
  it('rejects caller team, tokens, wrong pagination and malformed identifiers before network access',async()=>{
    const fake=makeFakeVercel();
    for(const args of [{limit:101},{limit:0},{teamId:'other'},{token:'vcp_FAKE_sneaky'}]){
      expect((await call('vercel_project_list',args,db,fake.fetch)).isError).toBe(true);
    }
    for(const args of [{},{project:'../../other'},{project:'demo',account:'other'}])
      expect((await call('vercel_project_get',args,db,fake.fetch)).isError).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
});
