// E-2: create an isolated preview custom environment on a verified project.
// No variable bytes are read or returned. Vercel copies requested nonproduction
// variables internally, after the branch and selected team are re-proven.
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BRANCH=/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/;
const ENV=/^env_[A-Za-z0-9_-]{3,124}$/;
const RESERVED=new Set(['production','preview','development']);
const schema={type:'object',properties:{
  project:{type:'string',pattern:PROJECT.source},
  expectedName:{type:'string',pattern:NAME.source},
  slug:{type:'string',pattern:SLUG.source},
  branch:{type:'string',pattern:BRANCH.source},
  description:{type:'string',maxLength:200},
  copyFrom:{type:'string',enum:['preview','development']},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
},required:['project','expectedName','slug','branch','outsideApp'],
additionalProperties:false};
function check(a){
  if(!a||typeof a!=='object'||Array.isArray(a)||
    Object.keys(a).some(k=>!Object.hasOwn(schema.properties,k))||
    !PROJECT.test(a.project??'')||!NAME.test(a.expectedName??'')||
    !SLUG.test(a.slug??'')||RESERVED.has(a.slug)||
    !BRANCH.test(a.branch??'')||a.branch.includes('..')||
    a.branch.split('/').some(x=>x===''||x==='.')||
    a.outsideApp!==true||
    a.description!==undefined&&(
      typeof a.description!=='string'||a.description.length>200||
      /[\x00-\x1f\x7f]/.test(a.description))||
    a.copyFrom!==undefined&&!['preview','development'].includes(a.copyFrom)||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean')
    throw new RefusalError('Exact nonproduction custom environment request required');
}
function requestBody(a){
  return {slug:a.slug,branchMatcher:{type:'equals',pattern:a.branch},
    ...(a.description!==undefined?{description:a.description}:{}),
    ...(a.copyFrom?{copyEnvVarsFrom:a.copyFrom}:{})};
}
export async function scope(ctx,project,expectedName){
  const {client,account}=await readProvider(ctx);
  if(account.scope==='project'&&account.project_id!==project)
    throw new RefusalError('Project outside selected credential');
  const p=await client.request('projects_get',{path:{idOrName:project}});
  if(p?.id!==project||p.name!==expectedName||
    p.accountId!=null&&p.accountId!==account.team_id)
    throw new RefusalError('Project identity or team is unverified');
  const productionBranch=p.link?.productionBranch;
  if(typeof productionBranch!=='string'||!BRANCH.test(productionBranch)||
    productionBranch.includes('..'))
    throw new RefusalError('Production Git branch is unknown');
  return {client,account,productionBranch};
}
async function noConflict(client,project,slug,branch){
  const page=await client.request('custom_environments_list',{
    path:{idOrName:project}});
  const items=Array.isArray(page)?page:page?.environments;
  if(!Array.isArray(items)||items.length>100)
    throw new RefusalError('Custom environment inventory unverified');
  if(items.some(x=>!x||typeof x!=='object'||
    x.slug===slug||x.branchMatcher?.type==='equals'&&
      x.branchMatcher.pattern===branch))
    throw new RefusalError('Custom environment name or branch already assigned');
}
export function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const create=defineWrite({
  name:'vercel_environment_create',
  async before(args,ctx){
    check(args);
    if(!['everyday','full'].includes(ctx.connection?.profile))
      throw new RefusalError('Elevated connection profile required');
    const {client,account,productionBranch}=await scope(ctx,args.project,args.expectedName);
    if(args.branch===productionBranch)
      throw new RefusalError('Cannot attach a custom environment to production branch');
    await noConflict(client,args.project,args.slug,args.branch);
    validateRequest('custom_environments_create',{
      path:{idOrName:args.project},query:{teamId:'team_FAKE_validation'},
      body:requestBody(args)});
    return {project:args.project,name:args.expectedName,slug:args.slug,
      branch:args.branch,productionBranch,copyFrom:args.copyFrom??null,
      description:args.description??null,teamId:account.team_id};
  },
  async preview(_args,_ctx,b){
    return 'Create isolated preview custom environment '+b.slug+' in '+
      b.project+' on exact nonproduction branch '+b.branch+
      (b.copyFrom?' and copy '+b.copyFrom+' variables provider-side; values remain hidden':
        '; no variables will be copied')+
      '. Does not attach domains or deploy. A separately confirmed operation is required.';
  },
  async production(){
    return {production:false,
      why:'Verified Git branch is not the production branch; no aliases/domains or live source'};
  },
  async targets(_args,b){
    return [{kind:'project',id:b.project,name:b.name},
      {kind:'env',id:b.slug,projectId:b.project}];
  },
  async apply(_args,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId||
        provider.account.scope==='project'&&provider.account.project_id!==b.project)
        throw new TypeError('Selected scope changed before custom environment creation');
      const {client,productionBranch}=await scope(ctx,b.project,b.name);
      if(productionBranch!==b.productionBranch||productionBranch===b.branch)
        throw new TypeError('Production branch changed since confirmation');
      await noConflict(client,b.project,b.slug,b.branch);
    });
    return provider.write('custom_environments_create',{
      path:{idOrName:b.project},body:{
        slug:b.slug,branchMatcher:{type:'equals',pattern:b.branch},
        ...(b.description!==null?{description:b.description}:{}),
        ...(b.copyFrom?{copyEnvVarsFrom:b.copyFrom}:{})}
    },{requestKey,tool:'vercel_environment_create',shapeResult:row=>{
      if(!ENV.test(row?.id??'')||row.slug!==b.slug)
        throw new TypeError('Created custom environment identity unverified');
      return {id:row.id,slug:b.slug};
    }});
  },
  async verify(_args,ctx,b,created){
    if(!ENV.test(created?.id??''))return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==b.teamId)return {confirmed:null};
    try{
      const row=await client.request('custom_environments_get',{
        path:{idOrName:b.project,environmentSlugOrId:created.id}});
      return {confirmed:row?.id===created.id&&row.slug===b.slug&&
        row.type==='preview'&&row.branchMatcher?.type==='equals'&&
        row.branchMatcher.pattern===b.branch&&
        Array.isArray(row.domains)&&row.domains.length===0,
        environment:created.id};
    }catch{return {confirmed:null};}
  }
});
export const customEnvironmentCreateTools={
  tools:[{name:'vercel_environment_create',writes:true,guardedWrite:true,
    profiles:['everyday','full'],area:'env',
    description:'Create a verified nonproduction branch custom environment; provider-side variable copy never exposes values.',
    inputSchema:schema,writeContract:create.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_environment_create:bindGuardedWrite(create,context,result=>({
    isError:['refused_by_guard','outcome_unknown'].includes(result.status),
    content:[{type:'text',text:JSON.stringify(result)}]
  }))}
};

// Reused by the guarded update/delete sibling. No provider secrets cross this boundary.
export {PROJECT,NAME,SLUG,BRANCH,ENV,RESERVED};
