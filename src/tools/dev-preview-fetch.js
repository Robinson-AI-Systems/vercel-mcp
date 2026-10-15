// V-3: SSRF/redirect-resistant smoke fetch for an owned, exact preview hostname.
// The private bypass is decrypted only in-process and never returned to the caller.
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {decryptSecret} from '../core/secret-box.js';
import {ownerDeployment,activeObject,base,schema,reply,assertInput,safeText}
  from './dev-observe-common.js';
const BYPASS=/^byp_[a-f0-9]{32}$/;
const HOST=/^[a-z0-9](?:[a-z0-9-]{0,90}[a-z0-9])?\.vercel\.app$/;
const props={...base,
  paths:{type:'array',minItems:1,maxItems:10,uniqueItems:true,
    items:{type:'string',minLength:1,maxLength:180}},
  bypassId:{type:'string',pattern:BYPASS.source}};
const inputSchema=schema(props,['runId','project','deployment','paths']);
function safePath(value){
  return typeof value==='string'&&value.startsWith('/')&&value.length<=180&&
    !value.startsWith('//')&&!value.includes('..')&&!value.includes('\\')&&
    !value.includes('%')&&!value.includes('?')&&!value.includes('#')&&
    /^\/[a-zA-Z0-9_./~-]*$/.test(value);
}
export function publicAddress(address){
  const type=isIP(address);
  if(type===4){
    const [a,b,c,d]=address.split('.').map(Number);
    return a>=1&&a<=223&&a!==10&&a!==127&&a!==0&&
      !(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&
      !(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||
        b===0||b===88&&c===99))&&!(a===198&&(b===18||b===19))&&
      !(a===203&&b===0&&c===113)&&!(a===192&&b===0&&c===2)&&
      !(a===198&&b===51&&c===100)&&d>=0&&d<=255;
  }
  if(type===6){
    const normalized=address.toLowerCase();
    // Vercel public IPv6 uses globally routable 2000::/3. All loopback,
    // link-local, ULA, mapped and unassigned ranges are denied.
    return /^[23][0-9a-f]{0,3}:/.test(normalized)&&
      !normalized.startsWith('2001:db8:')&&!normalized.startsWith('2001:0:');
  }
  return false;
}
async function publicHost(host){
  if(!HOST.test(host))throw new TypeError('Only verified Vercel preview hostnames may be fetched');
  const records=await lookup(host,{all:true,verbatim:true});
  if(!Array.isArray(records)||records.length<1||records.length>16||
     records.some(r=>!publicAddress(r.address)))
    throw new TypeError('Preview hostname resolved to private, mixed or unverifiable addresses');
}
async function snippet(response,max=4096){
  if(!response.body||typeof response.body.getReader!=='function')
    return {sample:'',truncated:false};
  const reader=response.body.getReader();
  let total=0,more=false;const chunks=[];
  try{
    for(let i=0;i<64;i++){
      const {value,done}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw new TypeError('Invalid response stream');
      const room=max-total,used=value.subarray(0,Math.max(0,room));
      chunks.push(Buffer.from(used));total+=used.length;
      if(value.length>room||total>=max){more=true;break;}
    }
  }finally{try{await reader.cancel();}catch{/* Already closed */}}
  return {sample:Buffer.concat(chunks).toString('utf8'),truncated:more};
}
async function readBypass(a,ctx,b){
  if(a.bypassId===undefined)return null;
  if(!BYPASS.test(a.bypassId))throw new TypeError('Malformed recorded bypass ID');
  const item=activeObject(b.objects,'bypass',a.bypassId,a.project);
  if(typeof item.detail?.ciphertext!=='string')
    throw new TypeError('Server-side bypass revocation evidence unavailable');
  return decryptSecret(item.detail.ciphertext,
    'dev-bypass:'+a.runId+':'+a.bypassId,ctx.env);
}
function hostOf(row){
  const input=row?.url;
  if(typeof input!=='string'||input.length>253)
    throw new TypeError('Provider did not attest preview URL');
  let url;
  try{url=new URL('https://'+input);}
  catch{throw new TypeError('Malformed preview URL');}
  if(url.username||url.password||url.port||url.pathname!=='/'||
     url.search||url.hash||!HOST.test(url.hostname))
    throw new TypeError('Preview URL is not a safe Vercel hostname');
  return url.hostname;
}
const safeHeader=response=>{
  const get=k=>{
    const x=response.headers?.get(k);
    return typeof x==='string'&&x.length<=100?safeText(x,100):null;
  };
  return {contentType:get('content-type'),cache:get('x-vercel-cache'),
    requestId:get('x-vercel-id')};
};
export const devPreviewFetchTools={
  tools:[{name:'vercel_dev_fetch_preview',area:'developer',writes:false,
    profiles:['read_only','everyday','full'],
    description:'Smoke-fetch ten or fewer paths on an exact owned preview with server-private bypass and no redirects.',
    inputSchema,annotations:{readOnlyHint:true}}],
  handlers:{
    async vercel_dev_fetch_preview(a,ctx){
      assertInput(a,Object.keys(props),inputSchema.required);
      if(!Array.isArray(a.paths)||a.paths.length<1||a.paths.length>10||
         new Set(a.paths).size!==a.paths.length||
         a.paths.some(x=>!safePath(x))||
         a.bypassId!==undefined&&!BYPASS.test(a.bypassId))
        throw new TypeError('Unsafe preview fetch path or bypass identity');
      const b=await ownerDeployment(ctx,a);
      const host=hostOf(b.deployment);
      await publicHost(host);
      const bypass=await readBypass(a,ctx,b);
      const fetcher=ctx.fetchImpl??fetch;
      const results=[];
      for(const path of a.paths){
        let response;
        try{
          response=await fetcher('https://'+host+path,{
            method:'GET',redirect:'manual',signal:AbortSignal.timeout(3000),
            headers:{accept:'text/html,application/json,text/plain',
              ...(bypass?{'x-vercel-protection-bypass':bypass}:{})}
          });
          if(response.status>=300&&response.status<400)
            throw new TypeError('Preview redirect refused before following it');
          if(typeof response.status!=='number'||response.status<100||response.status>599)
            throw new TypeError('Invalid upstream preview response');
          const read=await snippet(response);
          results.push({path,status:response.status,headers:safeHeader(response),
            body:safeText(read.sample,4096),truncated:read.truncated,
            completed:true});
        }catch{
          results.push({path,status:null,completed:false,
            reason:'Preview fetch failed, redirected or exceeded its bounded deadline'});
        }
      }
      return reply({runId:a.runId,deployment:a.deployment,host,
        results,complete:results.every(x=>x.completed),
        bypassUsed:Boolean(bypass),bypassValueReturned:false,
        note:'Only recorded, pre-resolved public preview hosts are eligible; no redirect is followed'});
    }
  }
};
