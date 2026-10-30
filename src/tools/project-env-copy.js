// E-1: server-side Config-only promotion between an authenticated project's
// ordinary, exact preview-branch, or explicitly authorized same-team projects. No source value ever enters a result,
// preview, audit or durable replay record.
import {timingSafeEqual} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {envMeta,scoped,verifiedCreatedEnvId} from './project-env-write.js';

const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
const ID=/^[A-Za-z0-9_-]{6,128}$/;
const BRANCH=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const NONPROD=new Set(['preview','development']);
const ALL=new Set(['production','preview','development']);
const props={
  project:{type:'string',pattern:PROJECT.source},
  destinationProject:{type:'string',pattern:PROJECT.source},
  outsideApp:{type:'boolean',const:true},
  sourceId:{type:'string',pattern:ID.source},
  sourceKey:{type:'string',pattern:KEY.source},
  sourceUpdatedAt:{type:'integer',minimum:1},
  sourceTarget:{type:'string',enum:['preview','development']},
  sourceGitBranch:{type:'string',pattern:BRANCH.source,maxLength:128},
  destinationKey:{type:'string',pattern:KEY.source},
  destinationTarget:{type:'string',enum:['preview','development','production']},
  destinationGitBranch:{type:'string',pattern:BRANCH.source,maxLength:128},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,
  required:['project','sourceId','sourceKey','sourceUpdatedAt','sourceTarget',
    'destinationKey','destinationTarget'],additionalProperties:false};
function argsValid(a){
  if(!a||typeof a!=='object'||Array.isArray(a)||
    Object.keys(a).some(k=>!Object.hasOwn(props,k))||
    !PROJECT.test(a.project??'')||
    (a.destinationProject!==undefined&&!PROJECT.test(a.destinationProject))||
    (a.destinationProject!==undefined&&a.destinationProject!==a.project&&a.outsideApp!==true)||
    (a.outsideApp!==undefined&&a.outsideApp!==true)||
    !ID.test(a.sourceId??'')||
    !KEY.test(a.sourceKey??'')||!KEY.test(a.destinationKey??'')||
    !Number.isSafeInteger(a.sourceUpdatedAt)||a.sourceUpdatedAt<1||
    !NONPROD.has(a.sourceTarget)||!ALL.has(a.destinationTarget)||
    [a.sourceGitBranch,a.destinationGitBranch].some(b=>b!==undefined&&
      (typeof b!=='string'||b.length>128||!BRANCH.test(b)||b.split('/').includes('..')))||
    (a.sourceGitBranch!==undefined&&a.sourceTarget!=='preview')||
    (a.destinationGitBranch!==undefined&&a.destinationTarget!=='preview')||
    (a.destinationProject===undefined||a.destinationProject===a.project)&&
    (a.destinationKey===a.sourceKey&&a.destinationTarget===a.sourceTarget&&
      (a.sourceGitBranch??null)===(a.destinationGitBranch??null))||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean')
    throw new RefusalError('Exact Config copy source and destination required');
}
function source(row,project,args){
  const m=envMeta(row,project);
  if(m.id!==args.sourceId||m.key!==args.sourceKey||
    m.updatedAt!==args.sourceUpdatedAt||m.kind!=='Config'||
    !m.targets.includes(args.sourceTarget)||m.targets.includes('production')||
    (row.gitBranch??null)!==(args.sourceGitBranch??null)||
    (row.gitBranch!=null&&(m.targets.length!==1||m.targets[0]!=='preview')))
    throw new RefusalError('Source Config identity, revision or preview/dev target not proven');
  // Existing plain variables can contain secrets despite their kind. Never
  // promote credential-shaped material even when the caller requests Config.
  if(typeof row.value!=='string'||!row.value||row.value.length>65536||
    credentialLike(row.value))
    throw new RefusalError('Source value is unavailable or unsafe to copy');
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
    const destinationProject=args.destinationProject??args.project;
    if(destinationProject!==args.project){
      if(account.scope==='project'||args.outsideApp!==true)
        throw new RefusalError('Cross-project copy needs same-team authority and explicit outside-app intent');
      const destination=await scoped(ctx,destinationProject);
      if(destination.account.team_id!==account.team_id)
        throw new RefusalError('Destination team differs from source');
    }
    const raw=await client.request('project_env_get',{
      path:{idOrName:args.project,id:args.sourceId}});
    source(raw,args.project,args);
    return {project:args.project,destinationProject,teamId:account.team_id,
      sourceId:args.sourceId,sourceKey:args.sourceKey,
      sourceUpdatedAt:args.sourceUpdatedAt,sourceTarget:args.sourceTarget,
      sourceGitBranch:args.sourceGitBranch??null,
      destinationKey:args.destinationKey,destinationTarget:args.destinationTarget,
      destinationGitBranch:args.destinationGitBranch??null};
  },
  async preview(_a,_ctx,b){
    return 'Copy Config '+b.sourceKey+' from '+b.sourceTarget+
      (b.sourceGitBranch?' (exact preview branch)':'')+' to '+
      b.destinationKey+' in '+b.destinationTarget+
      (b.destinationGitBranch?' (exact preview branch)':'')+' from '+b.project+
      ' to '+b.destinationProject+
      '; values hidden, destination is create-only; only new deployments consume changes';
  },
  async production(_a,_ctx,b){
    return {production:b.destinationTarget==='production',
      why:b.destinationTarget==='production'?'Production destination target':'Preview/development only'};
  },
  async targets(_a,b){
    return [{kind:'project',id:b.project},
      ...(b.destinationProject===b.project?[]:[{kind:'project',id:b.destinationProject}]),
      {kind:'env',id:b.destinationKey,projectId:b.destinationProject}];
  },
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    let value;
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId||
        provider.account.scope==='project'&&
          (provider.account.project_id!==b.project||b.destinationProject!==b.project))
        throw new TypeError('Selected credential changed');
      const {client,account}=await scoped(ctx,b.project);
      if(account.team_id!==b.teamId)throw new TypeError('Selected team changed');
      const destination=await scoped(ctx,b.destinationProject);
      if(destination.account.team_id!==b.teamId)
        throw new TypeError('Destination team changed');
      const raw=await client.request('project_env_get',{
        path:{idOrName:b.project,id:b.sourceId}});
      source(raw,b.project,a);
      value=raw.value;
    });
    return provider.write('project_env_create',{
      path:{idOrName:b.destinationProject},body:{
        key:b.destinationKey,value,type:'plain',target:[b.destinationTarget],
        ...(b.destinationGitBranch?{gitBranch:b.destinationGitBranch}:{})
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
      const destination=await scoped(ctx,b.destinationProject);
      if(destination.account.team_id!==b.teamId)return {confirmed:null};
      const from=await client.request('project_env_get',{
        path:{idOrName:b.project,id:b.sourceId}});
      source(from,b.project,a);
      const raw=await destination.client.request('project_env_get',{
        path:{idOrName:b.destinationProject,id:applied.id}});
      const to=envMeta(raw,b.destinationProject);
      if(to.id!==applied.id||to.key!==b.destinationKey||to.kind!=='Config'||
        to.targets.length!==1||to.targets[0]!==b.destinationTarget||
        (raw.gitBranch??null)!==b.destinationGitBranch)
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
    description:'Value-hidden Config copy between exact preview branches or owner-scoped same-team projects; create-only.',
    inputSchema,writeContract:copy.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_env_copy:bindGuardedWrite(copy,context,output)}
};
