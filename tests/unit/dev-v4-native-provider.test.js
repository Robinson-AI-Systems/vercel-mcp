import {beforeEach,describe,it,expect,vi} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async fn=>({...await fn(),loadToken:vi.fn()}));
const account='acct_FAKE_SANDBOX',team='team_FAKE_SANDBOX',project='prj_FAKE_SANDBOX';
const session='sbx_FAKE_SANDBOX_1234',runId='run_20261016_sbxfixture';
const conn={account,profile:'full',mode:'preview',listing:'catalog'};
function fixture(){
  const fake=makeFakeVercel(),audits=[];
  const objects=[{object_type:'project',object_id:project,project_id:project,
    detail:{name:'rtc-test-sandbox'},status:'active'},
    {object_type:'sandbox',object_id:session,project_id:project,
    detail:{name:'rtc-'+runId.replaceAll('_','-')+'-test'},status:'active'}];
  const db={
    getAccountCredential:async()=>({}),
    listProtectedResources:async()=>[],
    recordChange:async event=>audits.push(event),
    getDevRun:async({id,account:scope})=>id===runId&&scope===account?
      {id,status:'active'}:null,
    listDevRunObjects:async()=>structuredClone(objects),
    setDevRunObjectOutcome:async({type,objectId,status})=>{
      const obj=objects.find(x=>x.object_type===type&&x.object_id===objectId);
      if(!obj)return false;obj.status=status;return true;
    },
    requestReplayStore:()=>({
      claim:async()=>({state:'claimed',claimId:'fixture-claim'}),
      complete:async()=>true,release:async()=>true
    })
  };
  const raw=(state)=>({session:{id:session,projectId:project,
    sourceSandboxName:'rtc-'+runId.replaceAll('_','-')+'-test',status:state}});
  fake.when('GET','/v9/projects/{idOrName}')
    .resolves({id:project,name:'rtc-sandbox-test',accountId:team});
  fake.when('GET','/v2/sandboxes/sessions/{sessionId}')
    .resolves(raw('running')).resolves(raw('running'))
    .resolves(raw('running')).resolves(raw('stopped'));
  fake.when('POST','/v2/sandboxes/sessions/{sessionId}/stop').resolves({});
  return {db,fake,objects,audits,
    call:args=>dispatchReadOnlyTool({
      registry,name:'vercel_dev_sandbox_stop',args,connection:conn,
      db,env:{},fetchImpl:fake.fetch})
  };
}
describe('V-4 native provider-shaped scoped stop and cleanup state',()=>{
  beforeEach(()=>vi.mocked(loadToken).mockResolvedValue({
    token:'vcp_FAKE_SANDBOX_TOKEN',account:{id:account,scope:'team',team_id:team}}));
  it('uses the exact pinned Sandbox stop, provider readback and durable scoped cleaned state',async()=>{
    const f=fixture();
    const result=await f.call({runId,project,session,confirm:true,
      requestKey:'stop_sandbox_fixture'});
    const payload=JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({status:'applied',confirmed:true,
      receipt:{session,status:'stopped'}});
    expect(f.objects.find(x=>x.object_type==='sandbox').status).toBe('cleaned');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(1);
    const stop=f.fake.calls.find(x=>x.method==='POST');
    expect(stop).toMatchObject({path:'/v2/sandboxes/sessions/'+session+'/stop',
      query:{teamId:team}});
    expect(f.audits).toHaveLength(1);
    f.fake.verify();
  });
});
