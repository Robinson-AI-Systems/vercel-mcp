import {createHash} from 'node:crypto';
import {describe,it,expect,beforeEach,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {seedManifest} from '../../src/dev/scenarios.js';
import {encryptSecret} from '../../src/core/secret-box.js';
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
      // Mirror the real store's validation (src/db.js): an outcome
      // error over 160 characters is rejected — the AUD-O enriched
      // refusal exceeded it and killed live cleanup passes (AUD-Q).
      if(error!==null&&error!==undefined&&
         (typeof error!=='string'||error.length>160))
        throw new TypeError('Invalid cleanup outcome');
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
  const call=(name,args={},conn=owner,env={})=>dispatchReadOnlyTool({
    registry,name,args,connection:conn,db,fetchImpl:fake.fetch,env});
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
        target:'preview',files,meta:{rtc_run:run},
        projectSettings:{buildCommand:null,devCommand:null,framework:null,
          installCommand:null,outputDirectory:null,rootDirectory:null}}
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
      hasDeployments:false,crons:{definitions:[]}});
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
      hasDeployments:false,crons:{definitions:[]}};
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
  it('removes an exact run alias only if it still routes to the recorded preview',async()=>{
    const domain='rtc-'+runId.replaceAll('_','-')+'-preview.vercel.app';
    const f=fixture([object('alias','alias_FAKE_PREVIEW',project,
      {name:domain,deployment})]);
    f.fake.when('GET','/v4/aliases/{idOrAlias}')
      .resolves({uid:'alias_FAKE_PREVIEW',alias:domain,deploymentId:deployment})
      .resolves({uid:'alias_FAKE_PREVIEW',alias:domain,deploymentId:deployment})
      .rejects(404);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      uid:deployment,projectId:project,target:'preview',readyState:'READY'});
    f.fake.when('DELETE','/v2/aliases/{aliasId}').resolves({},204);
    const result=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'exactAliasDelete01'}));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    f.fake.verify();
  });
  it('refuses an alias that was re-pointed to production without DELETE',async()=>{
    const domain='rtc-'+runId.replaceAll('_','-')+'-preview.vercel.app';
    const f=fixture([object('alias','alias_FAKE_PREVIEW',project,
      {name:domain,deployment})]);
    f.fake.when('GET','/v4/aliases/{idOrAlias}').resolves({
      uid:'alias_FAKE_PREVIEW',alias:domain,deploymentId:'dpl_UNTRACKED'});
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      uid:deployment,projectId:project,target:'preview',readyState:'READY'});
    const result=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'aliasMovedLeave01'}));
    expect(result.confirmed).toBe(false);
    expect(f.rows.get(runId)[0].status).toBe('blocked');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('removes recorded preview-only env by exact ID after two metadata proofs',async()=>{
    const f=fixture([object('env','env_FAKE_PREVIEW',project,
      {key:'PREVIEW_ONLY',target:'preview',branch:'feature/dev'})]);
    const value={id:'env_FAKE_PREVIEW',key:'PREVIEW_ONLY',target:['preview'],
      gitBranch:'feature/dev',comment:'rtc_run='+runId};
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(value).resolves(value).rejects(404);
    f.fake.when('DELETE','/v9/projects/{idOrName}/env/{id}').resolves({},204);
    const result=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'deletePreviewEnv01'}));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('cannot clean an earlier blocked object just because it is no longer active',async()=>{
    const f=fixture([{...object('alias','alias_FAKE_PREVIEW',project,{}),
      status:'blocked',last_error:'Unverified routing'}]);
    const result=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'blockedNeedsProof01'}));
    expect(result.confirmed).toBe(false);
    expect(f.rows.get(runId)[0].status).toBe('blocked');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('revokes only the exact encrypted recorded automation bypass, then proves absence',async()=>{
    const env={TOKEN_ENCRYPTION_KEY:'11'.repeat(32)};
    const value='0123456789abcdef0123456789abcdef';
    const id='byp_'+createHash('sha256').update(value).digest('hex').slice(0,32);
    const box=encryptSecret(value,'dev-bypass:'+runId+':'+id,env);
    const name='rtc-'+runId.replaceAll('_','-')+'-static-site';
    const f=fixture([object('bypass',id,project,{ciphertext:box,note:'Isolated test'})]);
    const active={id:project,name,protectionBypass:{
      [value]:{scope:'automation-bypass',createdAt:1,createdBy:'owner'}
    }};
    const revoked={id:project,name,protectionBypass:{}};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(active).resolves(active).resolves(revoked);
    f.fake.when('PATCH','/v1/projects/{idOrName}/protection-bypass')
      .resolves({protectionBypass:{}});
    const out=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'revokeBypassOne01'
    },owner,env));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    const writes=f.fake.calls.filter(c=>c.method==='PATCH');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual({revoke:{secret:value,regenerate:false}});
    expect(JSON.stringify(out)+JSON.stringify(f.audit)).not.toContain(value);
    expect(JSON.stringify(f.audit)).not.toContain(box);
    f.fake.verify();
  });
  it('routes a tracked bypass cleanup through the protected owning project guard',async()=>{
    const f=fixture([object('bypass','byp_0123456789abcdef0123456789abcdef',
      project,{ciphertext:'synthetic-encrypted-only'})]);
    f.db.listProtectedResources=async()=>[{kind:'project',match:project,
      note:'Owner-excluded project'}];
    const out=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'denyProtectedBypass01'}));
    expect(out.status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
    expect(f.rows.get(runId)[0].status).toBe('active');
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
describe('AUD-H real provider shapes in seed and cleanup (VMCP-023)',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({
    token:'vcp_FAKE_DEV_TOKEN',account:{id:account,scope:'team',team_id:team}
  });});
  it('cleans an unaliased preview deployment whose object carries target:null',async()=>{
    const f=fixture([object('deployment',deployment)]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves({uid:deployment,projectId:project,target:null,
        readyState:'CANCELED',alias:[]})
      .resolves({uid:deployment,projectId:project,target:null,
        readyState:'CANCELED',alias:[]})
      .rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const done=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupNullTarget1'}));
    expect(done).toMatchObject({status:'applied',confirmed:true});
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    f.fake.verify();
  });
  it('seeds a preview deployment against the real provider shapes',async()=>{
    const seedRun='run_20261028_audh000001';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=fixture();
    f.db.getPurchasePolicy=async()=>({grantRequired:false,budgetCents:null});
    f.db.getTodaySpendCents=async()=>0;
    f.db.createDevRun=async({id,account:acct})=>{
      if(acct!==account)return {created:false};
      f.runs.set(id,{id,description:'Synthetic static-site',status:'active',
        created_at:new Date().toISOString(),cleaned_at:null});
      f.rows.set(id,[]);return {created:true};
    };
    f.db.addDevRunObject=async({id,type,objectId,projectId,detail})=>{
      f.rows.get(id)?.push(object(type,objectId,projectId??project,detail??{}));
      return true;
    };
    const projectRow={id:project,name,accountId:team};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .rejects(404).rejects(404).rejects(404).resolves(projectRow);
    f.fake.when('POST','/v11/projects').resolves(projectRow);
    f.fake.when('POST','/v2/files').resolves({urls:['example-upload.aws.com']},200);
    const deploymentRow={id:deployment,projectId:project,target:null,
      readyState:'QUEUED',meta:{rtc_run:seedRun}};
    f.fake.when('POST','/v13/deployments').resolves(deploymentRow);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(deploymentRow);
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudH00001'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
});
describe('AUD-J first-deployment projectSettings in seed (VMCP-023)',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({
    token:'vcp_FAKE_DEV_TOKEN',account:{id:account,scope:'team',team_id:team}
  });});
  // The provider requires projectSettings for a project's FIRST deployment
  // (vendored OpenAPI description) and refuses without them:
  // 400 missing_project_settings — the live probe's failure of 2026-10-28.
  // A seed deployment is always a first deployment, so the create call must
  // carry the settings, with the scenario's framework and nulls elsewhere.
  function seedFixture(){
    const f=fixture();
    f.db.getPurchasePolicy=async()=>({grantRequired:false,budgetCents:null});
    f.db.getTodaySpendCents=async()=>0;
    f.db.createDevRun=async({id,account:acct})=>{
      if(acct!==account)return {created:false};
      f.runs.set(id,{id,description:'Synthetic seed',status:'active',
        created_at:new Date().toISOString(),cleaned_at:null});
      f.rows.set(id,[]);return {created:true};
    };
    f.db.addDevRunObject=async({id,type,objectId,projectId,detail})=>{
      f.rows.get(id)?.push(object(type,objectId,projectId??project,detail??{}));
      return true;
    };
    return f;
  }
  function wireSeed(f,seedRun,name,createRow,getRow){
    const projectRow={id:project,name,accountId:team};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .rejects(404).rejects(404).rejects(404).resolves(projectRow);
    f.fake.when('POST','/v11/projects').resolves(projectRow);
    f.fake.when('POST','/v2/files').resolves({urls:['example-upload.aws.com']},200);
    const deploymentRow={id:deployment,projectId:project,target:null,
      readyState:'QUEUED',meta:{rtc_run:seedRun}};
    f.fake.when('POST','/v13/deployments').resolves(createRow??deploymentRow);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(getRow??deploymentRow);
  }
  it('sends null-framework projectSettings for a static-site seed',async()=>{
    const seedRun='run_20261028_audj000001';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();wireSeed(f,seedRun,name);
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudJ00001'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const create=f.fake.calls.find(c=>c.method==='POST'&&
      c.path==='/v13/deployments');
    expect(create.body.projectSettings).toEqual({
      buildCommand:null,devCommand:null,framework:null,
      installCommand:null,outputDirectory:null,rootDirectory:null});
    f.fake.verify();
  });
  it('sends the scenario framework for a nextjs-hello seed',async()=>{
    const seedRun='run_20261028_audj000002';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-nextjs-hello';
    const f=seedFixture();wireSeed(f,seedRun,name);
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'nextjs-hello',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudJ00002'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const create=f.fake.calls.find(c=>c.method==='POST'&&
      c.path==='/v13/deployments');
    expect(create.body.projectSettings).toEqual({
      buildCommand:null,devCommand:null,framework:'nextjs',
      installCommand:null,outputDirectory:null,rootDirectory:null});
    f.fake.verify();
  });
  it('seeds against the documented in-progress create shape (AUD-L)',async()=>{
    const seedRun='run_20261028_audl000001';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();
    // Branch 0 of the documented create response (vendored snapshot):
    // still building — id, target and readyState, and NO projectId.
    // The full shape arrives on verify()'s read-back instead.
    wireSeed(f,seedRun,name,{id:deployment,target:null,
      readyState:'BUILDING',aliasAssigned:false,duration:0});
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudL00001'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
  // AUD-M: verify()'s read-back may arrive in any documented
  // deployments_get shape — in-progress (no projectId, no meta),
  // reduced (meta, no projectId) — or promoted to production, which
  // the provider does to a project's first deployment (live record,
  // 2026-10-28). A wrong-project full shape must still refuse.
  it('verifies against an in-progress read-back shape (AUD-M)',async()=>{
    const seedRun='run_20261028_audm000001';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();
    wireSeed(f,seedRun,name,undefined,{id:deployment,target:null,
      readyState:'BUILDING'});
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudM00001'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
  it('verifies against a reduced read-back shape (AUD-M)',async()=>{
    const seedRun='run_20261028_audm000002';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();
    wireSeed(f,seedRun,name,undefined,{id:deployment,target:null,
      meta:{rtc_run:seedRun},url:'rtc-preview.vercel.app',
      readyState:'READY'});
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudM00002'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
  it('verifies a provider-promoted first deployment (AUD-M)',async()=>{
    const seedRun='run_20261028_audm000003';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();
    wireSeed(f,seedRun,name,undefined,{id:deployment,projectId:project,
      target:'production',readyState:'READY',meta:{rtc_run:seedRun}});
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudM00003'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
  it('still refuses a wrong-project read-back (AUD-M control)',async()=>{
    const seedRun='run_20261028_audm000004';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();
    wireSeed(f,seedRun,name,undefined,{id:deployment,
      projectId:'prj_FAKEOTHER',target:null,readyState:'READY',
      meta:{rtc_run:seedRun}});
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudM00004'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:false});
    f.fake.verify();
  });
  it('still refuses a read-back naming another project via project.id (PR #255 review)',async()=>{
    const seedRun='run_20261028_audm000005';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();
    wireSeed(f,seedRun,name,undefined,{id:deployment,
      project:{id:'prj_FAKEOTHER'},target:null,readyState:'READY',
      meta:{rtc_run:seedRun}});
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudM00005'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:false});
    f.fake.verify();
  });
  it('confirms when the CREATE response itself carries the promoted target (AUD-N)',async()=>{
    // The live closure probes' shape: the provider promotes the
    // first deployment at creation, so the create response (branch 0:
    // no projectId, no meta) already carries target 'production'.
    // The response target enum is production/staging/null — 'preview'
    // is never a response value. shapeResult is an identity check;
    // verify() judges the target.
    const seedRun='run_20261028_audn000001';
    const name='rtc-'+seedRun.replaceAll('_','-')+'-static-site';
    const f=seedFixture();
    wireSeed(f,seedRun,name,
      {id:deployment,target:'production',readyState:'BUILDING'},
      {id:deployment,projectId:project,target:'production',
        readyState:'READY',meta:{rtc_run:seedRun}});
    const out=parse(await f.call('vercel_dev_seed',
      {scenario:'static-site',runId:seedRun,outsideApp:true,confirm:true,
        requestKey:'seedAudN00001'},{...owner,kind:'connector'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
});

describe('AUD-K cleanup intent reconciliation (VMCP-027)',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({
    token:'vcp_FAKE_owner',account:{id:account,team_id:team,scope:'team'}});});
  const scratchName='rtc-'+runId.replaceAll('_','-')+'-static-site';
  function emptyLists(f){
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
  }
  it('cleans a failed seed run in one pass: intent reconciles on proven absence, then the project deletes',async()=>{
    const f=fixture([
      object('project',project,project,{name:scratchName}),
      object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'})
    ]);
    const row={id:project,name:scratchName,accountId:team,link:null};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(row).resolves(row).rejects(404);
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    emptyLists(f);
    f.fake.when('DELETE','/v9/projects/{idOrName}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'cleanupAudK00001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='intent').status).toBe('cleaned');
    expect(rows.find(o=>o.object_type==='project').status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('blocks intent and project, deleting nothing, when the intent target exists unrecorded',async()=>{
    const f=fixture([
      object('project',project,project,{name:scratchName}),
      object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'})
    ]);
    f.fake.when('GET','/v7/deployments').resolves({
      deployments:[{id:'dpl_UNRECORDED',projectId:project,target:null,
        meta:{rtc_run:runId}}],
      pagination:{next:null,count:1}});
    const out=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'cleanupAudK00002'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='intent').status).toBe('blocked');
    expect(rows.find(o=>o.object_type==='project').status).toBe('blocked');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('reconciles a lone project-creation intent when the project is absent',async()=>{
    // The seed records a project-creation intent with NO projectId
    // (project_id: null): reconciliation must not demand one.
    const f=fixture([
      object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName})
    ]);
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const out=parse(await f.call('vercel_dev_cleanup',{
      runId,outsideApp:true,confirm:true,requestKey:'cleanupAudK00003'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
});

describe('AUD-M cleanup uncertain-state reconciliation (VMCP-027)',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({
    token:'vcp_FAKE_owner',account:{id:account,team_id:team,scope:'team'}});});
  const scratchName='rtc-'+runId.replaceAll('_','-')+'-static-site';
  const withStatus=(o,status,error=null)=>({...o,status,last_error:error});
  function emptyLists(f){
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
  }
  it('discharges a run whose project object is stuck at uncertain',async()=>{
    // The live stranded shape of 2026-10-28: both intents cleaned by
    // AUD-K's reconciliation; the project object poisoned at uncertain
    // by a pre-fix inspection throw, though no delete ever dispatched.
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      withStatus(object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'}),
        'cleaned'),
      withStatus(object('project',project,project,{name:scratchName}),
        'uncertain','Provider result uncertain; independent inspection required')
    ]);
    const row={id:project,name:scratchName,accountId:team,link:null};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(row).resolves(row).rejects(404);
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    emptyLists(f);
    f.fake.when('DELETE','/v9/projects/{idOrName}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='project').status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('still stops at manual readback for an uncertain deployment object',async()=>{
    const f=fixture([
      withStatus(object('deployment',deployment,project,{target:'preview'}),
        'uncertain','Provider result uncertain; independent inspection required')
    ]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves({uid:deployment,projectId:project,target:null,alias:[]})
      .resolves({uid:deployment,projectId:project,target:null,alias:[]});
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00002'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    expect(f.rows.get(runId)[0].status).toBe('uncertain');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('lands an inspection failure at blocked, not uncertain',async()=>{
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      object('project',project,project,{name:scratchName})
    ]);
    const row={id:project,name:scratchName,accountId:team,link:null};
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(row).resolves(row);
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .rejects(400,{error:{code:'bad_request'}});
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00003'}));
    expect(out.confirmed).toBe(false);
    expect(f.rows.get(runId).find(o=>o.object_type==='project').status)
      .toBe('blocked');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('discharges a run whose deployment was promoted to production (AUD-M delete leg)',async()=>{
    // The successful-seed shape after the provider's promotion: the
    // deployment object is recorded, its read-back is the full shape
    // with target production. Cleanup must still take it down before
    // the project.
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      withStatus(object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'}),
        'cleaned'),
      object('deployment',deployment,project,{target:'preview'}),
      object('project',project,project,{name:scratchName})
    ]);
    const promoted={id:deployment,projectId:project,target:'production',
      alias:[],meta:{rtc_run:runId},readyState:'READY'};
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves(promoted).resolves(promoted).rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const row={id:project,name:scratchName,accountId:team,link:null};
    // Two deployment-branch scratch proofs (target production) plus
    // the project inspect pair, then the post-delete 404.
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(row).resolves(row).resolves(row).resolves(row).rejects(404);
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    emptyLists(f);
    f.fake.when('DELETE','/v9/projects/{idOrName}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00004'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='deployment').status).toBe('cleaned');
    expect(rows.find(o=>o.object_type==='project').status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(2);
    f.fake.verify();
  });
  it('discharges the full live shape: promoted, aliased to its own project domain (AUD-P)',async()=>{
    // The closure probe's real shape: the promoted deployment's
    // alias list carries its own URL and the scratch project's
    // canonical domain — its identity, not an attachment. The
    // project likewise carries only its canonical domain (AUD-O).
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      withStatus(object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'}),
        'cleaned'),
      object('deployment',deployment,project,{target:'preview'}),
      object('project',project,project,{name:scratchName})
    ]);
    const ownUrl=scratchName+'-abc123-team-fake.vercel.app';
    const promoted={id:deployment,projectId:project,target:'production',
      url:'https://'+ownUrl,alias:[ownUrl,scratchName+'.vercel.app'],
      meta:{rtc_run:runId},readyState:'READY'};
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves(promoted).resolves(promoted).rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const row={id:project,name:scratchName,accountId:team,link:null};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(row).resolves(row).resolves(row).resolves(row).rejects(404);
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[{name:scratchName+'.vercel.app',
        apexName:'vercel.app',projectId:project,gitBranch:null,
        redirect:null,customEnvironmentId:null,verified:true}],
        pagination:{next:null,count:1}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    f.fake.when('DELETE','/v9/projects/{idOrName}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudP00001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='deployment').status).toBe('cleaned');
    expect(rows.find(o=>o.object_type==='project').status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(2);
    f.fake.verify();
  });
  it('still refuses a scratch deployment aliased to a custom domain (AUD-P)',async()=>{
    const f=fixture([object('deployment',deployment,project,{target:'preview'})]);
    const ownUrl=scratchName+'-abc123-team-fake.vercel.app';
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      id:deployment,projectId:project,target:'production',
      url:'https://'+ownUrl,alias:[ownUrl,'custom.example.com'],
      meta:{rtc_run:runId},readyState:'READY'});
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudP00002'}));
    expect(out.confirmed).toBe(false);
    const row=f.rows.get(runId)[0];
    expect(row.status).toBe('blocked');
    expect(row.last_error).toContain('outside the project family');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('still refuses the production domain alias in an existing user project (AUD-P)',async()=>{
    const f=fixture([object('deployment',deployment,project,{target:'preview'})]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      id:deployment,projectId:project,target:'production',
      url:'https://customer-app-abc123.vercel.app',
      alias:['customer-production-app.vercel.app'],
      meta:{rtc_run:runId},readyState:'READY'});
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves({id:project,name:'customer-production-app',
        accountId:team,link:null});
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudP00003'}));
    expect(out.confirmed).toBe(false);
    const row=f.rows.get(runId)[0];
    expect(row.status).toBe('blocked');
    expect(row.last_error).toContain('outside the project family');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('deletes a preview deployment carrying only its own URL as alias (AUD-P)',async()=>{
    const f=fixture([object('deployment',deployment,project,{target:'preview'})]);
    const ownUrl=scratchName+'-abc123-team-fake.vercel.app';
    const row={id:deployment,projectId:project,target:null,
      url:'https://'+ownUrl,alias:[ownUrl],
      meta:{rtc_run:runId},readyState:'READY'};
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves(row).resolves(row).rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudP00004'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('discharges a deployment whose read-back is the in-progress shape (AUD-M delete leg)',async()=>{
    const f=fixture([object('deployment',deployment,project,{target:'preview'})]);
    // Branch 0: no projectId, no meta — id, target, readyState, alias.
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves({id:deployment,target:null,readyState:'BUILDING',alias:[]})
      .resolves({id:deployment,target:null,readyState:'BUILDING',alias:[]})
      .rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00005'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('revokes an alias whose deployment reads back in the reduced shape (AUD-M delete leg)',async()=>{
    // Branch 2 of deployments_get: project.id instead of projectId.
    // The alias branch's cross-check must accept the carried form.
    const domain='rtc-'+runId.replaceAll('_','-')+'-preview.vercel.app';
    const f=fixture([object('alias','alias_FAKE_PREVIEW',project,
      {name:domain,deployment})]);
    f.fake.when('GET','/v4/aliases/{idOrAlias}')
      .resolves({uid:'alias_FAKE_PREVIEW',alias:domain,deploymentId:deployment})
      .resolves({uid:'alias_FAKE_PREVIEW',alias:domain,deploymentId:deployment})
      .rejects(404);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      id:deployment,project:{id:project},target:null,
      meta:{rtc_run:runId},readyState:'READY',alias:[]});
    f.fake.when('DELETE','/v2/aliases/{aliasId}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00006'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(f.rows.get(runId)[0].status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('refuses a production deployment in an existing user project (PR #255 review)',async()=>{
    // Dev-preview runs record deployments in ordinary projects: a
    // preview later promoted there keeps the production refusal.
    const f=fixture([object('deployment',deployment,project,{target:'preview'})]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      id:deployment,projectId:project,target:'production',alias:[],
      readyState:'READY'});
    f.fake.when('GET','/v9/projects/{idOrName}').resolves({
      id:project,name:'existing-app',accountId:team,link:null});
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00007'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    expect(f.rows.get(runId)[0].status).toBe('blocked');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('blocks, never cleans, a project whose inventory read 404s (PR #255 review)',async()=>{
    // Only the project identity lookup can prove absence; an env
    // inventory 404 says nothing about the project itself.
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      object('project',project,project,{name:scratchName})
    ]);
    const row={id:project,name:scratchName,accountId:team,link:null};
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(row);
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v10/projects/{idOrName}/env').rejects(404);
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudM00008'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='project').status).toBe('blocked');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });
  it('discharges the stranded shape when the project carries its canonical domain (AUD-O)',async()=>{
    // The live stranded run's reality: the project holds only its
    // auto-assigned <name>.vercel.app domain — the deletion proof
    // must not count the project's own identity as content.
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      withStatus(object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'}),
        'cleaned'),
      withStatus(object('project',project,project,{name:scratchName}),
        'blocked','Project resource inventory is incomplete, live or no longer empty')
    ]);
    const row={id:project,name:scratchName,accountId:team,link:null};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(row).resolves(row).rejects(404);
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[{name:scratchName+'.vercel.app',
        apexName:'vercel.app',projectId:project,gitBranch:null,
        redirect:null,customEnvironmentId:null,verified:true}],
        pagination:{next:null,count:1}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    f.fake.when('DELETE','/v9/projects/{idOrName}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudO00001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='project').status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });

  it('records a nonempty project refusal instead of dying on the outcome cap (AUD-Q)',async()=>{
    // The AUD-O refusal form ran ~172 characters — over the outcome
    // store's 160 cap — so recording it threw and the whole pass
    // surfaced as a bare outcome_unknown with nothing recorded.
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      withStatus(object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'}),
        'cleaned'),
      withStatus(object('project',project,project,{name:scratchName}),
        'blocked','Project resource inventory is incomplete, live or no longer empty')
    ]);
    const row={id:project,name:scratchName,accountId:team,link:null,
      hasDeployments:true};
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(row);
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[{name:scratchName+'.vercel.app',
        apexName:'vercel.app',projectId:project,gitBranch:null,
        redirect:null,customEnvironmentId:null,verified:true}],
        pagination:{next:null,count:1}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudQ00001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    const proj=f.rows.get(runId).find(o=>o.object_type==='project');
    expect(proj.status).toBe('blocked');
    expect(proj.last_error).toContain('Project not empty');
    expect(proj.last_error).toContain('hasDeployments: true');
    expect(proj.last_error.length).toBeLessThanOrEqual(160);
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    f.fake.verify();
  });

  it('discharges the live shape: truncated canonical domain and alias (AUD-R)',async()=>{
    // Live rows, 2026-10-28 (both rtc projects): a 39+ character
    // project name minted a 35-character subdomain — the canonical
    // domain, and with it the promoted deployment's production
    // alias, is the TRUNCATED host, which neither AUD-O's exact-name
    // exclusion nor AUD-P's constructed family recognized.
    const truncated=scratchName.slice(0,35)+'.vercel.app';
    const f=fixture([
      withStatus(object('intent','intent-project-'+scratchName,null,
        {operation:'projects_create',name:scratchName}),'cleaned'),
      withStatus(object('intent','intent-deployment-'+scratchName,project,
        {operation:'deployments_create',name:scratchName,target:'preview'}),
        'cleaned'),
      object('deployment',deployment,project,{target:'preview'}),
      object('project',project,project,{name:scratchName})
    ]);
    const ownUrl=scratchName+'-abc123-team-fake.vercel.app';
    const promoted={id:deployment,projectId:project,target:'production',
      url:'https://'+ownUrl,alias:[ownUrl,truncated],
      meta:{rtc_run:runId},readyState:'READY'};
    f.fake.when('GET','/v13/deployments/{idOrUrl}')
      .resolves(promoted).resolves(promoted).rejects(404);
    f.fake.when('DELETE','/v13/deployments/{id}').resolves({},204);
    const row={id:project,name:scratchName,accountId:team,link:null};
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves(row).resolves(row).resolves(row).resolves(row).rejects(404);
    f.fake.when('GET','/v9/projects/{idOrName}/domains')
      .resolves({domains:[{name:truncated,
        apexName:'vercel.app',projectId:project,gitBranch:null,
        redirect:null,customEnvironmentId:null,verified:true}],
        pagination:{next:null,count:1}});
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
    f.fake.when('GET','/v7/deployments')
      .resolves({deployments:[],pagination:{next:null,count:0}});
    f.fake.when('DELETE','/v9/projects/{idOrName}').resolves({},204);
    const out=parse(await f.call('vercel_dev_cleanup',
      {runId,outsideApp:true,confirm:true,requestKey:'cleanupAudR00001'}));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    const rows=f.rows.get(runId);
    expect(rows.find(o=>o.object_type==='deployment').status).toBe('cleaned');
    expect(rows.find(o=>o.object_type==='project').status).toBe('cleaned');
    expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(2);
    f.fake.verify();
  });

  it('names the failing deployment arm in its refusal (AUD-S)',async()=>{
    const ownUrl=scratchName+'-abc123-team-fake.vercel.app';
    const base={id:deployment,projectId:project,target:'preview',
      url:'https://'+ownUrl,alias:[ownUrl],meta:{rtc_run:runId},
      readyState:'READY'};
    const cases=[
      [{...base,id:'dpl_SOMEONE_ELSE'},
       'identity does not match the recorded object (id)'],
      [{...base,projectId:'prj_SOMEONE_ELSE'},
       'identity does not match the recorded object (project)'],
      [{...base,meta:{}},'provenance does not match the run (meta)'],
      [{...base,alias:ownUrl},'alias list is missing or malformed'],
      [{...base,aliases:[{alias:ownUrl}]},'populated aliases field'],
      [{...base,alias:[ownUrl,'custom.example.com']},
       'outside the project family: custom.example.com']
    ];
    for(const [i,[rowData,want]] of cases.entries()){
      const f=fixture([object('deployment',deployment,project,
        {target:'preview'})]);
      f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(rowData);
      const out=parse(await f.call('vercel_dev_cleanup',
        {runId,outsideApp:true,confirm:true,
         requestKey:'cleanupAudS0000'+(i+1)}));
      expect(out.confirmed).toBe(false);
      const row=f.rows.get(runId)[0];
      expect(row.status).toBe('blocked');
      expect(row.last_error).toContain(want);
      expect(f.fake.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
      f.fake.verify();
    }
  });
});
