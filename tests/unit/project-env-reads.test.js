import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async mod=>({...await mod(),loadToken:vi.fn()}));

const project='prj_FAKE_ENV';
const account={id:'acct_FAKE',team_id:'team_FAKE',scope:'project',project_id:project};
const conn={account:'acct_FAKE',mode:'preview',profile:'read_only',listing:'catalog'};
const secret='vcp_FAKE_SENTINEL_MUST_NEVER_APPEAR';
const rows=[
  {id:'env_FAKE_ALPHA',projectId:project,key:'API_BASE_URL',type:'plain',visibility:'config',
   value:secret,comment:secret,target:['preview','production'],customEnvironmentIds:[],
   createdAt:100,updatedAt:200},
  {id:'env_FAKE_BETA',projectId:project,key:'DATABASE_PASSWORD',type:'encrypted',
   value:secret,description:secret,target:['development'],gitBranch:null,
   customEnvironmentIds:null}
];
const parse=r=>JSON.parse(r.content[0].text);
function fixture({scope='project'}={}){
 const fake=makeFakeVercel();
 const db={getAccountCredential:async()=>({})};
 loadToken.mockResolvedValue({token:'vcp_FAKE_TEST_env',account:{...account,scope}});
 const call=(name,args={},connection=conn)=>dispatchReadOnlyTool({
   registry,name,args,connection,db,fetchImpl:fake.fetch
 });
 fake.when('GET','/v9/projects/{idOrName}').resolves({id:project,name:'demo'});
 fake.when('GET','/v10/projects/{idOrName}/env').resolves({envs:rows});
 fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(rows[1]);
 return {fake,call};
}
describe('E-1 native project env metadata reads never leak values',()=>{
 beforeEach(()=>loadToken.mockReset());
 it('safe list redacts all provider-returned values and comments',async()=>{
   const f=fixture();
   const result=parse(await f.call('vercel_env_list',{}));
   expect(result.items).toHaveLength(2);
   expect(result.items[0]).toMatchObject({key:'API_BASE_URL',kind:'Config',targets:['preview','production']});
   expect(result.items[1]).toMatchObject({key:'DATABASE_PASSWORD',kind:'Secret'});
   expect(result).toMatchObject({project,hasValues:false,completeness:'unverified_provider_page'});
   expect(JSON.stringify(result)).not.toContain(secret);
   expect(JSON.stringify(result)).not.toContain('value');
   expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET']);
   expect(f.fake.calls[1].query).toMatchObject({decrypt:'false',teamId:'team_FAKE'});
   f.fake.verify();
 });
 it('returns only metadata for a provider GET that may contain a decrypted value',async()=>{
   const f=fixture();
   const result=parse(await f.call('vercel_env_get',{id:'env_FAKE_BETA'}));
   expect(result.item).toMatchObject({id:'env_FAKE_BETA',key:'DATABASE_PASSWORD',kind:'Secret'});
   expect(result.hasValues).toBe(false);
   expect(JSON.stringify(result)).not.toContain(secret);
   expect(f.fake.calls[1].path).toBe('/v1/projects/'+project+'/env/env_FAKE_BETA');
 });
 it('exports only sorted .env.example names and no provider values',async()=>{
   const f=fixture();
   const result=parse(await f.call('vercel_env_export_names',{}));
   expect(result.names).toEqual(['API_BASE_URL','DATABASE_PASSWORD']);
   expect(result.example).toBe(['API_BASE_URL=','DATABASE_PASSWORD='].join(String.fromCharCode(10)));
   expect(result.hasValues).toBe(false);
   expect(result.complete).toBe(false);
   expect(JSON.stringify(result)).not.toContain(secret);
 });
 it('refuses project-scope escape before API calls',async()=>{
   const f=fixture();
   const result=await f.call('vercel_env_list',{project:'prj_FAKE_OTHER'});
   expect(result.isError).toBe(true);
   expect(f.fake.calls).toHaveLength(0);
 });
 it('refuses foreign and contradictory provider identities',async()=>{
   for(const bad of [{...rows[0],projectId:'prj_FAKE_OTHER'},
     {...rows[0],key:'UNSAFE=KEY'},
     {...rows[0],id:'../bad'}]){
     const f=fixture();
     f.fake.when('GET','/v10/projects/{idOrName}/env').resolves({envs:[bad]});
     const result=await f.call('vercel_env_list',{});
     expect(result.isError).toBe(true);
   }
   const d=fixture();
   d.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves({...rows[1],id:'env_FAKE_OTHER'});
   expect((await d.call('vercel_env_get',{id:'env_FAKE_BETA'})).isError).toBe(true);
 });
 it('rejects duplicates rather than silently presenting ambiguous keys',async()=>{
   const f=fixture();
   f.fake.when('GET','/v10/projects/{idOrName}/env').resolves({envs:[rows[0],rows[0]]});
   expect((await f.call('vercel_env_list',{})).isError).toBe(true);
 });
 it('prevents invalid branch, filters and unknown args',async()=>{
   for(const args of [{target:'production',gitBranch:'feature/test'},
     {gitBranch:'../../private'},{decrypt:true},{teamId:'team_OTHER'}, {target:'other'}]){
     const f=fixture();
     expect((await f.call('vercel_env_list',args)).isError).toBe(true);
     expect(f.fake.calls).toHaveLength(0);
   }
 });
 it('handles approved preview branch filtering without ever requesting decrypted values',async()=>{
   const f=fixture();
   const result=parse(await f.call('vercel_env_list',{gitBranch:'feature/test',target:'preview'}));
   expect(result.items.map(x=>x.key)).toEqual(['API_BASE_URL']);
   expect(f.fake.calls[1].query).toMatchObject({decrypt:'false',gitBranch:'feature/test'});
 });
});


describe('E-1 explicit environment drift comparison',()=>{
 beforeEach(()=>loadToken.mockReset());
 const both={left:{target:'production'},right:{target:'production'},keys:['API_BASE_URL']};
 it('compares two independently selected config values without exposing either value or digest',async()=>{
   const f=fixture();
   f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves(rows[0]);
   const result=parse(await f.call('vercel_env_compare',both));
   expect(result.comparisons).toEqual([{key:'API_BASE_URL',status:'same'}]);
   expect(result).toMatchObject({hasValues:false,hasDigests:false,complete:false});
   expect(JSON.stringify(result)).not.toContain(secret);
   expect(JSON.stringify(result)).not.toMatch(/[a-f0-9]{64}/i);
   expect(f.fake.calls.filter(x=>x.path.includes('/env/env_FAKE_ALPHA'))).toHaveLength(2);
 });
 it('distinguishes changed Config values while keeping both values private',async()=>{
   const f=fixture();
   f.fake.when('GET','/v1/projects/{idOrName}/env/{id}')
     .resolves({...rows[0],value:'before_FAKE_private'})
     .resolves({...rows[0],value:'after_FAKE_private'});
   const result=parse(await f.call('vercel_env_compare',{
     left:{target:'production'},right:{target:'production'},keys:['API_BASE_URL']}));
   expect(result.comparisons).toEqual([{key:'API_BASE_URL',status:'different'}]);
   expect(JSON.stringify(result)).not.toContain('before_FAKE_private');
   expect(JSON.stringify(result)).not.toContain('after_FAKE_private');
 });
 it('classifies secret kinds without reading their values',async()=>{
   const f=fixture();
   const result=parse(await f.call('vercel_env_compare',{
     left:{target:'development'},right:{target:'development'},keys:['DATABASE_PASSWORD']}));
   expect(result.comparisons).toEqual([{key:'DATABASE_PASSWORD',status:'cannot_compare_secret'}]);
   expect(f.fake.calls.filter(x=>x.path.includes('/env/env_FAKE_BETA'))).toHaveLength(0);
   expect(JSON.stringify(result)).not.toContain(secret);
 });
 it('never declares a missing key when provider-page completion is unknown',async()=>{
   const f=fixture();
   const result=parse(await f.call('vercel_env_compare',{
     left:{target:'production'},right:{target:'development'},keys:['API_BASE_URL']}));
   expect(result.comparisons).toEqual([{key:'API_BASE_URL',status:'inventory_unverified'}]);
   expect(result.complete).toBe(false);
 });
 it('fails closed on a changed or foreign single-value identity',async()=>{
   const f=fixture();
   f.fake.when('GET','/v1/projects/{idOrName}/env/{id}').resolves({...rows[0],projectId:'prj_FAKE_OTHER'});
   expect((await f.call('vercel_env_compare',both)).isError).toBe(true);
 });
 it('refuses missing targets, unknown selectors and overlapping/invalid key sets',async()=>{
   for(const bad of [
     {left:{},right:{target:'production'},keys:['API_BASE_URL']},
     {left:{target:'production',teamId:'team_OTHER'},right:{target:'production'},keys:['API_BASE_URL']},
     {...both,keys:['API_BASE_URL','API_BASE_URL']},
     {...both,keys:['BAD=KEY']},
     {...both,keys:[]},
     {...both,teamId:'team_OTHER'}
   ]){
     const f=fixture();
     expect((await f.call('vercel_env_compare',bad)).isError).toBe(true);
     expect(f.fake.calls).toHaveLength(0);
   }
 });
 it('denies different project scope before accessing provider inventory',async()=>{
   const f=fixture();
   expect((await f.call('vercel_env_compare',{
     left:{project:'prj_FAKE_OTHER',target:'preview'},
     right:{target:'preview'},keys:['API_BASE_URL']})).isError).toBe(true);
   expect(f.fake.calls).toHaveLength(0);
 });
});
