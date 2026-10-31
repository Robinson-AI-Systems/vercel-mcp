// D-4 alias administration: exact previously routed project domains only.
// Domain removals and assignment both affect traffic and are always production.
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {PROJECT,DEPLOY,ALIASID,ALIAS,safeAlias,projectContext,
  ownedAliases,targetDeployment,schema,exactArgs} from './release-common.js';

const props={
  project:{type:'string',pattern:PROJECT.source},
  alias:{type:'string',pattern:ALIAS.source},
  aliasId:{type:'string',pattern:ALIASID.source},
  expectedCurrent:{type:'string',pattern:DEPLOY.source},
  deployment:{type:'string',pattern:DEPLOY.source},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const base=['project','alias','aliasId','expectedCurrent','outsideApp','confirm','dryRun','requestKey'];
function validate(a,mode){
  exactArgs(a,mode==='assign'?[...base,'deployment']:base);
  if(!PROJECT.test(a.project??'')||!safeAlias(a.alias)||
    !ALIASID.test(a.aliasId??'')||!DEPLOY.test(a.expectedCurrent??'')||
    mode==='assign'&&(!DEPLOY.test(a.deployment??'')||a.deployment===a.expectedCurrent)||
    a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean')
    throw new RefusalError('Exact alias, existing deployment and separate owner intent required');
}
async function before(a,ctx,mode){
  validate(a,mode);
  if(ctx.connection?.profile!=='full')throw new RefusalError('Alias traffic change requires full profile');
  const {client,account,project}=await projectContext(a,ctx);
  const aliases=await ownedAliases({client,account},project);
  const current=aliases.find(row=>row.domain===a.alias);
  if(!current||current.id!==a.aliasId||current.deployment!==a.expectedCurrent)
    throw new RefusalError('Alias ID, domain or currently serving deployment changed');
  const initial=await targetDeployment({...ctx,account},project,a.expectedCurrent);
  if(initial.id!==a.expectedCurrent)
    throw new RefusalError('Current alias deployment not verified');
  if(mode==='assign')await targetDeployment({...ctx,account},project,a.deployment);
  return {project,teamId:account.team_id,alias:a.alias,
    aliasId:a.aliasId,current:a.expectedCurrent,
    desired:mode==='assign'?a.deployment:null,
    mode,all:aliases};
}
function unchanged(a,b){
  return a.teamId===b.teamId&&a.project===b.project&&
    a.alias===b.alias&&a.aliasId===b.aliasId&&
    a.current===b.current&&a.desired===b.desired&&
    JSON.stringify(a.all)===JSON.stringify(b.all);
}
function ctxFor({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
function make(mode){
  const name=mode==='assign'?'vercel_alias_assign':'vercel_alias_delete';
  return defineWrite({
    name,
    before:(a,ctx)=>before(a,ctx,mode),
    async preview(_a,_ctx,b){
      return (mode==='assign'?'REASSIGN':'DELETE')+' production alias '+b.alias+
        ' (ID '+b.aliasId+') in '+b.project+' currently serving '+b.current+
        (b.desired?' → '+b.desired:' → no routing')+
        '. This affects live traffic and does not rebuild the target.';
    },
    async production(){return {production:true,why:'A live alias changes production routing'};},
    async targets(_a,b){
      return [{kind:'account',id:b.teamId},{kind:'project',id:b.project},
        {kind:'domain',id:b.alias,projectId:b.project},
        {kind:'alias',id:b.aliasId,projectId:b.project},
        {kind:'deployment',id:b.current,projectId:b.project},
        ...(b.desired?[{kind:'deployment',id:b.desired,projectId:b.project}]:[])];
    },
    async apply(a,ctx,b,requestKey){
      const provider=await writeProvider(ctx);
      await requirePreDispatch(async()=>{
        if(provider.account.team_id!==b.teamId||
          ctx.connection?.mode!=='production')
          throw new TypeError('Live alias requires independently authorized production connection');
        const state=await before(a,ctx,mode);
        if(!unchanged(b,state))
          throw new TypeError('Alias and target changed since confirmation');
      });
      return provider.write(mode==='assign'?'release_alias_assign':'release_alias_delete',
        mode==='assign'?{
          path:{id:b.desired},body:{alias:b.alias}
        }:{path:{aliasId:b.aliasId}},
        {requestKey,tool:name,shapeResult:()=>({id:b.aliasId,alias:b.alias,
          intendedDeployment:b.desired})});
    },
    async verify(_a,ctx,b){
      try{
        const {client,account,project}=await projectContext({project:b.project},ctx);
        if(account.team_id!==b.teamId)return {confirmed:null};
        const rows=await ownedAliases({client,account},project);
        const alias=rows.find(x=>x.domain===b.alias);
        if(mode==='assign')return {confirmed:alias?.deployment===b.desired?
          true:alias?.deployment===b.current?false:null};
        if(alias)return {confirmed:false};
        // Complete selected-project inventory is required; no false 404.
        return {confirmed:true};
      }catch{return {confirmed:null};}
    },
    // X-1: an assignment is undone by assigning the alias back to
    // the deployment that held it before. Deletion stores no
    // inverse (there is nothing to restore from).
    ...(mode==='assign'?{async inverse(_a,b){
      return {tool:'vercel_alias_assign',project:b.project,alias:b.alias,
        aliasId:b.aliasId,deployment:b.current,expectedCurrent:b.desired,
        outsideApp:true};
    }}:{})
  });
}
const assign=make('assign'),remove=make('delete');
const encode=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const aliasWriteTools={
  tools:[
    {name:'vercel_alias_assign',writes:true,guardedWrite:true,profiles:['full'],area:'releases',
      description:'Reassign one exact existing production alias to a READY production deployment.',
      inputSchema:schema({...props},['project','alias','aliasId','deployment','expectedCurrent','outsideApp']),
      writeContract:assign.writeContract,annotations:{readOnlyHint:false,destructiveHint:true}},
    {name:'vercel_alias_delete',writes:true,guardedWrite:true,profiles:['full'],area:'releases',
      description:'Irreversibly remove exact live alias routing with independent complete-project absence proof.',
      inputSchema:schema(Object.fromEntries(base.map(k=>[k,props[k]])),
        ['project','alias','aliasId','expectedCurrent','outsideApp']),
      writeContract:remove.writeContract,annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_alias_assign:bindGuardedWrite(assign,ctxFor,encode),
    vercel_alias_delete:bindGuardedWrite(remove,ctxFor,encode)
  }
};
