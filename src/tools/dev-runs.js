// V-1: independently owned, durable, preview-only developer runs.
// Synthetic seeding is intentionally metered; execution follows the account
// purchase policy (AUD-A2): owner word on owner connections, an independently
// approved purchase grant on delegated/builder connections.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch,PreDispatchRefusal,purchaseDelegationFor} from '../core/write.js';
import {compact} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {deploymentTargetMatches} from '../vercel/deployment-target.js';
import {deploymentProjectSettings} from '../vercel/project-settings.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {seedManifest,DEV_SCENARIOS} from '../dev/scenarios.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {inspectProjectForDeletion,countComplete} from './project-delete.js';
import {decryptSecret} from '../core/secret-box.js';

const RUN=/^run_[0-9]{8}_[a-z0-9]{6,24}$/;
const KEY=/^[a-zA-Z0-9_-]{8,128}$/;
const YES={type:'boolean'};
const props={runId:{type:'string',pattern:RUN.source},requestKey:{type:'string',pattern:KEY.source},
  confirm:YES,dryRun:YES,outsideApp:{type:'boolean',const:true}};
const seedSchema={type:'object',properties:{...props,
  scenario:{type:'string',enum:Object.keys(DEV_SCENARIOS)}},
  required:['scenario','outsideApp'],additionalProperties:false};
const cleanupSchema={type:'object',properties:{...props,
  runId:{type:'string',anyOf:[{pattern:RUN.source},{const:'all-runs'}]}},
  required:['runId','outsideApp'],additionalProperties:false};
const listSchema={type:'object',properties:{limit:{type:'integer',minimum:1,maximum:20},
  runId:{type:'string',pattern:RUN.source}},additionalProperties:false};
const output=r=>({isError:['refused_by_guard','outcome_unknown','spend_limit'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
const respond=r=>({content:[{type:'text',text:JSON.stringify(r)}]});
function objectArgs(args,keys,required){
  if(!args||typeof args!=='object'||Array.isArray(args)||
     Object.keys(args).some(k=>!keys.includes(k))||
     required.some(k=>!Object.hasOwn(args,k))||
     args.runId!==undefined&&args.runId!=='all-runs'&&!RUN.test(args.runId)||
     args.requestKey!==undefined&&!KEY.test(args.requestKey)||
     args.dryRun!==undefined&&typeof args.dryRun!=='boolean'||
     args.confirm!==undefined&&typeof args.confirm!=='boolean'||
     args.outsideApp!==undefined&&args.outsideApp!==true)
    throw new TypeError('Invalid exact development run request');
}
function resolvedRun(args,account){
  if(args.runId)return args.runId;
  if(!KEY.test(args.requestKey??''))
    throw new TypeError('A durable requestKey or explicit runId is required to seed');
  const date=new Date().toISOString().slice(0,10).replaceAll('-','');
  const tail=createHash('sha256').update(account+'|'+args.requestKey).digest('hex').slice(0,12);
  return 'run_'+date+'_'+tail;
}
const scope=ctx=>ctx.connection?.account;
function connectionIdentity(ctx){return ctx.connection?.clientId||ctx.connection?.account;}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:entry=>db.recordChange(entry),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
function assertPreviewConnection(ctx){
  if(ctx.connection?.mode!=='preview'||ctx.connection?.profile!=='full')
    throw new TypeError('Development runs require full-profile preview connection');
}
function scratchName(runId,scenario){
  const name='rtc-'+runId.replaceAll('_','-')+'-'+scenario;
  if(name.length>99||!/^[a-z0-9-]+$/.test(name))
    throw new TypeError('Scratch project name is not safe');
  return name;
}
async function selectedTeam(ctx){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope)||account.team_id==null)
    throw new TypeError('Scratch project requires stored team-level authority');
  return {client,account};
}
async function absentProject(client,name){
  try{await client.request('projects_get',{path:{idOrName:name}});}
  catch(e){if(e?.status===404)return;throw e;}
  throw new TypeError('The deterministic scratch project name is already in use');
}
async function assertProject(provider,id,name,team){
  const row=await provider.read('projects_get',{path:{idOrName:id}});
  if(row?.id!==id||row.name!==name||
     row.accountId!=null&&row.accountId!==team)
    throw new PreDispatchRefusal('The scratch project is no longer owned by the selected team');
  return row;
}
function noSecretObject(object){
  return {type:object.object_type,id:object.object_id,project:object.project_id,
    status:object.status,error:object.last_error??null,createdAt:object.created_at};
}
function sortCleanup(objects){
  // Dependency order, not provider timestamps: deploys/aliases must be
  // removed before the project that owns them (even on equal timestamps).
  const priorities={alias:0,deployment:1,env:2,bypass:3,sandbox:4,webhook:4,project:5,intent:6};
  return [...objects].sort((a,b)=>(priorities[a.object_type]??9)-
    (priorities[b.object_type]??9)||String(b.created_at).localeCompare(String(a.created_at))||
    a.object_id.localeCompare(b.object_id));
}
async function trackedRuns(db,account,runId,all=false){
  if(all){
    const runs=await db.listDevRuns({account,limit:50});
    if(runs.length===50)throw new TypeError('All-runs cleanup requires a complete bounded run inventory');
    return runs.filter(r=>r.status==='active');
  }
  const run=await db.getDevRun({id:runId,account});
  if(!run)throw new TypeError('Run is not owned by this account');
  if(run.status!=='active')throw new TypeError('This run was already cleaned');
  return [run];
}
const seed=defineWrite({
  name:'vercel_dev_seed',risk:{spend:true},
  async before(args,ctx){
    objectArgs(args,Object.keys(seedSchema.properties),seedSchema.required);
    assertPreviewConnection(ctx);
    if(!Object.hasOwn(DEV_SCENARIOS,args.scenario))throw new TypeError('Unknown synthetic seed scenario');
    // A requestKey is a durable seed identity, even after the ten-minute
    // transport replay window and a change of calendar date.
    if(args.requestKey&&await ctx.db.getDevRunByRequestKey({
      account:scope(ctx),requestKey:args.requestKey}))
      throw new TypeError('This seed request already has a durable run; reconcile it before retrying');
    const runId=resolvedRun(args,scope(ctx));
    if(await ctx.db.getDevRun({id:runId,account:scope(ctx)}))
      throw new TypeError('Existing development run must be reconciled, not recreated');
    const name=scratchName(runId,args.scenario);
    const fixture=seedManifest(args.scenario);
    const {client,account}=await selectedTeam(ctx);
    await absentProject(client,name);
    const files=fixture.files.map(f=>({file:f.file,
      sha:createHash('sha1').update(f.content).digest('hex'),
      size:Buffer.byteLength(f.content,'utf8')}));
    // A seed deployment is always its project's FIRST deployment, and the
    // provider requires projectSettings for a first deployment (vendored
    // OpenAPI description; omitting them is the 400 missing_project_settings
    // of the 2026-10-28 live probe). The scenario declares the framework;
    // every other setting stays null (provider auto-detects).
    const projectSettings=deploymentProjectSettings(
      {framework:fixture.framework});
    validateRequest('projects_create',{query:{teamId:account.team_id},
      body:{name,...(fixture.framework?{framework:fixture.framework}:{})}});
    validateRequest('deployments_create',{query:{teamId:account.team_id},
      body:{name,project:name,files,target:'preview',meta:{rtc_run:runId},
        projectSettings}});
    return {runId,name,files,teamId:account.team_id,scenario:args.scenario,
      framework:fixture.framework,projectSettings,note:fixture.note};
  },
  async preview(_args,_ctx,b){
    return 'Create isolated synthetic '+b.scenario+' preview in '+b.name+
      ' (run '+b.runId+'), track exact project/deployment identities for cleanup. '+
      b.note+'. Build usage is metered with no proven enforceable per-operation lifetime ceiling; '+
      'execution follows the account purchase policy (owner word or owner grant).';
  },
  async production(){return {production:false,why:'Preview-only scratch project with no live target'};},
  async spend(){return {cents:null,recurring:true,
    description:'Scratch preview deployment and build have unbounded usage-based cost'};},
  async targets(_args,b){return [{kind:'project',id:b.name,name:b.name}];},
  async apply(args,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId||provider.account.scope==='project')
        throw new TypeError('Selected team no longer matches');
      await absentProject({request:(...x)=>provider.read(...x)},b.name);
      // Purchase authority (AUD-A2): a consumed owner grant on the grant
      // path, or the executor's owner-word delegation on an owner
      // connection whose policy does not require a grant.
      if(!purchaseDelegationFor(ctx,'vercel_dev_seed',requestKey)&&
        (ctx.purchaseApproval?.operation!=='vercel_dev_seed'||
         ctx.purchaseApproval?.requestKey!==requestKey))
        throw new TypeError('Independent owner purchase grant missing');
    });
    const run=await ctx.db.createDevRun({id:b.runId,account:scope(ctx),
      connection:connectionIdentity(ctx),description:'Synthetic '+b.scenario,
      requestKey:args.requestKey??null});
    if(run.created!==true)
      throw new PreDispatchRefusal('Seed run was already claimed; inspect it before any provider write');
    // Record the irreversible dispatch intent BEFORE the POST. A provider
    // timeout or an interrupted DB readback leaves an explicit unresolved
    // checkpoint; cleanup must not pretend the resource never existed.
    const projectIntent='intent-project-'+b.name;
    await ctx.db.addDevRunObject({account:scope(ctx),id:b.runId,type:'intent',
      objectId:projectIntent,detail:{operation:'projects_create',name:b.name}});
    const created=await provider.write('projects_create',{
      body:{name:b.name,...(b.framework?{framework:b.framework}:{})}
    },{requestKey,tool:'vercel_dev_seed',mutationId:'scratch-project',
      shapeResult:row=>{
        if(typeof row?.id!=='string'||row.name!==b.name)
          throw new TypeError('Provider did not prove the created scratch project');
        return {id:row.id,name:row.name};
      }});
    await ctx.db.addDevRunObject({account:scope(ctx),id:b.runId,type:'project',
      objectId:created.id,projectId:created.id,detail:{name:b.name,scenario:b.scenario}});
    if(!await ctx.db.setDevRunObjectOutcome({account:scope(ctx),id:b.runId,
      type:'intent',objectId:projectIntent,status:'cleaned'}))
      throw new TypeError('Project intent readback was not durable');
    for(const item of b.files){
      const original=seedManifest(b.scenario).files.find(f=>f.file===item.file);
      const bytes=Buffer.from(original.content,'utf8');
      if(createHash('sha1').update(bytes).digest('hex')!==item.sha||bytes.length!==item.size)
        throw new TypeError('Seed bytes changed since owner confirmation');
      const result=await provider.uploadFile({sha:item.sha,bytes},{
        requestKey,tool:'vercel_dev_seed'});
      if(result?.uploaded!==true||result.sha!==item.sha||result.size!==item.size)
        throw new TypeError('Upload is uncertain; inspect provider before retrying');
    }
    await requirePreDispatch(async()=>{
      await assertProject(provider,created.id,b.name,b.teamId);
    });
    const deploymentIntent='intent-deployment-'+b.name;
    await ctx.db.addDevRunObject({account:scope(ctx),id:b.runId,type:'intent',
      objectId:deploymentIntent,projectId:created.id,
      detail:{operation:'deployments_create',name:b.name,target:'preview'}});
    const deployment=await provider.write('deployments_create',{
      body:{name:b.name,project:b.name,target:'preview',files:b.files,
        meta:{rtc_run:b.runId},projectSettings:b.projectSettings}
    },{requestKey,tool:'vercel_dev_seed',mutationId:'seed-preview',
      shapeResult:row=>{
        const id=row?.id??row?.uid;
        // The documented create response has an in-progress shape with
        // no projectId (AUD-L): it must match when carried; the durable
        // project proof is verify()'s read-back of the full object.
        if(typeof id!=='string'||!/^dpl_[A-Za-z0-9_-]{3,120}$/.test(id)||
           (row.projectId!==undefined&&row.projectId!==created.id)||
           !deploymentTargetMatches(row.target,'preview'))
          throw new TypeError('Provider did not prove seeded preview identity');
        return {id};
      }});
    await ctx.db.addDevRunObject({account:scope(ctx),id:b.runId,type:'deployment',
      objectId:deployment.id,projectId:created.id,detail:{target:'preview'}});
    if(!await ctx.db.setDevRunObjectOutcome({account:scope(ctx),id:b.runId,
      type:'intent',objectId:deploymentIntent,status:'cleaned'}))
      throw new TypeError('Deployment intent readback was not durable');
    return {runId:b.runId,projectId:created.id,deploymentId:deployment.id};
  },
  async verify(_args,ctx,b,r){
    if(!r?.deploymentId)return {confirmed:null};
    const {client,account}=await selectedTeam(ctx);
    if(account.team_id!==b.teamId)return {confirmed:null};
    const [project,deployment,objects]=await Promise.all([
      client.request('projects_get',{path:{idOrName:r.projectId}}),
      client.request('deployments_get',{path:{idOrUrl:r.deploymentId}}),
      ctx.db.listDevRunObjects({account:scope(ctx),id:b.runId})]);
    return {confirmed:project?.id===r.projectId&&project.name===b.name&&
      (deployment?.uid??deployment?.id)===r.deploymentId&&
      deployment.projectId===r.projectId&&
      deploymentTargetMatches(deployment.target,'preview')&&
      deployment.meta?.rtc_run===b.runId&&
      objects.some(o=>o.object_id===r.projectId&&o.object_type==='project')&&
      objects.some(o=>o.object_id===r.deploymentId&&o.object_type==='deployment')};
  }
});
async function deleteExactObject(o,ctx,provider,runId,teamId){
  if(o.status==='uncertain')return 'Prior provider outcome is uncertain; manual readback required';
  // A newly confirmed cleanup call may re-prove a previously blocked object.
  // Uncertain POST/DELETE outcomes are never automatically retried.
  if(!['active','blocked'].includes(o.status))
    return 'Only active or previously blocked objects can be inspected for cleanup';
  // A project-creation intent is recorded before its project exists, so
  // it carries no project_id: reconcile it ahead of the project-identity
  // guard every other object must pass (AUD-K review fix).
  if(o.object_type==='intent'&&o.detail?.operation==='projects_create'){
    if(provider.account.team_id!==teamId)
      return 'Selected team/project identity unavailable';
    const name=o.detail?.name;
    if(typeof name!=='string')
      return 'Creation intent cannot be reconciled from its recorded detail';
    const recorded=await ctx.db.listDevRunObjects(
      {account:scope(ctx),id:runId});
    let row=null;
    try{row=await provider.read('projects_get',{path:{idOrName:name}});}
    catch(e){if(e?.status!==404)throw e;}
    if(!row)return null;
    if(recorded.some(x=>x.object_type==='project'&&x.object_id===row.id))
      return null;
    return 'Creation intent target exists but was never recorded; manual reconciliation required';
  }
  const project=o.project_id;
  if(!project||provider.account.team_id!==teamId)
    return 'Selected team/project identity unavailable';
  if(o.object_type==='alias'){
    const name=o.detail?.name,deploy=o.detail?.deployment;
    if(typeof name!=='string'||!name.startsWith(
      'rtc-'+runId.replaceAll('_','-')+'-')||!name.endsWith('.vercel.app')||
       typeof deploy!=='string')return 'Preview alias provenance missing';
    const inspect=async()=>{
      const [alias,target]=await Promise.all([
        provider.read('release_alias_get',{path:{idOrAlias:o.object_id}}),
        provider.read('deployments_get',{path:{idOrUrl:deploy}})]);
      if((alias?.uid??alias?.id)!==o.object_id||alias.alias!==name||
         (alias.deploymentId??alias.deployment?.id)!==deploy||
         (target?.uid??target?.id)!==deploy||
         target.projectId!==project||
         !deploymentTargetMatches(target.target,'preview'))
        throw new PreDispatchRefusal('Alias no longer resolves exclusively to recorded preview');
    };
    try{await inspect();}catch(e){if(e instanceof PreDispatchRefusal)return e.message;throw e;}
    await requirePreDispatch(inspect);
    await provider.write('release_alias_delete',{path:{aliasId:o.object_id}},
      {requestKey:ctx.cleanupKey,tool:'vercel_dev_cleanup',
        mutationId:'delete-alias-'+o.object_id,shapeResult:()=>({deleted:true})});
    try{await provider.read('release_alias_get',{path:{idOrAlias:o.object_id}});}
    catch(e){if(e?.status===404)return null;throw e;}
    return 'Alias remains assigned after DELETE';
  }
  if(o.object_type==='env'){
    const expected=o.detail;
    if(typeof expected?.key!=='string'||expected.target!=='preview')
      return 'Preview env metadata provenance unavailable';
    const inspect=async()=>{
      const row=await provider.read('project_env_get',{
        path:{idOrName:project,id:o.object_id}});
      const targets=Array.isArray(row?.target)?row.target:[row?.target];
      if(row?.id!==o.object_id||row.key!==expected.key||
         targets.length!==1||targets[0]!=='preview'||
         (row.gitBranch??null)!==(expected.branch??null)||
         row.comment!=='rtc_run='+runId)
        throw new PreDispatchRefusal('Env identity or preview-only target has changed');
    };
    try{await inspect();}catch(e){if(e instanceof PreDispatchRefusal)return e.message;throw e;}
    await requirePreDispatch(inspect);
    await provider.write('project_env_delete',
      {path:{idOrName:project,id:o.object_id}},
      {requestKey:ctx.cleanupKey,tool:'vercel_dev_cleanup',
        mutationId:'delete-env-'+o.object_id,shapeResult:()=>({deleted:true})});
    try{await provider.read('project_env_get',{path:{idOrName:project,id:o.object_id}});}
    catch(e){if(e?.status===404)return null;throw e;}
    return 'Preview variable still exists after DELETE';
  }
  if(o.object_type==='bypass'){
    if(typeof o.detail?.ciphertext!=='string')return 'Missing encrypted bypass revocation proof';
    const row=await provider.read('projects_get',{path:{idOrName:project}});
    if(row?.id!==project||!row.name?.startsWith(
      'rtc-'+runId.replaceAll('_','-')+'-')||
       row.productionDeployment||row.productionDeploymentId)
      return 'Project-wide bypass revocation requires isolated run-owned project';
    const secret=decryptSecret(o.detail.ciphertext,
      'dev-bypass:'+runId+':'+o.object_id,ctx.env);
    if(!row.protectionBypass||typeof row.protectionBypass!=='object'||
       !Object.hasOwn(row.protectionBypass,secret))
      return 'Provider cannot prove the exact previously created bypass';
    await requirePreDispatch(async()=>{
      const fresh=await provider.read('projects_get',{path:{idOrName:project}});
      if(fresh.id!==row.id||!Object.hasOwn(fresh.protectionBypass??{},secret))
        throw new TypeError('Bypass identity changed before revocation');
    });
    const result=await provider.write('project_protection_bypass_update',
      {path:{idOrName:project},body:{revoke:{secret,regenerate:false}}},
      {requestKey:ctx.cleanupKey,tool:'vercel_dev_cleanup',
        mutationId:'revoke-bypass-'+o.object_id,
        shapeResult:x=>({revoked:Boolean(x?.protectionBypass&&
          typeof x.protectionBypass==='object'&&!Object.hasOwn(x.protectionBypass,secret))})});
    if(result.revoked!==true)return 'Provider did not confirm exact bypass revocation';
    const fresh=await provider.read('projects_get',{path:{idOrName:project}});
    if(fresh.id!==project||!fresh.protectionBypass||
       Object.hasOwn(fresh.protectionBypass,secret))
      return 'Bypass still active or provider evidence incomplete';
    return null;
  }
  if(o.object_type==='deployment'){
    const row=await provider.read('deployments_get',{path:{idOrUrl:o.object_id}});
    if((row?.uid??row?.id)!==o.object_id||row.projectId!==project||
       !deploymentTargetMatches(row.target,'preview')||
       !Array.isArray(row.alias)||row.alias.length||
       row.aliases!=null&&(!Array.isArray(row.aliases)||row.aliases.length))
      return 'Deployment is serving, production, aliased or no longer identified';
    await requirePreDispatch(async()=>{
      const fresh=await provider.read('deployments_get',{path:{idOrUrl:o.object_id}});
      if((fresh?.uid??fresh?.id)!==o.object_id||fresh.projectId!==project||
         !deploymentTargetMatches(fresh.target,'preview')||
         !Array.isArray(fresh.alias)||fresh.alias.length)
        throw new Error('Preview safety proof changed');
    });
    await provider.write('deployments_delete',{path:{id:o.object_id}},
      {requestKey:ctx.cleanupKey,tool:'vercel_dev_cleanup',mutationId:'delete-deployment-'+o.object_id,
        shapeResult:()=>({deleted:true})});
    try{await provider.read('deployments_get',{path:{idOrUrl:o.object_id}});}
    catch(e){if(e?.status===404)return null;throw e;}
    return 'Deployment still exists after delete request';
  }
  if(o.object_type==='sandbox'){
    const expected=o.detail?.name;
    if(!/^sbx_[A-Za-z0-9_-]{3,120}$/.test(o.object_id)||
      typeof expected!=='string'||!expected.startsWith(
        'rtc-'+runId.replaceAll('_','-')+'-'))
      return 'Sandbox run-owned identity or deterministic name missing';
    const inspect=async()=>{
      const row=await provider.read('sandbox_session_get',{path:{sessionId:o.object_id}});
      if(row?.session?.id!==o.object_id||row.session.projectId!==project||
        row.session.sourceSandboxName!==expected)
        throw new PreDispatchRefusal('Sandbox session or selected project changed');
      if(typeof row.session.status!=='string')
        throw new PreDispatchRefusal('Unverified Sandbox lifecycle status');
      return row.session.status.toLowerCase();
    };
    let state;
    try{state=await inspect();}catch(e){if(e instanceof PreDispatchRefusal)return e.message;throw e;}
    if(state==='stopped')return null;
    if(state!=='running')return 'Sandbox is stopping or status cannot be proven; manual readback required';
    await requirePreDispatch(async()=>{
      if(await inspect()!=='running')throw new TypeError('Sandbox changed before stop');
    });
    await provider.write('sandbox_stop',{path:{sessionId:o.object_id}},
      {requestKey:ctx.cleanupKey,tool:'vercel_dev_cleanup',
        mutationId:'stop-sandbox-'+o.object_id,shapeResult:()=>({accepted:true})});
    try{if(await inspect()==='stopped')return null;}
    catch(e){if(e instanceof PreDispatchRefusal)return e.message;throw e;}
    return 'Sandbox stop requested but not yet verified; leave run resource active';
  }
  if(o.object_type==='webhook'){
    // Signing key is local to this run. The scoped DB transition to cleaned
    // wipes its encrypted ciphertext; no provider resource exists to revoke.
    return null;
  }
  if(o.object_type==='project'){
    const name=o.detail?.name;
    if(typeof name!=='string'||!name.startsWith('rtc-'+runId.replaceAll('_','-')+'-'))
      return 'Missing deterministic scratch project provenance';
    const bound={client:{request:(id,params)=>provider.read(id,params)},account:provider.account};
    const initial=await inspectProjectForDeletion(ctx,project,bound);
    if(initial.id!==project||initial.name!==name||!initial.empty)
      return 'Project resource inventory is incomplete, live or no longer empty';
    await requirePreDispatch(async()=>{
      const fresh=await inspectProjectForDeletion(ctx,project,bound);
      if(fresh.id!==initial.id||fresh.name!==initial.name||!fresh.empty)
        throw new TypeError('Scratch project became nonempty before deletion');
    });
    await provider.write('projects_delete',{path:{idOrName:project}},
      {requestKey:ctx.cleanupKey,tool:'vercel_dev_cleanup',mutationId:'delete-project-'+project,
        shapeResult:()=>({deleted:true})});
    try{await provider.read('projects_get',{path:{idOrName:project}});}
    catch(e){if(e?.status===404)return null;throw e;}
    return 'Scratch project still exists after deletion';
  }
  if(o.object_type==='intent'){
    // A creation intent is a bookkeeping checkpoint, not a provider
    // resource (AUD-K / VMCP-027): it reconciles only when the intended
    // creation is proven to have produced nothing unrecorded — its
    // target is absent, or present and recorded as its own object in
    // this run. An existing but unrecorded target stays blocked for
    // manual reconciliation: cleanup never deletes or ignores an
    // unrecorded resource. An absence that cannot be proven throws and
    // lands in the caller's uncertain handling, like any other object.
    const operation=o.detail?.operation;
    const recorded=await ctx.db.listDevRunObjects(
      {account:scope(ctx),id:runId});
    if(operation==='deployments_create'&&typeof o.project_id==='string'){
      const page=await provider.read('deployments_list',
        {query:{projectId:o.project_id,limit:100}});
      countComplete(page,'deployments');
      const mine=page.deployments.filter(d=>d?.meta?.rtc_run===runId);
      if(!mine.length)return null;
      if(mine.every(d=>recorded.some(x=>x.object_type==='deployment'&&
        x.object_id===(d.uid??d.id))))return null;
      return 'Creation intent target exists but was never recorded; manual reconciliation required';
    }
    return 'Creation intent cannot be reconciled from its recorded detail';
  }
  return 'This resource type requires its own guarded lifecycle before cleanup';
}
const cleanup=defineWrite({
  name:'vercel_dev_cleanup',
  async before(args,ctx){
    objectArgs(args,Object.keys(cleanupSchema.properties),cleanupSchema.required);
    assertPreviewConnection(ctx);
    if(args.runId!=='all-runs'&&!RUN.test(args.runId))
      throw new TypeError('Exact owned runId or all-runs required');
    const {account}=await selectedTeam(ctx);
    const runs=await trackedRuns(ctx.db,scope(ctx),args.runId,args.runId==='all-runs');
    const groups=[];
    for(const r of runs){
      const objects=sortCleanup(await ctx.db.listDevRunObjects({account:scope(ctx),id:r.id}));
      if(objects.length>=100)throw new TypeError('Object inventory must be complete');
      // Only safe, stable metadata enters the preflight/audit snapshot.
      // The execution phase loads private object detail (including encrypted
      // bypass revocation evidence) directly from the owner-scoped database.
      groups.push({id:r.id,objects:objects.map(o=>({
        object_type:o.object_type,object_id:o.object_id,
        project_id:o.project_id,status:o.status,created_at:o.created_at,
        // An intent's write target is the project it concerned (AUD-K):
        // derived here, while the private detail is in hand, so an
        // intent-only run still identifies its targets to the guard.
        ...(o.object_type==='intent'?{intent_target:
          o.detail?.operation==='projects_create'&&
            typeof o.detail?.name==='string'
            ?{kind:'project',id:o.detail.name,name:o.detail.name}
            :o.detail?.operation==='deployments_create'&&
              typeof o.project_id==='string'
            ?{kind:'project',id:o.project_id}:null}:{})
      }))});
    }
    if(!groups.length)throw new TypeError('No active owned development runs eligible for cleanup');
    return {groups,teamId:account.team_id};
  },
  async preview(_args,_ctx,b){
    return 'Cleanup '+b.groups.length+' owned preview runs, newest recorded objects first. '+
      b.groups.map(r=>r.id+': '+r.objects.map(o=>o.object_type+':'+o.object_id).join(', ')).join('; ')+
      '. Untracked or production/serving resources are never touched; failures and ambiguous results remain recorded.';
  },
  async production(){return {production:false,why:'Recorded preview fixtures only, with live-state rechecks'};},
  async targets(_a,b){const base=b.groups.flatMap(g=>g.objects
    .filter(o=>o.object_type!=='intent')
    .map(o=>o.object_type==='bypass'
      ?{kind:'project',id:o.project_id}
      :{kind:o.object_type,id:o.object_id,projectId:o.project_id}));
    for(const g of b.groups)for(const o of g.objects){
      if(o.object_type==='intent'&&o.intent_target&&
        !base.some(x=>x.kind===o.intent_target.kind&&
          x.id===o.intent_target.id))base.push(o.intent_target);
    }
    return base;},
  async apply(_a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    const outcomes=[];
    for(const group of b.groups){
      const objects=sortCleanup(await ctx.db.listDevRunObjects({account:scope(ctx),id:group.id}));
      if(JSON.stringify(objects.map(o=>[
        o.object_type,o.object_id,o.project_id,o.status]))!==
         JSON.stringify(group.objects.map(o=>[
           o.object_type,o.object_id,o.project_id,o.status])))
        throw new PreDispatchRefusal('Run objects changed after confirmation');
      // Each record is handled separately; never infer a missing object from a tag.
      // Intents reconcile first (AUD-K): the project guard below must see
      // their reconciled state, not the state loaded at confirmation time.
      const ordered=[...objects.filter(o=>o.object_type==='intent'),
        ...objects.filter(o=>o.object_type!=='intent')];
      for(const obj of ordered){
        if(obj.status==='cleaned')continue;
        if(obj.object_type==='project'&&objects.some(x=>
           x.object_type==='intent'&&x.status!=='cleaned')){
          outcomes.push({runId:group.id,type:'project',id:obj.object_id,status:'blocked'});
          await ctx.db.setDevRunObjectOutcome({account:scope(ctx),id:group.id,
            type:obj.object_type,objectId:obj.object_id,status:'blocked',
            error:'Unresolved provider creation intent exists in this run'});
          obj.status='blocked';
          continue;
        }
        if(obj.status==='uncertain'){
          outcomes.push({runId:group.id,type:obj.object_type,
            id:obj.object_id,status:'uncertain'});
          continue;
        }
        let reason=null,uncertain=false;
        try{
          reason=await deleteExactObject(obj,{...ctx,cleanupKey:requestKey},
            provider,group.id,b.teamId);
        }catch(e){
          uncertain=!(e instanceof PreDispatchRefusal);
          reason=uncertain?'Provider result uncertain; independent inspection required':
            'Execution-time preview safety proof changed';
        }
        const status=reason?(uncertain?'uncertain':'blocked'):'cleaned';
        await ctx.db.setDevRunObjectOutcome({account:scope(ctx),id:group.id,
          type:obj.object_type,objectId:obj.object_id,status,error:reason});
        obj.status=status;
        outcomes.push({runId:group.id,type:obj.object_type,id:obj.object_id,status});
      }
      await ctx.db.completeDevRunCleanup({account:scope(ctx),id:group.id});
    }
    return {outcomes};
  },
  async verify(_a,ctx,b){
    const states=await Promise.all(b.groups.map(async g=>({
      run:await ctx.db.getDevRun({account:scope(ctx),id:g.id}),
      objects:await ctx.db.listDevRunObjects({account:scope(ctx),id:g.id})
    })));
    return {confirmed:states.every(s=>s.run?.status==='cleaned'&&
      s.objects.every(o=>o.status==='cleaned'))};
  }
});
export const devRunTools={
  tools:[
    {name:'vercel_dev_seed',area:'developer',writes:true,guardedWrite:true,
      profiles:['full'],description:'Plan and seed a recorded synthetic preview; metered builds follow the account purchase policy.',
      inputSchema:seedSchema,writeContract:seed.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_dev_list_runs',area:'developer',writes:false,
      profiles:['read_only','everyday','full'],
      description:'List bounded account-owned developer runs with precise recorded resource cleanup states.',
      inputSchema:listSchema,annotations:{readOnlyHint:true}},
    {name:'vercel_dev_cleanup',area:'developer',writes:true,guardedWrite:true,
      profiles:['full'],
      description:'Confirm exact recorded preview-resource cleanup with live ownership, production and replay checks.',
      inputSchema:cleanupSchema,writeContract:cleanup.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_dev_seed:bindGuardedWrite(seed,context,output),
    vercel_dev_cleanup:bindGuardedWrite(cleanup,context,output),
    async vercel_dev_list_runs(args,ctx){
      if(ctx.connection?.mode!=='preview')
        throw new TypeError('Production connection cannot access development tools');
      objectArgs(args,Object.keys(listSchema.properties),[]);
      if(args.runId==='all-runs')throw new TypeError('Run listing requires an exact owner ID');
      if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>20))
        throw new TypeError('Invalid run limit');
      if(typeof ctx.connection?.account!=='string')throw new TypeError('Stored account required');
      const runs=args.runId?
        [await ctx.db.getDevRun({id:args.runId,account:ctx.connection.account})].filter(Boolean):
        await ctx.db.listDevRuns({account:ctx.connection.account,limit:args.limit??20});
      return respond({runs:await Promise.all(runs.map(async r=>{
        const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:r.id});
        return {runId:r.id,status:r.status,createdAt:r.created_at,cleanedAt:r.cleaned_at,
          description:r.description,objects:objects.slice(0,50).map(noSecretObject),
          completeInventory:objects.length<=50};
      }))});
    }
  }
};
