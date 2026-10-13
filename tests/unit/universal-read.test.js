import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {apiRead} from '../../src/vercel/api-read-policy.js';
import {makeVercelClient} from '../../src/vercel/client.js';
import {documentedRead} from '../../src/vercel/openapi-validation.js';
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
 it('reads a bounded team flag inventory only after each project belongs to the stored team',async()=>{
   const f=fixture();loadToken.mockResolvedValue({token:'vcp_FAKE',
     account:{id:'acct_1',team_id:'team_ONE',scope:'team',project_id:null}});
   const documented=documentedRead('listTeamFlagsV2');
   f.api.when('GET',documented.path).resolves({
     data:[{id:'flag_1',projectId:'prj_ONE',environments:{secrets:['hidden']}},
       {id:'flag_2',projectId:'prj_TWO',rules:['never show']}],
     pagination:{next:'CURSOR_NEXT',debug:'private'}});
   f.api.when('GET','/v9/projects/{idOrName}')
     .resolves({id:'prj_ONE',accountId:'team_ONE'})
     .resolves({id:'prj_TWO',accountId:'team_ONE'});
   const out=await f.call({op:'listTeamFlagsV2',params:{path:{}}});
   expect(out.data).toEqual([{id:'flag_1',projectId:'prj_ONE'},{id:'flag_2',projectId:'prj_TWO'}]);
   expect(out.pagination.next).toBe('CURSOR_NEXT');
   expect(JSON.stringify(out)).not.toMatch(/hidden|never show|private/);
   expect(f.api.calls[0].query).toMatchObject({limit:'5'});
   expect(f.api.calls[0].params.teamId).toBe('team_ONE');
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','GET']);
   f.api.verify();
 });
 it('denies team-wide reads from project-only credentials and caller scope overrides',async()=>{
   const f=fixture();
   await expect(f.call({op:'listTeamFlagsV2',params:{path:{}}})).rejects.toThrow(/team connection/);
   await expect(f.call({op:'listTeamFlagsV2',params:{path:{projectIdOrName:'prj_ONE'}}}))
     .rejects.toThrow(/no project path/);
   await expect(f.call({op:'listTeamFlagsV2',params:{path:{},query:{limit:6}}}))
     .rejects.toThrow(/limited to five/);
   await expect(f.call({op:'listTeamFlagsV2',params:{path:{},query:{teamId:'team_TWO'}}}))
     .rejects.toThrow(/Team authority/);
   expect(f.api.calls).toHaveLength(0);
 });
 it('refuses a foreign, missing or unverifiable project from team-wide flag results',async()=>{
   const f=fixture();loadToken.mockResolvedValue({token:'vcp_FAKE',
     account:{id:'acct_1',team_id:'team_ONE',scope:'team'}});
   const documented=documentedRead('listTeamFlagsV2');
   f.api.when('GET',documented.path)
     .resolves({data:[{id:'a',projectId:'prj_TWO'}],pagination:{next:null}})
     .resolves({data:[{id:'a',projectId:'prj_ONE',teamId:'team_TWO'}],pagination:{next:null}})
     .resolves({data:[{id:'a'}],pagination:{next:null}});
   f.api.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_TWO',accountId:'team_TWO'});
   for(let i=0;i<3;i++)await expect(f.call({op:'listTeamFlagsV2',params:{path:{}}}))
     .rejects.toThrow(/foreign project|identity/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','GET','GET']);
 });
 it('refuses oversized or malformed team pages instead of silently truncating',async()=>{
   const f=fixture();loadToken.mockResolvedValue({token:'vcp_FAKE',
     account:{id:'acct_1',team_id:'team_ONE',scope:'team'}});
   f.api.when('GET',documentedRead('listTeamFlagsV2').path)
     .resolves({data:Array.from({length:6},(_,i)=>({id:'f_'+i,projectId:'prj_ONE'})),pagination:{next:null}})
     .resolves({data:[],pagination:'missing'});
   for(let i=0;i<2;i++)await expect(f.call({op:'listTeamFlagsV2',params:{path:{}}}))
     .rejects.toThrow(/bounded team flag page/);
   expect(f.api.calls).toHaveLength(2);
 });
 it('reads only scoped deployment flag status counts after provider deployment proof',async()=>{
   const f=fixture(),deployment='dpl_ABC123';
   f.api.when('GET','/v13/deployments/{idOrUrl}')
     .resolves({uid:deployment,projectId:'prj_ONE'});
   f.api.when('GET',documentedRead('getDeploymentFeatureFlags').path)
     .resolves({flags:[{value:'private',targeting:{token:'never show'}},{}],
       status:{deploymentId:deployment,projectId:'prj_ONE',flagCount:2}});
   const value=await f.call({op:'getDeploymentFeatureFlags',
     params:{path:{deploymentId:deployment}}});
   expect(value).toMatchObject({projectId:'prj_ONE',deploymentId:deployment,observedFlags:2,reportedFlagCount:2});
   expect(JSON.stringify(value)).not.toMatch(/private|never show|"targeting":/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','GET']);
   f.api.verify();
 });
 it('requires affirmative selected team ownership before any deployment-flag request',async()=>{
   const f=fixture(),deployment='dpl_ABC123';
   f.api.when('GET','/v9/projects/{idOrName}')
     .resolves({id:'prj_ONE'})
     .resolves({id:'prj_ONE',accountId:'team_OTHER'})
     .resolves({id:'prj_ONE',accountId:'team_ONE'});
   f.api.when('GET','/v13/deployments/{idOrUrl}')
     .resolves({uid:deployment,projectId:'prj_ONE'});
   f.api.when('GET',documentedRead('getDeploymentFeatureFlags').path)
     .resolves({flags:[],status:{deploymentId:deployment,projectId:'prj_ONE',flagCount:0}});
   const args={op:'getDeploymentFeatureFlags',params:{path:{deploymentId:deployment}}};
   for(let i=0;i<2;i++)await expect(f.call(args)).rejects.toThrow(/team identity/);
   expect(f.api.calls).toHaveLength(2);
   expect(f.api.calls.every(x=>x.path==='/v9/projects/prj_ONE')).toBe(true);
   expect((await f.call(args)).reportedFlagCount).toBe(0);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','GET','GET','GET']);
   f.api.verify();
 });
 it('refuses deployment flag reads from team-only or foreign project credentials',async()=>{
   const deployment='dpl_ABC123';
   const f=fixture();loadToken.mockResolvedValue({token:'vcp_FAKE',
     account:{id:'acct_1',team_id:'team_ONE',scope:'team'}});
   await expect(f.call({op:'getDeploymentFeatureFlags',
     params:{path:{deploymentId:deployment}}})).rejects.toThrow(/exact project connection/);
   expect(f.api.calls).toHaveLength(0);
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});
   f.api.when('GET','/v13/deployments/{idOrUrl}')
     .resolves({uid:deployment,projectId:'prj_OTHER'});
   await expect(f.call({op:'getDeploymentFeatureFlags',
     params:{path:{deploymentId:deployment}}})).rejects.toThrow(/identity/);
   expect(f.api.calls).toHaveLength(2);
 });
 it('refuses mismatched deployment flag response status before projecting counts',async()=>{
   const f=fixture(),deployment='dpl_ABC123';
   f.api.when('GET','/v13/deployments/{idOrUrl}')
     .resolves({uid:deployment,projectId:'prj_ONE'});
   f.api.when('GET',documentedRead('getDeploymentFeatureFlags').path)
     .resolves({flags:[],status:{deploymentId:'dpl_WRONG',projectId:'prj_ONE'}})
     .resolves({flags:[],status:{deploymentId:deployment,projectId:'prj_OTHER'}})
     .resolves({flags:Array.from({length:101},()=>({})),
       status:{deploymentId:deployment,projectId:'prj_ONE'}});
   for(let i=0;i<3;i++)await expect(f.call({op:'getDeploymentFeatureFlags',
     params:{path:{deploymentId:deployment}}})).rejects.toThrow(/status identity or bound/);
   expect(f.api.calls).toHaveLength(9);
 });
 it('denies malformed deployment identifiers and query authority before provider I/O',async()=>{
   const f=fixture();
   for(const args of [
     {op:'getDeploymentFeatureFlags',params:{path:{deploymentId:'not-a-deployment'}}},
     {op:'getDeploymentFeatureFlags',params:{path:{deploymentId:'dpl_ABC123'},query:{slug:'someone'}}},
     {op:'getDeploymentFeatureFlags',params:{path:{deploymentId:'dpl_ABC123'},query:{teamId:'team_OTHER'}}}
   ])await expect(f.call(args)).rejects.toThrow();
   expect(f.api.calls).toHaveLength(0);
 });
 it('projects only the documented flag-capacity counters for a verified project',async()=>{
   const f=fixture();f.api.when('GET',documentedRead('getFlagSettings').path)
     .resolves({projectId:'prj_ONE',enabled:true,
       metadata:{activeFlagCount:7,archivedFlagCount:2,segmentCount:3,packSizeInBytes:1280,
         internal:'private'},
       entities:[{id:'secret'}],environments:['private-env'],typeName:'settings'});
   const value=await f.call({op:'getFlagSettings',params:{path:{projectIdOrName:'prj_ONE'}}});
   expect(value).toMatchObject({projectId:'prj_ONE',enabled:true,
     metadata:{activeFlagCount:7,archivedFlagCount:2,segmentCount:3,packSizeInBytes:1280}});
   const serialized=JSON.stringify(value);
   expect(serialized).not.toMatch(/"entities"|"environments"|"internal"|private-env|"typeName"/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET']);
   f.api.verify();
 });
 it('rejects malformed, negative, fractional or out-of-project flag capacity data',async()=>{
   const f=fixture(),path=documentedRead('getFlagSettings').path;
   const valid={projectId:'prj_ONE',enabled:true,
     metadata:{activeFlagCount:1,archivedFlagCount:2,segmentCount:3,packSizeInBytes:4}};
   f.api.when('GET',path)
     .resolves({...valid,projectId:'prj_TWO'})
     .resolves({...valid,metadata:{...valid.metadata,activeFlagCount:-1}})
     .resolves({...valid,metadata:{...valid.metadata,segmentCount:1.5}})
     .resolves({...valid,metadata:{...valid.metadata,packSizeInBytes:'hidden'}})
     .resolves({...valid,metadata:null});
   for(let i=0;i<5;i++)await expect(f.call({op:'getFlagSettings',
     params:{path:{projectIdOrName:'prj_ONE'}}})).rejects.toThrow(/metadata|metric/);
   expect(f.api.calls).toHaveLength(10);
 });
 it('requires an exact stored project before requesting flag capacity settings',async()=>{
   const f=fixture();
   await expect(f.call({op:'getFlagSettings',
     params:{path:{projectIdOrName:'prj_OTHER'}}})).rejects.toThrow();
   expect(f.api.calls).toHaveLength(0);
 });
 it('lists only bounded verified segment identities without user targeting or memberships',async()=>{
   const f=fixture();
   f.api.when('GET',documentedRead('listFlagSegments').path).resolves({segments:[
     {id:'seg_1',projectId:'prj_ONE',typeName:'segment',label:'Beta users',
       slug:'beta',createdBy:'user_private',usedByFlags:['flag_private'],
       data:{include:{user:{id:[{value:'private_user'}]}},rules:[{rhs:'private-email'}]}},
     {id:'seg_2',projectId:'prj_ONE',label:'Internal'}]});
   const result=await f.call({op:'listFlagSegments',params:{path:{projectIdOrName:'prj_ONE'}}});
   expect(result.segments).toEqual([
     {id:'seg_1',projectId:'prj_ONE',label:'Beta users',slug:'beta'},
     {id:'seg_2',projectId:'prj_ONE',label:'Internal'}]);
   expect(result.observedCount).toBe(2);
   expect(JSON.stringify(result)).not.toMatch(/private|include|usedByFlags|rules/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET']);
   f.api.verify();
 });
 it('gets a segment only by exact ID, never by a matching slug assumption',async()=>{
   const f=fixture();
   f.api.when('GET',documentedRead('getFlagSegment').path)
     .resolves({id:'seg_1',projectId:'prj_ONE',label:'Beta',
       data:{exclude:{users:['private']}}})
     .resolves({id:'seg_1',projectId:'prj_ONE',label:'Beta',data:{rules:['private']}});
   const args={op:'getFlagSegment',params:{path:{projectIdOrName:'prj_ONE',segmentIdOrSlug:'seg_1'}}};
   const value=await f.call(args);
   expect(value.segment).toEqual({id:'seg_1',projectId:'prj_ONE',label:'Beta'});
   expect(JSON.stringify(value)).not.toMatch(/exclude|private|rules/);
   await expect(f.call({...args,params:{path:{...args.params.path,segmentIdOrSlug:'beta'}}}))
     .rejects.toThrow(/Exact provider segment ID/);
   f.api.verify();
 });
 it('refuses foreign, missing, duplicate and oversized segment inventories',async()=>{
   const f=fixture();
   f.api.when('GET',documentedRead('listFlagSegments').path)
     .resolves({segments:[{id:'seg_1',projectId:'prj_OTHER'}]})
     .resolves({segments:[{id:'seg_1'}]})
     .resolves({segments:[{id:'seg_1',projectId:'prj_ONE'},{id:'seg_1',projectId:'prj_ONE'}]})
     .resolves({segments:Array.from({length:21},(_,i)=>({id:'seg_'+i,projectId:'prj_ONE'}))})
     .resolves({segments:[],data:[]});
   for(let i=0;i<5;i++)await expect(f.call({op:'listFlagSegments',
     params:{path:{projectIdOrName:'prj_ONE'}}})).rejects.toThrow(/segment/);
   expect(f.api.calls).toHaveLength(10);
 });
 it('refuses segment metadata expansion and caller team overrides before provider IO',async()=>{
   const f=fixture();
   for(const args of [
     {op:'listFlagSegments',params:{path:{projectIdOrName:'prj_ONE'},query:{withMetadata:true}}},
     {op:'getFlagSegment',params:{path:{projectIdOrName:'prj_ONE',segmentIdOrSlug:'seg_1'},query:{teamId:'team_OTHER'}}}
   ])await expect(f.call(args)).rejects.toThrow();
   expect(f.api.calls).toHaveLength(0);
 });
 it('lists flag revision identities after independently verifying exact flag/project identity',async()=>{
   const f=fixture();
   f.api.when('GET',documentedRead('getFlag').path)
     .resolves({id:'flag_1',projectId:'prj_ONE',environments:{private:true}});
   f.api.when('GET',documentedRead('listFlagVersions').path)
     .resolves({versions:[{id:'ver_1',flagId:'flag_1',revision:3,createdAt:123456,
       data:{variants:[{value:'private variant'}]},message:'private message'}],
       pagination:{next:'CURSOR_PAGE_2',debug:'private'}});
   const value=await f.call({op:'listFlagVersions',
     params:{path:{projectIdOrName:'prj_ONE',flagIdOrSlug:'flag_1'}}});
   expect(value.versions).toEqual([{id:'ver_1',flagId:'flag_1',revision:3,createdAt:123456}]);
   expect(value.pagination.next).toBe('CURSOR_PAGE_2');
   expect(JSON.stringify(value)).not.toMatch(/private variant|private message|"data"|"debug"/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','GET']);
   f.api.verify();
 });
 it('rejects a foreign/ambiguous flag before requesting revision history',async()=>{
   const f=fixture();
   f.api.when('GET',documentedRead('getFlag').path)
     .resolves({id:'flag_2',projectId:'prj_ONE'})
     .resolves({id:'flag_1',projectId:'prj_OTHER'});
   for(let i=0;i<2;i++)await expect(f.call({op:'listFlagVersions',
     params:{path:{projectIdOrName:'prj_ONE',flagIdOrSlug:'flag_1'}}}))
     .rejects.toThrow(/identity/);
   expect(f.api.calls).toHaveLength(4);
 });
 it('refuses malformed, oversized, duplicate and out-of-flag version pages',async()=>{
   const f=fixture();
   f.api.when('GET',documentedRead('getFlag').path)
     .resolves({id:'flag_1',projectId:'prj_ONE'});
   const ver={id:'ver_1',flagId:'flag_1',revision:3,createdAt:1234};
   f.api.when('GET',documentedRead('listFlagVersions').path)
     .resolves({versions:[{...ver,flagId:'flag_2'}],pagination:{}})
     .resolves({versions:[{...ver,revision:-1}],pagination:{}})
     .resolves({versions:[ver,ver],pagination:{}})
     .resolves({versions:Array.from({length:21},(_,i)=>({...ver,id:'ver_'+i})),pagination:{}})
     .resolves({versions:[ver],pagination:'unsafe'});
   for(let i=0;i<5;i++)await expect(f.call({op:'listFlagVersions',
     params:{path:{projectIdOrName:'prj_ONE',flagIdOrSlug:'flag_1'}}}))
     .rejects.toThrow(/version|history/);
   expect(f.api.calls).toHaveLength(15);
 });
 it('rejects revision history scope overrides before making provider calls',async()=>{
   const f=fixture();
   for(const args of [
     {op:'listFlagVersions',params:{path:{projectIdOrName:'prj_OTHER',flagIdOrSlug:'flag_1'}}},
     {op:'listFlagVersions',params:{path:{projectIdOrName:'prj_ONE',flagIdOrSlug:'flag_1'},query:{teamId:'team_TWO'}}}
   ])await expect(f.call(args)).rejects.toThrow();
   expect(f.api.calls).toHaveLength(0);
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
 it('requires affirmative project-team ownership on both team and project connections',async()=>{
   const f=fixture(),path=documentedRead('listFlagsV2').path;
   loadToken.mockResolvedValue({token:'vcp_FAKE',
     account:{id:'acct_1',team_id:'team_ONE',scope:'team',project_id:null}});
   f.api.when('GET','/v9/projects/{idOrName}')
     .resolves({id:'prj_ONE'})
     .resolves({id:'prj_ONE',accountId:'team_OTHER'})
     .resolves({id:'prj_ONE',accountId:'team_ONE'});
   f.api.when('GET',path).resolves({data:[{id:'flag_1',projectId:'prj_ONE'}]});
   for(let i=0;i<2;i++)await expect(f.call(input)).rejects.toThrow(/selected team/);
   expect(f.api.calls).toHaveLength(2); // foreign or missing proof must stop before feature-flag GET
   expect((await f.call(input)).data).toEqual([{id:'flag_1',projectId:'prj_ONE'}]);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','GET','GET']);
   f.api.verify();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});
   const p=fixture();
   p.api.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_ONE'});
   await expect(p.call(input)).rejects.toThrow(/selected team/);
   expect(p.api.calls).toHaveLength(1);
 });

});
