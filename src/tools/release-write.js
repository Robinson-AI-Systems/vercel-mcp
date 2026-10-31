// D-4: explicit production-only promotion and verified historical rollback.
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp,loadProfiles,profileOwningDomain} from './app-guard.js';
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
    throw new RefusalError('Exact project, target and observed current production revision required');
}
async function candidate(a,ctx,mode){
  valid(a);
  if(ctx.connection?.profile!=='full')
    throw new RefusalError('Production traffic changes need full profile');
  const scoped=await projectContext(a,ctx);
  const aliases=await ownedAliases(scoped,scoped.project);
  const current=currentDeployment(aliases);
  if(current!==a.expectedCurrent||current===a.deployment)
    throw new RefusalError('Current production routing changed since owner preview');
  const target=await targetDeployment({...ctx,account:scoped.account},
    scoped.project,a.deployment);
  const old=await targetDeployment({...ctx,account:scoped.account},
    scoped.project,current);
  if(mode==='rollback'){
    // A ready but never serving build is not an eligible rollback target.
    if(target.servedAt===null||target.createdAt===null||old.createdAt===null||
      target.createdAt>=old.createdAt)
      throw new RefusalError('Rollback target was not a prior serving production build');
  }else if(target.servedAt!==null){
    throw new RefusalError('Previously promoted deployments must use rollback, not promote');
  }
  return {project:scoped.project,projectName:scoped.projectName??null,
    teamId:scoped.account.team_id,
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
    async preview(_a,ctx,b){
      // P-1 (design P2): a profiled project's preview names the app; a
      // rollback carries the profile's caution and the emergency label.
      let label='';
      try{
        const profiles=await loadProfiles(ctx.db,ctx.connection?.account);
        const shaped=profiles.map(profile=>({profile}));
        const owner=b.aliases.map(x=>profileOwningDomain(shaped,x.domain))
          .find(Boolean);
        if(owner){
          label=' '+owner.name+' manages this project (project profile): ';
          if(mode==='rollback'){
            label+='emergency rollback; the app\u2019s release workflow will move forward again on its next release.'+
              (owner.rollback_caution?' Caution: '+owner.rollback_caution:'');
          }else{
            label+='it releases by moving its '+
              (owner.production_branch??'production')+
              ' branch, and this promote is an outside-the-app action.';
          }
        }
      }catch{ label=''; }
      return (mode==='promote'?'PROMOTE':'ROLL BACK')+
        ' production '+b.project+' from '+b.current+' to '+b.target+
        ' ('+(b.commit??'unverified commit')+'). Move '+b.aliases.length+
        ' production domains ['+b.aliases.map(x=>x.domain).join(', ')+
        ']. '+(mode==='rollback'?'This returns to a previously serving build. ':
          'Only staged READY production deployments are eligible. ')+
        (b.reason?'Reason: '+b.reason+'. ':'')+
        ' Changes traffic without a rebuild. May use older environment variables and cron settings.'+
        label;
    },
    async production(){return {production:true,
      why:'Explicit live production domain routing change'};},
    async targets(a,b){
      // P-1: the profile guard reads the release action and the caller's
      // outsideApp declaration from the project target (additive fields).
      const outside=a.outsideApp===true;
      return [{kind:'account',id:b.teamId},
        {kind:'project',id:b.project,release:b.mode,outsideApp:outside,
          ...(b.projectName?{projectName:b.projectName}:{})},
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
    },
    // X-1: both directions undo as a rollback to the deployment that
    // served before this change (promote refuses previously-served
    // targets, so rollback is the universal opposite).
    async inverse(_a,b){
      return {tool:'vercel_deploy_rollback',project:b.project,
        deployment:b.current,expectedCurrent:b.target,outsideApp:true};
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
