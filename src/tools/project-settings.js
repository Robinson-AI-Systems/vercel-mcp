// D-1g: guarded project identity/framework settings, excluding paid build resources.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {CONFIG_SETTINGS,configFields,invalidProjectConfiguration,providerConfigBody,sameProjectConfiguration} from './project-config-fields.js';
import {validateRequest} from '../vercel/openapi-validation.js';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const NAME=/^[a-z0-9][a-z0-9._-]{0,99}$/;
const props={
  ...configFields,
  project:{type:'string',minLength:1,maxLength:128},
  name:{type:'string',pattern:NAME.source,maxLength:100},
  framework:{anyOf:[{type:'string',minLength:1,maxLength:100},{type:'null'}],
    description:'A Vercel-supported framework identifier or null; validated against pinned OpenAPI'},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties:props,required:['project'],additionalProperties:false};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    typeof args.project!=='string'||!ID.test(args.project)||
    (args.name===undefined && args.framework===undefined &&
      !CONFIG_SETTINGS.some(key=>args[key]!==undefined))||
    (args.name!==undefined&&(typeof args.name!=='string'||!NAME.test(args.name)))||
    (args.framework!==undefined&&args.framework!==null&&
      (typeof args.framework!=='string'||args.framework.length===0||args.framework.length>100))||
    invalidProjectConfiguration(args,{nullable:true})||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean'))
    throw new TypeError('Invalid project settings request');
}
// Store only an opaque fingerprint in audit/replay state; commands themselves
// may contain private build details and must not appear in previews or logs.
function configurationFingerprint(row,keys,includeFramework){
  const fields=keys.map(key=>[key,row[key]??null]);
  if(includeFramework)fields.push(['framework',row.framework??null]);
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const update=defineWrite({
  name:'vercel_project_update_settings',
  async before(args,ctx){
    validate(args);
    // Validate every supplied change against the immutable pinned PATCH schema
    // before any provider read or write, including combinations of fields.
    const body={...providerConfigBody(args),...(args.name!==undefined?{name:args.name}:{}),
      ...(args.framework!==undefined?{framework:args.framework}:{})};
    validateRequest('projects_update',{
      path:{idOrName:args.project},query:{teamId:'team_FAKE_validation'},body
    });
    const {client,account}=await readProvider(ctx);
    if(account.scope==='project'&&args.project!==account.project_id)
      throw new TypeError('Connection cannot change another project');
    const row=await client.request('projects_get',{path:{idOrName:args.project}});
    if(typeof row?.id!=='string'||typeof row?.name!=='string'||
      (account.scope==='project'&&row.id!==account.project_id))
      throw new TypeError('Project identity unavailable');
    // Undefined production metadata is unknown, and is treated as live.
    const live=row.hasDeployments!==false;
    const configChanges=CONFIG_SETTINGS.filter(key=>
      args[key]!==undefined && !sameProjectConfiguration(args[key],row[key]));
    if((args.name===undefined||args.name===row.name) &&
      (args.framework===undefined||args.framework===(row.framework??null)) &&
      configChanges.length===0)
      throw new TypeError('No settings change requested');
    return {id:row.id,name:row.name,framework:row.framework??null,live,
      newName:args.name??row.name,
      newFramework:args.framework!==undefined?args.framework:row.framework??null,
      changeName:args.name!==undefined,
      changeFramework:args.framework!==undefined,
      configChanges,
      configFingerprint:configurationFingerprint(row,configChanges,args.framework!==undefined)};
  },
  async preview(_args,_ctx,before){
    return 'Update settings for project '+before.name+' ('+before.id+')'+
      (before.changeName?'; rename to '+before.newName+
        ' (project URLs and aliases may be affected)':'')+
      (before.changeFramework?'; set framework to '+before.newFramework:'')+
      (before.configChanges.length?'; update build settings: '+before.configChanges.join(', '):'')+
      (before.live?'; this is classified as a PRODUCTION change':'');
  },
  async production(_args,_ctx,before){
    return {production:before.live,why:before.live?
      'Project may have existing deployments or live status is unknown':
      'Vercel reports hasDeployments=false'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.id,name:before.name},
      ...(before.changeName?[{kind:'project',id:before.newName,name:before.newName}]:[])];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.scope==='project' && provider.account.project_id!==before.id)
        throw new TypeError('Stored project token no longer covers the selected project');
      const row=await provider.read('projects_get',{path:{idOrName:before.id}});
      if(row?.id!==before.id||row?.name!==before.name||
        (provider.account.scope==='project'&&row.id!==provider.account.project_id))
        throw new TypeError('Project identity changed since the settings preview');
      // A previously empty project can become live while a user is confirming.
      // Never let an old preview authorization silently cover production.
      if((row.hasDeployments!==false)!==before.live)
        throw new TypeError('Project production classification changed since confirmation');
      if(configurationFingerprint(row,before.configChanges,before.changeFramework)!==before.configFingerprint)
        throw new TypeError('Project settings changed since the confirmed preview');
    });
    return provider.write('projects_update',{
      path:{idOrName:before.id},body:{
        ...(before.changeName?{name:before.newName}:{}),
        ...(before.changeFramework?{framework:before.newFramework}:{}),
        ...Object.fromEntries(before.configChanges.map(key=>[key,_args[key]]))
      }
    },{requestKey,tool:'vercel_project_update_settings',shapeResult:row=>{
      if(typeof row?.id!=='string'||typeof row?.name!=='string')
        throw new TypeError('Project identity missing in mutation response');
      return {id:row.id,name:row.name,framework:row.framework??null};
    }});
  },
  async verify(_args,ctx,before,applied){
    const {client}=await readProvider(ctx);
    const row=await client.request('projects_get',{path:{idOrName:before.id}});
    return {confirmed:row?.id===applied?.id && row?.name===before.newName &&
      (!before.changeFramework || row.framework===before.newFramework) &&
      before.configChanges.every(key=>sameProjectConfiguration(_args[key],row?.[key])),
      project:before.id};
  }
});
export const projectSettingsTools={
  tools:[{name:'vercel_project_update_settings',writes:true,guardedWrite:true,
    profiles:['everyday','full'],area:'projects',
    description:'Update project name, framework, build commands and directories after a guarded live-status check.',
    inputSchema,writeContract:update.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{
    vercel_project_update_settings:bindGuardedWrite(update,context,result=>({
      isError:['refused_by_guard','outcome_unknown'].includes(result.status),
      content:[{type:'text',text:JSON.stringify(result)}]
    }))
  }
};
