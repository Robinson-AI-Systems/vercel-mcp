import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));
const id='ecfg_FAKE_STORE',team='team_FAKE';
const record={id,slug:'fake-store',teamId:team,connectedProjects:[],
  itemCount:2,size:88,updatedAt:100};
const conn={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const token={token:'vcp_FAKE_global',account:{
  id:'acct_FAKE',scope:'team',team_id:team}};
const args={slug:'new-fake-store',outsideApp:true,confirm:true,
  requestKey:'globalConfigFake01'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(initial=[record]){
  const fake=makeFakeVercel(),audit=[],memo=new Map(),pending=new Set();
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async r=>audit.push(r),requestReplayStore:()=>({
      claim:async({key})=>{
        if(memo.has(key))return {state:'completed',result:memo.get(key)};
        if(pending.has(key))return {state:'pending'};
        pending.add(key);return {state:'claimed',claimId:key};
      },
      complete:async({key,result})=>{pending.delete(key);memo.set(key,result);},
      release:async({key})=>{pending.delete(key);return true;}
    })};
  loadToken.mockResolvedValue(token);
  // AUD-AC: the documented list contract (vendored snapshot: 200 = a bare
  // array, "List of all Global Configs", no pagination parameters) and the
  // shape captured live 2026-10-30 — the array itself, no pagination block.
  fake.when('GET','/v1/global-config')
    .resolves(initial);
  fake.when('GET','/v1/global-config/{edgeConfigId}')
    .resolves(record);
  fake.when('GET','/v1/global-config/{edgeConfigId}/items')
    .resolves({items:{SAFE_FLAG:'hello',PRIVATE_FAKE_TOKEN:'vcp_FAKE_SECRET_PROBE'}});
  const call=(name,input={},connection=conn)=>dispatchReadOnlyTool({
    registry,name,args:input,connection,db,fetchImpl:fake.fetch
  });
  return {fake,db,call,audit,memo};
}
const changes=f=>f.fake.calls.filter(x=>['POST','PATCH','DELETE'].includes(x.method));
describe('E-3 Global Config metadata, safe items and guarded creation',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('advertises selected team reads and guarded creation, using pinned v1 paths',()=>{
    for(const name of ['vercel_globalconfig_list','vercel_globalconfig_list_items',
      'vercel_globalconfig_create'])expect(registry.tools.some(t=>t.name===name)).toBe(true);
    expect(listMcpTools(registry,{...conn,profile:'read_only'})
      .some(t=>t.name==='vercel_globalconfig_create')).toBe(false);
    expect(registry.tools.find(t=>t.name==='vercel_globalconfig_create'))
      .toMatchObject({writes:true,guardedWrite:true,
        writeContract:{production:true,targets:true}});
    expect(validateRequest('global_config_list',{query:{teamId:team}})).toBe(true);
    expect(validateRequest('global_config_get',{path:{edgeConfigId:id},
      query:{teamId:team}})).toBe(true);
    expect(validateRequest('global_config_items',{path:{edgeConfigId:id},
      query:{teamId:team}})).toBe(true);
    expect(validateRequest('global_config_create',{query:{teamId:team},
      body:{slug:'new-fake-store'}})).toBe(true);
  });
  it('lists bounded store metadata with no tokens; the documented bare array certifies completeness',async()=>{
    const f=fixture();
    const result=parse(await f.call('vercel_globalconfig_list'));
    expect(result).toMatchObject({teamScoped:true,complete:true,shown:1,
      hasTokens:false,items:[{id,slug:'fake-store',projects:[]}]});
    expect(result.items[0]).not.toHaveProperty('token');
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
    expect(f.fake.calls[0]).toMatchObject({path:'/v1/global-config',
      query:{teamId:team}});
    f.fake.verify();
    // AUD-AC: every non-paginated shape the provider returns certifies —
    // the bare array (documented + live), an envelope without a pagination
    // block, and an envelope whose pagination explicitly ends (next:null).
    for(const page of [
      [record],
      {data:[record]},
      {edgeConfigs:[record]},
      {data:[record],pagination:{next:null}}
    ]){
      const v=fixture();
      v.fake.when('GET','/v1/global-config').resolves(page);
      expect(parse(await v.call('vercel_globalconfig_list'))
        .complete).toBe(true);
    }
    // A pagination block that does not end the inventory never certifies.
    for(const page of [
      {data:[record],pagination:{next:99}},
      {data:[record],pagination:{}}
    ]){
      const v=fixture();
      v.fake.when('GET','/v1/global-config').resolves(page);
      expect(parse(await v.call('vercel_globalconfig_list'))
        .complete).toBe(false);
    }
  });
  it('returns projected Config item values but redacts credential-shaped strings',async()=>{
    const f=fixture();
    const out=parse(await f.call('vercel_globalconfig_list_items',{id}));
    expect(out).toMatchObject({store:id,shown:2,capped:false,complete:false,
      hasTokens:false});
    expect(out.items).toContainEqual({key:'SAFE_FLAG',data:'hello'});
    expect(JSON.stringify(out)).not.toContain('vcp_FAKE_SECRET_PROBE');
    expect(f.fake.calls.map(x=>x.path)).toEqual([
      '/v1/global-config/'+id,'/v1/global-config/'+id+'/items']);
    expect(f.fake.calls.every(x=>x.query.teamId===team)).toBe(true);
  });
  it('creates only one empty new team store; readback proves zero linked projects',async()=>{
    const f=fixture([]);
    const newStore={id:'ecfg_FAKE_NEW',slug:'new-fake-store',teamId:team,
      connectedProjects:[],itemCount:0};
    f.fake.when('POST','/v1/global-config')
      .resolves({...newStore,token:'vcp_FAKE_PRIVATE_REPLY'});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}').resolves(newStore);
    const out=parse(await f.call('vercel_globalconfig_create',args));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(changes(f)).toHaveLength(1);
    expect(changes(f)[0]).toMatchObject({method:'POST',
      path:'/v1/global-config',query:{teamId:team},
      body:{slug:'new-fake-store'}});
    expect(JSON.stringify(out)+JSON.stringify(f.audit)).not.toContain('vcp_FAKE_PRIVATE_REPLY');
    expect(f.memo.size).toBe(2);
    f.fake.verify();
  });
  it('rejects create collisions, provider pagination uncertainty and unauthenticated team scope',async()=>{
    for(const initial of [
      [record,{...record,id:'ecfg_FAKE_OTHER',slug:'new-fake-store'}],
      [record,{...record,id,slug:'another'}]
    ]){
      const f=fixture(initial);
      expect(parse(await f.call('vercel_globalconfig_create',args)).status)
        .toBe('refused_by_guard');
      expect(changes(f)).toHaveLength(0);
    }
    const page=fixture([]);
    page.fake.when('GET','/v1/global-config')
      .resolves({data:[],pagination:{next:99}});
    expect(parse(await page.call('vercel_globalconfig_create',args)).status)
      .toBe('refused_by_guard');
    const scope=fixture([]);
    loadToken.mockResolvedValue({...token,account:{...token.account,
      scope:'project',project_id:'prj_FAKE'}});
    expect(parse(await scope.call('vercel_globalconfig_create',args)).status)
      .toBe('refused_by_guard');
    expect(changes(scope)).toHaveLength(0);
  });
  it('refuses protected account, read-only profile, unknown arguments, and no confirmation',async()=>{
    for(const a of [
      {...args,teamId:'team_OTHER'},
      {...args,slug:'../secrets'},
      {...args,slug:'vcp_FAKE_secret_credential'},
      {...args,outsideApp:false}
    ]){
      const f=fixture([]);
      expect(parse(await f.call('vercel_globalconfig_create',a)).status)
        .toBe('refused_by_guard');
      expect(changes(f)).toHaveLength(0);
    }
    const f=fixture([]);
    f.db.listProtectedResources=async()=>[{match:team,note:'protected team'}];
    expect(parse(await f.call('vercel_globalconfig_create',args)).status)
      .toBe('refused_by_guard');
    expect(changes(f)).toHaveLength(0);
    const read=fixture([]);
    const denied=await read.call('vercel_globalconfig_create',args,
      {...conn,profile:'read_only'});
    expect(denied.isError||parse(denied).status==='refused_by_guard').toBe(true);
    for(const flags of [{confirm:false},{dryRun:true,confirm:false}]){
      const f=fixture([]);
      const out=parse(await f.call('vercel_globalconfig_create',{...args,...flags}));
      expect(out.status).toBe(flags.dryRun?'preview':'needs_confirmation');
      expect(changes(f)).toHaveLength(0);
    }
  });
  it('rejects foreign IDs, team metadata, duplicate rows and unknown unsafe item key',async()=>{
    const f=fixture([{...record,teamId:'team_FOREIGN'}]);
    expect((await f.call('vercel_globalconfig_list')).isError).toBe(true);
    const duplicate=fixture([record,{...record}]);
    expect((await duplicate.call('vercel_globalconfig_list')).isError).toBe(true);
    const bad=fixture();
    bad.fake.when('GET','/v1/global-config/{edgeConfigId}/items')
      .resolves({items:{'../../BAD':'okay'}});
    expect((await bad.call('vercel_globalconfig_list_items',{id})).isError).toBe(true);
    const missing=fixture();
    expect((await missing.call('vercel_globalconfig_list_items',{id:'ecfg_FAKE_OTHER'})).isError).toBe(true);
  });
  it('refuses concurrent slug collision at pre-dispatch proof without a provider write',async()=>{
    const f=fixture([]);
    f.fake.when('GET','/v1/global-config')
      .resolves([])
      .resolves([{...record,slug:args.slug}]);
    const out=parse(await f.call('vercel_globalconfig_create',args));
    expect(out.status).toBe('refused_by_guard');
    expect(changes(f)).toHaveLength(0);
  });
  it('AUD-AC: creates against the live-shaped list (bare empty array, no pagination block)',async()=>{
    // The exact shape that refused live on 2026-10-30 (VMCP-010 probe):
    // the team's list is a bare [] with no pagination block anywhere.
    const f=fixture([]);
    const newStore={id:'ecfg_FAKE_NEW',slug:'new-fake-store',teamId:team,
      connectedProjects:[],itemCount:0};
    f.fake.when('POST','/v1/global-config').resolves(newStore);
    f.fake.when('GET','/v1/global-config/{edgeConfigId}').resolves(newStore);
    const out=parse(await f.call('vercel_globalconfig_create',args));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(changes(f)).toHaveLength(1);
  });
  it('AUD-AC: a full-bound inventory without an explicit pagination end still refuses create',async()=>{
    // At exactly the 100-row bound with no pagination.next === null, a
    // silent provider cap is indistinguishable from a genuine 100, so
    // slug uniqueness is unprovable and the refusal must stay.
    const full=Array.from({length:100},(_,i)=>({...
      record,id:'ecfg_FAKE_'+i,slug:'store-'+i}));
    const f=fixture(full);
    expect(parse(await f.call('vercel_globalconfig_create',args)).status)
      .toBe('refused_by_guard');
    expect(changes(f)).toHaveLength(0);
    // The same 100 rows WITH pagination.next === null certify: create plans.
    const certified=fixture([]);
    certified.fake.when('GET','/v1/global-config')
      .resolves({data:full,pagination:{next:null}});
    const newStore={id:'ecfg_FAKE_NEW',slug:'new-fake-store',teamId:team,
      connectedProjects:[],itemCount:0};
    certified.fake.when('POST','/v1/global-config').resolves(newStore);
    certified.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(newStore);
    const dry=parse(await certified.call('vercel_globalconfig_create',
      {...args,confirm:false,dryRun:true,requestKey:'globalConfigFake02'}));
    expect(dry.status).toBe('preview');
    expect(changes(certified)).toHaveLength(0);
  });
});
