// D-1m: irreversible deletion is restricted to independently inspected,
// provably empty projects; other project deletion remains unimplemented.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
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
export function countComplete(reply,key){
  const rows=reply?.[key];
  // Missing pagination metadata is NOT proof that the provider returned its
  // entire resource collection. This gate protects irreversible deletion.
  if(!Array.isArray(rows)||rows.length>100||!reply.pagination||
    reply.pagination.next!==null||reply.pagination.hasNext===true||
    reply.pagination.hasMore===true||reply.hasMore===true)
    throw new TypeError('Cannot prove complete '+key+' inventory');
  // A terminal cursor alone is not proof of zero resources if the provider
  // simultaneously reports a larger total. Refuse contradictory or malformed
  // totals rather than treating pagination uncertainty as safe to delete.
  // Vercel's pinned list schemas supply pagination.count as the actual page
  // cardinality. Missing or conflicting counts cannot authorize deletion.
  if(!Number.isSafeInteger(reply.pagination.count)||
    reply.pagination.count!==rows.length)
    throw new TypeError('Cannot prove '+key+' pagination count');
  for(const total of [reply.total,reply.pagination.total]){
    if(total===undefined||total===null)continue;
    const parsed=typeof total==='string'&&/^(0|[1-9][0-9]*)$/.test(total)?
      Number(total):total;
    if(!Number.isSafeInteger(parsed)||parsed!==rows.length)
      throw new TypeError('Contradictory '+key+' inventory total');
  }
  return rows.length;
}
export function envInventoryCount(reply){
  // The documented env-list response has a branch with no pagination
  // object ({envs, hiddenProductionEnvCount}): it is a complete
  // inventory exactly when nothing is hidden from this credential
  // (AUD-M). A positive hidden count leaves the inventory unproven,
  // like any other unrecognized shape.
  if(reply?.pagination!==undefined)return countComplete(reply,'envs');
  if(Array.isArray(reply?.envs)&&
    Number.isSafeInteger(reply.hiddenProductionEnvCount)&&
    reply.hiddenProductionEnvCount===0)return reply.envs.length;
  throw new TypeError('Cannot prove complete envs inventory');
}
// No raw provider resource rows or secret values leave this function.

// The project's own canonical domain: the UNIQUE vercel.app entry
// carrying no branch, redirect or custom environment whose subdomain
// is the project name — or a truncation of it. Vercel truncates long
// project names when minting the domain (live evidence, AUD-R: the
// 41-character rtc-run names minted 35-character subdomains), so an
// exact-name comparison misses the real canonical on long names.
// Ambiguity (two candidate entries) identifies nothing: the caller
// then counts every entry as attached, which is the safe direction.
export function canonicalDomainEntry(domains,projectName){
  if(!Array.isArray(domains)||typeof projectName!=='string'||
     !projectName)return null;
  const matches=domains.filter(d=>{
    if(!d||typeof d.name!=='string'||
       !d.name.endsWith('.vercel.app'))return false;
    if(d.gitBranch!=null||d.redirect!=null||
       d.customEnvironmentId!=null)return false;
    const sub=d.name.slice(0,-'.vercel.app'.length);
    return sub===projectName||
      (sub.length<projectName.length&&projectName.startsWith(sub));
  });
  return matches.length===1?matches[0]:null;
}

export async function inspectProjectForDeletion(ctx,selector,bound){
  const {client,account}=bound??await readProvider(ctx);
  if(!['team','full'].includes(account.scope))
    throw new TypeError('Only authenticated team accounts may delete projects');
  const row=await client.request('projects_get',{path:{idOrName:selector}});
  if(typeof row?.id!=='string'||!ID.test(row.id)||
    typeof row.name!=='string'||!NAME.test(row.name))
    throw new TypeError('Project identity not independently available');
  // The record-based part of the proof reads only fields the documented
  // project schema carries (AUD-K / VMCP-027): an earlier version demanded
  // storageConnections/stores arrays the schema does not contain at all, so
  // the proof could never pass against a real project. link and crons are
  // documented but NOT required fields: absent or null counts as none,
  // while a present crons object must still prove its definitions array.
  // Storage has no documented record field and no list operation in this
  // server's table, so it is outside this proof; store wiring surfaces as
  // project environment variables, which the env inventory below covers.
  let cronCount=0;
  if(row.crons!=null){
    if(!Array.isArray(row.crons.definitions))
      throw new TypeError('Cannot establish complete project resource inventory');
    cronCount=row.crons.definitions.length;
  }
  const domains=await client.request('projects_domains_list',{
    path:{idOrName:row.id},query:{limit:100}});
  const env=await client.request('projects_env_list',{path:{idOrName:row.id}});
  // hasDeployments on a project is a secondary signal, not sufficient proof
  // that no retained or previously deployed build exists. Require a distinct
  // team-scoped deployment inventory before an irreversible deletion.
  const countDomains=countComplete(domains,'domains');
  // The project's own canonical production domain — <name>.vercel.app
  // with no branch, redirect or custom environment — is part of the
  // project's identity and dies with it; it is not an attached
  // resource. Every real project carries one from creation, so
  // counting it made this proof unpassable against real projects
  // (AUD-O / VMCP-027 — the fakes modeled an empty domains list, and
  // no live project deletion had ever passed the proof). Any other
  // entry — a custom domain, an owner-added subdomain, a branch or
  // redirect domain — is attached content and still blocks.
  const canonicalEntry=canonicalDomainEntry(domains.domains,row.name);
  const domainsAttached=domains.domains.filter(
    d=>d!==canonicalEntry).length;
  const countEnvs=envInventoryCount(env);
  const deploymentPage=await client.request('deployments_list',{
    query:{projectId:row.id,limit:100}
  });
  const deploymentCount=countComplete(deploymentPage,'deployments');
  if(deploymentPage.deployments.some(item=>!item||item.projectId!==row.id))
    throw new TypeError('Cannot prove scoped project deployment inventory');
  const inventory={
    deployments:deploymentCount,
    git:row.link!=null?1:0,crons:cronCount,
    domains:countDomains,domainsAttached,envVariables:countEnvs
  };
  return {id:row.id,name:row.name,inventory,
    hasDeployments:row.hasDeployments===true,
    empty:row.hasDeployments!==true&&
      inventory.deployments===0&&inventory.git===0&&
      inventory.crons===0&&inventory.domainsAttached===0&&
      inventory.envVariables===0};
}
const deletion=defineWrite({
  name:'vercel_project_delete',
  async before(args,ctx){
    assertArgs(args);
    const state=await inspectProjectForDeletion(ctx,args.project);
    if(state.name!==args.expectedName)
      throw new TypeError('Typed project name does not match provider identity');
    // Only dry-runs may inspect nonempty impact. Confirmation is empty-only.
    if(!state.empty && args.dryRun!==true)
      throw new TypeError('Nonempty deletion disabled; use dryRun for resource impact');
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
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      // Inventory proof and DELETE use one bound token/team even if the owner
      // rotates the account credential during the potentially slow inventory.
      const client={request:(id,params)=>provider.read(id,params)};
      const fresh=await inspectProjectForDeletion(ctx,before.id,{client,account:provider.account});
      if(fresh.id!==before.id||fresh.name!==before.name||!fresh.empty)
        throw new TypeError('Deletion impact changed since confirmation');
    });
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
