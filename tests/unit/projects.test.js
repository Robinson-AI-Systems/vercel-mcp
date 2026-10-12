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
      pagination:{next:'1700000000000'}});
    const result=parse(await call('vercel_project_list',{limit:5},db,fake.fetch));
    expect(result.projects).toEqual([{id:'prj_A',name:'demo',framework:'nextjs',
      productionUrl:null,gitRepo:null,productionBranch:null,paused:false,nodeVersion:null}]);
    expect(result.next).toBe(1700000000000);
    expect(result.complete).toBe(false);
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
  it('redacts credential-shaped project member identities and display fields',async()=>{
    const fake=makeFakeVercel();
    const secret='vcp_FAKE_sensitive_member';
    fake.when('GET','/v1/projects/{idOrName}/members').resolves({
      members:[{uid:secret,email:'github_pat_FAKE_mail',name:'sk_test_FAKE_name',
        role:'xoxb-FAKE_role',createdAt:1700000000000},
      {uid:'user_SAFE',email:'safe@example.test',name:'Safe',role:'PROJECT_VIEWER'}],
      pagination:{next:null}
    });
    const result=parse(await call('vercel_project_list_members',
      {project:'prj_DEMO',limit:10},db,fake.fetch));
    expect(result.members[0]).toMatchObject({id:null,email:null,name:null,role:null});
    expect(result.members[1]).toMatchObject({id:'user_SAFE',email:'safe@example.test',
      name:'Safe',role:'PROJECT_VIEWER'});
    expect(JSON.stringify(result)).not.toMatch(/vcp_FAKE|github_pat_FAKE|sk_test_FAKE|xoxb-FAKE/);
    expect(fake.calls.map(x=>x.method)).toEqual(['GET']);
    fake.verify();
  });
  it('normalizes callable member continuation and returns a useful follow-up',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v1/projects/{idOrName}/members').resolves({members:[
      {uid:'user_A',email:'a@example.test',role:'ADMIN',createdAt:1700000000000}],
      pagination:{next:'1700000001000'}});
    const data=parse(await call('vercel_project_list_members',{project:'prj_DEMO',limit:3},db,fake.fetch));
    expect(data).toMatchObject({next:1700000001000,complete:false});
    expect(data.nextStep).toContain('until=1700000001000');
    expect(data.members[0].createdAt).toBe(1700000000000);
  });
  it('refuses invalid, missing or oversized provider list pages',async()=>{
    for(const page of [
      {projects:[]},
      {projects:[],pagination:{next:'cursor_NOT_A_NUMBER'}},
      {projects:[],pagination:{next:null,hasNext:true}},
      {projects:Array.from({length:4},(_,i)=>({id:'prj_'+i,name:'p'+i})),pagination:{next:null}}
    ]){
      const fake=makeFakeVercel();fake.when('GET','/v10/projects').resolves(page);
      expect((await call('vercel_project_list',{limit:3},db,fake.fetch)).isError).toBe(true);
    }
    const fake=makeFakeVercel();
    fake.when('GET','/v1/projects/{idOrName}/members').resolves({
      members:[{uid:'user_A'},{uid:'user_B'}],pagination:{next:null}});
    expect((await call('vercel_project_list_members',{
      project:'prj_DEMO',limit:1},db,fake.fetch)).isError).toBe(true);
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
  it('never reflects credential-shaped or unbounded project summary and settings fields',async()=>{
    const fake=makeFakeVercel();
    const poison='vcp_'+'a'.repeat(24);
    fake.when('GET','/v10/projects').resolves({projects:[{
      id:'prj_A',name:'demo',framework:'nextjs',
      productionUrl:'https://user:password@example.test?token='+poison,
      link:{repo:poison,productionBranch:'main'},nodeVersion:'22.x'
    }],pagination:{next:null}});
    fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:'prj_A',name:'demo',productionUrl:'example.test?token='+poison,
      buildCommand:poison,installCommand:'npm ci',devCommand:'x'.repeat(400),
      rootDirectory:'src',latestProductionDeployments:[{createdAt:poison}]
    });
    const listed=parse(await call('vercel_project_list',{},db,fake.fetch));
    expect(listed.projects[0]).toMatchObject({
      id:'prj_A',name:'demo',productionUrl:null,gitRepo:null,nodeVersion:'22.x'
    });
    const detail=parse(await call('vercel_project_get',{project:'prj_A'},db,fake.fetch));
    expect(detail).toMatchObject({productionUrl:null,buildCommand:null,
      installCommand:'npm ci',devCommand:null,rootDirectory:'src',lastProductionAt:null});
    expect(JSON.stringify({listed,detail})).not.toContain(poison);
    expect(fake.calls).toHaveLength(2);
  });
  it('returns null for canonical token shapes in project fields and hostnames',async()=>{
    const fake=makeFakeVercel();
    const secrets=['sk_test_'+'a'.repeat(24),'rk_live_'+'b'.repeat(24),
      'vercel_blob_rw_'+'c'.repeat(24),'xoxb-'+'d'.repeat(24),
      'AKIA'+'A'.repeat(20)];
    fake.when('GET','/v10/projects').resolves({projects:secrets.map((secret,i)=>({
      id:'prj_'+i,name:'demo',framework:secret,productionUrl:secret+'.example.test',
      link:{repo:secret,productionBranch:secret}
    })),pagination:{next:null}});
    const result=parse(await call('vercel_project_list',{},db,fake.fetch));
    expect(result.projects).toHaveLength(secrets.length);
    for(const row of result.projects)
      expect(row).toMatchObject({framework:null,productionUrl:null,gitRepo:null,productionBranch:null});
    expect(JSON.stringify(result)).not.toContain('sk_test_');
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
  it('projects object-form cron metadata and alias safely without echoing nested provider data',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:'prj_DEMO',name:'app',alias:[{alias:'app.vercel.app',rawToken:'private'}],
      crons:{definitions:[{path:'/api/sync',schedule:'0 0 * * *'}]},
      token:'never-output'});
    const data=parse(await call('vercel_project_get',{project:'prj_DEMO'},db,fake.fetch));
    expect(data.cronsCount).toBe(1);
    expect(data.productionUrl).toBe('app.vercel.app');
    expect(JSON.stringify(data)).not.toContain('private');
    expect(JSON.stringify(data)).not.toContain('never-output');
  });
  it('provides bounded project diagnostics without copying nested credentials',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_DEMO',name:'demo',
      hasDeployments:true,pauseStatus:{status:'PAUSED',token:'FAKE_INTERNAL'},
      commandForIgnoringBuildStep:'node scripts/ignore.js',
      link:{type:'github',repo:'example/demo',productionBranch:'main',accessToken:'FAKE_SECRET'},
      resourceConfig:{buildMachineType:'enhanced',maxConcurrentBuilds:2,
        fluid:true,privateKey:'FAKE_SECRET',defaultRegions:['iad1','fra1']},
      latestProductionDeployments:[{id:'dpl_FAKE001',readyState:'READY',createdAt:1700000000000,
        token:'FAKE_SECRET'}]});
    const data=parse(await call('vercel_project_get',{project:'prj_DEMO'},db,fake.fetch));
    expect(data).toMatchObject({ignoreBuildStep:'node scripts/ignore.js',
      hasDeployments:true,pauseState:'PAUSED',
      git:{type:'github',repo:'example/demo',productionBranch:'main'},
      resourceConfig:{buildMachineType:'enhanced',maxConcurrentBuilds:2,fluid:true,
        defaultRegions:['iad1','fra1']},
      latestProduction:[{id:'dpl_FAKE001',state:'READY',createdAt:1700000000000}]});
    expect(JSON.stringify(data)).not.toMatch(/privateKey|accessToken|FAKE_SECRET|FAKE_INTERNAL/);
  });
  it('does not echo malformed provider nested values and limits arrays',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_DEMO',name:'demo',
      resourceConfig:{defaultRegions:Array.from({length:80},(_,i)=>'r'+i),
        buildMachineType:'value'+String.fromCharCode(10)+'unsafe',maxConcurrentBuilds:-9},
      latestProductionDeployments:Array.from({length:30},(_,i)=>({id:'dpl_'+i}))});
    const data=parse(await call('vercel_project_get',{project:'prj_DEMO'},db,fake.fetch));
    expect(data.latestProduction).toHaveLength(5);
    expect(data.resourceConfig.defaultRegions).toHaveLength(12);
    expect(data.resourceConfig).not.toHaveProperty('buildMachineType');
    expect(data.resourceConfig).not.toHaveProperty('maxConcurrentBuilds');
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
