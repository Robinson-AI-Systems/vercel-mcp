// D-1f: new empty project only. Never attaches a Git repo, secrets or resources.
import {defineWrite,bindGuardedWrite} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {CONFIG_SETTINGS,configFields,invalidProjectConfiguration,providerConfigBody} from './project-config-fields.js';

const NAME=/^[a-z0-9][a-z0-9-]{0,99}$/;
// Framework options are validated by the pinned provider schema.
const schema={type:'object',properties:{
  name:{type:'string',pattern:NAME.source,maxLength:100},
  framework:{type:'string',minLength:1,maxLength:100},
  ...configFields,
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
},required:['name'],additionalProperties:false};
function assertArgs(args){
  if(!args || typeof args!=='object' || Array.isArray(args) ||
    Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k)) ||
    typeof args.name!=='string' || !NAME.test(args.name) ||
    (args.framework!==undefined && (typeof args.framework!=='string'||args.framework.length<1||args.framework.length>100)) ||
    invalidProjectConfiguration(args)||
    (args.confirm!==undefined && typeof args.confirm!=='boolean') ||
    (args.dryRun!==undefined && typeof args.dryRun!=='boolean'))
    throw new TypeError('Invalid project creation request');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),
    replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const create=defineWrite({
  name:'vercel_project_create',
  async before(args,ctx){
    assertArgs(args);
    validateRequest('projects_create',{query:{teamId:'team_FAKE_validation'},
      body:{name:args.name,...(args.framework?{framework:args.framework}:{}),...providerConfigBody(args)}});
    const {client,account}=await readProvider(ctx);
    if(account.scope==='project')throw new TypeError('Project-only keys cannot create team projects');
    try{
      await client.request('projects_get',{path:{idOrName:args.name}});
    }catch(err){
      if(err?.status===404)return {name:args.name,framework:args.framework??null};
      throw err;
    }
    throw new TypeError('Project name is already assigned');
  },
  async preview(_args,_ctx,before){
    return 'Create an empty, unlinked preview project named '+before.name+
      (before.framework?' using '+before.framework:' with auto-detected framework')+
      (CONFIG_SETTINGS.some(key=>_args[key]!==undefined)?
        '; config fields: '+CONFIG_SETTINGS.filter(key=>_args[key]!==undefined).join(', '):'')+
      '; no Git link, deployment, paid resources or secrets';
  },
  async production(){return {production:false,why:'New empty project has no live deployment'};},
  async targets(_args,before){return [{kind:'project',id:before.name,name:before.name}];},
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    return provider.write('projects_create',{body:{
      name:before.name,...(before.framework?{framework:before.framework}:{}),...providerConfigBody(_args)
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
      CONFIG_SETTINGS.every(key=>_args[key]===undefined||row?.[key]===_args[key]),
      project:result.id};
  }
});
const out=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
export const projectCreateTools={
  tools:[{name:'vercel_project_create',writes:true,guardedWrite:true,
    profiles:['everyday','full'],area:'projects',
    description:'Create an unlinked project with framework, build commands and directories; never deploy or attach Git.',
    inputSchema:schema,annotations:{readOnlyHint:false,destructiveHint:false},
    writeContract:create.writeContract}],
  handlers:{
    vercel_project_create:bindGuardedWrite(create,context,out)
  }
};
