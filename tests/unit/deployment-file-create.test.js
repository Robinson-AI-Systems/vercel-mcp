import {createHash} from 'node:crypto';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeVercelClient} from '../../src/vercel/client.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest,openApiOperation} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async x=>({...await x(),loadToken:vi.fn()}));
const project='prj_FAKE',account={id:'acct_FAKE',team_id:'team_FAKE',
  scope:'project',project_id:project};
const connection={account:'acct_FAKE',profile:'full',mode:'preview',listing:'catalog'};
const safeFiles=[{path:'index.html',content:'<h1>Safe preview</h1>'},
  {path:'app.js',content:'console.log("hello")'}];
const args={project,expectedName:'my-app',files:safeFiles,
  target:'preview',outsideApp:true,requestKey:'fileDeployFAKE01'};
const row={id:project,name:'my-app',accountId:'team_FAKE'};
const decode=x=>JSON.parse(x.content[0].text);
function fixture(override=row){
  const fake=makeFakeVercel(),claims=[],audits=[];
  fake.when('GET','/v9/projects/{idOrName}').resolves(override);
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async entry=>audits.push(entry),
    requestReplayStore:()=>({
      claim:async c=>{claims.push(c);return {state:'claimed',claimId:c.key}},
      complete:async()=>{},release:async()=>true
    })
  };
  const call=(input=args,conn=connection)=>dispatchReadOnlyTool({
    registry,name:'vercel_deploy_create_from_files',args:input,
    connection:conn,db,fetchImpl:fake.fetch
  });
  return {fake,call,db,claims,audits};
}
describe('D-3 2 MiB immutable file deployment manifest and billing lockout',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  it('registers full-profile guarded spend writer without read-only exposure',()=>{
    expect(registry.tools.find(x=>x.name==='vercel_deploy_create_from_files'))
      .toMatchObject({writes:true,guardedWrite:true,profiles:['full'],
        writeContract:{spend:true,production:true,targets:true}});
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .some(x=>x.name==='vercel_deploy_create_from_files')).toBe(false);
  });
  it('produces a SHA-1 manifest with exact byte sizes and provider-visible preview only',async()=>{
    const f=fixture(),out=decode(await f.call({...args,dryRun:true}));
    expect(out).toMatchObject({status:'preview',mode:'PREVIEW'});
    expect(out.preview).toContain('SHA-1');
    expect(out.preview).toContain('2 MiB');
    expect(out.moneyLine).toMatch(/total ceiling/);
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
    expect(f.audits).toHaveLength(1);expect(f.claims).toHaveLength(0);
    f.fake.verify();
  });
  it('enforces the immutable provider file-reference API contract',()=>{
    const files=safeFiles.map(v=>{
      const bytes=Buffer.from(v.content,'utf8');
      return {file:v.path,sha:createHash('sha1').update(bytes).digest('hex'),size:bytes.length};
    });
    expect(()=>validateRequest('deployments_create',{
      query:{teamId:'team_FAKE_validation'},
      body:{name:'my-app',project:'my-app',files,target:'preview'}
    })).not.toThrow();
    expect(openApiOperation('deployments_file_upload')).toMatchObject({
      method:'POST',path:'/v2/files'});
  });
  it('refuses confirmation before any billed upload or deploy POST',async()=>{
    const f=fixture(),out=decode(await f.call({...args,confirm:true}));
    expect(out).toMatchObject({status:'refused_by_guard'});
    expect(out.reason).toMatch(/enforceable/i);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    expect(f.claims).toHaveLength(0);
  });
  it('classifies production and denies a preview connection',async()=>{
    const f=fixture();
    expect(decode(await f.call({...args,target:'production',confirm:true}))
      .status).toBe('refused_by_guard');
    expect(f.fake.calls.every(x=>x.method!=='POST')).toBe(true);
  });
  it('returns a production preview only for verified production connection',async()=>{
    const f=fixture(),out=decode(await f.call({...args,target:'production',dryRun:true},
      {...connection,mode:'production'}));
    expect(out).toMatchObject({status:'preview',mode:'PRODUCTION'});
    expect(f.fake.calls.some(x=>x.method==='POST')).toBe(false);
  });
  it('rejects dangerous paths, hidden env files, duplicate paths and credential content',async()=>{
    const patches=[
      [{path:'../index.html',content:'ok'}],
      [{path:'.env',content:'A=B'}],
      [{path:'src//app.js',content:'ok'}],
      [{path:'a.js',content:'ok'},{path:'a.js',content:'second'}],
      [{path:'bad\\name.js',content:'ok'}],
      [{path:'index.html',content:'const secret = sk_live_FAKE_secret_example'}],
      [{path:'index.html',content:'apiKey = examplePassword'}],
      [{path:'index.html',content:'\u0000binary'}],
      [{path:'index.html',content:'x'.repeat(2097153)}],
      Array.from({length:5},(_,i)=>({path:'f'+i+'.txt',content:'safe'}))
    ];
    for(const files of patches){
      const f=fixture(),out=decode(await f.call({...args,files}));
      expect(out.status).toBe('refused_by_guard');
      expect(f.fake.calls.some(c=>c.method==='POST')).toBe(false);
    }
  });
  it('enforces a total 2 MiB UTF-8 byte ceiling even for multibyte text',async()=>{
    for(const files of [
      [{path:'a.txt',content:'é'.repeat(1100000)}],
      [{path:'a.txt',content:'x'.repeat(1024000)},
        {path:'b.txt',content:'x'.repeat(1100000)}]
    ]){
      const f=fixture(),out=decode(await f.call({...args,files}));
      expect(out.status).toBe('refused_by_guard');
      expect(f.fake.calls.some(x=>x.method==='POST')).toBe(false);
    }
  });
  it('never trusts caller team IDs, forged project names or read-only profile',async()=>{
    for(const patch of [{teamId:'team_OTHER'}, {project:'prj_OTHER'},
      {expectedName:'foreign'}, {outsideApp:false}, {target:'unscoped'},
      {confirm:'yes'}, {files:'payload'}]){
      const f=fixture(),out=await f.call({...args,...patch});
      expect(out.isError||decode(out).status==='refused_by_guard').toBe(true);
      expect(f.fake.calls.every(c=>c.method!=='POST')).toBe(true);
    }
    const f=fixture();
    expect((await f.call(args,{...connection,profile:'read_only'})).isError).toBe(true);
  });
  it('denies protected resource and team-mismatched provider project',async()=>{
    for(const altered of [{...row,id:'prj_OTHER'},
      {...row,accountId:'team_OTHER'}]){
      const f=fixture(altered);
      expect(decode(await f.call({...args,confirm:true})).status)
        .toBe('refused_by_guard');
    }
    const f=fixture();
    f.db.listProtectedResources=async()=>[{match:project,note:'protected'}];
    expect(decode(await f.call({...args,confirm:true})).status)
      .toBe('refused_by_guard');
  });
});
describe('binary upload HTTP transport (offline fake only)',()=>{
  function make(){
    const fake=makeFakeVercel(),records=new Map(),claims=[];
    fake.when('POST','/v2/files').resolves({},200);
    const replayStore={
      claim:async ({key})=>{claims.push(key);
        return records.has(key)?{state:'completed',result:records.get(key)}:
          {state:'claimed',claimId:key};},
      complete:async ({key,result})=>{records.set(key,result)}
    };
    const client=makeVercelClient({token:'vcp_FAKE_not_real',account,
      fetchImpl:fake.fetch,replayStore});
    return {fake,client,claims,records};
  }
  it('uploads raw bytes once with scope and SHA header; replays exact response',async()=>{
    const f=make(),bytes=Buffer.from('Hello, file transport!','utf8');
    const sha=createHash('sha1').update(bytes).digest('hex');
    const options={requestKey:'fileUploadFAKE01',tool:'vercel_deploy_create_from_files',mode:'preview'};
    const one=await f.client.uploadFile({sha,bytes},options);
    const two=await f.client.uploadFile({sha,bytes},options);
    expect(one).toEqual({sha,size:bytes.length,uploaded:true});
    expect(two).toEqual(one);
    expect(f.fake.calls).toHaveLength(1);
    expect(f.fake.calls[0]).toMatchObject({method:'POST',path:'/v2/files',
      query:{teamId:'team_FAKE'}});
    expect(f.fake.calls[0].headers['x-vercel-digest']).toBe(sha);
    expect(f.fake.calls[0].headers['content-type']).toBe('application/octet-stream');
    expect(f.fake.calls[0].body).toEqual(bytes);
    expect(JSON.stringify(one)).not.toContain(bytes.toString());
  });
  it('rejects digest mismatches and malformed authorization metadata before transport',async()=>{
    const f=make(),bytes=Buffer.from('this cannot leak');
    for(const [sha,options] of [
      ['0'.repeat(40),{requestKey:'fileUploadFAKE02',tool:'vercel_deploy_create_from_files'}],
      [createHash('sha1').update(bytes).digest('hex'),
        {requestKey:'bad!',tool:'vercel_deploy_create_from_files'}],
      [createHash('sha1').update(bytes).digest('hex'),
        {requestKey:'fileUploadFAKE03',tool:'vercel_fake'}]
    ]) await expect(f.client.uploadFile({sha,bytes},options)).rejects.toThrow();
    expect(f.fake.calls).toHaveLength(0);expect(f.claims).toHaveLength(0);
  });
  it('retains unknown outcome on server/transport failure without retry',async()=>{
    const fake=makeFakeVercel(),keys=[];
    fake.when('POST','/v2/files').rejects(503);
    const client=makeVercelClient({token:'vcp_FAKE_token',account,
      fetchImpl:fake.fetch,replayStore:{
        claim:async c=>{keys.push(c.key);return {state:'claimed',claimId:c.key}},
        complete:async()=>{throw new Error('Must not cache failure');}
      }});
    const bytes=Buffer.from('ok'),sha=createHash('sha1').update(bytes).digest('hex');
    await expect(client.uploadFile({bytes,sha},{requestKey:'fileUploadFAKE04',
      tool:'vercel_deploy_create_from_files'}))
      .rejects.toMatchObject({code:'outcome_unknown'});
    expect(fake.calls).toHaveLength(1);expect(keys).toHaveLength(1);
  });
});
describe('AUD-H legible upload failures (VMCP-023)',()=>{
  const store=()=>({claim:async c=>({state:'claimed',claimId:c.key}),
    complete:async()=>{}});
  const bytes=Buffer.from('legible'),sha=createHash('sha1')
    .update(bytes).digest('hex');
  it('names the upload leg and HTTP status class on a provider refusal',async()=>{
    const fake=makeFakeVercel();
    fake.when('POST','/v2/files').rejects(503);
    const client=makeVercelClient({token:'vcp_FAKE_token',account,
      fetchImpl:fake.fetch,replayStore:store()});
    await expect(client.uploadFile({bytes,sha},{requestKey:'fileUploadFAKE05',
      tool:'vercel_deploy_create_from_files'}))
      .rejects.toMatchObject({code:'outcome_unknown',
        leg:'deployments_file_upload',failureClass:'http_status',status:503});
    expect(fake.calls).toHaveLength(1);
  });
  it('classifies an aborted upload fetch as a timeout, never retrying',async()=>{
    let calls=0;
    const fetchImpl=async()=>{calls++;
      const e=new Error('The operation timed out');e.name='TimeoutError';throw e;};
    const client=makeVercelClient({token:'vcp_FAKE_token',account,
      fetchImpl,replayStore:store()});
    await expect(client.uploadFile({bytes,sha},{requestKey:'fileUploadFAKE06',
      tool:'vercel_deploy_create_from_files'}))
      .rejects.toMatchObject({code:'outcome_unknown',
        leg:'deployments_file_upload',failureClass:'timeout'});
    expect(calls).toBe(1);
  });
  it('classifies a refused upload fetch as network failure',async()=>{
    const fetchImpl=async()=>{throw new TypeError('fetch failed');};
    const client=makeVercelClient({token:'vcp_FAKE_token',account,
      fetchImpl,replayStore:store()});
    await expect(client.uploadFile({bytes,sha},{requestKey:'fileUploadFAKE07',
      tool:'vercel_deploy_create_from_files'}))
      .rejects.toMatchObject({code:'outcome_unknown',
        leg:'deployments_file_upload',failureClass:'network'});
  });
});
describe('AUD-H real provider shapes through the guarded tool (VMCP-023)',()=>{
  beforeEach(()=>{vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
  const deploymentId='dpl_FAKEDEPLOY01';
  // The provider's documented encoding: a preview deployment object carries
  // target:null (the vendored snapshot: null indicates a preview deployment).
  const deploymentRow={id:deploymentId,projectId:project,target:null,
    readyState:'QUEUED',url:'my-app-git-preview.vercel.app'};
  const ownerConn={...connection,kind:'connector'};
  function ownerFixture(){
    const f=fixture();
    f.db.getPurchasePolicy=async()=>({grantRequired:false,budgetCents:null});
    f.db.getTodaySpendCents=async()=>0;
    f.fake.when('POST','/v2/files')
      .resolves({urls:['example-upload.aws.com']},200);
    return f;
  }
  it('applies a confirmed preview deployment against the real shapes',async()=>{
    const f=ownerFixture();
    f.fake.when('POST','/v13/deployments').resolves(deploymentRow);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(deploymentRow);
    const out=decode(await f.call({...args,confirm:true},ownerConn));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    f.fake.verify();
  });
  it('echoes the project record settings into the create body (AUD-J)',async()=>{
    const configured={...row,framework:'nextjs',buildCommand:'next build'};
    const f=fixture(configured);
    f.db.getPurchasePolicy=async()=>({grantRequired:false,budgetCents:null});
    f.db.getTodaySpendCents=async()=>0;
    f.fake.when('POST','/v2/files')
      .resolves({urls:['example-upload.aws.com']},200);
    f.fake.when('POST','/v13/deployments').resolves(deploymentRow);
    f.fake.when('GET','/v13/deployments/{idOrUrl}').resolves(deploymentRow);
    const out=decode(await f.call({...args,confirm:true},ownerConn));
    expect(out).toMatchObject({status:'applied',confirmed:true});
    const create=f.fake.calls.find(c=>c.method==='POST'&&
      c.path==='/v13/deployments');
    expect(create.body.projectSettings).toEqual({
      buildCommand:'next build',devCommand:null,framework:'nextjs',
      installCommand:null,outputDirectory:null,rootDirectory:null});
    f.fake.verify();
  });
  it('names the upload leg when the upload fails',async()=>{
    const f=ownerFixture();
    f.fake.when('POST','/v2/files').rejects(503);
    const out=decode(await f.call({...args,confirm:true},ownerConn));
    expect(out).toMatchObject({status:'outcome_unknown',
      failure:{leg:'deployments_file_upload',failureClass:'http_status',
        status:503}});
    f.fake.verify();
  });
  it('names the create leg and provider code when creation is refused',async()=>{
    const f=ownerFixture();
    f.fake.when('POST','/v13/deployments').rejects(400,
      {error:{code:'missing_files',message:'do-not-leak-marker'}});
    const out=decode(await f.call({...args,confirm:true},ownerConn));
    expect(out).toMatchObject({status:'outcome_unknown',
      failure:{leg:'deployments_create',code:'missing_files',status:400}});
    expect(JSON.stringify(out)).not.toContain('do-not-leak-marker');
    f.fake.verify();
  });
  it('names an unverified create response shape without leaking it',async()=>{
    const f=ownerFixture();
    f.fake.when('POST','/v13/deployments')
      .resolves({id:deploymentId,projectId:'prj_OTHER',target:null});
    const out=decode(await f.call({...args,confirm:true},ownerConn));
    expect(out).toMatchObject({status:'outcome_unknown',
      failure:{leg:'deployments_create',code:'response_shape_unverified'}});
    f.fake.verify();
  });
});
