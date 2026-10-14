// D-3: small, explicit text-file deployments with trusted project identity.
// Sources are SHA-1 uploaded in bounded raw binary operations; build spend is
// unknown and centrally denied until per-transaction provider ceilings exist.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
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
    throw new TypeError('Exact project and one to four bounded safe files required');
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
      throw new TypeError('File content must be bounded nonsecret UTF-8 text');
    const parts=file.path.split('/');
    if(parts.some(part=>!SEG.test(part)||part==='.'||part==='..'||
      part.startsWith('.')||credentialLike(part))||seen.has(file.path))
      throw new TypeError('Unsafe, hidden or duplicate deployment path');
    seen.add(file.path);
    const bytes=Buffer.from(file.content,'utf8');
    total+=bytes.length;
    if(bytes.length===0||bytes.length>LIMIT||total>LIMIT)
      throw new TypeError('Deployment files exceed 2 MiB total');
    return {file:file.path,sha:createHash('sha1').update(bytes).digest('hex'),
      size:bytes.length};
  });
  return {items,total};
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
    throw new TypeError('Project outside selected connection scope');
  const row=await client.request('projects_get',{path:{idOrName:id}});
  if(row?.id!==id||row.name!==name||
    row.accountId!=null&&row.accountId!==account.team_id)
    throw new TypeError('Stored team/project identity mismatch');
  return {client,account};
}
const create=defineWrite({
  name:'vercel_deploy_create_from_files',risk:{spend:true},
  async before(args,ctx){
    const files=manifest(args);
    if(ctx.connection?.profile!=='full')throw new TypeError('Full profile required');
    const {account}=await checkProject(ctx,args.project,args.expectedName);
    const body={name:args.expectedName,project:args.expectedName,
      files:files.items,target:args.target};
    validateRequest('deployments_create',{query:{teamId:'team_FAKE_validation'},body});
    return {project:args.project,name:args.expectedName,
      target:args.target,files:files.items,total:files.total,
      teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Create a '+before.target+' deployment of '+before.name+
      ' with '+before.files.length+' SHA-1 verified text files ('+before.total+
      ' bytes, at most 2 MiB). Each file is uploaded before deploy. '+
      'Build charges remain unbounded; an independently approved enforceable total cost ceiling is required.';
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
      if(ctx.purchaseApproval?.operation!=='vercel_deploy_create_from_files'||
        ctx.purchaseApproval.requestKey!==requestKey)
        throw new TypeError('Independent owner purchase approval missing');
      const grant=await ctx.db.getPurchaseIntent({
        account:ctx.connection.account,reference:ctx.purchaseApproval.reference});
      if(grant?.status!=='consumed'||!grant.consumed_at)
        throw new TypeError('Owner purchase approval not consumed');
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
    return provider.write('deployments_create',{
      body:{name:before.name,project:before.name,
        files:before.files,target:before.target}
    },{requestKey,tool:'vercel_deploy_create_from_files',shapeResult:row=>{
      const id=row?.id??row?.uid;
      if(typeof id!=='string'||!/^dpl_[A-Za-z0-9_-]{3,120}$/.test(id)||
        row.projectId!==before.project||row.target!==before.target)
        throw new TypeError('Created deployment identity/target unverified');
      return {id};
    }});
  },
  async verify(_args,ctx,before,created){
    if(typeof created?.id!=='string')return {confirmed:null};
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==before.teamId)return {confirmed:null};
    const row=await client.request('deployments_get',{path:{idOrUrl:created.id}});
    return {confirmed:(row?.uid??row?.id)===created.id&&
      row.projectId===before.project&&row.target===before.target,
      deployment:created.id};
  }
});
export const deploymentFileCreateTools={
  tools:[{name:'vercel_deploy_create_from_files',writes:true,guardedWrite:true,
    profiles:['full'],area:'deployments',
    description:'Deploy up to 2 MiB of SHA-1 uploaded safe text files; metered build execution requires separate enforceable owner cost approval.',
    inputSchema,writeContract:create.writeContract,
    annotations:{readOnlyHint:false,destructiveHint:false}}],
  handlers:{vercel_deploy_create_from_files:bindGuardedWrite(create,context,result=>({
    isError:['refused_by_guard','outcome_unknown'].includes(result.status),
    content:[{type:'text',text:JSON.stringify(result)}]
  }))}
};
