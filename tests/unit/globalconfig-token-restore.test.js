import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async orig=>({...await orig(),loadToken:vi.fn()}));

const id='ecfg_FAKE_TOKENS',team='team_FAKE',project='prj_FAKE_LINK';
const versionId='backup_FAKE_ONE';
// AUD-AF: remodelled from the pinned contract — ownerId, documented
// fields only, no project-link field (the linked variant adds
// connectedProjects back to pin the reported-links path).
const row={id,slug:'config-store',ownerId:team,createdAt:90,
  createdBy:'user_FAKE',digest:'digest_FAKE',itemCount:1,
  sizeInBytes:12,updatedAt:100};
// The documented items GET: a bare array of GlobalConfigItem.
const currentItems=[{key:'FLAG',value:'current',edgeConfigId:id,
  createdAt:90,updatedAt:95}];
const tokenRow={id:'ectok_FAKE_TOKEN',label:'CI read access',
  createdAt:100,value:'vcp_FAKE_LIST_RESPONSE_SECRET'};
const bearer='vcp_FAKE_CREATED_TOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const connection={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const prod={...connection,mode:'production'};
const identity={token:'vcp_FAKE_provider',account:{
  id:'acct_FAKE',team_id:team,scope:'team'}};
const args={id,expectedSlug:'config-store',expectedUpdatedAt:100,
  outsideApp:true,confirm:true,requestKey:'createReadFake01',
  label:'CI read access'};
const restoreArgs={id,expectedSlug:'config-store',expectedUpdatedAt:100,
  versionId,outsideApp:true,confirm:true,requestKey:'restoreFake01'};
const revokeArgs={id,expectedSlug:'config-store',expectedUpdatedAt:100,
  tokenIds:[tokenRow.id],outsideApp:true,confirm:true,requestKey:'revokeTokenFake01'};
const env={TOKEN_ENCRYPTION_KEY:'0123456789abcdef'.repeat(4)};
const parse=r=>JSON.parse(r.content[0].text);
function fixture({linked=false,tokenRows=[],items=currentItems}={}){
  const fake=makeFakeVercel(),audits=[],secretRows=[],memo=new Map(),claims=new Set();
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async row=>audits.push(row),
    insertOneTimeSecret:async x=>{secretRows.push(x);return x;},
    consumeOneTimeSecret:async()=>null,
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(memo.has(key))return {state:'completed',result:memo.get(key)};
        if(claims.has(key))return {state:'pending'};
        claims.add(key);return {state:'claimed',claimId:key};
      },
      complete:async({key,result})=>{claims.delete(key);memo.set(key,result);},
      release:async({key})=>{claims.delete(key);return true;}
    })};
  loadToken.mockResolvedValue(identity);
  const selected=linked?{...row,connectedProjects:[project]}:row;
  fake.when('GET','/v1/global-config/{edgeConfigId}').resolves(selected);
  fake.when('GET','/v1/global-config/{edgeConfigId}/tokens').resolves(tokenRows);
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,accountId:team});
  fake.when('GET','/v1/global-config/{edgeConfigId}/items').resolves(items);
  // The documented BACKUP payload keeps its key-map items shape —
  // allItems must keep accepting it (AUD-AF normalizer).
  fake.when('GET','/v1/global-config/{edgeConfigId}/backups/{edgeConfigBackupVersionId}')
    .resolves({id:versionId,edgeConfigId:id,items:{FLAG:'backup'}});
  const call=(name,a={},c=connection)=>dispatchReadOnlyTool({
    registry,name,args:a,connection:c,db,env,fetchImpl:fake.fetch
  });
  const mutations=()=>fake.calls.filter(x=>['POST','DELETE','PATCH'].includes(x.method));
  return {fake,db,call,audits,secretRows,mutations,memo};
}
describe('E-3/E-4 complete Global Config token and restore workflow',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('publishes exact documented paths and non-read-only guarded contracts',()=>{
    expect(validateRequest('global_config_create_token',{
      path:{edgeConfigId:id},query:{teamId:team},
      body:{label:'CI read access'}})).toBe(true);
    expect(validateRequest('global_config_tokens',{
      path:{edgeConfigId:id},query:{teamId:team}})).toBe(true);
    expect(validateRequest('global_config_delete_tokens',{
      path:{edgeConfigId:id},query:{teamId:team},
      body:{ids:[tokenRow.id]}})).toBe(true);
    expect(validateRequest('global_config_backup_get',{
      path:{edgeConfigId:id,edgeConfigBackupVersionId:versionId},
      query:{teamId:team}})).toBe(true);
    expect(validateRequest('global_config_restore_backup',{
      path:{edgeConfigId:id,edgeConfigBackupVersionId:versionId},
      query:{teamId:team}})).toBe(true);
    for(const name of ['vercel_globalconfig_create_token',
      'vercel_globalconfig_restore_backup','vercel_globalconfig_revoke_tokens']){
      expect(registry.tools.find(t=>t.name===name))
        .toMatchObject({writes:true,guardedWrite:true});
      expect(listMcpTools(registry,{...connection,profile:'read_only'})
        .some(t=>t.name===name)).toBe(false);
    }
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .some(t=>t.name==='vercel_globalconfig_list_tokens')).toBe(true);
  });
  it('issues token and delivers encrypted one-time UUID only, with provider readback',async()=>{
    const f=fixture();
    f.fake.when('POST','/v1/global-config/{edgeConfigId}/token')
      .resolves({id:tokenRow.id,label:tokenRow.label,token:bearer});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/tokens')
      .resolves([]).resolves([]).resolves([tokenRow]);
    const out=parse(await f.call('vercel_globalconfig_create_token',args,prod));
    expect(out).toMatchObject({status:'applied',confirmed:true,
      revealAt:'/api/vercel/setup'});
    expect(out.ownerRevealRef).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0]).toMatchObject({method:'POST',
      path:'/v1/global-config/'+id+'/token',body:{label:'CI read access'}});
    expect(f.secretRows).toHaveLength(1);
    expect(f.secretRows[0].ciphertext).not.toContain(bearer);
    expect(JSON.stringify(out)+JSON.stringify(f.audits)).not.toContain(bearer);
  });
  it('lists only safe token metadata and revokes exact ID with independent absence',async()=>{
    const f=fixture({tokenRows:[tokenRow]});
    const list=parse(await f.call('vercel_globalconfig_list_tokens',{id}));
    expect(list).toMatchObject({hasTokenValues:false,tokens:[{
      id:tokenRow.id,label:tokenRow.label}]});
    expect(JSON.stringify(list)).not.toContain('LIST_RESPONSE_SECRET');
    f.fake.when('DELETE','/v1/global-config/{edgeConfigId}/tokens')
      .resolves(undefined,204);
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/tokens')
      .resolves([tokenRow]).resolves([tokenRow]).resolves([]);
    const out=parse(await f.call('vercel_globalconfig_revoke_tokens',revokeArgs,prod));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0].body).toEqual({ids:[tokenRow.id]});
    expect(JSON.stringify(out)+JSON.stringify(f.audits)).not.toContain('LIST_RESPONSE_SECRET');
  });
  it('restores a specific version after naming affected keys but no item values',async()=>{
    const f=fixture();
    f.fake.when('POST','/v1/global-config/{edgeConfigId}/backups/{edgeConfigBackupVersionId}/restore')
      .resolves({status:'accepted'});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(row).resolves(row).resolves({...row,updatedAt:101});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/items')
      .resolves({items:{FLAG:'current'}})
      .resolves({items:{FLAG:'current'}})
      .resolves({items:{FLAG:'backup'}});
    const out=parse(await f.call('vercel_globalconfig_restore_backup',restoreArgs,prod));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0]).toMatchObject({method:'POST',
      path:'/v1/global-config/'+id+'/backups/'+versionId+'/restore'});
    expect(JSON.stringify(out)).toContain('FLAG');
    expect(JSON.stringify(out)+JSON.stringify(f.audits)).not.toContain('"backup"');
    expect(JSON.stringify(out)+JSON.stringify(f.audits)).not.toContain('"current"');
  });
  it('denies live-project token issuance, token revoke and backup restore in preview',async()=>{
    for(const [name,a] of [
      ['vercel_globalconfig_create_token',args],
      ['vercel_globalconfig_revoke_tokens',revokeArgs],
      ['vercel_globalconfig_restore_backup',restoreArgs]]){
      const f=fixture({linked:true,tokenRows:[tokenRow]});
      expect(parse(await f.call(name,a)).status).toBe('refused_by_guard');
      expect(f.mutations()).toHaveLength(0);
    }
  });
  it('refuses missing owner vault, stale backup or missing exact token without mutation',async()=>{
    const a=fixture();
    delete a.db.insertOneTimeSecret;
    expect(parse(await a.call('vercel_globalconfig_create_token',args)).status)
      .toBe('refused_by_guard');
    expect(a.mutations()).toHaveLength(0);
    const b=fixture();
    b.fake.when('GET','/v1/global-config/{edgeConfigId}/backups/{edgeConfigBackupVersionId}')
      .resolves({id:'backup_FAKE_OTHER',items:{FLAG:'backup'}});
    expect(parse(await b.call('vercel_globalconfig_restore_backup',restoreArgs)).status)
      .toBe('refused_by_guard');
    expect(b.mutations()).toHaveLength(0);
    const c=fixture();
    expect(parse(await c.call('vercel_globalconfig_revoke_tokens',revokeArgs)).status)
      .toBe('refused_by_guard');
    expect(c.mutations()).toHaveLength(0);
  });
  it('dry run and unconfirmed token creation never issue provider bearer',async()=>{
    for(const flags of [{dryRun:true,confirm:false},{confirm:false}]){
      const f=fixture();
      const out=parse(await f.call('vercel_globalconfig_create_token',
        {...args,...flags},prod));
      expect(out.status).toBe(flags.dryRun?'preview':'needs_confirmation');
      expect(f.mutations()).toHaveLength(0);
      expect(f.secretRows).toHaveLength(0);
    }
  });
  it('selects the newest complete-inventory backup strictly before a UTC cutoff',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/backups').resolves({
      backups:[
        {id:versionId,edgeConfigId:id,createdAt:'2026-01-10T00:00:00.000Z'},
        {id:'backup_FAKE_NEW',edgeConfigId:id,createdAt:'2026-01-20T00:00:00.000Z'}
      ],pagination:{next:null}
    });
    f.fake.when('POST','/v1/global-config/{edgeConfigId}/backups/{edgeConfigBackupVersionId}/restore')
      .resolves({});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}')
      .resolves(row).resolves(row).resolves({...row,updatedAt:101});
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/items')
      .resolves({items:{FLAG:'current'}})
      .resolves({items:{FLAG:'current'}})
      .resolves({items:{FLAG:'backup'}});
    const {versionId:unused,...withoutVersion}=restoreArgs;
    expect(unused).toBe(versionId);
    const out=parse(await f.call('vercel_globalconfig_restore_backup',{
      ...withoutVersion,beforeTime:'2026-01-15T00:00:00.000Z'},prod));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    expect(JSON.stringify(out)).toContain(versionId);
    expect(f.mutations()).toHaveLength(1);
    expect(f.mutations()[0].path)
      .toBe('/v1/global-config/'+id+'/backups/'+versionId+'/restore');
  });
  it('refuses an incomplete timestamp-based backup inventory before provider mutation',async()=>{
    const f=fixture();
    f.fake.when('GET','/v1/global-config/{edgeConfigId}/backups')
      .resolves({backups:[{id:versionId,createdAt:'2026-01-10T00:00:00.000Z'}],
        pagination:{next:'later'}});
    const {versionId:unused,...withoutVersion}=restoreArgs;
    expect(unused).toBe(versionId);
    const out=parse(await f.call('vercel_globalconfig_restore_backup',{
      ...withoutVersion,beforeTime:'2026-01-15T00:00:00.000Z'}));
    expect(out.status).toBe('refused_by_guard');
    expect(f.mutations()).toHaveLength(0);
  });

});
