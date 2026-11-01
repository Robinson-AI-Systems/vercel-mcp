// Owner-operated, read-only HTTPS evidence runner. Never print or persist bearer
// values, provider responses, project IDs, file bytes or raw error messages.
// Real acceptance requires independently approved nonproduction resources.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export class AcceptanceFailure extends Error {
  constructor(code) { super(code); this.name='AcceptanceFailure'; }
}
const PASS=/^rtc_pass_[A-Za-z0-9_-]{43}$/;
const DEPLOY=/^dpl_[A-Za-z0-9_-]{3,120}$/;
const PROJECT=/^prj_[A-Za-z0-9_-]{3,120}$/;
const FILE=/^[a-fA-F0-9]{32,128}$/;
const HASH=/^[a-f0-9]{64}$/;
function requireThat(ok,code) { if(!ok)throw new AcceptanceFailure(code); }
function cleanOrigin(value) {
  requireThat(typeof value==='string','origin_required');
  let url;
  try { url=new URL(value); } catch { throw new AcceptanceFailure('invalid_origin'); }
  requireThat(url.protocol==='https:'&&url.origin===value&&url.username===''&&
    url.password===''&&url.pathname==='/'&&url.search===''&&url.hash===''&&
    url.port==='','invalid_origin');
  return value;
}
function passCheck(value) {
  requireThat(typeof value==='string'&&PASS.test(value),'invalid_protected_pass');
}
function argsCheck(options) {
  const {phase,testPass,previewPass,project,deployment,fileId,expectedSha256}=options;
  requireThat(['before','after-revocation'].includes(phase),'invalid_phase');
  if(testPass)passCheck(testPass);
  if(previewPass)passCheck(previewPass);
  requireThat(!testPass||testPass!==previewPass,'passes_must_be_independently_scoped');
  if(phase==='after-revocation')
    requireThat(Boolean(testPass||previewPass),'revoked_pass_required');
  if(project||deployment||fileId||expectedSha256){
    requireThat(phase==='before'&&Boolean(previewPass)&&PROJECT.test(project||'')&&
      DEPLOY.test(deployment||''),'approved_project_and_deployment_required');
  }
  if(fileId||expectedSha256)requireThat(FILE.test(fileId||'')&&HASH.test(expectedSha256||''),
    'verified_file_and_expected_digest_required');
}
async function readJsonLimited(response) {
  // Never buffer unbounded or echo provider-returned content on failure.
  const length=response.headers?.get('content-length');
  requireThat(!length||/^[0-9]{1,7}$/.test(length)&&Number(length)<=8192,
    'http_response_too_large');
  requireThat(Boolean(response.body?.getReader),'invalid_http_body');
  const reader=response.body.getReader();
  const parts=[];
  let lengthSoFar=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      requireThat(value instanceof Uint8Array,'invalid_http_bytes');
      lengthSoFar+=value.byteLength;
      requireThat(lengthSoFar<=8192,'http_response_too_large');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  const bytes=Buffer.concat(parts,lengthSoFar);
  let parsed;
  try { parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new AcceptanceFailure('invalid_json_envelope'); }
  requireThat(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),
    'invalid_json_envelope');
  return parsed;
}
async function fetchBounded(origin,path,{pass,method='GET',body,fetchImpl}) {
  const headers={accept:'application/json'};
  if(pass)headers.authorization='Bearer '+pass;
  if(body!==undefined)headers['content-type']='application/json';
  let response;
  try {
    response=await fetchImpl(origin+path,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),
      redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(7000)});
  } catch { throw new AcceptanceFailure('http_request_failed'); }
  requireThat(Number.isInteger(response?.status),'invalid_http_status');
  requireThat(response.status<300||response.status>=400,'http_redirect_refused');
  return {status:response.status,data:await readJsonLimited(response)};
}
function requireStatus(reply,status,code) {
  requireThat(reply.status===status,code+'_http_'+reply.status);
}
async function call(origin,path,options,status=200) {
  const reply=await fetchBounded(origin,path,options);
  requireStatus(reply,status,'unexpected_'+path.replace(/[^a-z]/gi,'_'));
  return reply.data;
}
function result(data) {
  requireThat(data?.ok===true&&data.result&&typeof data.result==='object',
    'unverified_response_envelope');
  return data.result;
}
export async function checkConnectedAcceptance({
  origin,testPass,previewPass,project,deployment,fileId,expectedSha256,
  phase='before',fetchImpl=fetch
}) {
  origin=cleanOrigin(origin);
  argsCheck({phase,testPass,previewPass,project,deployment,fileId,expectedSha256});
  const summary={originVerified:false,oauthDiscovery:false,anonymousDenied:false,
    testIdentity:false,testProviderDenied:false,previewScoped:false,
    fileDigestVerified:false,runtimeStreamObserved:false,
    revocationDenied:false,connectedProviderAcceptance:'unverified'};
  const publicContract=await call(origin,'/api/contract',{fetchImpl});
  requireThat(publicContract.rtc===1&&publicContract.server==='robinson-vercel-mcp',
    'unexpected_public_contract');
  summary.originVerified=true;
  const discovery=await call(origin,'/.well-known/oauth-authorization-server',{fetchImpl});
  requireThat(discovery.issuer===origin&&
    discovery.authorization_endpoint===origin+'/api/oauth/authorize'&&
    discovery.token_endpoint===origin+'/api/oauth/token'&&
    Array.isArray(discovery.code_challenge_methods_supported)&&
    discovery.code_challenge_methods_supported.includes('S256'),
    'unexpected_oauth_discovery');
  summary.oauthDiscovery=true;
  await call(origin,'/api/whoami',{fetchImpl},401);
  await call(origin,'/api/whoami',{fetchImpl,pass:'not-a-pass'},401);
  summary.anonymousDenied=true;
  if(phase==='after-revocation') {
    for(const pass of [testPass,previewPass].filter(Boolean)) {
      const reply=await call(origin,'/api/whoami',{fetchImpl,pass},401);
      // A random invalid or merely expired pass also gets 401. Only the
      // dedicated server-side revocation status proves this control worked.
      requireThat(reply?.ok===false&&reply?.error?.code==='pass_revoked',
        'revocation_not_independently_proven');
    }
    summary.revocationDenied=true;
    return summary;
  }
  if(testPass) {
    const identity=result(await call(origin,'/api/whoami',{fetchImpl,pass:testPass}));
    requireThat(identity.mode==='test'&&identity.profile==='read_only'&&
      Array.isArray(identity.areas)&&identity.areas.length===1&&identity.areas[0]==='server',
      'test_pass_not_isolated');
    const tools=result(await call(origin,'/api/tools?limit=20',{fetchImpl,pass:testPass}));
    requireThat(Array.isArray(tools.tools)&&tools.tools.length===1&&
      tools.tools[0].name==='vercel_whoami','test_discovery_not_isolated');
    const read=result(await call(origin,'/api/tools/vercel_whoami',
      {fetchImpl,pass:testPass,method:'POST',body:{}}));
    requireThat(read.rtc===1&&read.mode==='test'&&read.providerAccess===false,
      'test_identity_not_proven');
    summary.testIdentity=true;
    const denied=await call(origin,'/api/tools/vercel_deploy_list',
      {fetchImpl,pass:testPass,method:'POST',body:{}},403);
    requireThat(denied?.ok===false,'test_provider_read_not_denied');
    summary.testProviderDenied=true;
  }
  if(previewPass) {
    const identity=result(await call(origin,'/api/whoami',{fetchImpl,pass:previewPass}));
    requireThat(identity.mode==='preview'&&identity.profile==='read_only'&&
      Array.isArray(identity.areas)&&identity.areas.includes('deployments'),
      'preview_pass_not_scoped');
    const denied=await call(origin,'/api/tools/vercel_project_create',
      {fetchImpl,pass:previewPass,method:'POST',body:{}},403);
    requireThat(denied?.ok===false,'write_not_denied');
    summary.previewScoped=true;
    if(deployment) {
      const base={project,deployment};
      const logs=result(await call(origin,'/api/tools/vercel_deploy_get_runtime_logs',
        {fetchImpl,pass:previewPass,method:'POST',body:base}));
      requireThat(logs.project===project&&logs.deployment===deployment&&
        logs.containsRawLogText===false&&Number.isSafeInteger(logs.scanned)&&
        logs.scanned>=0&&logs.transport?.complete===false,
        'unverified_provider_runtime_sample');
      summary.runtimeStreamObserved=logs.scanned>0;
      if(fileId) {
        const file=result(await call(origin,'/api/tools/vercel_deploy_get_file',
          {fetchImpl,pass:previewPass,method:'POST',body:{...base,fileId}}));
        requireThat(file.project===project&&file.deployment===deployment&&
          file.fileId===fileId&&typeof file.content==='string'&&
          Buffer.byteLength(file.content)<=2048&&
          file.bytes===Buffer.byteLength(file.content),
          'unverified_provider_file_identity');
        requireThat(createHash('sha256').update(file.content,'utf8').digest('hex')===
          expectedSha256,'provider_file_digest_mismatch');
        summary.fileDigestVerified=true;
      }
      summary.connectedProviderAcceptance=summary.runtimeStreamObserved&&
        summary.fileDigestVerified?'file_digest_and_runtime_rows_verified':
        'partial_nonproduction_observations_only';
    }
  }
  return summary;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  checkConnectedAcceptance({
    origin:process.env.VERCEL_MCP_ORIGIN||'https://vercel.robinsonaisystems.com',
    testPass:process.env.RTC_TEST_PASS,previewPass:process.env.RTC_PREVIEW_PASS,
    project:process.env.RTC_APPROVED_PROJECT_ID,
    deployment:process.env.RTC_APPROVED_DEPLOYMENT_ID,
    fileId:process.env.RTC_APPROVED_FILE_ID,
    expectedSha256:process.env.RTC_EXPECTED_FILE_SHA256,
    phase:process.env.RTC_ACCEPTANCE_PHASE||'before'
  }).then(value=>{
    // Only constant labels and bounded Booleans. No credential or source output.
    process.stdout.write(JSON.stringify(value)+'\n');
  }).catch(error=>{
    process.stderr.write('Connected acceptance blocked: '+
      (error instanceof AcceptanceFailure?error.message:'internal_error')+'\n');
    process.exitCode=1;
  });
}
