// Service-owned encrypted proposals. Only owner setup may consume and issue a pass.
import {oneTimeSecrets} from '../core/one-time-secrets.js';
import {decryptSecret} from '../core/secret-box.js';
const KIND='rtc_pass_request';
const ACCOUNT=/^[a-zA-Z0-9_/-]{3,256}$/;
const REF=/^[0-9a-f-]{36}$/;
export function passScope(input,knownAreas){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['mode','hours','areas','rateLimitPerMinute'].includes(k)))
    throw new TypeError('Invalid read-only pass scope');
  const {mode='preview',hours=24,areas=['server'],rateLimitPerMinute=120}=input;
  if(!['preview','test'].includes(mode)||!Number.isInteger(hours)||hours<1||hours>720||
    !Number.isInteger(rateLimitPerMinute)||rateLimitPerMinute<1||rateLimitPerMinute>600||
    !Array.isArray(areas)||areas.length<1||areas.length>12||new Set(areas).size!==areas.length||
    areas.some(x=>!knownAreas.includes(x))||mode==='test'&&(areas.length!==1||areas[0]!=='server'))
    throw new TypeError('Unsupported read-only pass scope');
  return {mode,hours,areas:[...areas].sort(),rateLimitPerMinute};
}
export async function requestPass({db,env,account,scope,now}){
  if(!ACCOUNT.test(account||'')||env?.VERCEL_ENV!=='production')throw new TypeError('Owner pass request unavailable');
  const payload={version:1,account,...scope};
  const receipt=await oneTimeSecrets({db,env,now}).issue({account,kind:KIND,
    label:'Owner review of read-only RTC pass',value:JSON.stringify(payload),ttlMs:600000});
  return {status:'awaiting_owner_approval',ownerApprovalRequired:true,
    reference:receipt.id,expiresAt:receipt.expiresAt};
}
function decode(value,account,knownAreas){
  try{
    const payload=JSON.parse(value);
    if(payload?.version!==1||payload.account!==account||
      !['mode','hours','areas'].every(k=>Object.hasOwn(payload,k))||
      Object.keys(payload).some(k=>!['version','account','mode','hours','areas','rateLimitPerMinute'].includes(k)))return null;
    return {version:1,account,...passScope({mode:payload.mode,hours:payload.hours,areas:payload.areas,
      rateLimitPerMinute:payload.rateLimitPerMinute??120},knownAreas)};
  }catch{return null;}
}
export async function inspectPassRequest({db,env,account,reference,knownAreas,now=()=>Date.now()}){
  if(!ACCOUNT.test(account||'')||!REF.test(reference||''))return null;
  const row=await db.getRtcPassRequest({account,reference});
  if(!row||row.id!==reference||row.vercel_account!==account||row.kind!==KIND||
    !Number.isFinite(new Date(row.expires_at).getTime())||new Date(row.expires_at).getTime()<=now())return null;
  try{return decode(decryptSecret(row.ciphertext,`once:${account}:${KIND}:${reference}`,env),account,knownAreas);}
  catch{return null;}
}
export async function consumePassRequest({db,env,account,reference,knownAreas,now}){
  if(!ACCOUNT.test(account||'')||!REF.test(reference||''))return null;
  const row=await oneTimeSecrets({db,env,now}).reveal({id:reference,account});
  return row?.kind===KIND?decode(row.value,account,knownAreas):null;
}
