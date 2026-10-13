import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {checkConnectedAcceptance,AcceptanceFailure} from '../../scripts/check-connected-acceptance.mjs';

const origin='https://vercel-mcp-liard.vercel.app';
const testPass='rtc_pass_'+('A'.repeat(43));
const previewPass='rtc_pass_'+('B'.repeat(43));
const project='prj_ONE123',deployment='dpl_ONE123',fileId='a'.repeat(40);
const source='A harmless public test file.';
const expectedSha256=createHash('sha256').update(source).digest('hex');
function fixture({revoked=false,missingTeam=false,logRows=2,wrongFile=false}={}) {
  const calls=[];
  const api=vi.fn(async(url,init)=>{
    const path=new URL(url).pathname+new URL(url).search;
    calls.push({path,method:init.method,headers:init.headers,body:init.body,
      redirect:init.redirect});
    const token=init.headers.authorization;
    let status=200,body;
    if(path==='/api/contract')
      body={rtc:1,server:'robinson-vercel-mcp',counts:{tools:51}};
    else if(path==='/.well-known/oauth-authorization-server')
      body={issuer:origin,authorization_endpoint:origin+'/api/oauth/authorize',
        token_endpoint:origin+'/api/oauth/token',code_challenge_methods_supported:['S256']};
    else if(!token||token==='Bearer not-a-pass'||revoked) {
      status=401;body={ok:false,error:{code:revoked?'pass_revoked':'permission'}};
    }else if(path==='/api/whoami') {
      body={ok:true,result:token==='Bearer '+testPass?
        {mode:'test',profile:'read_only',areas:['server']}:
        {mode:'preview',profile:'read_only',areas:missingTeam?['server']:['server','deployments']}};
    }else if(path==='/api/tools?limit=20')
      body={ok:true,result:{tools:[{name:'vercel_whoami'}],count:1,next:null}};
    else if(path==='/api/tools/vercel_whoami')
      body={ok:true,result:{rtc:1,mode:'test',providerAccess:false,scope:'service_only'}};
    else if(['/api/tools/vercel_deploy_list','/api/tools/vercel_project_create'].includes(path)){
      status=403;body={ok:false,error:{code:'outside_scope'}};
    }else if(path==='/api/tools/vercel_deploy_get_runtime_logs')
      body={ok:true,result:{project,deployment,scanned:logRows,inWindow:logRows,
        containsRawLogText:false,transport:{complete:false,cutoff:'stream_end'}}};
    else if(path==='/api/tools/vercel_deploy_get_file')
      body={ok:true,result:{project,deployment,fileId,content:wrongFile?'tampered':source,
        bytes:Buffer.byteLength(wrongFile?'tampered':source)}};
    else throw new Error('Unexpected test route: '+path);
    return new Response(JSON.stringify(body),{status,
      headers:{'content-type':'application/json'}});
  });
  return {api,calls};
}
describe('secure owner-operated connected evidence runner',()=>{
 it('verifies public RTC and OAuth discovery plus denial without needing a bearer',async()=>{
   const f=fixture();const evidence=await checkConnectedAcceptance({origin,fetchImpl:f.api});
   expect(evidence).toMatchObject({originVerified:true,oauthDiscovery:true,
     anonymousDenied:true,testIdentity:false,connectedProviderAcceptance:'unverified'});
   expect(f.calls).toHaveLength(4);
   expect(f.calls.every(row=>row.method==='GET'&&row.redirect==='manual')).toBe(true);
 });
 it('proves TEST service-only identity and denied provider routing without any provider read',async()=>{
   const f=fixture();const evidence=await checkConnectedAcceptance({origin,testPass,fetchImpl:f.api});
   expect(evidence).toMatchObject({testIdentity:true,testProviderDenied:true,
     previewScoped:false,connectedProviderAcceptance:'unverified'});
   expect(f.calls.some(row=>row.path==='/api/tools/vercel_deploy_get_file')).toBe(false);
   expect(f.calls.some(row=>row.path==='/api/tools/vercel_deploy_get_runtime_logs')).toBe(false);
   expect(f.calls.find(row=>row.path==='/api/tools/vercel_deploy_list').method).toBe('POST');
 });
 it('checks provider file bytes by digest without echoing data or bearer into evidence',async()=>{
   const f=fixture();
   const evidence=await checkConnectedAcceptance({origin,previewPass,project,deployment,
     fileId,expectedSha256,fetchImpl:f.api});
   expect(evidence).toMatchObject({previewScoped:true,fileDigestVerified:true,
     runtimeStreamObserved:true,
     connectedProviderAcceptance:'file_digest_and_runtime_rows_verified'});
   const serialized=JSON.stringify(evidence);
   expect(serialized).not.toContain(source);
   expect(serialized).not.toContain(previewPass);
   expect(serialized).not.toContain(project);
   expect(serialized).not.toContain(deployment);
   expect(f.calls.filter(row=>row.path.startsWith('/api/tools/')).every(row=>
     row.method==='POST'&&row.headers.authorization==='Bearer '+previewPass)).toBe(true);
 });
 it('does not infer runtime data existed when the streamed sample has zero entries',async()=>{
   const f=fixture({logRows:0});
   const evidence=await checkConnectedAcceptance({origin,previewPass,project,deployment,
     fileId,expectedSha256,fetchImpl:f.api});
   expect(evidence.runtimeStreamObserved).toBe(false);
   expect(evidence.connectedProviderAcceptance).toBe('partial_nonproduction_observations_only');
 });
 it('rejects missing expected file integrity proof before sending a request',async()=>{
   const f=fixture();
   await expect(checkConnectedAcceptance({origin,previewPass,project,deployment,
     fileId,fetchImpl:f.api})).rejects.toThrow('verified_file_and_expected_digest_required');
   expect(f.api).not.toHaveBeenCalled();
 });
 it('fails closed on an unexpected source digest and does not return raw contents',async()=>{
   const f=fixture({wrongFile:true});
   await expect(checkConnectedAcceptance({origin,previewPass,project,deployment,
     fileId,expectedSha256,fetchImpl:f.api})).rejects.toThrow('provider_file_digest_mismatch');
 });
 it('rejects preview passes without deployment read area before any provider read',async()=>{
   const f=fixture({missingTeam:true});
   await expect(checkConnectedAcceptance({origin,previewPass,project,deployment,
     fetchImpl:f.api})).rejects.toThrow('preview_pass_not_scoped');
   expect(f.calls.some(row=>row.path.includes('runtime_logs'))).toBe(false);
 });
 it('checks actual post-revocation 401 without issuing another tool call',async()=>{
   const f=fixture({revoked:true});
   const evidence=await checkConnectedAcceptance({origin,testPass,previewPass,
     phase:'after-revocation',fetchImpl:f.api});
   expect(evidence.revocationDenied).toBe(true);
   expect(f.calls.filter(row=>row.path==='/api/whoami')).toHaveLength(4);
   expect(f.calls.some(row=>row.path.includes('/api/tools/'))).toBe(false);
 });
 it('denies insecure origins and unverified deployment scope without network I/O',async()=>{
   const f=fixture();
   for(const settings of [
     {origin:'http://vercel-mcp-liard.vercel.app'},
     {origin:origin+'/api/mcp'},
     {origin:origin+'?token=private'},
     {origin,previewPass,deployment},
     {origin,previewPass,project,deployment:'not-deployment'}
   ])await expect(checkConnectedAcceptance({...settings,fetchImpl:f.api}))
     .rejects.toBeInstanceOf(AcceptanceFailure);
   expect(f.api).not.toHaveBeenCalled();
 });
 it('does not echo an upstream response body or exception into errors',async()=>{
   const api=vi.fn(async()=>new Response('{"private":"do not echo",',{status:200}));
   await expect(checkConnectedAcceptance({origin,fetchImpl:api}))
     .rejects.toThrow('invalid_json_envelope');
   const oversized=vi.fn(async()=>new Response('X'.repeat(9000),{status:200}));
   await expect(checkConnectedAcceptance({origin,fetchImpl:oversized}))
     .rejects.toThrow('http_response_too_large');
 });
});
