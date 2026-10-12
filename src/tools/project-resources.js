// D-1q: grouped, usage-billed project resource settings under owner spend cap.
// No owner settings or user-supplied price; all writes require production mode.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact} from '../core/util.js';
import {accountSpendGuard} from '../vercel/spend.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const TYPES=Object.freeze({
  buildMachineType:['standard','enhanced','turbo'],
  buildMachineSelection:['elastic','fixed'],
  functionDefaultMemoryType:['standard','standard_legacy','performance','performance_xl'],
  buildQueueConfiguration:['WAIT_FOR_NAMESPACE_QUEUE','SKIP_NAMESPACE_QUEUE']
});
const CONFIG_KEYS=['buildMachineType','buildMachineSelection','elasticConcurrencyEnabled',
  'fluid','functionDefaultMemoryType','functionDefaultTimeout','functionDefaultRegions',
  'buildQueueConfiguration'];
const schema={type:'object',properties:{
  project:{type:'string',minLength:1,maxLength:128,pattern:ID.source},
  expectedName:{type:'string',minLength:1,maxLength:100},
  buildMachineType:{type:'string',enum:TYPES.buildMachineType},
  buildMachineSelection:{type:'string',enum:TYPES.buildMachineSelection},
  elasticConcurrencyEnabled:{type:'boolean'},
  fluid:{type:'boolean'},
  functionDefaultMemoryType:{type:'string',enum:TYPES.functionDefaultMemoryType},
  functionDefaultTimeout:{type:'integer',minimum:1,maximum:800},
  functionDefaultRegions:{type:'array',minItems:1,maxItems:3,uniqueItems:true,
    items:{type:'string',pattern:'^[a-z]{3}[1-9]$'}},
  buildQueueConfiguration:{type:'string',enum:TYPES.buildQueueConfiguration},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
},required:['project','expectedName'],additionalProperties:false};
function validate(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k))||
    typeof args.project!=='string'||!ID.test(args.project)||
    typeof args.expectedName!=='string'||!ID.test(args.expectedName)||
    !CONFIG_KEYS.some(k=>args[k]!==undefined)||
    Object.keys(TYPES).some(k=>args[k]!==undefined&&!TYPES[k].includes(args[k]))||
    ['fluid','elasticConcurrencyEnabled'].some(k=>args[k]!==undefined&&typeof args[k]!=='boolean')||
    (args.functionDefaultTimeout!==undefined &&
      (!Number.isInteger(args.functionDefaultTimeout)||args.functionDefaultTimeout<1||
       args.functionDefaultTimeout>800))||
    (args.functionDefaultRegions!==undefined&&
      (!Array.isArray(args.functionDefaultRegions)||args.functionDefaultRegions.length<1||
       args.functionDefaultRegions.length>3||
       new Set(args.functionDefaultRegions).size!==args.functionDefaultRegions.length||
       args.functionDefaultRegions.some(x=>typeof x!=='string'||!/^[a-z]{3}[1-9]$/.test(x))))||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean'))
    throw new TypeError('Invalid project resource settings');
}
function candidate(args){
  return Object.fromEntries(CONFIG_KEYS.filter(k=>args[k]!==undefined).map(k=>
    [k,args[k]]));
}
function patch(updates){
  const {buildQueueConfiguration,...rest}=updates;
  return {...rest,...(buildQueueConfiguration===undefined?{}:
    {buildQueue:{configuration:buildQueueConfiguration}})};
}
function equivalent(a,b){
  return JSON.stringify(a)===JSON.stringify(b);
}
function observed(config,key){
  return key==='buildQueueConfiguration'?config?.buildQueue?.configuration:config?.[key];
}
// Preserve only a digest of the selected pre-confirmation fields. Never
// overwrite another agent's metered resource changes with a stale PATCH.
function resourceFingerprint(config,keys){
  return createHash('sha256').update(JSON.stringify(keys.map(key=>
    [key,observed(config,key)??null]))).digest('hex');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    checkSpend:accountSpendGuard({db,account:connection.account}),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const change=defineWrite({
  name:'vercel_project_set_build_resources',risk:{spend:true},
  async before(args,ctx){
    validate(args);
    if(ctx.connection?.profile!=='full')throw new TypeError('Full profile required');
    const changes=candidate(args);
    const body={resourceConfig:patch(changes)};
    validateRequest('projects_update',{
      path:{idOrName:args.project},query:{teamId:'team_FAKE_validation'},body});
    const {client,account}=await readProvider(ctx);
    if(!['team','full'].includes(account.scope))
      throw new TypeError('Team account required');
    const row=await client.request('projects_get',{path:{idOrName:args.project}});
    if(typeof row?.id!=='string'||!ID.test(row.id)||
      typeof row?.name!=='string'||row.name!==args.expectedName)
      throw new TypeError('Project identity mismatch');
    if(!row.resourceConfig||typeof row.resourceConfig!=='object'||
      Array.isArray(row.resourceConfig))
      throw new TypeError('Existing resource configuration is unknown');
    const selected=Object.fromEntries(Object.entries(changes)
      .filter(([key,value])=>!equivalent(value,observed(row.resourceConfig,key))));
    if(!Object.keys(selected).length)
      throw new TypeError('No resource changes required');
    return {id:row.id,name:row.name,changes:selected,
      resourceFingerprint:resourceFingerprint(row.resourceConfig,Object.keys(selected))};
  },
  async preview(_args,_ctx,before){
    return 'Change billed build/function resource settings for '+before.name+
      ' ('+before.id+'): '+Object.keys(before.changes).join(', ')+
      '. Pricing depends on usage; review https://vercel.com/pricing. '+
      'Explicit production confirmation and owner-configured positive spend cap required.';
  },
  async production(){
    return {production:true,why:'Changing build/function resources affects live or future metered usage'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.id,name:before.name}];
  },
  async spend(){
    return {cents:null,recurring:true,
      description:'Usage-based build/function resources (https://vercel.com/pricing)'};
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(!['team','full'].includes(provider.account.scope))
        throw new TypeError('Metered resource write requires team authority');
      const fresh=await provider.read('projects_get',{path:{idOrName:before.id}});
      if(fresh?.id!==before.id||fresh?.name!==before.name||
        !fresh.resourceConfig||typeof fresh.resourceConfig!=='object'||
        Array.isArray(fresh.resourceConfig))
        throw new TypeError('Project identity or resource state changed before a metered update');
      if(resourceFingerprint(fresh.resourceConfig,Object.keys(before.changes))!==before.resourceFingerprint)
        throw new TypeError('Metered resource configuration changed since confirmation');
      // Recheck after the potentially slow provider read; an owner can reduce
      // the spend limit or revoke remaining daily headroom after confirmation.
      const spend=await accountSpendGuard({db:ctx.db,account:ctx.connection.account})(
        {cents:null,recurring:true,description:'Usage-based build/function resources'},true);
      if(!spend.allowed)throw new TypeError('Owner daily spending permission was withdrawn');
    });
    return provider.write('projects_update',{
      path:{idOrName:before.id},body:{resourceConfig:patch(before.changes)}
    },{requestKey,tool:'vercel_project_set_build_resources',shapeResult:row=>{
      if(typeof row?.id!=='string'||row.id!==before.id)
        throw new TypeError('Project ID missing in resource mutation response');
      return {id:row.id};
    }});
  },
  async verify(_args,ctx,before,applied){
    const {client}=await readProvider(ctx);
    const row=await client.request('projects_get',{path:{idOrName:before.id}});
    if(!row?.resourceConfig||typeof row.resourceConfig!=='object')
      return {confirmed:null,project:before.id};
    return {confirmed:row.id===before.id&&applied.id===before.id&&
      Object.entries(before.changes).every(([key,value])=>
        equivalent(observed(row.resourceConfig,key),value)),
      project:before.id};
  }
});
export const projectResourcesTools={
  tools:[{name:'vercel_project_set_build_resources',writes:true,guardedWrite:true,
    profiles:['full'],area:'projects',
    description:'Change metered build and function resource settings under owner spend limits and production confirmation.',
    inputSchema:schema,writeContract:change.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_project_set_build_resources:bindGuardedWrite(change,context,result=>({
    isError:['refused_by_guard','outcome_unknown','spend_limit'].includes(result.status),
    content:[{type:'text',text:JSON.stringify(result)}]
  }))}
};
