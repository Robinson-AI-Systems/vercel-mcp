import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {cronsTools,denverCronPreview} from '../../src/tools/crons.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const connection={account:'acct_C',profile:'read_only',listing:'catalog',mode:'preview'};
const db={getAccountCredential:async()=>({})};
const registry=mergeNamespaces([cronsTools]);
const call=(args,fake,conn=connection)=>dispatchReadOnlyTool({
  registry,name:'vercel_cron_list',args,connection:conn,db,fetchImpl:fake.fetch});
const parse=r=>JSON.parse(r.content[0].text);
const stored=scope=>({token:'vcp_FAKE_C',account:{id:'acct_C',
  team_id:'team_C',scope,project_id:scope==='project'?'prj_ONLY':null}});
describe('D-1d safe Vercel cron schedule reads',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(stored('team'));});
  it('reads existing cron definitions without ever triggering the scheduled endpoint',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:'prj_APP',name:'app',env:[{value:'super-private'}],crons:{
        deploymentId:'dpl_FAKE0001',enabledAt:1700000000000,disabledAt:1600000000000,
        updatedAt:1700000000000,
        definitions:[{path:'/api/sync?secret=do-not-echo',schedule:'0 0 * * *',
          description:'token=hidden',host:'private.internal',source:'api'}]}});
    const result=parse(await call({project:'prj_APP'},fake));
    expect(result).toMatchObject({project:'prj_APP',available:true,count:1,
      enabled:true,deploymentId:'dpl_FAKE0001',
      jobs:[{path:'/api/sync',scheduleUtc:'0 0 * * *',source:'api'}]});
    expect(result.jobs[0].denverExample.winter).toEqual({time:'17:00 MST',dayOffset:-1});
    expect(result.jobs[0].denverExample.summer).toEqual({time:'18:00 MDT',dayOffset:-1});
    expect(JSON.stringify(result)).not.toMatch(/super-private|do-not-echo|hidden|private.internal/);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({method:'GET',path:'/v9/projects/prj_APP',
      query:{teamId:'team_C'}});
  });
  it('hides credential-bearing decoded paths, malformed paths and provider schedules',async()=>{
    const fake=makeFakeVercel();
    const secret='vcp_FAKE_sensitive_cron';
    fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:'prj_APP',crons:{definitions:[
        {path:'/api/'+secret,schedule:secret,source:'api'},
        {path:'/api/%76cp_FAKE_sensitive_cron',schedule:'*/5 * * * *'},
        {path:'/api/safe?token='+secret,schedule:'0 0 * * *'},
        {path:'/api/invalid\\\\segment',schedule:'0 0 * * *'},
        {path:'/api/line\nsecret',schedule:'0 0 * * *'}
      ]}});
    const result=parse(await call({project:'prj_APP'},fake));
    expect(result.jobs.map(x=>x.path)).toEqual([null,null,'/api/safe',null,null]);
    expect(result.jobs[0].scheduleUtc).toBeNull();
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fake.calls.map(x=>x.method)).toEqual(['GET']);
  });
  it('rejects an untrusted credential-shaped project identifier in cron output',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:'vcp_FAKE_sensitive_project',crons:{definitions:[]}});
    const result=await call({project:'prj_APP'},fake);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('vcp_FAKE_sensitive_project');
  });
  it('distinguishes unavailable cron metadata from an explicitly empty schedule',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_A'})
      .resolves({id:'prj_A',crons:{definitions:[],disabledAt:1700000000000}});
    const unavailable=parse(await call({project:'prj_A'},fake));
    expect(unavailable).toMatchObject({available:false,count:null,jobs:[]});
    const empty=parse(await call({project:'prj_A'},fake));
    expect(empty).toMatchObject({available:true,count:0,enabled:false,jobs:[]});
  });
  it('rejects invalid paths, cross-project and caller scope override before provider fetch',async()=>{
    const fake=makeFakeVercel();
    for(const args of [{},{project:'../other'},{project:'prj_A',token:'fake'},
      {project:'prj_A',teamId:'other'}]){
      expect((await call(args,fake)).isError).toBe(true);
    }
    loadToken.mockResolvedValue(stored('project'));
    expect((await call({project:'prj_OTHER'},fake)).isError).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
  it('does not invent Denver time for complex schedules, minute offsets or DST transitions',()=>{
    expect(denverCronPreview('*/15 * * * *')).toBeNull();
    expect(denverCronPreview('0 12 * * 1')).toBeNull();
    expect(denverCronPreview('0 0 * * *').winter.time).toContain('MST');
    expect(denverCronPreview('0 0 * * *').summer.time).toContain('MDT');
  });
});
