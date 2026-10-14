// E-1: server-side Config-only promotion between an authenticated project's
// ordinary non-branch environments. No raw source value ever enters a result,
// preview, audit or durable replay record.
import {timingSafeEqual} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {envMeta,scoped,verifiedCreatedEnvId} from './project-env-write.js';

const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
const ID=/^[A-Za-z0-9_-]{6,128}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const NONPROD=new Set(['preview','development']);
const ALL=new Set(['production','preview','development']);
const props={
  project:{type:'string',pattern:PROJECT.source},
  sourceId:{type:'string',pattern:ID.source},
  sourceKey:{type:'string',pattern:KEY.source},
  sourceUpdatedAt:{type:'integer',minimum:1},
  sourceTarget:{type:'string',enum:['preview','development']},
  destinationKey:{type:'string',pattern:KEY.source},
  destinationTarget:{type:'string',enum:['preview','development','production']},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,
  required:['project','sourceId','sourceKey','sourceUpdatedAt','sourceTarget',
    'destinationKey','destinationTarget'],additionalProperties:false};
function argsValid(a){
  if(!a||typeof a!=='object'||Array.isArray(a)||
    Object.keys(a).some(k=>!Object.hasOwn(props,k))||
    !PROJECT.test(a.project??'')||!ID.test(a.sourceId??'')||
    !KEY.test(a.sourceKey??'')||!KEY.test(a.destinationKey??'')||
    !Number.isSafeInteger(a.sourceUpdatedAt)||a.sourceUpdatedAt<1||
    !NONPROD.has(a.sourceTarget)||!ALL.has(a.destinationTarget)||
    (a.destinationKey===a.sourceKey&&a.destinationTarget===a.sourceTarget)||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean')
    throw new TypeError('Exact Config copy source and destination required');
}
function source(row,project,args){
  const m=envMeta(row,project);
  if(m.id!==args.sourceId||m.key!==args.sourceKey||
    m.updatedAt!==args.sourceUpdatedAt||m.kind!=='Config'||
    !m.targets.includes(args.sourceTarget)||m.targets.includes('production')||
    row.gitBranch!=null)
    throw new TypeError('Source Config identity, revision or preview/dev target not proven');
  // Existing plain variables can contain secrets despite their kind. Never
  // promote credential-shaped material even when the caller requests Config.
  if(typeof row.value!=='string'||!row.value||row.value.length>65536||
    credentialLike(row.value))
    throw new TypeError('Source value is unavailable or unsafe to copy');
  return m;
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const copy=defineWrite({
  name:'vercel_env_copy',secretIn:true,
  async before(args,ctx){
    argsValid(args);
    const {client,account}=await scoped(ctx,args.project);
    const raw=await client.request('project_env_get',{
      path:{idOrName:args.project,id:args.sourceId}});
    source(raw,args.project,args);
    return {project:args.project,teamId:account.team_id,
      sourceId:args.sourceId,sourceKey:args.sourceKey,
      sourceUpdatedAt:args.sourceUpdatedAt,sourceTarget:args.sourceTarget,
      destinationKey:args.destinationKey,destinationTarget:args.destinationTarget};
  },
  async preview(_a,_ctx,b){
    return 'Copy Config '+b.sourceKey+' from '+b.sourceTarget+' to '+
      b.destinationKey+' in '+b.destinationTarget+' for '+b.project+
      '; values hidden, destination is create-only; only new deployments consume changes';
  },
  async production(_a,_ctx,b){
    return {production:b.destinationTarget==='production',
      why:b.destinationTarget==='production'?'Production destination target':'Preview/development only'};
  },
  async targets(_a,b){
    return [{kind:'project',id:b.project},
      {kind:'env',id:b.destinationKey,projectId:b.project}];
  },
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    let value;
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId||
        provider.account.scope==='project'&&provider.account.project_id!==b.project)
        throw new TypeError('Selected credential changed');
      const {client,account}=await scoped(ctx,b.project);
      if(account.team_id!==b.teamId)throw new TypeError('Selected team changed');
      const raw=await client.request('project_env_get',{
        path:{idOrName:b.project,id:b.sourceId}});
      source(raw,b.project,a);
      value=raw.value;
    });
    return provider.write('project_env_create',{
      path:{idOrName:b.project},body:{
        key:b.destinationKey,value,type:'plain',target:[b.destinationTarget]
      }
    },{requestKey,tool:'vercel_env_copy',shapeResult:raw=>{
      return {id:verifiedCreatedEnvId(raw,b.destinationKey)};
    }});
  },
  async verify(a,ctx,b,applied){
    if(!ID.test(applied?.id??''))return {confirmed:null};
    try{
      const {client,account}=await scoped(ctx,b.project);
      if(account.team_id!==b.teamId)return {confirmed:null};
      const from=await client.request('project_env_get',{
        path:{idOrName:b.project,id:b.sourceId}});
      source(from,b.project,a);
      const raw=await client.request('project_env_get',{
        path:{idOrName:b.project,id:applied.id}});
      const to=envMeta(raw,b.project);
      if(to.id!==applied.id||to.key!==b.destinationKey||to.kind!=='Config'||
        to.targets.length!==1||to.targets[0]!==b.destinationTarget)
        return {confirmed:false};
      if(typeof raw.value!=='string')return {confirmed:null};
      const l=Buffer.from(from.value),r=Buffer.from(raw.value);
      return {confirmed:l.length===r.length&&timingSafeEqual(l,r)};
    }catch{return {confirmed:null};}
  }
});
const output=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const projectEnvCopyTools={
  tools:[{name:'vercel_env_copy',writes:true,guardedWrite:true,
    profiles:['everyday','full'],area:'env',
    description:'Server-side, value-hidden Config copy between ordinary targets in the same verified project; no overwrite.',
    inputSchema,writeContract:copy.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_env_copy:bindGuardedWrite(copy,context,output)}
};
