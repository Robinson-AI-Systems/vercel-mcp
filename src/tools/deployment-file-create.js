// D-3: small, explicit text-file deployments with trusted project identity.
// Sources are SHA-1 uploaded in bounded raw binary operations; build spend is
// unknown and centrally denied until per-transaction provider ceilings exist.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch,purchaseDelegationFor, RefusalError } from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {deploymentTargetMatches} from '../vercel/deployment-target.js';
import {deploymentProjectSettings} from '../vercel/project-settings.js';
import {validateRequest} from '../vercel/openapi-validation.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SEG=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const LIMIT=2097152;
const inputSchema={type:'object',properties:{
  project:{type:'string',pattern:ID.source,minLength:2,maxLength:128},
  expectedName:{type:'string',pattern:NAME.source,minLength:1,maxLength:100},
  files:{type:'array',minItems:1,maxItems:4,items:{type:'object',
    properties:{path:{type:'string',minLength:1,maxLength:256},
      content:{type:'string',minLength:1,maxLength:2097152}},
    required:['path','content'],additionalProperties:false}},
  target:{type:'string',enum:['preview','production']},
  outsideApp:{type:'boolean',const:true},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
},required:['project','expectedName','files','target','outsideApp'],additionalProperties:false};

function manifest(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(inputSchema.properties,k))||
    !ID.test(args.project??'')||!NAME.test(args.expectedName??'')||
    !['preview','production'].includes(args.target)||args.outsideApp!==true||
    args.dryRun!==undefined&&typeof args.dryRun!=='boolean'||
    args.confirm!==undefined&&typeof args.confirm!=='boolean'||
    !Array.isArray(args.files)||args.files.length<1||args.files.length>4)
    throw new RefusalError('Exact project and one to four bounded safe files required');
  let total=0;
  const seen=new Set();
  const items=args.files.map(file=>{
    if(!file||typeof file!=='object'||Array.isArray(file)||
      Object.keys(file).some(k=>!['path','content'].includes(k))||
      typeof file.path!=='string'||file.path.length>256||
      typeof file.content!=='string'||file.content.length<1||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(file.content)||
      credentialLike(file.content)||
      /((?:password|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*\S+)/i.test(file.content))
      throw new RefusalError('File content must be bounded nonsecret UTF-8 text');
    const parts=file.path.split('/');
    if(parts.some(part=>!SEG.test(part)||part==='.'||part==='..'||
      part.startsWith('.')||credentialLike(part))||seen.has(file.path))
      throw new RefusalError('Unsafe, hidden or duplicate deployment path');
    seen.add(file.path);
    const bytes=Buffer.from(file.content,'utf8');
    total+=bytes.length;
    if(bytes.length===0||bytes.length>LIMIT||total>LIMIT)
      throw new RefusalError('Deployment files exceed 2 MiB total');
    return {file:file.path,sha:createHash('sha1').update(bytes).digest('hex'),
      size:bytes.length};
  });
  return {items,total};
}
// AUD-AG (files-create round 2; dossier:
// dev-preview-dossier-round2-2026-10-30.md): the AUD-M2 redacted
// shape fingerprint, applied to this tool's create leg. Round 1
// (AUD-AD) convicted the projectSettings resend and shipped the
// settings-only-on-first-deployment rule; the 2026-10-30 live probe
// then falsified its sufficiency — a settings-less create on a
// deployed project still drew a provider 400 at deployments_create,
// and nothing about why survived: the client strips the provider
// message by design, the AUD-H failure detail reaches only the
// ephemeral result, and the guarded-write executor journals no
// change_log row for an apply-path outcome_unknown. The full-body
// delta table (dossier §3) leaves two contract-visible suspects
// outside evidence cannot separate — the documented framework
// auto-detection confirmation (unsuppressed anywhere in this
// product) and the explicit target:'preview' the documented
// request vocabulary omits — so this card builds the instrument
// instead of a guessed fix: on any throw out of the create write,
// one best-effort change_log row carries the refusal's shape —
// the AUD-H verdict fields (status, pattern-validated code) and
// the dispatched body's field names with type words, computed
// from the actual body object — never values: no file contents,
// digests, sizes, identifiers or provider message. Field order
// follows AUD-M2's truncation discipline (the recent-changes read
// returns LEFT(summary, 160)): verdict, settings and target
// presence (the two suspects' discriminators), files shape, then
// the constant fields. One more live attempt reads the conviction
// back through vercel_recent_changes.
function jsonTypeOf(value){
  if(value===undefined)return 'absent';
  if(value===null)return 'null';
  if(Array.isArray(value))return 'array';
  return typeof value;
}
function createRefusalSummary(body,error){
  const status=Number.isSafeInteger(error?.status)&&
    error.status>=100&&error.status<=599?String(error.status):'absent';
  const code=typeof error?.code==='string'&&
    /^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(error.code)?error.code:'absent';
  const files=Array.isArray(body?.files)?body.files:[];
  const entry=files[0]&&typeof files[0]==='object'&&!Array.isArray(files[0])?
    files[0]:null;
  const entryShape=entry?Object.keys(entry).sort()
    .map(key=>key+':'+jsonTypeOf(entry[key])).join(','):'absent';
  return 'SHAPE-FP deployments_create failed=['+status+':'+code+'] types: '+
    'projectSettings:'+jsonTypeOf(body?.projectSettings)+
    ' target:'+jsonTypeOf(body?.target)+
    ' files:array#'+files.length+
    ' files[]:'+entryShape+
    ' name:'+jsonTypeOf(body?.name)+
    ' project:'+jsonTypeOf(body?.project)+
    ' meta:'+jsonTypeOf(body?.meta)+
    ' query:teamId';
}
async function journalCreateRefusal(ctx,before,body,error){
  try{
    await ctx.audit({account:ctx.connection.account,
      mode:ctx.connection.mode,tool:'vercel_deploy_create_from_files',
      summary:createRefusalSummary(body,error),dryRun:false,
      production:before.target==='production'});
  }catch{/* Best-effort, as AUD-M2: the audit trail never changes the outcome. */}
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
async function checkProject(ctx,id,name){
  const {client,account}=await readProvider(ctx);
  if(account.scope==='project'&&account.project_id!==id)
    throw new RefusalError('Project outside selected connection scope');
  const row=await client.request('projects_get',{path:{idOrName:id}});
  if(row?.id!==id||row.name!==name||
    row.accountId!=null&&row.accountId!==account.team_id)
    throw new RefusalError('Stored team/project identity mismatch');
  return {client,account,row};
}
const create=defineWrite({
  name:'vercel_deploy_create_from_files',risk:{spend:true},
  async before(args,ctx){
    const files=manifest(args);
    if(ctx.connection?.profile!=='full')throw new RefusalError('Full profile required');
    const {account,row}=await checkProject(ctx,args.project,args.expectedName);
    // projectSettings are required for a project's FIRST deployment and
    // saved by the provider for later ones (vendored OpenAPI description;
    // omitting them against a settings-less project is the 400
    // missing_project_settings of VMCP-023's 2026-10-28 live probe).
    // AUD-AD: they are sent ONLY when this create is that first
    // deployment — the record's documented hasDeployments flag, already
    // read above, is the proof. On a deployed project the provider
    // inherits its saved settings (the create contract's redeploy rule:
    // inherited unless explicitly overridden), which is the shape every
    // other create caller uses (git create, branch previews). Resending
    // the record's settings on a non-first deployment is the one body
    // difference from those proven routes and is what the provider
    // refused with HTTP 400 in the 2026-10-30 live staging (twice;
    // dossier: dev-preview-dossier-2026-10-30.md). Effective settings
    // are unchanged — the saved copy IS the record's values; they are
    // no longer restated.
    const firstDeployment=row.hasDeployments===false;
    const projectSettings=firstDeployment?deploymentProjectSettings(row):undefined;
    const body={name:args.expectedName,project:args.expectedName,
      files:files.items,target:args.target,
      ...(projectSettings?{projectSettings}:{})};
    validateRequest('deployments_create',{query:{teamId:'team_FAKE_validation'},body});
    return {project:args.project,name:args.expectedName,
      target:args.target,files:files.items,total:files.total,
      projectSettings,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Create a '+before.target+' deployment of '+before.name+
      ' with '+before.files.length+' SHA-1 verified text files ('+before.total+
      ' bytes, at most 2 MiB). Each file is uploaded before deploy. '+
      'Build charges are metered; execution follows the account purchase policy (owner word or owner grant).';
  },
  async production(_args,_ctx,before){
    return {production:before.target==='production',
      why:'Explicit requested file deployment target'};
  },
  async targets(_args,before){
    return [{kind:'project',id:before.project,name:before.name}];
  },
  async spend(){
    return {cents:null,recurring:true,
      description:'File upload and build incur unbounded usage-based charges'};
  },
  async apply(args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        provider.account.scope==='project'&&provider.account.project_id!==before.project)
        throw new TypeError('Team/project scope changed');
      const project=await provider.read('projects_get',{path:{idOrName:before.project}});
      if(project?.id!==before.project||project.name!==before.name||
        project.accountId!=null&&project.accountId!==before.teamId)
        throw new TypeError('Project identity changed before upload');
      const fresh=manifest(args);
      if(fresh.total!==before.total||
        JSON.stringify(fresh.items)!==JSON.stringify(before.files))
        throw new TypeError('File manifest changed since owner review');
      // Purchase authority (AUD-A2): a consumed owner grant on the grant
      // path, or the executor's owner-word delegation on an owner
      // connection whose policy does not require a grant.
      if(!purchaseDelegationFor(ctx,'vercel_deploy_create_from_files',requestKey)){
        if(ctx.purchaseApproval?.operation!=='vercel_deploy_create_from_files'||
          ctx.purchaseApproval.requestKey!==requestKey)
          throw new TypeError('Independent owner purchase approval missing');
        const grant=await ctx.db.getPurchaseIntent({
          account:ctx.connection.account,reference:ctx.purchaseApproval.reference});
        if(grant?.status!=='consumed'||!grant.consumed_at)
          throw new TypeError('Owner purchase approval not consumed');
      }
    });
    // Each upload uses a distinct durable replay claim. Failed or uncertain
    // uploads stop deployment creation; never retry POST blindly.
    for(let index=0;index<before.files.length;index++){
      const item=before.files[index],bytes=Buffer.from(args.files[index].content,'utf8');
      if(createHash('sha1').update(bytes).digest('hex')!==item.sha||
        bytes.length!==item.size)
        throw new TypeError('File bytes changed after confirmation');
      const uploaded=await provider.uploadFile({sha:item.sha,bytes},{
        requestKey,tool:'vercel_deploy_create_from_files'});
      if(uploaded?.sha!==item.sha||uploaded.size!==item.size||
        uploaded.uploaded!==true)throw new TypeError('Upload could not be verified');
    }
    const body={name:before.name,project:before.name,
      files:before.files,target:before.target,
      ...(before.projectSettings?{projectSettings:before.projectSettings}:{})};
    let created;
    try{
      created=await provider.write('deployments_create',{body},
        {requestKey,tool:'vercel_deploy_create_from_files',shapeResult:row=>{
          const id=row?.id??row?.uid;
          // The documented create response has an in-progress shape with
          // no projectId (AUD-L): it must match when carried; the durable
          // project proof is verify()'s read-back of the full object.
          if(typeof id!=='string'||!/^dpl_[A-Za-z0-9_-]{3,120}$/.test(id)||
            ((row.projectId??row.project?.id)!=null&&
             (row.projectId??row.project?.id)!==before.project))
            throw new TypeError('Created deployment identity unverified');
          // No target arm (AUD-N): the documented response target enum
          // is production/staging/null — a provider-promoted first
          // deployment must surface as applied with verify() reporting
          // the target honestly, never as outcome_unknown.
          return {id};
        }});
    }catch(error){
      // AUD-AG: journal the refusal's redacted shape fingerprint
      // (best-effort) before the executor shapes the unchanged
      // outcome_unknown result from the same error.
      await journalCreateRefusal(ctx,before,body,error);
      throw error;
    }
    return created;
  },
  async verify(_args,ctx,before,created){
    if(typeof created?.id!=='string')return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==before.teamId)return {confirmed:null};
    const row=await client.request('deployments_get',{path:{idOrUrl:created.id}});
    // Project identity is required when the read-back carries it,
    // top-level or as the reduced shape's nested project.id (AUD-M;
    // PR #255 review).
    return {confirmed:(row?.uid??row?.id)===created.id&&
      ((row.projectId??row.project?.id)==null||
       (row.projectId??row.project?.id)===before.project)&&
      deploymentTargetMatches(row.target,before.target),
      deployment:created.id};
  }
});
export const deploymentFileCreateTools={
  tools:[{name:'vercel_deploy_create_from_files',writes:true,guardedWrite:true,
    profiles:['full'],area:'deployments',
    description:'Deploy up to 2 MiB of SHA-1 uploaded safe text files; metered build cost follows the account purchase policy.',
    inputSchema,writeContract:create.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_deploy_create_from_files:bindGuardedWrite(create,context,result=>({
    isError:['refused_by_guard','outcome_unknown'].includes(result.status),
    content:[{type:'text',text:JSON.stringify(result)}]
  }))}
};
