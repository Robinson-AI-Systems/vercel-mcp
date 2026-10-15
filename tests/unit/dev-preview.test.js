import {beforeEach,describe,it,expect,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
import {planPreviewEnv} from '../../src/tools/dev-preview-env.js';
import {planPreviewAlias} from '../../src/tools/dev-preview-alias.js';
import {context} from '../../src/tools/dev-preview-common.js';
vi.mock('../../src/vercel/tokens.js',async fn=>({...await fn(),loadToken:vi.fn()}));
const account='acct_FAKE_V2',team='team_FAKE_V2',project='prj_FAKE_V2';
const deployment='dpl_FAKE_V2_PREVIEW',runId='run_20261014_abcd1234';
const owner={account,mode:'preview',profile:'full',listing:'catalog'};
const parse=out=>JSON.parse(out.content?.[0]?.text??'{}');
const object=(type,id,detail={})=>({object_type:type,object_id:id,
  project_id:project,detail,status:'active',created_at:new Date().toISOString()});
const projectRow={id:project,name:'test-preview',accountId:team,
  link:{type:'github',org:'synthetic',repo:'preview'}};
function fixture(items=[],row=projectRow){
  const fake=makeFakeVercel(),audit=[],runs=new Map(),objects=new Map(),receipts=new Map();
  runs.set(runId,{id:runId,status:'active',description:'Synthetic test'});
  objects.set(runId,structuredClone(items));
  const db={
    getAccountCredential:async()=>({}),
    getVercelAccountSafe:async()=>({id:account,spend_limit_cents:0}),
    getTodaySpendCents:async()=>0,
    insertOneTimeSecret:async row=>{receipts.set(row.id,row);},
    consumeOneTimeSecret:async({id,account:a})=>{
      const x=receipts.get(id);
      if(!x || (x.account!==a && x.vercel_account!==a))return null;
      receipts.delete(id);return {...x,vercel_account:a};
    },
    recordChange:async e=>audit.push(e),
    listProtectedResources:async()=>[],
    getDevRun:async({id,account:a})=>a===account?runs.get(id)??null:null,
    createDevRun:async({id,description})=>{
      const exists=runs.has(id);
      if(!exists)runs.set(id,{id,status:'active',description});
      return {id,created:!exists};
    },
    listDevRunObjects:async({id,account:a})=>a===account?structuredClone(objects.get(id)??[]):[],
    addDevRunObject:async({id,type,objectId,projectId,detail})=>{
      if(!objects.has(id))objects.set(id,[]);
      if(objects.get(id).some(x=>x.object_type===type&&x.object_id===objectId))
        throw new TypeError('Duplicated run object');
      objects.get(id).push({object_type:type,object_id:objectId,
        project_id:projectId,detail,status:'active',created_at:new Date().toISOString()});
      return true;
    },
    setDevRunObjectOutcome:async({id,type,objectId,status,error})=>{
      const x=objects.get(id)?.find(x=>x.object_type===type&&x.object_id===objectId);
      if(!x)return false;x.status=status;x.last_error=error;return true;
    },
    completeDevRunCleanup:async({id})=>{
      if(!objects.get(id).every(x=>x.status==='cleaned'))return false;
      runs.get(id).status='cleaned';return true;
    },
    requestReplayStore:()=>({
      claim:async({key})=>({state:'claimed',claimId:key}),
      complete:async()=>true,release:async()=>true
    })
  };
  const call=(name,args={},conn=owner,fetchImpl=fake.fetch,env={})=>
    dispatchReadOnlyTool({registry,name,args,connection:conn,db,fetchImpl,env});
  fake.when('GET','/v9/projects/{idOrName}').resolves(row);
  return {call,db,audit,fake,runs,objects,receipts};
}
describe('V-2 owned branch, preview env, alias and bypass',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({
    token:'vcp_FAKE_V2_TOKEN',account:{id:account,scope:'team',team_id:team}
  });});
  it('registers four guarded writes with accurate access and metered classifications',()=>{
    for(const name of ['vercel_dev_preview_branch','vercel_dev_wire_preview_env',
      'vercel_dev_alias_preview','vercel_dev_create_bypass']){
      const tool=registry.tools.find(t=>t.name===name);
      expect(tool).toMatchObject({writes:true,guardedWrite:true,
        writeContract:{production:true,targets:true}});
      expect(listMcpTools(registry,{profile:'read_only'}).some(t=>t.name===name))
        .toBe(false);
    }
    expect(registry.tools.find(t=>t.name==='vercel_dev_preview_branch').writeContract.spend).toBe(true);
    expect(registry.tools.find(t=>t.name==='vercel_dev_create_bypass').writeContract)
      .toMatchObject({access:true,secretOut:true});
  });
  it('refuses every V-2 tool from production before any provider requests',async()=>{
    const f=fixture();
    const common={runId,project,confirm:true,outsideApp:true};
    for(const [name,a] of [
      ['vercel_dev_preview_branch',{gitRef:'feature/test',gitSha:'a'.repeat(40)}],
      ['vercel_dev_wire_preview_env',{vars:[{key:'EXAMPLE',value:'public-demo'}]}],
      ['vercel_dev_alias_preview',{deployment,alias:'rtc-run-20261014-abcd1234-test.vercel.app'}],
      ['vercel_dev_create_bypass',{note:'Synthetic check'}]
    ]){
      const x=parse(await f.call(name,{...common,...a},{...owner,mode:'production'}));
      expect(x.status).toBe('refused_by_guard');
    }
    expect(f.fake.calls).toHaveLength(0);
  });
  it('refuses costly/no-preview branch automatically, without any POST',async()=>{
    const f=fixture();
    const base={runId,project,gitSha:'a'.repeat(40),confirm:true,
      requestKey:'newPreviewBuild01'};
    const denied=parse(await f.call('vercel_dev_preview_branch',
      {...base,gitRef:'ai/agent-build'}));
    expect(denied.status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
    const deniedCost=parse(await f.call('vercel_dev_preview_branch',
      {...base,gitRef:'feature/isolated'}));
    expect(deniedCost.status).toBe('refused_by_guard');
    expect(JSON.stringify(deniedCost)).toMatch(/Unbounded|ceiling/i);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('builds the V-2 preview env plan with exact run, provider and bounded inventory',async()=>{
    const f=fixture();
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves({envs:[],pagination:{next:null,count:0}});
    const args={runId,project,vars:[{key:'DEMO_PREVIEW_ONLY',value:'synthetic-value-123'}]};
    const p=await planPreviewEnv(args,context({db:f.db,connection:owner,
      env:{},fetchImpl:f.fake.fetch}));
    expect(p).toMatchObject({project,runId,priorCount:0,
      planned:[{key:'DEMO_PREVIEW_ONLY',target:['preview'],type:'encrypted'}]});
    f.fake.verify();
  });
  it('builds the V-2 preview alias plan only for absent recorded deployment',async()=>{
    const name='rtc-'+runId.replaceAll('_','-')+'-preview.vercel.app';
    const f=fixture([object('deployment',deployment)]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      uid:deployment,projectId:project,target:'preview',readyState:'READY'});
    f.fake.when('GET','/v4/aliases/{idOrAlias}').rejects(404);
    const p=await planPreviewAlias({runId,project,deployment,alias:name},
      context({db:f.db,connection:owner,env:{},fetchImpl:f.fake.fetch}));
    expect(p).toMatchObject({project,runId,deployment,alias:name});
    f.fake.verify();
  });
  it('validates one preview-only env body and never exposes the inline source value',async()=>{
    const f=fixture();
    const source='synthetic-value-123';
    const args={runId,project,confirm:true,requestKey:'wirePreviewEnv01',
      vars:[{key:'DEMO_PREVIEW_ONLY',value:source}]};
    const created={id:'env_FAKE_V2_001',key:'DEMO_PREVIEW_ONLY',
      type:'encrypted',target:['preview'],comment:'rtc_run='+runId};
    const initial={envs:[],pagination:{next:null,count:0}};
    const complete={envs:[created],pagination:{next:null,count:1}};
    f.fake.when('GET','/v10/projects/{idOrName}/env')
      .resolves(initial).resolves(initial).resolves(initial).resolves(complete);
    f.fake.when('POST','/v10/projects/{idOrName}/env')
      .resolves({created});
    const result=parse(await f.call('vercel_dev_wire_preview_env',args));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.objects.get(runId).find(x=>x.object_type==='env').object_id)
      .toBe(created.id);
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(1);
    const post=f.fake.calls.find(x=>x.method==='POST');
    expect(f.fake.calls.filter(c=>c.path.endsWith('/env')&&c.method==='GET')
      .every(c=>!Object.hasOwn(c.query,'limit'))).toBe(true);
    expect(post.body).toMatchObject({key:'DEMO_PREVIEW_ONLY',value:source,
      type:'encrypted',target:['preview'],comment:'rtc_run='+runId});
    expect(JSON.stringify(result)+JSON.stringify(f.audit)+JSON.stringify(f.objects.get(runId)))
      .not.toContain(source);
    f.fake.verify();
  });
  it('rejects overwrite, production/invalid value sources and duplicate env keys',async()=>{
    const f=fixture();
    const initial={envs:[{id:'env_EXISTING',key:'EXISTING',target:['preview']}],
      pagination:{next:null,count:1}};
    f.fake.when('GET','/v10/projects/{idOrName}/env').resolves(initial);
    for(const args of [
      {runId,project,vars:[{key:'EXISTING',value:'demo'}]},
      {runId,project,vars:[{key:'X',value:'demo',generate:true}]},
      {runId,project,vars:[{key:'X',value:'demo'},{key:'X',value:'demo'}]},
      {runId,project,vars:[{key:'X',value:'demo',target:['production']}]}
    ]){
      const result=parse(await f.call('vercel_dev_wire_preview_env',
        {...args,confirm:true,requestKey:'badEnvAttempt01'}));
      expect(result.status).toBe('refused_by_guard');
    }
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('assigns only an absent run-owned preview alias with explicit owner check',async()=>{
    const name='rtc-'+runId.replaceAll('_','-')+'-preview.vercel.app';
    const f=fixture([object('deployment',deployment,{target:'preview'})]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      uid:deployment,projectId:project,target:'preview',readyState:'READY'});
    f.fake.when('GET','/v4/aliases/{idOrAlias}')
      .rejects(404).rejects(404)
      .resolves({uid:'alias_FAKE_V2',alias:name,deploymentId:deployment});
    f.fake.when('POST','/v2/deployments/{id}/aliases')
      .resolves({uid:'alias_FAKE_V2',alias:name});
    const out=parse(await f.call('vercel_dev_alias_preview',{
      runId,project,deployment,alias:name,confirm:true,requestKey:'assignPreviewAlias01'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const writes=f.fake.calls.filter(x=>x.method==='POST');
    expect(writes).toHaveLength(1);
    expect(writes[0].body.alias).toBe(name);
    expect(f.objects.get(runId).some(o=>o.object_type==='alias'&&
      o.object_id==='alias_FAKE_V2')).toBe(true);
    f.fake.verify();
  });
  it('does not silently move an existing alias, even for the same deployment',async()=>{
    const name='rtc-'+runId.replaceAll('_','-')+'-preview.vercel.app';
    const f=fixture([object('deployment',deployment)]);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves({
      uid:deployment,projectId:project,target:'preview',readyState:'READY'});
    f.fake.when('GET','/v4/aliases/{idOrAlias}')
      .resolves({uid:'alias_EXISTING',alias:name,deploymentId:deployment});
    const out=parse(await f.call('vercel_dev_alias_preview',{
      runId,project,deployment,alias:name,confirm:true}));
    expect(out.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    f.fake.verify();
  });
  it('refuses a project-wide bypass when it is not an owned scratch project',async()=>{
    const f=fixture([object('deployment',deployment)]);
    const out=parse(await f.call('vercel_dev_create_bypass',{
      runId,project,note:'Synthetic test bypass',confirm:true}));
    expect(out.status).toBe('refused_by_guard');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('issues bypass only on a provably isolated scratch project and hides the value',async()=>{
    const name='rtc-'+runId.replaceAll('_','-')+'-static-site';
    const row={...projectRow,name,productionDeployment:null,
      protectionBypass:{}};
    const f=fixture([object('project',project,{name})],row);
    f.fake.when('GET','/v7/deployments').resolves({
      deployments:[],pagination:{count:0,next:null}});
    f.fake.when('GET','/v9/projects/{idOrName}/domains').resolves({
      domains:[],pagination:{count:0,next:null}});
    let generated;
    const fetchImpl=async(input,init={})=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      const method=init.method??(input instanceof Request?input.method:'GET');
      if(method==='PATCH'&&url.pathname.endsWith('/protection-bypass')){
        const body=JSON.parse(init.body??'{}');
        generated=body.generate?.secret;
        return new Response(JSON.stringify({protectionBypass:{
          [generated]:{scope:'automation-bypass',createdAt:1,createdBy:'owner'}
        }}),{status:200,headers:{'content-type':'application/json'}});
      }
      return f.fake.fetch(input,init);
    };
    const out=parse(await f.call('vercel_dev_create_bypass',
      {runId,project,note:'Synthetic isolation proof',confirm:true,
        requestKey:'ownerBypassOnly01'},owner,fetchImpl,
      {TOKEN_ENCRYPTION_KEY:'00'.repeat(32)}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(generated).toMatch(/^[a-z0-9]{32}$/);
    expect(out.ownerRevealRef).toBeDefined();
    expect(f.receipts.size).toBe(1);
    expect(f.objects.get(runId).some(o=>o.object_type==='bypass'&&
      o.detail.ciphertext.startsWith('v1.'))).toBe(true);
    expect(JSON.stringify(out)+JSON.stringify(f.audit)+
      JSON.stringify(f.objects.get(runId))).not.toContain(generated);
    expect(f.fake.calls.filter(x=>x.method==='POST'||x.method==='PATCH')).toHaveLength(0);
    f.fake.verify();
  });
  it('never issues project-wide bypass when any deployment is production',async()=>{
    const name='rtc-'+runId.replaceAll('_','-')+'-static-site';
    const f=fixture([object('project',project,{name})],{...projectRow,name});
    f.fake.when('GET','/v7/deployments').resolves({
      deployments:[{id:'dpl_LIVE',projectId:project,target:'production'}],
      pagination:{count:1,next:null}});
    f.fake.when('GET','/v9/projects/{idOrName}/domains').resolves({
      domains:[],pagination:{count:0,next:null}});
    const out=parse(await f.call('vercel_dev_create_bypass',
      {runId,project,note:'Must refuse live',confirm:true}));
    expect(out.status).toBe('refused_by_guard');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('pinned Vercel env, alias and bypass operation schemas are validated',()=>{
    expect(validateRequest('project_env_create',{
      path:{idOrName:project},query:{teamId:team},body:{
        key:'TEST_SOURCE',value:'synthetic-source',type:'encrypted',
        target:['preview'],comment:'rtc_run='+runId
      }})).toBe(true);
    expect(validateRequest('release_alias_assign',{
      path:{id:deployment},query:{teamId:team},
      body:{alias:'rtc-run-20261014-abcd1234-preview.vercel.app'}})).toBe(true);
    expect(validateRequest('project_protection_bypass_update',{
      path:{idOrName:project},query:{teamId:team},
      body:{generate:{secret:'a'.repeat(32),note:'synthetic'}}})).toBe(true);
  });
});
