// D-4: explicit production-only promotion and verified historical rollback.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {projectContext,ownedAliases,currentDeployment,targetDeployment,
  sameRoute,PROJECT,DEPLOY,schema,exactArgs} from './release-common.js';

const props={
  project:{type:'string',pattern:PROJECT.source},
  deployment:{type:'string',pattern:DEPLOY.source},
  expectedCurrent:{type:'string',pattern:DEPLOY.source},
  reason:{type:'string',maxLength:160},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
function valid(args){
  exactArgs(args,Object.keys(props));
  if(!PROJECT.test(args.project??'')||
    !DEPLOY.test(args.deployment??'')||
    !DEPLOY.test(args.expectedCurrent??'')||
    args.expectedCurrent===args.deployment||args.outsideApp!==true||
    args.confirm!==undefined&&typeof args.confirm!=='boolean'||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean'||
    args.reason!==undefined&&
      (typeof args.reason!=='string'||args.reason.length>160||
        !/^[A-Za-z0-9 .,;:!()?/_-]*$/.test(args.reason))||
    args.requestKey!==undefined&&
      !/^[A-Za-z0-9_-]{8,128}$/.test(args.requestKey))
    throw new TypeError('Exact project, target and observed current production revision required');
}
async function candidate(a,ctx,mode){
  valid(a);
  if(ctx.connection?.profile!=='full')
    throw new TypeError('Production traffic changes need full profile');
  const scoped=await projectContext(a,ctx);
  const aliases=await ownedAliases(scoped,scoped.project);
  const current=currentDeployment(aliases);
  if(current!==a.expectedCurrent||current===a.deployment)
    throw new TypeError('Current production routing changed since owner preview');
  const target=await targetDeployment({...ctx,account:scoped.account},
    scoped.project,a.deployment);
  const old=await targetDeployment({...ctx,account:scoped.account},
    scoped.project,current);
  if(mode==='rollback'){
    // A ready but never serving build is not an eligible rollback target.
    if(target.servedAt===null||target.createdAt===null||old.createdAt===null||
      target.createdAt>=old.createdAt)
      throw new TypeError('Rollback target was not a prior serving production build');
  }else if(target.servedAt!==null){
    throw new TypeError('Previously promoted deployments must use rollback, not promote');
  }
  return {project:scoped.project,teamId:scoped.account.team_id,
    mode,current,target:a.deployment,aliases,commit:target.commit,
    reason:a.reason??null,fromCreated:old.createdAt,toCreated:target.createdAt};
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:item=>db.recordChange(item),replayStore:db.requestReplayStore(),
    guardProtected:t=>checkProtected(t,{db,connection,env}),
    guardApp:t=>checkApp(t,{db,connection,env})};
}
function specFor(mode){
  const name=mode==='promote'?'vercel_deploy_promote':'vercel_deploy_rollback';
  return defineWrite({
    name,
    before:(a,ctx)=>candidate(a,ctx,mode),
    async preview(_a,_ctx,b){
      return (mode==='promote'?'PROMOTE':'ROLL BACK')+
        ' production '+b.project+' from '+b.current+' to '+b.target+
        ' ('+(b.commit??'unverified commit')+'). Move '+b.aliases.length+
        ' production domains ['+b.aliases.map(x=>x.domain).join(', ')+
        ']. '+(mode==='rollback'?'This returns to a previously serving build. ':
          'Only staged READY production deployments are eligible. ')+
        (b.reason?'Reason: '+b.reason+'. ':'')+
        ' Changes traffic without a rebuild. May use older environment variables and cron settings.';
    },
    async production(){return {production:true,
      why:'Explicit live production domain routing change'};},
    async targets(_a,b){
      return [{kind:'account',id:b.teamId},{kind:'project',id:b.project},
        {kind:'deployment',id:b.current,projectId:b.project},
        {kind:'deployment',id:b.target,projectId:b.project},
        ...b.aliases.map(x=>({kind:'domain',id:x.domain,
          projectId:b.project}))];
    },
    async apply(a,ctx,b,requestKey){
      const provider=await writeProvider(ctx);
      await requirePreDispatch(async()=>{
        if(provider.account.team_id!==b.teamId||
          ctx.connection?.mode!=='production')
          throw new TypeError('Only an independently enabled production connection may release');
        const live=await candidate(a,ctx,mode);
        if(!sameRoute(live,b))
          throw new TypeError('Serving aliases or source/target changed before dispatch');
      });
      return provider.write(mode==='promote'?'release_promote':'release_rollback',
        {path:{projectId:b.project,deploymentId:b.target},
          ...(mode==='rollback'&&b.reason?{query:{description:b.reason}}:{})},
        {requestKey,tool:name,shapeResult:()=>({
          project:b.project,requestedDeployment:b.target})});
    },
    async verify(_a,ctx,b){
      try{
        const {client,account,project}=await projectContext(
          {project:b.project},ctx);
        if(project!==b.project||account.team_id!==b.teamId)
          return {confirmed:null};
        const aliases=await ownedAliases({client,account},project);
        if(aliases.length!==b.aliases.length||
          aliases.some(x=>!b.aliases.some(z=>z.domain===x.domain)))
          return {confirmed:null};
        const assigned=aliases.every(x=>x.deployment===b.target);
        const unchanged=aliases.every(x=>x.deployment===b.current);
        return {confirmed:assigned?true:unchanged?false:null};
      }catch{return {confirmed:null};}
    }
  });
}
const promote=specFor('promote'),rollback=specFor('rollback');
const out=x=>({isError:['refused_by_guard','outcome_unknown'].includes(x.status),
  content:[{type:'text',text:JSON.stringify(x)}]});
export const releaseWriteTools={
  tools:[
    {name:'vercel_deploy_promote',writes:true,guardedWrite:true,
      area:'releases',profiles:['full'],
      description:'Promote a never-served READY production build after proving every current alias and owner confirmation.',
      inputSchema:schema(props,['project','deployment','expectedCurrent','outsideApp']),
      writeContract:promote.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_deploy_rollback',writes:true,guardedWrite:true,
      area:'releases',profiles:['full'],
      description:'Restore a previously serving production deployment with exact currently serving aliases and confirmation.',
      inputSchema:schema(props,['project','deployment','expectedCurrent','outsideApp']),
      writeContract:rollback.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_deploy_promote:bindGuardedWrite(promote,context,out),
    vercel_deploy_rollback:bindGuardedWrite(rollback,context,out)
  }
};
