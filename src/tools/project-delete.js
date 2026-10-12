// D-1m: irreversible deletion is restricted to independently inspected,
// provably empty projects; other project deletion remains unimplemented.
import {defineWrite,bindGuardedWrite} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const NAME=/^[a-z0-9][a-z0-9-]{0,99}$/;
const properties={
  project:{type:'string',minLength:1,maxLength:128,pattern:ID.source},
  expectedName:{type:'string',pattern:NAME.source,maxLength:100},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
const inputSchema={type:'object',properties,
  required:['project','expectedName','outsideApp'],additionalProperties:false};
function assertArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!Object.hasOwn(properties,key))||
    typeof args.project!=='string'||!ID.test(args.project)||
    typeof args.expectedName!=='string'||!NAME.test(args.expectedName)||
    args.outsideApp!==true ||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean'))
    throw new TypeError('Explicit project identity and outside-app intent required');
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
function countComplete(reply,key){
  const rows=reply?.[key];
  // Missing pagination metadata is NOT proof that the provider returned its
  // entire resource collection. This gate protects irreversible deletion.
  if(!Array.isArray(rows)||rows.length>100||!reply.pagination||
    reply.pagination.next!==null||reply.pagination.hasNext===true||
    reply.pagination.hasMore===true||reply.hasMore===true)
    throw new TypeError('Cannot prove complete '+key+' inventory');
  return rows.length;
}
// No raw provider resource rows or secret values leave this function.
async function inspect(ctx,selector){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope))
    throw new TypeError('Only authenticated team accounts may delete projects');
  const row=await client.request('projects_get',{path:{idOrName:selector}});
  if(typeof row?.id!=='string'||!ID.test(row.id)||
    typeof row.name!=='string'||!NAME.test(row.name))
    throw new TypeError('Project identity not independently available');
  // A generic project GET does not prove storage/cron absence. The explicit
  // arrays are mandatory; missing, unknown or paginated resource data refuses.
  const storage=Array.isArray(row.storageConnections)?row.storageConnections:
    Array.isArray(row.stores)?row.stores:null;
  const cron=row.crons?.definitions;
  if(!Array.isArray(storage)||!Array.isArray(cron)||
    typeof row.hasDeployments!=='boolean'||
    !Object.hasOwn(row,'link')||row.link===undefined)
    throw new TypeError('Cannot establish complete project resource inventory');
  const domains=await client.request('projects_domains_list',{
    path:{idOrName:row.id},query:{limit:100}});
  const env=await client.request('projects_env_list',{path:{idOrName:row.id}});
  // hasDeployments on a project is a secondary signal, not sufficient proof
  // that no retained or previously deployed build exists. Require a distinct
  // team-scoped deployment inventory before an irreversible deletion.
  const countDomains=countComplete(domains,'domains');
  const countEnvs=countComplete(env,'envs');
  const deploymentPage=await client.request('deployments_list',{
    query:{projectId:row.id,limit:100}
  });
  if(!Array.isArray(deploymentPage?.deployments)||
    !deploymentPage.pagination||deploymentPage.pagination.next!==null||
    deploymentPage.pagination.hasNext===true||
    deploymentPage.pagination.hasMore===true||deploymentPage.hasMore===true||
    deploymentPage.deployments.length>100||
    deploymentPage.deployments.some(item=>!item||item.projectId!==row.id))
    throw new TypeError('Cannot prove complete project deployment inventory');
  const inventory={
    deployments:row.hasDeployments?'present':deploymentPage.deployments.length,
    git:row.link!=null?1:0,crons:cron.length,storageConnections:storage.length,
    domains:countDomains,envVariables:countEnvs
  };
  return {id:row.id,name:row.name,inventory,
    empty:Object.values(inventory).every(n=>n===0)};
}
const deletion=defineWrite({
  name:'vercel_project_delete',
  async before(args,ctx){
    assertArgs(args);
    const state=await inspect(ctx,args.project);
    if(state.name!==args.expectedName)
      throw new TypeError('Typed project name does not match provider identity');
    if(!state.empty)
      throw new TypeError('This delete tool supports only verified empty projects');
    return state;
  },
  async preview(_args,_ctx,before){
    const details=Object.entries(before.inventory)
      .map(([key,count])=>key+': '+count).join('; ');
    return 'IRREVERSIBLE deletion of project '+before.name+' ('+before.id+
      '). Resources observed: '+details+'; '+
      (before.empty?'eligible empty-only state, subject to immediate recheck':
        'NOT ELIGIBLE: project has attached resources');
  },
  async production(){
    return {production:true,why:'Deleting even an empty project is irreversible'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.id,name:before.name}];
  },
  async apply(_args,ctx,before,requestKey){
    if(!before.empty)throw new TypeError('Nonempty projects cannot be deleted');
    // Narrow race window: immediately repeat every authoritative GET and
    // refuse if identity, enumeration or any resource count changed.
    const fresh=await inspect(ctx,before.id);
    if(fresh.id!==before.id||fresh.name!==before.name||!fresh.empty)
      throw new TypeError('Deletion impact changed since confirmation');
    const provider=await writeProvider(ctx);
    return provider.write('projects_delete',{path:{idOrName:before.id}},{
      requestKey,tool:'vercel_project_delete',shapeResult:()=>({accepted:true})
    });
  },
  async verify(_args,ctx,before){
    try{
      const {client}=await readProvider(ctx);
      await client.request('projects_get',{path:{idOrName:before.id}});
      return {confirmed:false,project:before.id};
    }catch(error){
      return {confirmed:error?.status===404?true:null,project:before.id};
    }
  }
});
const output=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
export const projectDeleteTools={
  tools:[{name:'vercel_project_delete',writes:true,guardedWrite:true,
    profiles:['full'],area:'projects',
    description:'Irreversibly delete only provably empty projects after independent inventory, typed name and production confirmation.',
    inputSchema,writeContract:deletion.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:true}}],
  handlers:{vercel_project_delete:bindGuardedWrite(deletion,context,output)}
};
