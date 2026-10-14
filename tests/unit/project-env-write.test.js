import {beforeEach,describe,expect,it,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

const project='prj_FAKE_ENV',id='env_FAKE_ABC01',key='PUBLIC_TEST_VALUE';
const connection={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const token={token:'vcp_FAKE_envwrite',account:{
  id:'acct_FAKE',scope:'project',project_id:project,team_id:'team_FAKE'}};
const original={id,projectId:project,key,type:'plain',target:['preview'],updatedAt:100,
  customEnvironmentIds:[],value:'ORIGINAL_FAKE_PUBLIC'};
const setArgs={project,key,mode:'create',targets:['preview'],kind:'Config',
  value:'PUBLIC_FAKE_GOOD',confirm:true,requestKey:'setPreviewFake_01'};
const deleteArgs={project,id,expectedKey:key,expectedUpdatedAt:100,
  outsideApp:true,confirm:true,requestKey:'deleteEnvFake_01'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),audits=[],memo=new Map();
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async row=>audits.push(row),
    requestReplayStore:()=>({
      claim:async({key})=>memo.has(key)?{state:'completed',result:memo.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>{memo.set(key,result);},
      release:async()=>true
    })
  };
  const call=(name,args,c=connection)=>dispatchReadOnlyTool({
    registry,name,args,connection:c,db,fetchImpl:fake.fetch
  });
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,name:'fake-env-project',hasDeployments:false});
  return {fake,call,db,audits,memo};
}
describe('E-1 guarded single-variable environment lifecycle',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(token);});
  it('registers genuine guarded tools with profile exclusions',()=>{
    const set=registry.tools.find(x=>x.name==='vercel_env_set');
    const del=registry.tools.find(x=>x.name==='vercel_env_delete');
    expect(set).toMatchObject({writes:true,guardedWrite:true,
      writeContract:{production:true,targets:true,secretIn:true}});
    expect(del).toMatchObject({writes:true,guardedWrite:true,
      writeContract:{production:true,targets:true}});
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .some(x=>[set.name,del.name].includes(x.name))).toBe(false);
    expect(listMcpTools(registry,{...connection,profile:'everyday'})
      .some(x=>x.name===del.name)).toBe(false);
  });
  it('creates exact preview Config and independently proves the value without leaking it',async()=>{
    const f=fixture();
    f.fake.when('POST','/v10/projects/{idOrName}/env').resolves({created:{id,key,value:'PRIVATE_FAKE_RAW'},failed:[]});
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves({...original,value:setArgs.value});
    const out=parse(await f.call('vercel_env_set',setArgs));
    expect(out).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','POST','GET','GET']);
    const post=f.fake.calls.find(c=>c.method==='POST');
    expect(post.path).toBe('/v10/projects/'+project+'/env');
    expect(post.query.teamId).toBe('team_FAKE');
    expect(post.body).toEqual({key,value:setArgs.value,type:'plain',target:['preview']});
    expect(JSON.stringify(out)).not.toContain(setArgs.value);
    expect(JSON.stringify(f.audits)).not.toContain(setArgs.value);
    expect(JSON.stringify(out)).not.toContain('PRIVATE_FAKE_RAW');
    expect(f.memo.size).toBe(2);
  });
  it('cryptographically generates Secret value, reports metadata only, never echoing private bytes',async()=>{
    const f=fixture();
    f.fake.when('POST','/v10/projects/{idOrName}/env').resolves({created:{id,key},failed:[]});
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves({...original,type:'sensitive',value:'PRIVATE_FAKE_SHOULD_NOT_ECHO'});
    const out=parse(await f.call('vercel_env_set',{
      ...setArgs,kind:undefined,value:undefined,
      generate:{bytes:32,encoding:'base64url'},requestKey:'generateEnvFake_01'
    }));
    expect(out).toMatchObject({status:'applied',confirmed:null});
    const posted=f.fake.calls.find(c=>c.method==='POST').body;
    expect(posted.type).toBe('sensitive');
    expect(posted.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(out)).not.toContain(posted.value);
    expect(JSON.stringify(f.audits)).not.toContain(posted.value);
    expect(JSON.stringify(out)).not.toContain('PRIVATE_FAKE_SHOULD_NOT_ECHO');
  });
  it('updates an explicit same-kind variable only after fresh ID/revision check',async()=>{
    const f=fixture();
    const changed={...original,value:'PUBLIC_FAKE_GOOD',updatedAt:101};
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(original).resolves(original).resolves(changed);
    f.fake.when('PATCH','/v9/projects/{idOrName}/env/{id}').resolves(changed);
    const out=parse(await f.call('vercel_env_set',{
      ...setArgs,mode:'update',id,expectedUpdatedAt:100,
      requestKey:'updateEnvFake_01'}));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.map(c=>c.method)).toEqual(['GET','GET','GET','GET','PATCH','GET','GET']);
    expect(f.fake.calls.find(c=>c.method==='PATCH').body)
      .toEqual({value:setArgs.value,type:'plain',target:['preview']});
    expect(JSON.stringify(out)).not.toContain(setArgs.value);
  });
  it('deletes a preview-only exact environment and verifies provider 404',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(original).resolves(original).rejects(404);
    f.fake.when('DELETE','/v9/projects/{idOrName}/env/{id}')
      .resolves(null,204);
    const out=parse(await f.call('vercel_env_delete',deleteArgs));
    expect(out).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
    const calls=f.fake.calls;
    expect(calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    expect(calls.find(c=>c.method==='DELETE').path)
      .toBe('/v9/projects/'+project+'/env/'+id);
    expect(f.audits).toHaveLength(1);
  });
  it('refuses read-only profiles, protected projects and production target',async()=>{
    const f=fixture();
    expect((await f.call('vercel_env_set',setArgs,
      {...connection,profile:'read_only'})).isError).toBe(true);
    const prod=parse(await f.call('vercel_env_set',{
      ...setArgs,targets:['production']}));
    expect(prod).toMatchObject({status:'refused_by_guard'});
    f.db.listProtectedResources=async()=>[{match:project,note:'protected project'}];
    expect(parse(await f.call('vercel_env_set',setArgs)))
      .toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('does not dispatch malformed values, selectors or secret-kind shortcuts',async()=>{
    for(const bad of [
      {...setArgs,teamId:'team_OTHER'},
      {...setArgs,project:'prj_FOREIGN'},
      {...setArgs,value:'sk_live_fake_supersecret'},
      {...setArgs,kind:'Secret'},
      {...setArgs,targets:[]},
      {...setArgs,targets:['preview','preview']},
      {...setArgs,mode:'update'},
      {...setArgs,kind:'Secret',targets:['development'],value:undefined,
        generate:{bytes:32,encoding:'hex'}},
      {...setArgs,kind:'Secret',value:undefined,pendingInputId:'not-uuid'}
    ]){
      const f=fixture();
      const r=await f.call('vercel_env_set',bad);
      expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.some(c=>c.method==='POST'||c.method==='PATCH')).toBe(false);
    }
  });
  it('denies concurrent revision or target changes before update or deletion',async()=>{
    for(const mode of ['update','delete']){
      const f=fixture();
      const moved={...original,updatedAt:101};
      f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
        .resolves(original).resolves(moved);
      const input=mode==='update'?{...setArgs,mode,id,expectedUpdatedAt:100}:deleteArgs;
      const out=parse(await f.call(mode==='update'?'vercel_env_set':'vercel_env_delete',input));
      expect(out).toMatchObject({status:'refused_by_guard'});
      expect(f.fake.calls.some(c=>['PATCH','DELETE'].includes(c.method))).toBe(false);
    }
  });
  it('does not treat a missing project as proof that an environment was deleted',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}')
      .resolves({id:project}).resolves({id:project}).rejects(404);
    f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
      .resolves(original).resolves(original);
    f.fake.when('DELETE','/v9/projects/{idOrName}/env/{id}').resolves(null,204);
    const out=parse(await f.call('vercel_env_delete',deleteArgs));
    expect(out).toMatchObject({status:'applied',confirmed:null});
  });
  it('dry runs and no-confirm never mutate',async()=>{
    for(const change of [{dryRun:true,confirm:false},{confirm:false}]){
      const f=fixture();
      const out=parse(await f.call('vercel_env_set',{...setArgs,...change}));
      expect(out.status).toBe(change.dryRun?'preview':'needs_confirmation');
      expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
    }
  });
});
