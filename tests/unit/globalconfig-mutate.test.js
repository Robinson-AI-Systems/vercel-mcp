import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
import {checkTargets} from '../../src/tools/self-guard.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));

const id='ecfg_FAKE_PATCH',project='prj_FAKE_LINK',team='team_FAKE';
// AUD-AF: remodelled from the pinned contract — the documented
// single-store record carries exactly these fields. There is NO
// project-link field (linkage lives on the project side), no teamId
// and no size; size is sizeInBytes. The pre-AUD-AF fake invented
// connectedProjects/teamId/size, which is why the suite was green
// while every real store refused live.
const row={id,slug:'project-config',ownerId:team,createdAt:90,
  createdBy:'user_FAKE',digest:'digest_FAKE',updatedAt:100,
  itemCount:1,sizeInBytes:30};
// The documented items GET: a bare array of GlobalConfigItem.
const item=(key,value)=>({key,value,edgeConfigId:id,createdAt:90,updatedAt:95});
const conn={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const prod={...conn,mode:'production'};
const token={token:'vcp_FAKE_config',account:{id:'acct_FAKE',
  team_id:team,scope:'team'}};
const core={id,expectedSlug:row.slug,expectedUpdatedAt:100,
  outsideApp:true,confirm:true,requestKey:'globalPatchFake01'};
const args={...core,items:[{operation:'update',key:'FLAG',value:'enabled'}]};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(current=row,items=[item('FLAG','disabled')]){
  const fake=makeFakeVercel(),audits=[],memo=new Map(),pending=new Set();
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async x=>audits.push(x),
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(memo.has(key))return {state:'completed',result:memo.get(key)};
        if(pending.has(key))return {state:'pending'};
        pending.add(key);return {state:'claimed',claimId:key};
      },
      complete:async({key,result})=>{pending.delete(key);memo.set(key,result);},
      release:async({key})=>{pending.delete(key);return true;}
    })};
  loadToken.mockResolvedValue(token);
  fake.when('GET','/v1/global-config/{edgeConfigId}').resolves(current);
  fake.when('GET','/v1/global-config/{edgeConfigId}/items').resolves(items);
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,accountId:team});
  const call=(name,a=core,c=conn)=>dispatchReadOnlyTool({
    registry,name,args:a,connection:c,fetchImpl:fake.fetch,db});
  const mutations=()=>fake.calls.filter(x=>x.method==='PATCH'||x.method==='DELETE');
  return {fake,db,audits,call,mutations};
}
describe('E-3 guarded Global Config item patch and store removal',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('is published as two real guarded writes using documented pinned paths',()=>{
    for(const name of ['vercel_globalconfig_patch_items','vercel_globalconfig_delete']){
      expect(registry.tools.find(x=>x.name===name))
        .toMatchObject({writes:true,guardedWrite:true});
      expect(listMcpTools(registry,{...conn,profile:'read_only'})
        .some(x=>x.name===name)).toBe(false);
    }
    expect(validateRequest('global_config_patch_items',{
      path:{edgeConfigId:id},query:{teamId:team},
      body:{items:[{operation:'update',key:'FLAG',value:'enabled'}]}}))
      .toBe(true);
    expect(validateRequest('global_config_delete',{
      path:{edgeConfigId:id},query:{teamId:team}})).toBe(true);
  });
  it('updates an item on a contract-shaped store and independently verifies its value',async()=>{
    const f=fixture();
    f.fake.when('PATCH','/v1/global-config/{edgeConfigId}/items').resolves({});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(row).resolves(row).resolves({...row,updatedAt:101});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/items')
      .resolves([item('FLAG','disabled')])
      .resolves([item('FLAG','disabled')])
      .resolves([item('FLAG','enabled')]);
    const out=parse(await f.call('vercel_globalconfig_patch_items',args,prod));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0]).toMatchObject({method:'PATCH',
      path:'/v1/global-config/'+id+'/items',query:{teamId:team},
      body:{items:[{operation:'update',key:'FLAG',value:'enabled'}]}});
    expect(JSON.stringify(out)+JSON.stringify(f.audits))
      .not.toContain('enabled');
  });
  it('removes a verified empty store after confirm with independent 404',async()=>{
    const empty={...row,itemCount:0};
    const f=fixture(empty,[]);
    f.fake.when('DELETE','/v1/global-config/{edgeConfigId}').resolves(undefined,204);
    f.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(empty).resolves(empty).rejects(404);
    const out=parse(await f.call('vercel_globalconfig_delete',core,prod));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0]).toMatchObject({method:'DELETE',
      path:'/v1/global-config/'+id,query:{teamId:team}});
  });
  it('labels connected stores production and refuses preview-mode writes',async()=>{
    const linked={...row,connectedProjects:[project]};
    for(const [name,input] of [
      ['vercel_globalconfig_patch_items',args],
      ['vercel_globalconfig_delete',core]
    ]){
      const f=fixture(linked);
      expect(parse(await f.call(name,input)))
        .toMatchObject({status:'refused_by_guard'});
      expect(f.mutations()).toHaveLength(0);
    }
  });
  it('AUD-AF: contract-shaped stores plan in production, refuse in preview, keep legacy item maps',async()=>{
    // Pre-fix, store() demanded an Array.isArray(row.projects) the
    // documented record can never supply, so both plans below
    // refused with refused_by_guard even from a production
    // connection — the exact live VMCP-010 refusal. Post-fix the
    // unreported linkage classifies the store live-connected:
    // production plans, preview refuses, nothing is unguarded.
    const planPatch=fixture();
    const previewed=parse(await planPatch.call('vercel_globalconfig_patch_items',
      {...args,confirm:false,dryRun:true},prod));
    expect(previewed.status).toBe('preview');
    expect(planPatch.mutations()).toHaveLength(0);
    const planDelete=fixture({...row,itemCount:0},[]);
    const deletePreview=parse(await planDelete.call('vercel_globalconfig_delete',
      {...core,confirm:false,dryRun:true},prod));
    expect(deletePreview.status).toBe('preview');
    expect(deletePreview.preview).toContain('unreported project linkage');
    expect(planDelete.mutations()).toHaveLength(0);
    const refusedPatch=fixture();
    expect(parse(await refusedPatch.call('vercel_globalconfig_patch_items',args)))
      .toMatchObject({status:'refused_by_guard'});
    expect(refusedPatch.mutations()).toHaveLength(0);
    const refusedDelete=fixture({...row,itemCount:0},[]);
    expect(parse(await refusedDelete.call('vercel_globalconfig_delete',core)))
      .toMatchObject({status:'refused_by_guard'});
    expect(refusedDelete.mutations()).toHaveLength(0);
    // The AUD-AC-era envelope-map items shape still plans and applies.
    const legacy=fixture(row,{items:{FLAG:'disabled'}});
    legacy.fake.when('PATCH','/v1/global-config/{edgeConfigId}/items').resolves({});
    legacy.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(row).resolves(row).resolves({...row,updatedAt:101});
    legacy.fake.when('GET','/v1/global-config/{edgeConfigId}/items')
      .resolves({items:{FLAG:'disabled'}})
      .resolves({items:{FLAG:'disabled'}})
      .resolves({items:{FLAG:'enabled'}});
    const applied=parse(await legacy.call('vercel_globalconfig_patch_items',args,prod));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    expect(legacy.mutations()).toHaveLength(1);
  });
  it('refuses identity drift, stale versions, item collisions and protected stores',async()=>{
    for(const [current,items] of [
      [{...row,ownerId:'team_OTHER'}, [item('FLAG','disabled')]],
      [{...row,updatedAt:101}, [item('FLAG','disabled')]],
      [{...row,itemCount:2}, [item('FLAG','disabled')]],
      [row,{}]
    ]){
      const f=fixture(current,items);
      expect(parse(await f.call('vercel_globalconfig_patch_items',args,prod)).status)
        .toBe('refused_by_guard');
      expect(f.mutations()).toHaveLength(0);
    }
    // A reported link to a project another team owns still refuses:
    // the per-project proof runs whenever links ARE reported.
    const wrongTeam=fixture({...row,connectedProjects:[project]});
    wrongTeam.fake.when('GET','/v9/projects/{idOrName}')
      .resolves({id:project,accountId:'team_OTHER'});
    expect(parse(await wrongTeam.call('vercel_globalconfig_patch_items',args,prod)).status)
      .toBe('refused_by_guard');
    expect(wrongTeam.mutations()).toHaveLength(0);
    const protectedStore=fixture();
    protectedStore.db.listProtectedResources=async()=>[{match:id,note:'protected'}];
    expect(parse(await protectedStore.call('vercel_globalconfig_patch_items',args,prod)).status)
      .toBe('refused_by_guard');
    expect(protectedStore.mutations()).toHaveLength(0);
    expect(checkTargets([{kind:'store',id,accountId:team}],[]))
      .toEqual({blocked:false});
    expect(checkTargets([{kind:'store',id}],[]).blocked).toBe(true);
  });
  it('does not mutate without confirmation or on unsafe Config values',async()=>{
    for(const input of [
      {...args,confirm:false,dryRun:true},
      {...args,confirm:false},
      {...args,items:[{operation:'update',key:'FLAG',value:'vcp_FAKE_CREDENTIAL'}]},
      {...args,items:[{operation:'update',key:'FLAG',value:'enabled'},
        {operation:'delete',key:'FLAG'}]}
    ]){
      const f=fixture();
      const result=parse(await f.call('vercel_globalconfig_patch_items',input));
      expect(['preview','needs_confirmation','refused_by_guard']).toContain(result.status);
      expect(f.mutations()).toHaveLength(0);
    }
  });
  it('rechecks changed store revision immediately before dispatch',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(row).resolves({...row,updatedAt:102});
    const out=parse(await f.call('vercel_globalconfig_patch_items',args,prod));
    expect(out.status).toBe('refused_by_guard');
    expect(f.mutations()).toHaveLength(0);
  });
  it('AUD-AC: the published item schema and the runtime validator agree on value',async()=>{
    // The published schema must name exactly the keys the validator
    // accepts, and its value description must state the runtime rule:
    // required for create/update/upsert, forbidden for delete.
    const tool=registry.tools.find(x=>x.name==='vercel_globalconfig_patch_items');
    const itemSchema=tool.inputSchema.properties.items.items;
    expect(itemSchema.additionalProperties).toBe(false);
    expect(Object.keys(itemSchema.properties).sort())
      .toEqual(['key','operation','value']);
    expect(itemSchema.required).toEqual(['operation','key']);
    expect(itemSchema.properties.value.description)
      .toMatch(/Required for create, update and upsert/);
    expect(itemSchema.properties.value.description)
      .toMatch(/must not be supplied for delete/);
    expect(itemSchema.properties.value.description).toMatch(/8192/);
    const published=listMcpTools(registry,conn)
      .find(x=>x.name==='vercel_globalconfig_patch_items');
    expect(published.inputSchema.properties.items.items)
      .toEqual(itemSchema);
    // Validator verdicts match the published rule, operation by operation:
    // a missing value refuses for create/update/upsert; a supplied value
    // refuses for delete; delete without a value is the one that proceeds.
    for(const operation of ['create','update','upsert']){
      const f=fixture(row,{});
      const out=parse(await f.call('vercel_globalconfig_patch_items',
        {...core,items:[{operation,key:'NEW_FLAG'}]}));
      expect(out.status).toBe('refused_by_guard');
      expect(f.mutations()).toHaveLength(0);
    }
    const withValue=fixture();
    expect(parse(await withValue.call('vercel_globalconfig_patch_items',
      {...core,items:[{operation:'delete',key:'FLAG',value:'enabled'}]}))
      .status).toBe('refused_by_guard');
    expect(withValue.mutations()).toHaveLength(0);
    const del=fixture();
    del.fake.when('PATCH','/v1/global-config/{edgeConfigId}/items')
      .resolves({});
    del.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(row).resolves(row).resolves({...row,updatedAt:101});
    del.fake.when('GET','/v1/global-config/{edgeConfigId}/items')
      .resolves({items:{FLAG:'disabled'}})
      .resolves({items:{FLAG:'disabled'}}).resolves({items:{}});
    const out=parse(await del.call('vercel_globalconfig_patch_items',
      {...core,items:[{operation:'delete',key:'FLAG'}]},prod));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(del.mutations()).toHaveLength(1);
  });
});
