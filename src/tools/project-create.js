// D-1r: empty unlinked projects and guarded metered Git-linked imports; no secrets.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {accountSpendGuard} from '../vercel/spend.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {verifyGitNamespace,verifyExactGitRepository} from './git-identity.js';
import {CONFIG_SETTINGS,createConfigFields,invalidProjectConfiguration,providerConfigBody} from './project-config-fields.js';

const NAME=/^[a-z0-9][a-z0-9-]{0,99}$/;
const REPO=/^[a-zA-Z0-9_.-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/;
const NAMESPACE=/^[-_a-zA-Z0-9]{1,128}$/;
const PROVIDERS=['github','gitlab','bitbucket'];
const gitSchema={type:'object',properties:{
  type:{type:'string',enum:PROVIDERS},repo:{type:'string',minLength:3,maxLength:201,pattern:REPO.source},
  namespaceId:{type:'string',minLength:1,maxLength:128,pattern:NAMESPACE.source}
},required:['type','repo','namespaceId'],additionalProperties:false};
// Framework options are validated by the pinned provider schema.
const schema={type:'object',properties:{
  name:{type:'string',pattern:NAME.source,maxLength:100},
  framework:{type:'string',minLength:1,maxLength:100},
  ...createConfigFields,
  gitRepository:gitSchema,
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
},required:['name'],additionalProperties:false};
function assertArgs(args){
  if(!args || typeof args!=='object' || Array.isArray(args) ||
    Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k)) ||
    typeof args.name!=='string' || !NAME.test(args.name) ||
    (args.framework!==undefined && (typeof args.framework!=='string'||args.framework.length<1||args.framework.length>100)) ||
    invalidProjectConfiguration(args)||
    (args.gitRepository!==undefined &&
      (!args.gitRepository||typeof args.gitRepository!=='object'||Array.isArray(args.gitRepository)||
       Object.keys(args.gitRepository).some(k=>!Object.hasOwn(gitSchema.properties,k))||
       !PROVIDERS.includes(args.gitRepository.type)||
       typeof args.gitRepository.repo!=='string'||!REPO.test(args.gitRepository.repo)||
       typeof args.gitRepository.namespaceId!=='string'||
       !NAMESPACE.test(args.gitRepository.namespaceId)))||
    (args.confirm!==undefined && typeof args.confirm!=='boolean') ||
    (args.dryRun!==undefined && typeof args.dryRun!=='boolean'))
    throw new TypeError('Invalid project creation request');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),
    checkSpend:(declaration,confirm)=>declaration.cents===0?
      {allowed:true,code:'allowed',explanation:'Unlinked empty project: $0 estimated build usage'}:
      accountSpendGuard({db,account:connection.account})(declaration,confirm),
    replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const create=defineWrite({
  name:'vercel_project_create',risk:{spend:true},
  async before(args,ctx){
    assertArgs(args);
    const git=args.gitRepository??null;
    if(git && (ctx.connection?.profile!=='full'||ctx.connection?.mode!=='production'))
      throw new TypeError('Git imports require full production-mode connection');
    validateRequest('projects_create',{query:{teamId:'team_FAKE_validation'},
      body:{name:args.name,...(args.framework?{framework:args.framework}:{}),
        ...providerConfigBody(args),...(git?{gitRepository:{type:git.type,repo:git.repo}}:{})}});
    const {client,account}=await readProvider(ctx);
    if(account.scope==='project')throw new TypeError('Project-only keys cannot create team projects');
    if(git){
      const namespaces=await client.request('git_namespaces',{query:{provider:git.type}});
      verifyGitNamespace(namespaces,git.type,git.namespaceId);
      const search=await client.request('git_repos_search',{query:{
        provider:git.type,namespaceId:git.namespaceId,query:git.repo.split('/')[1]
      }});
      verifyExactGitRepository(search,{repo:git.repo,provider:git.type,namespaceId:git.namespaceId});
    }
    try{
      await client.request('projects_get',{path:{idOrName:args.name}});
    }catch(err){
      if(err?.status===404)return {name:args.name,framework:args.framework??null,git};
      throw err;
    }
    throw new TypeError('Project name is already assigned');
  },
  async preview(_args,_ctx,before){
    return (before.git?'Import a Git-linked project named ':'Create an empty unlinked project named ')+before.name+
      (before.framework?' using '+before.framework:' with auto-detected framework')+
      (CONFIG_SETTINGS.some(key=>_args[key]!==undefined)?
        '; config fields: '+CONFIG_SETTINGS.filter(key=>_args[key]!==undefined).join(', '):'')+
      (before.git?'; attach authenticated '+before.git.type+' Git repository '+before.git.repo+
        '; a build/deployment may start and incur usage; production authorization and pricing review required':
        '; no Git link, deployment, paid resources or secrets');
  },
  async production(_args,_ctx,before){return {production:Boolean(before.git),why:before.git?
    'Git import can trigger a deployment and metered usage':
    'New empty unlinked project has no live deployment'};},
  async spend(_args,_ctx,before){return before.git?
    {cents:null,recurring:true,description:'Git project import may trigger usage-based build charges (https://vercel.com/pricing)'}:
    {cents:0,recurring:false,description:'Empty unlinked project creation'};},
  async targets(_args,before){return [{kind:'project',id:before.name,name:before.name}];},
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    if(before.git){
      await requirePreDispatch(async()=>{
      // A metered Git import may occur long after preview and approval. Repeat
      // identity and independently owned spend-policy checks before the POST.
      const {account}=provider;
      const client={request:(id,params)=>provider.read(id,params)};
      if(!['team','full'].includes(account.scope)||
        ctx.connection?.profile!=='full'||ctx.connection?.mode!=='production')
        throw new TypeError('Git import authority changed before execution');
      const namespaces=await client.request('git_namespaces',{query:{provider:before.git.type}});
      verifyGitNamespace(namespaces,before.git.type,before.git.namespaceId);
      const search=await client.request('git_repos_search',{query:{
        provider:before.git.type,namespaceId:before.git.namespaceId,
        query:before.git.repo.split('/')[1]
      }});
      verifyExactGitRepository(search,{repo:before.git.repo,
        provider:before.git.type,namespaceId:before.git.namespaceId});
      // Last-moment owner spending decision follows BOTH potentially slow GETs.
      const spending=await accountSpendGuard({db:ctx.db,account:ctx.connection.account})(
        {cents:null,recurring:true,description:'Git import may incur metered build usage'},true);
      if(!spending.allowed)
        throw new TypeError('Owner-approved daily spending limit no longer permits this Git import');
      });
    }
    // Confirmation may lag the initial 404. A different administrator can
    // claim the name meanwhile; the exact credential that would POST must
    // recheck it after all Git and spending proofs have completed.
    await requirePreDispatch(async()=>{
      if(!['team','full'].includes(provider.account.scope))
        throw new TypeError('Project creation authority changed');
      try{
        await provider.read('projects_get',{path:{idOrName:before.name}});
      }catch(error){
        if(error?.status===404)return;
        throw error;
      }
      throw new TypeError('Project name was claimed after confirmation');
    });
    // The final authenticated name lookup can be slow. An owner may revoke
    // spending permission while it is pending; never dispatch a metered POST
    // against the earlier policy snapshot.
    if(before.git){
      await requirePreDispatch(async()=>{
        const spending=await accountSpendGuard({db:ctx.db,account:ctx.connection.account})(
          {cents:null,recurring:true,description:'Git import may incur metered build usage'},true);
        if(!spending.allowed)
          throw new TypeError('Owner spending authorization changed during final name lookup');
      });
    }
    return provider.write('projects_create',{body:{
      name:before.name,...(before.framework?{framework:before.framework}:{}),...providerConfigBody(_args),
      ...(before.git?{gitRepository:{type:before.git.type,repo:before.git.repo}}:{})
    }},{requestKey,tool:'vercel_project_create',shapeResult:value=>{
      if(typeof value?.id!=='string'||typeof value?.name!=='string')
        throw new TypeError('Vercel did not return project identity');
      return {id:value.id,name:value.name};
    }});
  },
  async verify(_args,ctx,before,result){
    if(typeof result?.id!=='string'||typeof result?.name!=='string')
      return {confirmed:null};
    const {client}=await readProvider(ctx);
    const row=await client.request('projects_get',{path:{idOrName:result.id}});
    return {confirmed:row?.id===result.id&&row?.name===before.name&&
      (before.framework===null||row.framework===before.framework)&&
      CONFIG_SETTINGS.every(key=>_args[key]===undefined||row?.[key]===_args[key])&&
      (!before.git || (row?.link?.type===before.git.type&&
        (row?.link?.repo===before.git.repo||row?.link?.fullName===before.git.repo))),
      project:result.id};
  }
});
const out=result=>({isError:['refused_by_guard','outcome_unknown','spend_limit'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
export const projectCreateTools={
  tools:[{name:'vercel_project_create',writes:true,guardedWrite:true,
    profiles:['everyday','full'],area:'projects',
    description:'Create a guarded empty project or full-profile production-confirmed Git-linked import with owner spending limits.',
    inputSchema:schema,annotations:{readOnlyHint:false,destructiveHint:false},
    writeContract:create.writeContract}],
  handlers:{
    vercel_project_create:bindGuardedWrite(create,context,out)
  }
};
