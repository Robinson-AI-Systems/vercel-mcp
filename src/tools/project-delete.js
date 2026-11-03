// D-1m: irreversible deletion starts from an independent inspection.
// Provably empty projects delete on the typed-name confirmation alone.
// AUD-CH (owner's ruling, 2026-11-03): a NON-empty project is no longer
// refused outright — the tool's duty is to warn, not to veto its owner.
// The plan (dry-run or the confirmation prompt) renders the full
// evaluation: exactly what the project holds and what deleting it
// destroys, plus an evaluationId fingerprint of that exact state.
// Confirming requires naming that evaluationId; any change to the
// project's contents changes the fingerprint and the confirmation is
// refused until the owner reviews a fresh evaluation. Execution
// re-inspects immediately before the DELETE and verifies by read-back.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
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
  evaluationId:{type:'string',pattern:'^[0-9a-f]{64}$'},
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
    (args.evaluationId!==undefined&&
      (typeof args.evaluationId!=='string'||!/^[0-9a-f]{64}$/.test(args.evaluationId)))||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean'))
    throw new RefusalError('Explicit project identity and outside-app intent required');
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
  throw new RefusalError('Cannot prove complete envs inventory');
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
    throw new RefusalError('Only authenticated team accounts may delete projects');
  const row=await client.request('projects_get',{path:{idOrName:selector}});
  if(typeof row?.id!=='string'||!ID.test(row.id)||
    typeof row.name!=='string'||!NAME.test(row.name))
    throw new RefusalError('Project identity not independently available');
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
      throw new RefusalError('Cannot establish complete project resource inventory');
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
    throw new RefusalError('Cannot prove scoped project deployment inventory');
  const inventory={
    deployments:deploymentCount,
    git:row.link!=null?1:0,crons:cronCount,
    domains:countDomains,domainsAttached,envVariables:countEnvs
  };
  const state={id:row.id,name:row.name,inventory,
    hasDeployments:row.hasDeployments===true,
    empty:row.hasDeployments!==true&&
      inventory.deployments===0&&inventory.git===0&&
      inventory.crons===0&&inventory.domainsAttached===0&&
      inventory.envVariables===0};
  // AUD-CH: the owner-facing evaluation detail behind the counts.
  // Identities only — never a value: deployment ids with their
  // target and state, the attached (non-canonical) domain names,
  // the canonical domain's name, the code link's identity, the
  // environment variable KEYS (values are never read into this
  // record) and the cron paths.
  const safeText=v=>typeof v==='string'&&v.length<=200?v:null;
  const deployments=deploymentPage.deployments.map(d=>({
    id:safeText(d?.id??d?.uid),target:d?.target??null,
    state:safeText(d?.readyState??d?.state)})).sort(
    (a,b)=>String(a.id).localeCompare(String(b.id)));
  if(deployments.some(d=>d.id===null))
    throw new RefusalError('Cannot prove scoped project deployment inventory');
  const attachedDomains=domains.domains.filter(d=>d!==canonicalEntry)
    .map(d=>safeText(d?.name)).sort();
  if(attachedDomains.some(n=>n===null))
    throw new RefusalError('Cannot prove complete domains inventory');
  const envRows=Array.isArray(env?.envs)?env.envs:[];
  const envKeys=envRows.map(e=>safeText(e?.key)).sort();
  if(envKeys.some(k=>k===null))
    throw new RefusalError('Cannot prove complete envs inventory');
  const cronPaths=(row.crons?.definitions??[]).map(
    c=>safeText(c?.path)).sort();
  if(cronPaths.some(p=>p===null))
    throw new RefusalError('Cannot establish complete project resource inventory');
  const link=row.link?{
    type:safeText(row.link.type),repo:safeText(row.link.repo),
    org:safeText(row.link.org),
    repoId:typeof row.link.repoId==='number'?row.link.repoId:null
  }:null;
  state.evaluation={
    deployments,attachedDomains,
    canonicalDomain:canonicalEntry?safeText(canonicalEntry.name):null,
    git:link,envKeys,cronPaths
  };
  // The fingerprint binds an owner's confirmation to THIS exact
  // evaluation: any change to what the project holds — a new
  // deployment, a domain attached, a variable added — changes it.
  state.evaluationId=createHash('sha256').update(JSON.stringify({
    id:state.id,name:state.name,hasDeployments:state.hasDeployments,
    evaluation:state.evaluation
  })).digest('hex');
  return state;
}
const deletion=defineWrite({
  name:'vercel_project_delete',
  async before(args,ctx){
    assertArgs(args);
    const state=await inspectProjectForDeletion(ctx,args.project);
    if(state.name!==args.expectedName)
      throw new RefusalError('Typed project name does not match provider identity');
    // AUD-CH: a named evaluation must be the CURRENT one, on either
    // path — a stale fingerprint means the owner would be confirming
    // contents they have not seen.
    if(args.evaluationId!==undefined&&args.evaluationId!==state.evaluationId)
      throw new RefusalError('That evaluation is no longer current: the project has changed since it was made. Run the plan again and confirm the evaluation it shows now');
    if(!state.empty&&args.confirm===true&&args.dryRun!==true&&
      args.evaluationId===undefined)
      throw new RefusalError('Deleting a project that still holds resources requires confirming the exact evaluation: run the plan (dryRun) to see everything that would be destroyed, then confirm with the evaluationId it shows');
    return state;
  },
  async preview(_args,_ctx,before){
    const details=Object.entries(before.inventory)
      .map(([key,count])=>key+': '+count).join('; ');
    const head='IRREVERSIBLE deletion of project '+before.name+' ('+before.id+
      '). Resources observed: '+details+'; ';
    if(before.empty)
      return head+'eligible empty-only state, subject to immediate recheck';
    // AUD-CH: the warning is the tool's duty; the decision is the
    // owner's. State exactly what dies, in plain terms, and bind
    // the confirmation to this evaluation.
    const ev=before.evaluation;
    const parts=[];
    if(ev.deployments.length){
      const prod=ev.deployments.filter(d=>d.target==='production').length;
      parts.push(ev.deployments.length+' deployment(s) — '+
        ev.deployments.map(d=>d.id+' ('+
          (d.target??'preview')+(d.state?', '+d.state:'')+')').join(', ')+
        (prod?' — '+prod+' of them production: the live site at the '+
          'project addresses below goes down':''));
    }
    if(ev.attachedDomains.length)
      parts.push('attached domain(s) '+ev.attachedDomains.join(', ')+
        ' — these addresses stop working');
    if(ev.canonicalDomain)
      parts.push('the project address '+ev.canonicalDomain+' disappears');
    if(before.hasDeployments&&!ev.deployments.length)
      parts.push('the project record says it has had deployments before '+
        '(none exist now)');
    if(ev.git)
      parts.push('the code link to '+(ev.git.type??'git')+
        (ev.git.repo?' repo '+ev.git.repo:'')+
        ' is cut — the repository itself is not changed');
    if(ev.envKeys.length)
      parts.push(ev.envKeys.length+' environment variable(s) ('+
        ev.envKeys.join(', ')+') — their values are permanently lost');
    if(ev.cronPaths.length)
      parts.push('cron job(s) on '+ev.cronPaths.join(', ')+' stop');
    return head+'NOT ELIGIBLE: project has attached resources '+
      '(empty-only path). OWNER-CONFIRMED DELETION: this project is '+
      'not empty, and deleting it permanently destroys: '+
      parts.join('; ')+'. This cannot be undone. Evaluation: '+
      before.evaluationId+'. To proceed, confirm with evaluationId '+
      'set to that exact value; if anything about the project '+
      'changes, the evaluation changes and the confirmation is refused.';
  },
  async production(){
    return {production:true,why:'Deleting even an empty project is irreversible'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.id,name:before.name}];
  },
  async apply(args,ctx,before,requestKey){
    // Narrow race window: immediately repeat every authoritative GET and
    // refuse if identity, enumeration or any evaluated content changed.
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      // Inventory proof and DELETE use one bound token/team even if the owner
      // rotates the account credential during the potentially slow inventory.
      const client={request:(id,params)=>provider.read(id,params)};
      const fresh=await inspectProjectForDeletion(ctx,before.id,{client,account:provider.account});
      if(fresh.id!==before.id||fresh.name!==before.name||fresh.empty!==before.empty||
        fresh.evaluationId!==before.evaluationId||
        (args.evaluationId!==undefined&&args.evaluationId!==fresh.evaluationId))
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
    description:'Irreversibly delete a project after inventory, typed name and production confirmation; a non-empty project also needs the plan\'s exact evaluationId.',
    inputSchema,writeContract:deletion.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:true}}],
  handlers:{vercel_project_delete:bindGuardedWrite(deletion,context,output)}
};
