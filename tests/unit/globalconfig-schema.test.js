import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));

const id='ecfg_FAKE_SCHEMA',team='team_FAKE',project='prj_FAKE_APP';
const row={id,slug:'fake-schema',teamId:team,connectedProjects:[],
  itemCount:2,updatedAt:100};
const prior={type:'object',properties:{FLAG:{type:'string'},COUNT:{type:'integer'}},
  required:['FLAG','COUNT'],additionalProperties:false};
const desired={type:'object',properties:{FLAG:{type:'string',minLength:3},
  COUNT:{type:'integer',minimum:0}},
  required:['FLAG','COUNT'],additionalProperties:false};
const values={FLAG:'hello',COUNT:2};
const token={token:'vcp_FAKE_schema',account:{id:'acct_FAKE',
  team_id:team,scope:'team'}};
const conn={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const basic={id,expectedSlug:row.slug,expectedUpdatedAt:100,
  outsideApp:true,confirm:true,requestKey:'schemaWriteFake01'};
const update={...basic,mode:'set',definition:desired};
const remove={...basic,mode:'remove'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture({linked=false,current=prior,items=values}={}){
  const fake=makeFakeVercel(),memo=new Map(),claims=new Set(),audit=[];
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async x=>audit.push(x),requestReplayStore:()=>({
      claim:async({key})=>{
        if(memo.has(key))return {state:'completed',result:memo.get(key)};
        if(claims.has(key))return {state:'pending'};
        claims.add(key);return {state:'claimed',claimId:key};
      },
      complete:async({key,result})=>{claims.delete(key);memo.set(key,result);},
      release:async({key})=>{claims.delete(key);return true;}
    })};
  loadToken.mockResolvedValue(token);
  fake.when('GET','/v1/global-config/{edgeConfigId}')
    .resolves({...row,connectedProjects:linked?[project]:[]});
  fake.when('GET','/v1/global-config/{edgeConfigId}/schema')
    .resolves({definition:current});
  fake.when('GET','/v1/global-config/{edgeConfigId}/items')
    .resolves({items});
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,accountId:team});
  const call=(name,args,c=conn)=>dispatchReadOnlyTool({
    registry,name,args,connection:c,db,fetchImpl:fake.fetch
  });
  const writes=()=>fake.calls.filter(x=>['POST','DELETE'].includes(x.method));
  return {fake,db,audit,call,writes,memo};
}
describe('E-4 Global Config JSON Schema lifecycle',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('exposes exact pinned GET/POST/DELETE and genuine write contracts',()=>{
    expect(validateRequest('global_config_schema_get',{
      path:{edgeConfigId:id},query:{teamId:team}})).toBe(true);
    expect(validateRequest('global_config_schema_set',{
      path:{edgeConfigId:id},query:{teamId:team},
      body:{definition:desired}})).toBe(true);
    expect(validateRequest('global_config_schema_delete',{
      path:{edgeConfigId:id},query:{teamId:team}})).toBe(true);
    expect(listMcpTools(registry,{...conn,profile:'read_only'})
      .some(x=>x.name==='vercel_globalconfig_get_schema')).toBe(true);
    expect(listMcpTools(registry,{...conn,profile:'read_only'})
      .some(x=>x.name==='vercel_globalconfig_set_schema')).toBe(false);
    expect(registry.tools.find(x=>x.name==='vercel_globalconfig_set_schema'))
      .toMatchObject({writes:true,guardedWrite:true,
        writeContract:{production:true,targets:true}});
  });
  it('reads bounded exact-store schema with no credential-shaped provider fields',async()=>{
    const f=fixture();
    const out=parse(await f.call('vercel_globalconfig_get_schema',{id}));
    expect(out).toMatchObject({store:id,hasSchema:true,schema:prior});
    expect(f.fake.calls.map(x=>x.path)).toEqual([
      '/v1/global-config/'+id,'/v1/global-config/'+id+'/schema']);
    const absent=fixture();
    absent.fake.when('GET','/v1/global-config/{edgeConfigId}/schema')
      .rejects(404);
    expect(parse(await absent.call('vercel_globalconfig_get_schema',{id})))
      .toMatchObject({store:id,schema:null,hasSchema:false});
  });
  it('sets a compatible schema, rechecks revision and independently reads back',async()=>{
    const f=fixture();
    f.fake.when('POST','/v1/global-config/{edgeConfigId}/schema')
      .resolves({definition:desired});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/schema')
      .resolves({definition:prior})
      .resolves({definition:prior})
      .resolves({definition:desired});
    const result=parse(await f.call('vercel_globalconfig_set_schema',update));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0]).toMatchObject({method:'POST',path:
      '/v1/global-config/'+id+'/schema',query:{teamId:team},
      body:{definition:desired}});
    expect(JSON.stringify(result)).not.toContain('"hello"');
    expect(f.audit).toHaveLength(1);
  });
  it('removes schema under full profile, recording inverse without mutating items',async()=>{
    const f=fixture();
    f.fake.when('DELETE','/v1/global-config/{edgeConfigId}/schema')
      .resolves(null,204);
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/schema')
      .resolves({definition:prior})
      .resolves({definition:prior})
      .rejects(404);
    const result=parse(await f.call('vercel_globalconfig_set_schema',remove));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].method).toBe('DELETE');
    expect(f.audit[0].inverse).toMatchObject({tool:'vercel_globalconfig_set_schema',
      mode:'set',definition:prior,requiresFreshRevision:true});
  });
  it('dry-run previews incompatible keys without sending a provider write',async()=>{
    const f=fixture();
    const incompatible={...desired,properties:{...desired.properties,
      FLAG:{type:'number'}}};
    const out=parse(await f.call('vercel_globalconfig_set_schema',{
      ...update,dryRun:true,confirm:false,definition:incompatible}));
    expect(out).toMatchObject({status:'preview'});
    expect(JSON.stringify(out)).toContain('FLAG');
    expect(f.writes()).toHaveLength(0);
    expect(parse(await f.call('vercel_globalconfig_set_schema',{
      ...update,definition:incompatible})).status).toBe('refused_by_guard');
    expect(f.writes()).toHaveLength(0);
  });
  it('fails closed on production links, stale revision, protected store and unsafe references',async()=>{
    for(const [opts,a] of [
      [{linked:true},update],
      [{}, {...update,expectedUpdatedAt:101}],
      [{}, {...update,definition:{type:'object',properties:{FLAG:{$ref:'https://other.example/schema'}}}}]
    ]){
      const f=fixture(opts);
      expect(parse(await f.call('vercel_globalconfig_set_schema',a))
        .status).toBe('refused_by_guard');
      expect(f.writes()).toHaveLength(0);
    }
    const f=fixture();
    f.db.listProtectedResources=async()=>[{match:id,note:'protected'}];
    expect(parse(await f.call('vercel_globalconfig_set_schema',update))
      .status).toBe('refused_by_guard');
    const everyday=fixture();
    expect(parse(await everyday.call('vercel_globalconfig_set_schema',remove,
      {...conn,profile:'everyday'})).status).toBe('refused_by_guard');
  });
  it('rejects a competing schema change before confirmed provider dispatch',async()=>{
    const f=fixture();
    const different={...prior,required:['COUNT']};
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/schema')
      .resolves({definition:prior}).resolves({definition:different});
    const out=parse(await f.call('vercel_globalconfig_set_schema',update));
    expect(out.status).toBe('refused_by_guard');
    expect(f.writes()).toHaveLength(0);
  });
});
