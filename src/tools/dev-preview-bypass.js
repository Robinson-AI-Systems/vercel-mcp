// V-2: owner-only one-time automation bypass for isolated run-owned scratch projects.
// Vercel's bypass is project-wide, so never enable it for a live/mixed-use project.
import {randomBytes,createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {encryptSecret} from '../core/secret-box.js';
import {oneTimeSecrets} from '../core/one-time-secrets.js';
import {readProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {common,exact,owned,boundedLabel,context,respond,
  preIntent,record,markIntent,selectedWrite} from './dev-preview-common.js';
const props={...common,note:{type:'string',minLength:3,maxLength:80}};
const schema={type:'object',properties:props,
  required:['runId','project','note'],additionalProperties:false};
function complete(result,key){
  const entries=result?.[key];
  if(!Array.isArray(entries)||entries.length>100||
     result.pagination?.next!==null||result.pagination?.count!==entries.length)
    throw new TypeError('Production/alias inventory cannot be verified completely');
  return entries;
}
async function isolated(client,b){
  const [row,deps,domains]=await Promise.all([
    client.request('projects_get',{path:{idOrName:b.project}}),
    client.request('deployments_list',{query:{projectId:b.project,limit:100}}),
    client.request('projects_domains_list',{path:{idOrName:b.project}})]);
  if(row?.id!==b.project||row.name!==b.name||!row.name.startsWith(
    'rtc-'+b.runId.replaceAll('_','-')+'-')||
     row.productionDeployment||row.productionDeploymentId||
     complete(deps,'deployments').some(d=>
       d.projectId!==b.project||d.target!=='preview')||
     complete(domains,'domains').length)
    throw new TypeError('Protection bypass is unsafe on a project with any live or unknown traffic');
}
const bypass=defineWrite({
  name:'vercel_dev_create_bypass',risk:{access:true},secretOut:true,oneTimeDelivery:true,
  async before(a,ctx){
    exact(a,props,schema.required);
    if(!boundedLabel(a.note))throw new TypeError('Unsafe bypass note');
    const b=await owned(a,ctx,{requireRun:true});
    const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    if(!objects.some(o=>o.object_type==='project'&&o.object_id===b.project&&
        o.status==='active'))
      throw new TypeError('Only an owned run scratch project can receive a bypass');
    const {client}=await readProvider(ctx);
    await isolated(client,b);
    const probe={generate:{secret:'a'.repeat(32),note:a.note}};
    validateRequest('project_protection_bypass_update',{
      path:{idOrName:b.project},query:{teamId:b.teamId},body:probe});
    return {...b,note:a.note};
  },
  async preview(_a,_ctx,b){
    return 'Generate a single automation-bypass credential for isolated, run-owned scratch project '+
      b.project+'. It can widen project access; the value is revealed only on authenticated setup, never here.';
  },
  async production(){return {production:false,why:'Exclusively unaliased run-owned preview scratch project'};},
  async access(){return {widens:true,who:'Holder of the automation bypass',
    what:'Bypass Vercel deployment protection for isolated scratch project'};},
  async targets(_a,b){return [{kind:'project',id:b.project,name:b.name}];},
  async apply(_a,ctx,b,key){
    const provider=await selectedWrite(ctx,b);
    await requirePreDispatch(async()=>{
      await isolated({request:(...x)=>provider.read(...x)},b);
    });
    const value=randomBytes(16).toString('hex');
    const id='byp_'+createHash('sha256').update(value).digest('hex').slice(0,32);
    // Encrypt the revocation credential before POST; absence of this intent
    // after an ambiguous request must never be interpreted as safe cleanup.
    const box=encryptSecret(value,'dev-bypass:'+b.runId+':'+id,ctx.env);
    const intent=await preIntent(ctx,b,'bypass',id,{ciphertext:box,
      note:b.note,operation:'project_protection_bypass_update'});
    const created=await provider.write('project_protection_bypass_update',{
      path:{idOrName:b.project},body:{generate:{secret:value,note:b.note}}
    },{tool:'vercel_dev_create_bypass',requestKey:key,mutationId:'bypass-'+id,
      shapeResult:row=>{
        const state=row?.protectionBypass;
        if(!state||typeof state!=='object'||Array.isArray(state)||
           !Object.hasOwn(state,value))
          throw new TypeError('Provider did not prove newly issued bypass credential');
        return {configured:true};
      }});
    if(created.configured!==true)throw new TypeError('Bypass confirmation unavailable');
    await record(ctx,b,'bypass',id,{ciphertext:box,note:b.note});
    await markIntent(ctx,b,intent);
    // Only the authenticated setup path can consume and reveal this secret.
    const receipt=await oneTimeSecrets({db:ctx.db,env:ctx.env}).issue({
      account:ctx.connection.account,kind:'dev_automation_bypass',label:b.note,value});
    return {id,ownerRevealRef:receipt.id,expiresAt:receipt.expiresAt};
  },
  async verify(_a,ctx,b,r){
    if(typeof r?.id!=='string')return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==b.teamId)return {confirmed:null};
    await isolated(client,b);
    const rows=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    return {confirmed:rows.some(o=>o.object_type==='bypass'&&o.object_id===r.id),
      ownerRevealRef:r.ownerRevealRef,expiresAt:r.expiresAt};
  }
});
export const devPreviewBypassTools={
  tools:[{name:'vercel_dev_create_bypass',area:'developer',writes:true,guardedWrite:true,
    profiles:['full'],inputSchema:schema,writeContract:bypass.writeContract,
    description:'Grant isolated scratch-project automation bypass, revealed only on authenticated one-time setup.',
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_dev_create_bypass:bindGuardedWrite(bypass,context,respond)}
};
