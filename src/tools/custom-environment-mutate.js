// E-2: exact custom-environment update and irreversible removal.
// Nonproduction-only, with safe provider rechecks. AUD-CN (owner's
// ruling, 2026-11-03, from the AUD-CH refusal audit): deletion used
// to require a provably EMPTY environment (no linked domains, no
// active deployment aliases) — an eligibility veto over the owner.
// The delete path now collects the links into a fingerprinted
// evaluation the owner confirms by its exact evaluationId, in the
// AUD-CH pattern. The update path keeps the emptiness proof: it is
// not destructive, and retargeting live links is a separate design
// question the owner has not commissioned.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {credentialLike} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {scope,context,PROJECT,NAME,SLUG,BRANCH,ENV,RESERVED} from './custom-environment-create.js';

const INTEGER={type:'integer',minimum:1};
const props={
  project:{type:'string',pattern:PROJECT.source},
  expectedName:{type:'string',pattern:NAME.source},
  id:{type:'string',pattern:ENV.source},
  expectedSlug:{type:'string',pattern:SLUG.source},
  expectedBranch:{type:'string',pattern:BRANCH.source},
  expectedUpdatedAt:INTEGER,
  slug:{type:'string',pattern:SLUG.source},
  branch:{type:'string',pattern:BRANCH.source},
  description:{type:'string',maxLength:200},
  outsideApp:{type:'boolean',const:true},confirm:{type:'boolean'},
  dryRun:{type:'boolean'},
  evaluationId:{type:'string',pattern:'^[0-9a-f]{64}$'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const core=['project','expectedName','id','expectedSlug','expectedBranch',
  'expectedUpdatedAt','outsideApp'];
const schema=(required, allowed)=>({type:'object',properties:Object.fromEntries(
  allowed.map(key=>[key,props[key]])),required,additionalProperties:false});
function valid(a,change=false){
  const allowed=change?[...core,'slug','branch','description','confirm','dryRun','requestKey']:
    [...core,'confirm','dryRun','evaluationId','requestKey'];
  if(!a||typeof a!=='object'||Array.isArray(a)||
    Object.keys(a).some(k=>!allowed.includes(k))||
    !PROJECT.test(a.project??'')||!NAME.test(a.expectedName??'')||
    !ENV.test(a.id??'')||!SLUG.test(a.expectedSlug??'')||
    RESERVED.has(a.expectedSlug)||
    !goodBranch(a.expectedBranch)||
    !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<=0||
    a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    (!change&&a.evaluationId!==undefined&&
      (typeof a.evaluationId!=='string'||!/^[0-9a-f]{64}$/.test(a.evaluationId))))
    throw new RefusalError('Exact custom environment identity and revision required');
  if(change){
    if(a.slug===undefined&&a.branch===undefined&&a.description===undefined)
      throw new RefusalError('An explicit environment change is required');
    if(a.slug!==undefined&&(!SLUG.test(a.slug)||RESERVED.has(a.slug)))throw new RefusalError('Invalid next slug');
    if(a.branch!==undefined&&!goodBranch(a.branch))throw new RefusalError('Invalid next branch');
    if(a.description!==undefined&&(!safeDescription(a.description)))
      throw new RefusalError('Unsafe environment description');
  }
}
function goodBranch(branch){
  return typeof branch==='string'&&BRANCH.test(branch)&&
    !branch.includes('..')&&!branch.split('/').some(x=>x===''||x==='.')&&
    !credentialLike(branch);
}
function safeDescription(text){
  return typeof text==='string'&&text.length<=200&&
    !/[\x00-\x1f\x7f]/.test(text)&&!credentialLike(text);
}
async function getExact(client,project,id,a,productionBranch,collect=false){
  const r=await client.request('custom_environments_get',{
    path:{idOrName:project,environmentSlugOrId:id}});
  // AUD-CN: on the delete path (collect) the link lists are read into
  // the evaluation instead of refusing on non-empty; a list that is
  // not an array is unprovable and still refuses on every path.
  if(!r||r.id!==id||r.slug!==a.expectedSlug||
    r.type!=='preview'||r.updatedAt!==a.expectedUpdatedAt||
    r.branchMatcher?.type!=='equals'||
    r.branchMatcher.pattern!==a.expectedBranch||
    a.expectedBranch===productionBranch||
    !Array.isArray(r.domains)||(!collect&&r.domains.length!==0)||
    !Array.isArray(r.currentDeploymentAliases)||
    (!collect&&r.currentDeploymentAliases.length!==0)||
    (r.projectId!=null&&r.projectId!==project))
    throw new RefusalError('Custom environment revision, branch or emptiness changed');
  return r;
}
function proposed(a){
  return {slug:a.slug??a.expectedSlug,
    branch:a.branch??a.expectedBranch,
    ...(a.description!==undefined?{description:a.description}:{})};
}
async function conflicts(client,project,id,slug,branch){
  const page=await client.request('custom_environments_list',
    {path:{idOrName:project}});
  const rows=Array.isArray(page)?page:page?.environments;
  // An incomplete or oversized inventory cannot prove no collision.
  if(!Array.isArray(rows)||rows.length>100||page?.pagination?.next)
    throw new RefusalError('Cannot verify custom environment uniqueness');
  const seen=new Set();
  for(const r of rows){
    if(!r||!ENV.test(r.id??'')||!SLUG.test(r.slug??'')||
      seen.has(r.id))throw new RefusalError('Unverified custom environment inventory');
    seen.add(r.id);
    if(r.id!==id&&(r.slug===slug||
      r.branchMatcher?.type==='equals'&&r.branchMatcher.pattern===branch))
      throw new RefusalError('Another environment owns the requested slug or branch');
  }
  if(!seen.has(id))throw new RefusalError('Selected environment missing from inventory');
}
async function state(args,ctx,change){
  valid(args,change);
  const {client,account,productionBranch}=await scope(ctx,args.project,args.expectedName);
  const row=await getExact(client,args.project,args.id,args,productionBranch,!change);
  const next=change?proposed(args):{slug:args.expectedSlug,branch:args.expectedBranch};
  if(next.branch===productionBranch)
    throw new RefusalError('Cannot attach a custom environment to production');
  if(change){
    if(next.slug===row.slug&&next.branch===row.branchMatcher.pattern&&
      (args.description===undefined||args.description===(row.description??'')))
      throw new RefusalError('No change to the selected custom environment');
    await conflicts(client,args.project,args.id,next.slug,next.branch);
  }
  if(!change)await conflicts(client,args.project,args.id,row.slug,row.branchMatcher.pattern);
  const base={project:args.project,name:args.expectedName,id:row.id,slug:row.slug,
    branch:row.branchMatcher.pattern,updatedAt:row.updatedAt,
    teamId:account.team_id,productionBranch,
    nextSlug:next.slug,nextBranch:next.branch,
    nextDescription:args.description??null,descriptionChanged:args.description!==undefined};
  if(change)return base;
  // AUD-CN: the delete evaluation — the links that used to refuse the
  // deletion outright, named and fingerprinted. A link entry whose
  // name cannot be proven refuses the evaluation: the warning must
  // be complete or it does not exist.
  const linkNames=(list,pick)=>list.map(entry=>{
    const value=typeof entry==='string'?entry:pick(entry);
    if(typeof value!=='string'||!value)
      throw new RefusalError('Custom environment link inventory could not be verified');
    return value;
  }).sort();
  const domains=linkNames(row.domains,e=>e?.name??e?.domain);
  const aliases=linkNames(row.currentDeploymentAliases,e=>e?.alias??e?.name);
  const evaluation={project:args.project,id:row.id,slug:row.slug,
    branch:row.branchMatcher.pattern,updatedAt:row.updatedAt,domains,aliases};
  return {...base,domains,aliases,evaluation,
    evaluationId:createHash('sha256').update(JSON.stringify(evaluation)).digest('hex')};
}
async function recheck(ctx,args,b,change){
  const provider=await writeProvider(ctx);
  await requirePreDispatch(async()=>{
    if(provider.account.team_id!==b.teamId||
      provider.account.scope==='project'&&provider.account.project_id!==b.project)
      throw new TypeError('Selected Vercel team or scope changed');
    const now=await state(args,ctx,change);
    if(now.teamId!==b.teamId||now.productionBranch!==b.productionBranch||
      now.id!==b.id||now.updatedAt!==b.updatedAt||
      now.nextSlug!==b.nextSlug||now.nextBranch!==b.nextBranch)
      throw new TypeError('Custom environment changed since confirmation');
    // AUD-CN: on the delete path the links are part of what the owner
    // confirmed — drift in them, or a linked deletion that was never
    // confirmed on its evaluation, refuses before dispatch.
    if(!change&&(now.evaluationId!==b.evaluationId||
      ((now.domains.length>0||now.aliases.length>0)&&!b.ownerConfirmed)))
      throw new TypeError('Custom environment links changed since confirmation');
  });
  return provider;
}
function path(b){
  return {idOrName:b.project,environmentSlugOrId:b.id};
}
const update=defineWrite({
  name:'vercel_environment_update',
  async before(a,ctx){return state(a,ctx,true);},
  async preview(_a,_ctx,b){return 'Update isolated custom environment '+b.slug+
    ' ('+b.id+') to '+b.nextSlug+' on nonproduction branch '+b.nextBranch+
    '; attached domains and active aliases forbidden, no deployments triggered';},
  async production(){return {production:false,why:'Exact nonproduction branch, no attached domains or active aliases'};},
  async targets(_a,b){return [{kind:'project',id:b.project,name:b.name},
    {kind:'env',id:b.id,projectId:b.project}];},
  async apply(a,ctx,b,requestKey){
    const provider=await recheck(ctx,a,b,true);
    const body={...(a.slug!==undefined?{slug:b.nextSlug}:{}),
      ...(a.branch!==undefined?{branchMatcher:{type:'equals',pattern:b.nextBranch}}:{}),
      ...(b.descriptionChanged?{description:b.nextDescription}:{})};
    return provider.write('custom_environments_update',{path:path(b),body},{
      requestKey,tool:'vercel_environment_update',shapeResult:r=>{
        if(r?.id!==b.id||r?.slug!==b.nextSlug)
          throw new TypeError('Updated custom environment identity unverified');
        return {id:b.id};
      }});
  },
  async verify(_a,ctx,b){
    try{
      const {client,account,productionBranch}=await scope(ctx,b.project,b.name);
      if(account.team_id!==b.teamId||productionBranch!==b.productionBranch)return {confirmed:null};
      const row=await client.request('custom_environments_get',{path:path(b)});
      return {confirmed:row?.id===b.id&&row.slug===b.nextSlug&&
        row.type==='preview'&&row.updatedAt>b.updatedAt&&
        row.branchMatcher?.type==='equals'&&row.branchMatcher.pattern===b.nextBranch&&
        (!b.descriptionChanged||row.description===b.nextDescription)&&
        Array.isArray(row.domains)&&row.domains.length===0&&
        Array.isArray(row.currentDeploymentAliases)&&row.currentDeploymentAliases.length===0};
    }catch{return {confirmed:null};}
  }
});
const remove=defineWrite({
  name:'vercel_environment_delete',
  async before(a,ctx){
    if(ctx.connection?.profile!=='full')
      throw new RefusalError('Full owner profile required for irreversible environment removal');
    const b=await state(a,ctx,false);
    // AUD-CN: a named evaluation must be the CURRENT one on either
    // path, and a linked environment confirms only on its exact
    // evaluation — never silently on the simple confirmation.
    if(a.evaluationId!==undefined&&a.evaluationId!==b.evaluationId)
      throw new RefusalError('That evaluation is no longer current: the environment or its links have changed since it was made. Run the plan again and confirm the evaluation it shows now');
    const linked=b.domains.length>0||b.aliases.length>0;
    if(linked&&a.confirm===true&&a.dryRun!==true&&a.evaluationId===undefined)
      throw new RefusalError('This custom environment still has linked domains or active deployment aliases; remove the links first — or confirm the exact evaluation: run the plan (dryRun) to see the links named, then confirm with the evaluationId it shows');
    return {...b,linked,ownerConfirmed:linked&&a.evaluationId===b.evaluationId};
  },
  async preview(_a,_ctx,b){
    if(!b.linked)return 'IRREVERSIBLY remove isolated custom environment '+b.slug+
      ' ('+b.id+') from project '+b.project+'; no linked domains or active aliases. '+
      'Unassigned project variables are never deleted by this operation';
    return 'IRREVERSIBLY remove custom environment '+b.slug+
      ' ('+b.id+') from project '+b.project+'. OWNER-CONFIRMED REMOVAL: '+
      'it still has '+(b.domains.length?'linked domain(s) '+b.domains.join(', '):'')+
      (b.domains.length&&b.aliases.length?' and ':'')+
      (b.aliases.length?'active deployment alias(es) '+b.aliases.join(', '):'')+
      ' — removing the environment breaks those links and the previews '+
      'they serve stop answering; Vercel may itself refuse while links '+
      'exist, and that verdict is reported as returned. Unassigned '+
      'project variables are never deleted by this operation. '+
      'Evaluation: '+b.evaluationId+'. To proceed, confirm with '+
      'evaluationId set to that exact value; if the environment or its '+
      'links change, the evaluation changes and the confirmation is refused.';},
  async production(_a,_ctx,b){return {production:false,
    why:b.linked?'Nonproduction branch environment; its linked domains and aliases serve only its own preview deployments':
      'No production branch, domains or active deployment aliases'};},
  async targets(_a,b){return [{kind:'project',id:b.project,name:b.name},
    {kind:'env',id:b.id,projectId:b.project}];},
  async apply(a,ctx,b,requestKey){
    const provider=await recheck(ctx,a,b,false);
    return provider.write('custom_environments_delete',{path:path(b),
      body:{deleteUnassignedEnvironmentVariables:false}},{
      requestKey,tool:'vercel_environment_delete',shapeResult:()=>({id:b.id})});
  },
  async verify(_a,ctx,b){
    let client,account;
    try{
      ({client,account}=await scope(ctx,b.project,b.name));
      if(account.team_id!==b.teamId)return {confirmed:null};
    }catch{return {confirmed:null};}
    try{
      await client.request('custom_environments_get',{path:path(b)});
      return {confirmed:false};
    }catch(err){return {confirmed:err?.status===404?true:null};}
  }
});
const output=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const customEnvironmentMutateTools={
  tools:[
    {name:'vercel_environment_update',writes:true,guardedWrite:true,
      profiles:['everyday','full'],area:'env',
      description:'Update a verified empty, nonproduction custom environment by exact revision; never mutate attached domains.',
      inputSchema:schema(core,[...core,'slug','branch','description','confirm','dryRun','requestKey']),
      writeContract:update.writeContract,annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_environment_delete',writes:true,guardedWrite:true,
      profiles:['full'],area:'env',
      description:'Irreversibly remove a nonproduction custom environment by exact revision; linked domains or aliases need the plan\'s exact evaluationId.',
      inputSchema:schema(core,[...core,'confirm','dryRun','evaluationId','requestKey']),
      writeContract:remove.writeContract,annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_environment_update:bindGuardedWrite(update,context,output),
    vercel_environment_delete:bindGuardedWrite(remove,context,output)
  }
};
