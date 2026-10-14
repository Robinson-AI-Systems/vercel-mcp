import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

const project='prj_FAKE_ONE',deployment='dpl_FAKE_SOURCE';
const connection={account:'acct_FAKE',mode:'preview',profile:'full',listing:'catalog'};
const saved={token:'vcp_FAKE_source',account:{
  id:'acct_FAKE',team_id:'team_FAKE',scope:'project',project_id:project}};
const row={uid:deployment,projectId:project,readyState:'READY',
  target:'preview',name:'preview-test'};
const args={project,deployment,expectedState:'READY',
  expectedTarget:'preview',outsideApp:true,confirm:false,
  requestKey:'redeployFAKE123'};
const value=result=>JSON.parse(result.content[0].text);
function fixture(override=row){
  const fake=makeFakeVercel(),audits=[],claims=[];
  fake.when('GET','/v13/deployments/{idOrUrl}').resolves(override);
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async item=>audits.push(item),
    requestReplayStore:()=>({
      claim:async claim=>{claims.push(claim);return {state:'claimed',claimId:claim.key}},
      complete:async()=>{},release:async()=>true
    })
  };
  const call=(parameters=args,conn=connection)=>dispatchReadOnlyTool({
    registry,name:'vercel_deploy_redeploy',args:parameters,
    connection:conn,db,fetchImpl:fake.fetch
  });
  return {fake,db,call,audits,claims};
}
describe('D-3 target-preserving redeploy with metered cost gate',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(saved);});
  it('is a registry-attested guarded spend write, never read-only or everyday',()=>{
    const tool=registry.tools.find(x=>x.name==='vercel_deploy_redeploy');
    expect(tool).toMatchObject({writes:true,guardedWrite:true,profiles:['full'],
      writeContract:{spend:true,production:true,targets:true}});
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .some(t=>t.name===tool.name)).toBe(false);
    expect(listMcpTools(registry,{...connection,profile:'everyday'})
      .some(t=>t.name===tool.name)).toBe(false);
  });
  it('previews exact preview source but never creates a charged build',async()=>{
    const f=fixture();
    const preview=value(await f.call({...args,dryRun:true}));
    expect(preview).toMatchObject({status:'preview',mode:'PREVIEW'});
    expect(preview.preview).toContain('preserved');
    expect(preview.moneyLine).toMatch(/total ceiling/i);
    expect(f.fake.calls.map(c=>c.method)).toEqual(['GET','GET']);
    expect(f.fake.calls.every(c=>c.query.teamId==='team_FAKE')).toBe(true);
    expect(f.audits).toHaveLength(1);
    expect(f.claims).toHaveLength(0);
    f.fake.verify();
  });
  it('refuses confirmation before any POST or paid replay claim',async()=>{
    const f=fixture();
    const result=value(await f.call({...args,confirm:true}));
    expect(result).toMatchObject({status:'refused_by_guard'});
    expect(result.reason).toMatch(/enforceable/i);
    expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
    expect(f.claims).toHaveLength(0);
    expect(f.audits).toHaveLength(0);
  });
  it('validates precise provider redeploy POST body against pinned OpenAPI',()=>{
    expect(()=>validateRequest('deployments_create',{
      query:{teamId:'team_FAKE_validation'},
      body:{name:'preview-test',project:'preview-test',
        deploymentId:deployment,target:'preview'}
    })).not.toThrow();
  });
  it('keeps production target and refuses a preview-mode confirmation',async()=>{
    const f=fixture({...row,target:'production'});
    const input={...args,expectedTarget:'production',confirm:true};
    expect(value(await f.call(input))).toMatchObject({status:'refused_by_guard'});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
  });
  it('previews production as PRODUCTION only when the verified source really is production',async()=>{
    const f=fixture({...row,target:'production'});
    const out=value(await f.call({...args,expectedTarget:'production',dryRun:true},
      {...connection,mode:'production'}));
    expect(out).toMatchObject({status:'preview',mode:'PRODUCTION'});
    expect(f.fake.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('refuses forged target, state, identity and project mismatch before a priced dispatch',async()=>{
    for(const changed of [
      {...row,target:null},{...row,target:'production'},
      {...row,readyState:'BUILDING'},{...row,projectId:'prj_OTHER'},
      {...row,uid:'dpl_DIFFERENT'},{...row,name:null},
      {...row,id:'dpl_DIFFERENT'}
    ]){
      const f=fixture(changed);
      const response=value(await f.call());
      expect(response.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(c=>c.method!=='POST')).toBe(true);
    }
  });
  it('requires explicit exact destination scope and outside-app intent',async()=>{
    for(const patched of [
      {project:'prj_OTHER'},{outsideApp:false},{expectedTarget:'production'},
      {expectedState:'BUILDING'},{teamId:'team_OTHER'},{deployment:'../invalid'},
      {requestKey:'!unsafe!'}, {confirm:'yes'}, {dryRun:'yes'}
    ]){
      const f=fixture();
      const response=await f.call({...args,...patched});
      expect(response.isError||value(response).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.filter(c=>c.method==='POST')).toHaveLength(0);
    }
  });
  it('does not allow protected, app-owned or read-only targets to reach POST',async()=>{
    const f=fixture();
    f.db.listProtectedResources=async()=>[{match:project,note:'protected fixture'}];
    expect(value(await f.call({...args,confirm:true})).status).toBe('refused_by_guard');
    const second=await f.call(args,{...connection,profile:'read_only'});
    expect(second.isError).toBe(true);
    expect(f.fake.calls.every(c=>c.method!=='POST')).toBe(true);
  });
  it('never treats confirm without a separate owner purchase grant as permission to bill',async()=>{
    const f=fixture();
    await f.call({...args,confirm:true,requestKey:'redeployAltFAKE02'});
    await f.call({...args,confirm:true,requestKey:'redeployAltFAKE03'});
    expect(f.fake.calls.filter(c=>c.method==='POST')).toHaveLength(0);
    expect(f.claims).toHaveLength(0);
  });
});
