// V-3: scoped, read-only development run proofs; no production connections.
import {readProvider} from '../vercel/provider.js';
import { RefusalError } from '../core/write.js';
import {credentialLike} from '../core/util.js';
export const RUN=/^run_[0-9]{8}_[a-z0-9]{6,24}$/;
export const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
export const DEPLOY=/^dpl_[A-Za-z0-9_-]{3,120}$/;
export const schema=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
export const base={runId:{type:'string',pattern:RUN.source},
  project:{type:'string',pattern:PROJECT.source},
  deployment:{type:'string',pattern:DEPLOY.source}};
export const reply=obj=>({content:[{type:'text',text:JSON.stringify(obj)}]});
export function assertInput(a,allowed,required){
  if(!a||typeof a!=='object'||Array.isArray(a)||
     Object.keys(a).some(k=>!allowed.includes(k))||
     required.some(k=>!Object.hasOwn(a,k))||
     !RUN.test(a.runId??'')||!PROJECT.test(a.project??'')||
     a.deployment!==undefined&&!DEPLOY.test(a.deployment))
    throw new TypeError('Exact owned preview run, project and declared fields required');
}
export function requirePreview(ctx){
  if(ctx.connection?.mode!=='preview'||!['read_only','everyday','full'].includes(ctx.connection?.profile))
    throw new RefusalError('Developer reads require a preview-only authenticated connection');
}
export function safeText(v,max=180){
  if(typeof v!=='string')return null;
  const s=v.slice(0,max);
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)||credentialLike(v)||
     /\b(?:token|password|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/i.test(v))
    return '[hidden]';
  return s;
}
export async function ownerRun(ctx,{runId,project}){
  requirePreview(ctx);
  if(!RUN.test(runId??'')||!PROJECT.test(project??''))
    throw new RefusalError('Exact preview run and project required');
  const record=await ctx.db.getDevRun({id:runId,account:ctx.connection.account});
  if(!record||record.status!=='active')
    throw new RefusalError('Only an active run owned by this account may be inspected');
  const tracked=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:runId});
  if(!Array.isArray(tracked)||tracked.length>=100||
     !tracked.some(item=>item?.project_id===project&&item.status==='active'&&
       ['project','deployment','alias','env','bypass'].includes(item.object_type)))
    throw new RefusalError('This run has no active recorded ownership of the selected project');
  const {client,account}=await readProvider(ctx);
  if(account.scope==='project'&&account.project_id!==project)
    throw new RefusalError('Selected provider token cannot read another project');
  const raw=await client.request('projects_get',{path:{idOrName:project}});
  if(raw?.id!==project||raw.accountId!==account.team_id||!account.team_id)
    throw new RefusalError('Vercel project ownership and team scope cannot be verified');
  return {client,account,raw,runId,project};
}
export async function ownerDeployment(ctx,args){
  const bound=await ownerRun(ctx,args);
  const objects=await ctx.db.listDevRunObjects({
    account:ctx.connection.account,id:args.runId});
  if(objects.length>=100)throw new RefusalError('Run inventory exceeded the bounded ownership proof');
  if(!objects.some(o=>o.object_type==='deployment'&&
       o.object_id===args.deployment&&o.project_id===args.project&&
       o.status==='active'))
    throw new RefusalError('This run does not own the requested active deployment');
  const deployment=await bound.client.request('deployments_get',
    {path:{idOrUrl:args.deployment}});
  if((deployment?.uid??deployment?.id)!==args.deployment||
     deployment.projectId!==args.project||deployment.target!=='preview')
    throw new RefusalError('Deployment is no longer an owned preview');
  return {...bound,deployment,objects};
}
export function activeObject(objects,type,id,project){
  const item=objects.find(o=>o.object_type===type&&o.object_id===id&&
    o.project_id===project&&o.status==='active');
  if(!item)throw new TypeError('Selected object does not belong to the active preview run');
  return item;
}
