import {describe,it,expect,beforeEach,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {seedManifest} from '../../src/dev/scenarios.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';

vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));
const account='acct_FAKE_DEV',team='team_FAKE_DEV',project='prj_FAKE_DEV',deployment='dpl_FAKE_DEV_PREVIEW';
const runId='run_20261014_abcdef1234';
const owner={account,profile:'full',mode:'preview',listing:'catalog'};
const parse=value=>JSON.parse(value.content?.[0]?.text??'{}');
const object=(type,id,projectId=project,detail={})=>({
  object_type:type,object_id:id,project_id:projectId,detail,
  created_at:new Date().toISOString(),status:'active',last_error:null
});
function fixture(items=[]){
  const fake=makeFakeVercel(),runs=new Map(),rows=new Map(),audit=[],ledger=new Map();
  runs.set(runId,{id:runId,description:'Synthetic static-site',status:'active',
    created_at:new Date().toISOString(),cleaned_at:null});
  rows.set(runId,structuredClone(items));
  const db={
    getAccountCredential:async()=>({}),
    listProtectedResources:async()=>[],
    recordChange:async e=>audit.push(e),
    getVercelAccountSafe:async()=>({id:account,spend_limit_cents:0}),
    getTodaySpendCents:async()=>0,
    listDevRuns:async()=>[...runs.values()],
    getDevRunByRequestKey:async()=>null,
    getDevRun:async({id,account:owner})=>owner===account?runs.get(id)??null:null,
    listDevRunObjects:async({id,account:owner})=>owner===account?structuredClone(rows.get(id)??[]):[],
    setDevRunObjectOutcome:async({id,type,objectId,status,error})=>{
      const item=rows.get(id)?.find(x=>x.object_id===objectId&&x.object_type===type);
      if(!item)return false;item.status=status;item.last_error=error;return true;
    },
    completeDevRunCleanup:async({id})=>{
      if(rows.get(id).every(o=>o.status==='cleaned')){runs.get(id).status='cleaned';return true;}
      return false;
    },
    requestReplayStore:()=>({
      claim:async({key})=>ledger.has(key)?{state:'completed',result:ledger.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>{ledger.set(key,result);},
      release:async()=>true
    })
  };
  const call=(name,args={},conn=owner)=>dispatchReadOnlyTool({
    registry,name,args,connection:conn,db,fetchImpl:fake.fetch});
  return {call,db,fake,runs,rows,audit,ledger};
}
describe('V-1 recorded development runs and strict cleanup',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({
    token:'vcp_FAKE_DEV_TOKEN',account:{id:account,scope:'team',team_id:team}
  });});
  it('registers three tools and protects both writes through real guarded contracts',()=>{
    for(const name of ['vercel_dev_seed','vercel_dev_cleanup']){
      const item=registry.tools.find(t=>t.name===name);
      expect(item).toMatchObject({writes:true,guardedWrite:true,
        writeContract:{production:true,targets:true}});
      expect(listMcpTools(registry,{profile:'read_only'}).some(t=>t.name===name)).toBe(false);
    }
    expect(registry.tools.find(t=>t.name==='vercel_dev_list_runs').writes).toBe(false);
  });
  it('seed scenarios are finite and contain no credentials or production events',()=>{
    for(const scenario of ['static-site','nextjs-hello','api-function','cron-demo']){
      const item=seedManifest(scenario);
      expect(item.files.length).toBeGreaterThan(0);
      expect(item.files.every(f=>f.file&&!/\.\./.test(f.file))).toBe(true);
      expect(JSON.stringify(item)).not.toMatch(/private.key|api.secret/i);
    }
    expect(seedManifest('cron-demo').note).toMatch(/production/);
    expect(()=>seedManifest('not-real')).toThrow();
  });
  it('uses the pinned provider shape for synthetic preview source, never production',()=>{
    const run='run_20261014_abcdef1234';
    const files=seedManifest('static-site').files.map(f=>({file:f.file,
      sha:'a'.repeat(40),size:Buffer.byteLength(f.content)}));
    expect(validateRequest('deployments_create',{
      query:{teamId:team},body:{name:'rtc-test-preview',project:'rtc-test-preview',
        target:'preview',files,meta:{rtc_run:run}}
    })).toBe(true);
  });
  it('forbids production connections, cross-tenant creation, and metered seed execution',async()=>{
    const f=fixture();
    const name='vercel_dev_seed';
    const args={scenario:'static-site',outsideApp:true,confirm:true,requestKey:'seedNoSpend123'};
    const denied=parse(await f.call(name,args,{...owner,mode:'production'}));
    expect(denied.status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const blocked=parse(await f.call(name,args));
    expect(blocked.status).toBe('refused_by_guard');
    expect(JSON.stringify(blocked)).toMatch(/Unbounded|ceiling|refus/i);
    expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
    expect(f.runs.size).toBe(1);
    f.fake.verify();
  });
  it('only lists owner-visible run records; read-only and foreign probes perform no provider call',async()=>{
    const f=fixture([object('deployment',deployment)]);
    expect(parse(await f.call('vercel_dev_list_runs',{runId})).runs[0].objects)
      .toMatchObject([{type:'deployment',id:deployment}]);
    expect(parse(await f.call('vercel_dev_list_runs',{runId:'run_20261014_bbbbbbbb'},
      {...owner,account:'foreign'})).runs).toEqual([]);
    expect(f.fake.calls).toHaveLength(0);
  });
  it('refuses raw deployment cleanup if aliases are serving, without destructive API call',async()=>{
    const f=fixture([object('deployment',deployment)]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      uid:deployment,projectId:project,target:'preview',readyState:'READY',
      alias:['live.example.test']});
    const value=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'cleanupAlias001'}));
    expect(value.status).toBe('applied');
    expect(value.confirmed).toBe(false);
    expect(f.rows.get(runId)[0].status).toBe('blocked');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('cleans exact unaliased preview and independently proves 404, but never repeats deletion',async()=>{
    const f=fixture([object('deployment',deployment)]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves({uid:deployment,projectId:project,target:'preview',
        readyState:'CANCELED',alias:[]})
      .resolves({uid:deployment,projectId:project,target:'preview',
        readyState:'CANCELED',alias:[]})
      .rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const args={runId,outsideApp:true,confirm:true,requestKey:'cleanupGood001'};
    const done=parse(await f.call('vercel_dev_cleanup',args));
    expect(done).toMatchObject({status:'applied',confirmed:true});
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    expect(f.runs.get(runId).status).toBe('cleaned');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    expect(parse(await f.call('vercel_dev_cleanup',args)).status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('refuses production listing before reading the database or Vercel provider',async()=>{
    const f=fixture();
    const out=await f.call('vercel_dev_list_runs',{}, {...owner,mode:'production'});
    expect(out.isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
  });
  it('preserves unresolved provider outcomes without retrying DELETE',async()=>{
    const f=fixture([{...object('deployment',deployment),status:'uncertain'}]);
    const args={runId,outsideApp:true,confirm:true,requestKey:'cleanupUnknown001'};
    const result=parse(await f.call('vercel_dev_cleanup',args));
    expect(result.status).toBe('applied');
    expect(result.confirmed).toBe(false);
    expect(f.rows.get(runId)[0].status).toBe('uncertain');
    expect(f.fake.calls).toHaveLength(0);
  });
  it('skips nonempty or modified scratch project and preserves its resource record',async()=>{
    const name='rtc-'+runId.replaceAll('_','-')+'-static-site';
    const f=fixture([object('project',project,project,{name})]);
    f.fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:project,name,accountId:team,link:{type:'github',repo:'foreign/repo'},
      hasDeployments:false,stores:[],crons:{definitions:[]}});
    // Full reusable project-deletion inspector requires complete independent
    // domain, environment and deployment pages even when Git linkage is known.
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    const out=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'cleanupProject001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    expect(f.rows.get(runId)[0].status).toBe('blocked');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('deletes only an independently verified empty owned scratch project',async()=>{
    const name='rtc-'+runId.replaceAll('_','-')+'-static-site';
    const f=fixture([object('project',project,project,{name})]);
    const empty={id:project,name,accountId:team,link:null,
      hasDeployments:false,storageConnections:[],crons:{definitions:[]}};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(empty).resolves(empty).rejects(404);
    for(const [path,field] of [
      ['/v9/projects/{idOrName}/domains','domains'],
      ['/v10/projects/{idOrName}/env','envs'],
      ['/v7/deployments','deployments']
    ]){
      const page={[field]:[],pagination:{count:0,next:null}};
      f.fake.when('GET',path).resolves(page).resolves(page);
    }
    f.fake.when('DELETE','/v9/projects/{idOrName}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'cleanupEmptyProj001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    expect(f.fake.calls.find(c=>c.method==='DELETE').path)
      .toBe('/v9/projects/'+project);
    f.fake.verify();
  });
  it('denies unowned, invalid, and undeclared cleanup runs',async()=>{
    const f=fixture();
    for(const args of [{runId:'run_20261014_zzzzzzzz',outsideApp:true},
      {runId:'not-a-run',outsideApp:true},{runId,outsideApp:false}]){
      const out=parse(await f.call('vercel_dev_cleanup',{...args,confirm:true}));
      expect(out.status).toBe('refused_by_guard');
    }
    expect(f.fake.calls).toHaveLength(0);
  });
});
