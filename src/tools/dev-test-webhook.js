// V-5: only synthetic, preview-bound Vercel webhooks; never impersonate a real provider event.
import {randomBytes,createHash,createHmac} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {encryptSecret,decryptSecret} from '../core/secret-box.js';
import {oneTimeSecrets} from '../core/one-time-secrets.js';
import {ownerDeployment} from './dev-observe-common.js';
import {publicAddress} from './dev-preview-fetch.js';
import {context,respond,RUN,PROJ,DEPLOY,KEY} from './dev-preview-common.js';

const EVENTS=new Set(['deployment.created','deployment.succeeded','deployment.error',
  'deployment.promoted','project.created','project.env-variable.created']);
const PATH=/^\/[A-Za-z0-9/_~.-]{0,170}$/;
const HOST=/^[a-z0-9](?:[a-z0-9-]{0,91}[a-z0-9])?\.vercel\.app$/;
const SECRET_ID='webhook-secret';
// Purpose-scoped AES-GCM AAD allows only [a-zA-Z0-9_:./-]; run IDs have
// underscores, so hash them rather than passing the raw ID to encryptSecret.
export function webhookSecretPurpose(runId){
  if(!RUN.test(runId??''))throw new TypeError('Exact run identity required');
  return 'dev-webhook:'+createHash('sha256').update(runId).digest('hex').slice(0,32)+':'+SECRET_ID;
}
const props={
  runId:{type:'string',pattern:RUN.source},project:{type:'string',pattern:PROJ.source},
  deployment:{type:'string',pattern:DEPLOY.source},
  action:{type:'string',enum:['prepare','send']},
  event:{type:'string',enum:[...EVENTS]},
  url:{type:'string',minLength:12,maxLength:250},
  requestKey:{type:'string',pattern:KEY.source},
  dryRun:{type:'boolean'},confirm:{type:'boolean'}
};
const inputSchema={type:'object',properties:props,required:['runId','project','deployment','action','event','url'],additionalProperties:false};
function validate(a){
  if(!a||typeof a!=='object'||Array.isArray(a)||
    inputSchema.required.some(k=>!Object.hasOwn(a,k))||
    Object.keys(a).some(k=>!Object.hasOwn(props,k))||
    !RUN.test(a.runId)||!PROJ.test(a.project)||!DEPLOY.test(a.deployment)||
    !['prepare','send'].includes(a.action)||!EVENTS.has(a.event)||
    a.requestKey!==undefined&&!KEY.test(a.requestKey)||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.confirm!==undefined&&typeof a.confirm!=='boolean')
    throw new RefusalError('Exact active preview and supported synthetic test event required');
}
export function checkedReceiver(raw,previewHostname){
  if(typeof raw!=='string'||raw.length>250||/[\r\n]/.test(raw))
    throw new RefusalError('Explicit public preview HTTPS URL required');
  let url;try{url=new URL(raw);}catch{throw new RefusalError('Invalid preview URL');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||
    url.search||url.hash||!HOST.test(url.hostname)||url.hostname!==previewHostname||
    !PATH.test(url.pathname)||url.pathname.includes('..')||raw.includes('%')||
    raw!==url.toString())
    throw new RefusalError('Webhook endpoint must be the exact recorded Vercel preview host and safe path');
  return url;
}
export function syntheticEvent({runId,project,deployment,event,key,at}){
  if(!EVENTS.has(event)||!RUN.test(runId)||!PROJ.test(project)||!DEPLOY.test(deployment)||
    typeof key!=='string'||!key.length||!Number.isSafeInteger(at))
    throw new TypeError('Unverified synthetic event identity');
  const id='evt_'+createHash('sha256').update([runId,deployment,event,key].join('|')).digest('hex').slice(0,24);
  return {id,type:event,createdAt:at,payload:{deploymentId:deployment,projectId:project,
    target:'preview',synthetic:true},region:'test'};
}
export function syntheticSignature(bytes,secret){
  if(!Buffer.isBuffer(bytes)||typeof secret!=='string'||secret.length<32)
    throw new TypeError('Webhook signing requires raw bytes and recorded private secret');
  return createHmac('sha1',secret).update(bytes).digest('hex');
}
export async function signedPreviewPost(url,bytes,secret,{lookupImpl=lookup,requestImpl=httpsRequest}={}){
  if(!(url instanceof URL)||!HOST.test(url.hostname)||url.protocol!=='https:'||url.port||
    !Buffer.isBuffer(bytes)||bytes.length>4096)
    throw new TypeError('Unsafe webhook transport request');
  // Resolve the FULL answer first. The HTTPS connection pins an address from it;
  // a second uncontrolled DNS lookup would reintroduce rebinding/SSRF.
  const addresses=await lookupImpl(url.hostname,{all:true,verbatim:true});
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>16||
    addresses.some(r=>![4,6].includes(r.family)||!publicAddress(r.address)))
    throw new TypeError('Webhook destination resolves privately, inconsistently or incompletely');
  const {address,family}=addresses[0];
  const signature=syntheticSignature(bytes,secret);
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(err,result)=>{if(settled)return;settled=true;
      if(err)reject(err);else resolve(result);};
    const req=requestImpl(url,{
      method:'POST',agent:false,timeout:3000,servername:url.hostname,
      lookup:(_hostname,_opts,callback)=>callback(null,address,family),
      headers:{'content-type':'application/json','content-length':bytes.length,
        'x-vercel-signature':signature,'x-robinson-synthetic':'true'}
    },res=>{
      const status=res.statusCode;
      // Do not follow Location, do not expose response body/headers. A receipt
      // attests only the HTTP acknowledgement, never application-side effects.
      res.resume();
      if(!Number.isInteger(status)||status<200||status>=300)
        finish(new TypeError('Synthetic webhook receiver refused or redirected'));
      else finish(null,{status,acknowledged:true});
    });
    req.on('timeout',()=>req.destroy(new Error('Bounded synthetic delivery timed out')));
    req.on('error',err=>finish(err));
    req.end(bytes);
  });
}
function activeSecret(objects){
  return objects.find(x=>x.object_type==='webhook'&&x.object_id===SECRET_ID&&x.status==='active');
}
const send=defineWrite({
  name:'vercel_dev_send_test_webhook',secretOut:true,oneTimeDelivery:true,
  oneTimeWhen:a=>a.action==='prepare',
  async before(a,ctx){
    validate(a);
    if(ctx.connection?.mode!=='preview'||!['everyday','full'].includes(ctx.connection?.profile))
      throw new RefusalError('Developer webhook is preview-only and needs delegated builder write access');
    const d=await ownerDeployment(ctx,a);
    if(d.deployment?.readyState!=='READY'||typeof d.deployment.url!=='string')
      throw new RefusalError('An exact READY recorded preview is required');
    const host=d.deployment.url.toLowerCase();
    if(!HOST.test(host))throw new RefusalError('Preview host identity was not attested');
    const url=checkedReceiver(a.url,host);
    const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:a.runId});
    if(!Array.isArray(objects)||objects.length>=100)
      throw new RefusalError('Run inventory not proven complete');
    const row=activeSecret(objects);
    if(a.action==='prepare'&&row||a.action==='send'&&!row)
      throw new RefusalError(a.action==='prepare'?'Webhook signing key already prepared':'Prepare a private per-run signing key first');
    return {runId:a.runId,project:a.project,deployment:a.deployment,teamId:d.account.team_id,
      url:url.toString(),event:a.event,action:a.action,
      keyPrepared:Boolean(row),host};
  },
  async preview(_a,_ctx,b){
    return b.action==='prepare'?
      'Create one run-owned synthetic signing key for '+b.host+'; reveal only once through vercel_reveal_one_time_secret.':
      'Send ONE synthetic '+b.event+' notification to '+b.url+
      '. This is NOT a genuine Vercel delivery and may trigger the receiver. No redirect/retry is permitted.';
  },
  async production(){return {production:false,why:'Native READY preview and same-host synthetic receiver only'};},
  async targets(_a,b){return [{kind:'project',id:b.project},{kind:'deployment',id:b.deployment,projectId:b.project}];},
  async apply(a,ctx,b,key){
    await requirePreDispatch(async()=>{
      const fresh=await ownerDeployment(ctx,a);
      if(fresh.account.team_id!==b.teamId||fresh.deployment.readyState!=='READY'||
         fresh.deployment.url?.toLowerCase()!==b.host)
        throw new TypeError('Preview ownership/serving state changed before webhook operation');
    });
    if(b.action==='prepare'){
      const value=randomBytes(32).toString('hex');
      const ciphertext=encryptSecret(value,webhookSecretPurpose(b.runId),ctx.env);
      await ctx.db.addDevRunObject({account:ctx.connection.account,id:b.runId,
        type:'webhook',objectId:SECRET_ID,projectId:b.project,detail:{ciphertext}});
      const receipt=await oneTimeSecrets({db:ctx.db,env:ctx.env}).issue({
        account:ctx.connection.account,kind:'dev_synthetic_webhook',label:'Preview synthetic signing key',value});
      return {prepared:true,ownerRevealRef:receipt.id,expiresAt:receipt.expiresAt};
    }
    const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    const saved=Array.isArray(objects)?activeSecret(objects):null;
    if(!b.keyPrepared||typeof saved?.detail?.ciphertext!=='string')
      throw new TypeError('Run-owned private synthetic key not available');
    const value=decryptSecret(saved.detail.ciphertext,webhookSecretPurpose(b.runId),ctx.env);
    const body=Buffer.from(JSON.stringify(syntheticEvent({
      runId:b.runId,project:b.project,deployment:b.deployment,event:b.event,key,at:Date.now()
    })),'utf8');
    // Dispatch is one-shot: transport ambiguity stays unknown; never replay an
    // external POST as though it were a safe GET or retriable status poll.
    const delivered=await (ctx.webhookPost??signedPreviewPost)(new URL(b.url),body,value);
    return {synthetic:true,event:b.event,receiverStatus:delivered.status,
      httpAcknowledged:delivered.acknowledged===true,receiverSideEffectsVerified:false};
  },
  async publicReceipt(a,_b,_r,v){
    if(a.action==='prepare')return null;
    return {event:v.event,receiverStatus:v.receiverStatus,synthetic:true,
      receiverSideEffectsVerified:false};
  },
  async verify(_a,ctx,b,r){
    if(b.action==='prepare'){
      const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
      return {confirmed:!!activeSecret(objects),ownerRevealRef:r.ownerRevealRef,expiresAt:r.expiresAt};
    }
    return {confirmed:r?.httpAcknowledged===true,receiverStatus:r.receiverStatus,
      synthetic:true,receiverSideEffectsVerified:false};
  }
});
export const devWebhookTools={
  tools:[{name:'vercel_dev_send_test_webhook',area:'developer',writes:true,guardedWrite:true,
    profiles:['everyday','full'],inputSchema,writeContract:send.writeContract,
    description:'Prepare a private signing key or deliver one signed synthetic event only to a recorded preview receiver.',
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_dev_send_test_webhook:bindGuardedWrite(send,ctx=>({
    ...context(ctx),webhookPost:ctx.webhookPost}),respond)}
};
