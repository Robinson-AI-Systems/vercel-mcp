import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {apiRead} from '../../src/vercel/api-read-policy.js';
import {makeVercelClient} from '../../src/vercel/client.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'project',project_id:'prj_ONE'};
function fixture(){
 const api=makeFakeVercel();api.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_ONE',accountId:'team_ONE'});
 const ctx={db:{getAccountCredential:async()=>({})},connection:{account:'acct_1',profile:'read_only',mode:'preview'},fetchImpl:api.fetch};
 return {api,ctx,call:a=>apiRead(a,ctx)};
}
const input={op:'listFlagsV2',params:{path:{projectIdOrName:'prj_ONE'}}};
describe('U-1 scope-verified documented metadata reads',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('validates real indexed GET parameters and projects flag metadata only',async()=>{
   const f=fixture();f.api.when('GET','/v2/projects/{projectIdOrName}/feature-flags/flags').resolves({
     flags:[{id:'flag_1',name:'Checkout',projectId:'prj_ONE',value:'private content',rules:[{email:'private@example.com'}]}]});
   const r=await f.call(input);
   expect(r.flags).toEqual([{id:'flag_1',name:'Checkout',projectId:'prj_ONE'}]);
   expect(r.completeness).toBe('unverified_provider_page');
   expect(f.api.calls[1].query).toEqual({limit:'20',teamId:'team_ONE'});
   expect(f.api.calls.every(x=>x.method==='GET')).toBe(true);f.api.verify();
 });
 it('refuses cross-project or cross-team identity before the indexed read',async()=>{
   const f=fixture();await expect(f.call({...input,params:{path:{projectIdOrName:'prj_OTHER'}}})).rejects.toThrow();
   expect(f.api.calls).toHaveLength(0);
   f.api.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_ONE',accountId:'team_OTHER'});
   await expect(f.call(input)).rejects.toThrow(/identity/);expect(f.api.calls).toHaveLength(1);
 });
 it('refuses writes, secrets, unsupported operations and scope overrides without I/O',async()=>{
   const f=fixture();for(const x of [{...input,op:'createFlag'},{...input,op:'getSdkKeys'},
     {...input,op:'getTeam'},{...input,op:'getUser'},{...input,params:{path:{projectIdOrName:'prj_ONE'},query:{teamId:'team_ONE'}}},
     {...input,params:{path:{projectIdOrName:'prj_ONE'},body:{}}}])await expect(f.call(x)).rejects.toThrow();
   expect(f.api.calls).toHaveLength(0);
 });
 it('rejects unknown documented query parameters before a flag provider call',async()=>{
   const f=fixture();await expect(f.call({...input,params:{...input.params,query:{unknown:true}}})).rejects.toThrow(/Unknown API query/);
   expect(f.api.calls).toHaveLength(0);
 });
 it('refuses out-of-scope response identities and redacts unsafe metadata',async()=>{
   const f=fixture();f.api.when('GET','/v2/projects/{projectIdOrName}/feature-flags/flags')
     .resolves({flags:[{id:'flag_1',projectId:'prj_OTHER'}]}).resolves({flags:[{id:'flag_1',name:'vcp_FAKE_unsafe'}]});
   await expect(f.call(input)).rejects.toThrow(/out-of-scope/);
   expect((await f.call(input)).flags[0].name).toBeNull();
 });
 it('caps lists explicitly without returning rules or pretending complete evidence',async()=>{
   const f=fixture();f.api.when('GET','/v2/projects/{projectIdOrName}/feature-flags/flags')
     .resolves({flags:Array.from({length:25},(_,i)=>({id:'flag_'+i,rules:['private']}))});
   const r=await f.call(input);expect(r.flags).toHaveLength(20);expect(r.capped).toBe(true);
   expect(JSON.stringify(r)).not.toContain('private');
 });
 it('returns provider-confirmed opaque flag cursors for a bounded follow-up page',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/projects/{projectIdOrName}/feature-flags/flags')
     .resolves({data:[{id:'flag_1',projectId:'prj_ONE',rules:['private']}],
       pagination:{next:'CURSOR_2',internal:'do not forward'}})
     .resolves({data:[{id:'flag_2',projectId:'prj_ONE'}],pagination:{next:null}});
   const first=await f.call(input);
   expect(first.data).toEqual([{id:'flag_1',projectId:'prj_ONE'}]);
   expect(first.pagination).toEqual({next:'CURSOR_2',completeness:'provider_cursor_only'});
   expect(JSON.stringify(first)).not.toContain('private');
   expect(JSON.stringify(first)).not.toContain('internal');
   const second=await f.call({...input,params:{...input.params,query:{cursor:first.pagination.next}}});
   expect(second.pagination).toMatchObject({next:null});
   expect(f.api.calls.at(-1).query).toEqual({cursor:'CURSOR_2',limit:'20',teamId:'team_ONE'});
 });
 it('rejects unsafe provider cursors and fails closed without reflecting them',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/projects/{projectIdOrName}/feature-flags/flags')
     .resolves({data:[],pagination:{next:{toString:'unsafe'}}})
     .resolves({data:[],pagination:{next:'unsafe'+String.fromCharCode(10)+'value'}})
     .resolves({data:[],pagination:'unknown'});
   for(let i=0;i<3;i++)await expect(f.call(input)).rejects.toThrow(/pagination|cursor/);
   expect(f.api.calls).toHaveLength(6);
 });
 it('does not invent a continuation when the provider omits pagination',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/projects/{projectIdOrName}/feature-flags/flags').resolves({data:[{id:'flag_1'}]});
   const value=await f.call(input);
   expect(value.pagination).toBeUndefined();
   expect(value.completeness).toBe('unverified_provider_page');
 });
 it('transport cannot use an indexed write or foreign team even when called directly',async()=>{
   const f=fixture(),client=makeVercelClient({token:'vcp_FAKE',account,fetchImpl:f.api.fetch});
   await expect(client.request('api:createFlag',{path:{projectIdOrName:'prj_ONE'}})).rejects.toThrow(/GET or HEAD/);
   await expect(client.request('api:getTeam',{path:{teamId:'team_OTHER'}})).rejects.toThrow(/another team/);
   expect(f.api.calls).toHaveLength(0);
 });
 it('enforces HTTP body bounds for indexed reads including malformed JSON',async()=>{
   const client=makeVercelClient({token:'vcp_FAKE',account,fetchImpl:async()=>new Response('vcp_FAKE_private',{
     status:200,headers:{'content-type':'application/json','content-length':'65537'}})});
   await expect(client.request('api:listFlagsV2',{path:{projectIdOrName:'prj_ONE'}})).rejects.toThrow(/unsafe byte length/);
 });
});
