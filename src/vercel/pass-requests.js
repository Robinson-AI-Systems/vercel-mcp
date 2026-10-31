// Service-owned encrypted proposals. Only owner setup or the owner's own
// connector connection (vercel_apply_owner_approval, AUD-AS) may consume
// and issue a pass; a delegated pass connection never can.
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
const PROJECT_ID=/^[a-zA-Z0-9_-]{3,128}$/;
// R-1W payload v2: the write-capable scope (BATCH-R amendment, 2026-10-30).
// A delegated profile, a standing spend ceiling in integer cents (0 = no
// spend) and an optional project restriction. Areas are always explicit:
// a write pass never inherits the read default.
export function writePassScope(input,knownAreas){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['writes','profile','mode','hours','areas','rateLimitPerMinute','spendLimitCents','projectIds'].includes(k)))
    throw new TypeError('Invalid write pass scope');
  const {profile='everyday',mode='preview',hours=24,areas,rateLimitPerMinute=120,
    spendLimitCents=0,projectIds=null}=input;
  if(input.writes!==true||!['everyday','full'].includes(profile)||
    !['preview','production'].includes(mode)||
    !Number.isInteger(hours)||hours<1||hours>720||
    !Number.isInteger(rateLimitPerMinute)||rateLimitPerMinute<1||rateLimitPerMinute>600||
    !Array.isArray(areas)||areas.length<1||areas.length>12||new Set(areas).size!==areas.length||
    areas.some(x=>!knownAreas.includes(x))||
    !Number.isSafeInteger(spendLimitCents)||spendLimitCents<0||spendLimitCents>2147483647||
    !(projectIds===null||(Array.isArray(projectIds)&&projectIds.length>=1&&
      projectIds.length<=50&&new Set(projectIds).size===projectIds.length&&
      projectIds.every(x=>typeof x==='string'&&PROJECT_ID.test(x)))))
    throw new TypeError('Unsupported write pass scope');
  return {writes:true,profile,mode,hours,areas:[...areas].sort(),rateLimitPerMinute,
    spendLimitCents,projectIds:projectIds===null?null:[...projectIds].sort()};
}
export async function requestPass({db,env,account,scope,now}){
  if(!ACCOUNT.test(account||'')||env?.VERCEL_ENV!=='production')throw new TypeError('Owner pass request unavailable');
  const write=scope?.writes===true;
  const payload=write?{version:2,account,...scope}:{version:1,account,...scope};
  const receipt=await oneTimeSecrets({db,env,now}).issue({account,kind:KIND,
    label:write?'Owner review of write-capable RTC pass':'Owner review of read-only RTC pass',
    value:JSON.stringify(payload),ttlMs:600000});
  return {status:'awaiting_owner_approval',ownerApprovalRequired:true,
    reference:receipt.id,expiresAt:receipt.expiresAt};
}
function decode(value,account,knownAreas,knownWriteAreas=knownAreas){
  try{
    const payload=JSON.parse(value);
    if(payload?.version===2){
      if(payload.account!==account||
        !['writes','profile','mode','hours','areas'].every(k=>Object.hasOwn(payload,k))||
        Object.keys(payload).some(k=>!['version','account','writes','profile','mode','hours','areas','rateLimitPerMinute','spendLimitCents','projectIds'].includes(k)))return null;
      return {version:2,account,...writePassScope({writes:payload.writes,profile:payload.profile,
        mode:payload.mode,hours:payload.hours,areas:payload.areas,
        rateLimitPerMinute:payload.rateLimitPerMinute??120,
        spendLimitCents:payload.spendLimitCents??0,
        projectIds:payload.projectIds??null},knownWriteAreas)};
    }
    if(payload?.version!==1||payload.account!==account||
      !['mode','hours','areas'].every(k=>Object.hasOwn(payload,k))||
      Object.keys(payload).some(k=>!['version','account','mode','hours','areas','rateLimitPerMinute'].includes(k)))return null;
    return {version:1,account,...passScope({mode:payload.mode,hours:payload.hours,areas:payload.areas,
      rateLimitPerMinute:payload.rateLimitPerMinute??120},knownAreas)};
  }catch{return null;}
}
export async function inspectPassRequest({db,env,account,reference,knownAreas,knownWriteAreas,now=()=>Date.now()}){
  if(!ACCOUNT.test(account||'')||!REF.test(reference||''))return null;
  const row=await db.getRtcPassRequest({account,reference});
  if(!row||row.id!==reference||row.vercel_account!==account||row.kind!==KIND||
    !Number.isFinite(new Date(row.expires_at).getTime())||new Date(row.expires_at).getTime()<=now())return null;
  try{return decode(decryptSecret(row.ciphertext,`once:${account}:${KIND}:${reference}`,env),account,knownAreas,knownWriteAreas);}
  catch{return null;}
}
export async function consumePassRequest({db,env,account,reference,knownAreas,knownWriteAreas,now}){
  if(!ACCOUNT.test(account||'')||!REF.test(reference||''))return null;
  const row=await oneTimeSecrets({db,env,now}).reveal({id:reference,account});
  return row?.kind===KIND?decode(row.value,account,knownAreas,knownWriteAreas):null;
}
