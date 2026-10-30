// V-2: scoped run, project and run-object utilities.
import {createHash} from 'node:crypto';
import { RefusalError } from '../core/write.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {compact} from '../core/util.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
export const RUN=/^run_[0-9]{8}_[a-z0-9]{6,24}$/;
export const PROJ=/^prj_[A-Za-z0-9_-]{3,124}$/;
export const KEY=/^[A-Za-z0-9_-]{8,128}$/;
export const BRANCH=/^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/;
export const SHA=/^[a-f0-9]{40}$/;
export const DEPLOY=/^dpl_[A-Za-z0-9_-]{3,120}$/;
export const common={runId:{type:'string',pattern:RUN.source},
  project:{type:'string',pattern:PROJ.source},
  requestKey:{type:'string',pattern:KEY.source},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'}};
export const respond=result=>({
  isError:['refused_by_guard','outcome_unknown','spend_limit'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
export function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
export function exact(args,props,required){
  if(!args||typeof args!=='object'||Array.isArray(args)||
     Object.keys(args).some(x=>!Object.hasOwn(props,x))||
     required.some(x=>!Object.hasOwn(args,x))||
     !RUN.test(args.runId??'')||!PROJ.test(args.project??'')||
     args.requestKey!==undefined&&!KEY.test(args.requestKey)||
     args.confirm!==undefined&&typeof args.confirm!=='boolean'||
     args.dryRun!==undefined&&typeof args.dryRun!=='boolean'||
     args.outsideApp!==undefined&&args.outsideApp!==true)
    throw new RefusalError('Invalid exact preview workflow request');
}
export function safeBranch(value){
  return BRANCH.test(value??'')&&!value.includes('..')&&
    !value.split('/').some(x=>x===''||x==='.');
}
// P-1: the no-preview branch rule moved to src/tools/app-guard.js
// (previewBranchRefusal), where it is sourced from project profiles;
// the built-in default below it preserves this function's old behavior
// for profile-less installs.
export async function owned(args,ctx,{requireRun=false}={}){
  if(ctx.connection?.mode!=='preview'||ctx.connection?.profile!=='full')
    throw new RefusalError('Preview-only full owner connection required');
  const {client,account}=await readProvider(ctx);
  if(account.scope==='project'&&account.project_id!==args.project)
    throw new RefusalError('Project outside connection scope');
  const row=await client.request('projects_get',{path:{idOrName:args.project}});
  if(row?.id!==args.project||!row?.name||!account.team_id||
     row.accountId!=null&&row.accountId!==account.team_id)
    throw new RefusalError('Selected account/project identity not proven');
  const current=await ctx.db.getDevRun({id:args.runId,account:ctx.connection.account});
  if(current&&current.status!=='active')throw new RefusalError('Run is terminal');
  if(requireRun&&!current)throw new RefusalError('Run is not registered');
  return {project:row.id,name:row.name,teamId:account.team_id,
    runId:args.runId,existing:current!==null};
}
export async function startRun(ctx,b){
  const run=await ctx.db.createDevRun({id:b.runId,account:ctx.connection.account,
    connection:ctx.connection.clientId??ctx.connection.account,
    description:'Preview workflow '+b.project});
  if(!run||typeof run.created!=='boolean')throw new TypeError('Run checkpoint uncertain');
}
export async function preIntent(ctx,b,kind,name,detail={}){
  const id='intent-'+kind+'-'+createHash('sha256').update(name).digest('hex').slice(0,32);
  await ctx.db.addDevRunObject({account:ctx.connection.account,id:b.runId,
    type:'intent',objectId:id,projectId:b.project,detail:{kind,...detail}});
  return id;
}
export async function markIntent(ctx,b,id){
  if(!await ctx.db.setDevRunObjectOutcome({account:ctx.connection.account,
    id:b.runId,type:'intent',objectId:id,status:'cleaned'}))
    throw new TypeError('Dispatch intent has not been resolved in durable store');
}
export async function record(ctx,b,type,id,detail){
  await ctx.db.addDevRunObject({account:ctx.connection.account,id:b.runId,
    type,objectId:id,projectId:b.project,detail});
}
export async function selectedWrite(ctx,b){
  const provider=await writeProvider(ctx);
  if(provider.account.team_id!==b.teamId||
     provider.account.scope==='project'&&provider.account.project_id!==b.project)
    throw new TypeError('Provider authority changed');
  const row=await provider.read('projects_get',{path:{idOrName:b.project}});
  if(row?.id!==b.project||row.name!==b.name||
     row.accountId!=null&&row.accountId!==b.teamId)
    throw new TypeError('Project changed since approval');
  return provider;
}
export function boundedLabel(x){return typeof x==='string'&&x.length<=80&&
  /^[a-zA-Z0-9 _.-]+$/.test(x);}
