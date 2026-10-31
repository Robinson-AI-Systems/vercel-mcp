// E-1: single-variable create/update/delete with explicit project, target and audit guards.
// Never serialize values, digests or raw provider rows to the result or audit.
import {randomBytes} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {pendingInputs} from '../core/pending-inputs.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
const ID=/^[A-Za-z0-9_-]{6,128}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const TARGETS=new Set(['preview','development','production']);
const PENDING=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const props={
  project:{type:'string',pattern:PROJECT.source},key:{type:'string',pattern:KEY.source},
  mode:{type:'string',enum:['create','update']},
  id:{type:'string',pattern:ID.source},expectedUpdatedAt:{type:'integer',minimum:1},
  targets:{type:'array',minItems:1,maxItems:3,uniqueItems:true,
    items:{type:'string',enum:['preview','development','production']}},
  kind:{type:'string',enum:['Config','Secret']},
  value:{type:'string',minLength:1,maxLength:65536},
  pendingInputId:{type:'string',pattern:PENDING.source},
  generate:{type:'object',properties:{
    bytes:{type:'integer',const:32},
    encoding:{type:'string',enum:['hex','base64url']}
  },required:['bytes','encoding'],additionalProperties:false},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  outsideApp:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const setSchema={type:'object',properties:props,required:['project','key','mode','targets'],
  additionalProperties:false};
const delProps={project:props.project,id:props.id,expectedKey:props.key,
  expectedUpdatedAt:props.expectedUpdatedAt,
  outsideApp:{type:'boolean',const:true},
  confirm:props.confirm,dryRun:props.dryRun,requestKey:props.requestKey};
const delSchema={type:'object',properties:delProps,
  required:['project','id','expectedKey','expectedUpdatedAt','outsideApp'],
  additionalProperties:false};
const plain=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,p)=>plain(v)&&Object.keys(v).every(k=>Object.hasOwn(p,k));
const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const ordered=(t)=>[...t].sort();
function validateSet(a){
  if(!exact(a,props)||!PROJECT.test(a.project??'')||!KEY.test(a.key??'')||
    !['create','update'].includes(a.mode)||
    !Array.isArray(a.targets)||a.targets.length<1||a.targets.length>3||
    a.targets.some(t=>!TARGETS.has(t))||new Set(a.targets).size!==a.targets.length||
    (a.mode==='create'&&(a.id!==undefined||a.expectedUpdatedAt!==undefined))||
    (a.mode==='update'&&(!ID.test(a.id??'')||
      !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1))||
    (a.kind!==undefined&&!['Secret','Config'].includes(a.kind))||
    (a.confirm!==undefined&&typeof a.confirm!=='boolean')||
    (a.outsideApp!==undefined&&typeof a.outsideApp!=='boolean')||
    (a.dryRun!==undefined&&typeof a.dryRun!=='boolean'))
    throw new RefusalError('Invalid exact environment value request');
  const kind=a.kind??'Secret';
  const sources=['value','pendingInputId','generate'].filter(k=>a[k]!==undefined);
  if(sources.length!==1||
    (kind==='Config'&&sources[0]!=='value')||
    (kind==='Secret'&&sources[0]==='value')||
    (kind==='Secret'&&a.targets.includes('development'))||
    (sources[0]==='value'&&(typeof a.value!=='string'||a.value.length<1||
      a.value.length>65536||credentialLike(a.value)))||
    (sources[0]==='pendingInputId'&&!PENDING.test(a.pendingInputId))||
    (sources[0]==='generate'&&(!exact(a.generate,{bytes:1,encoding:1})||
      a.generate.bytes!==32||!['hex','base64url'].includes(a.generate.encoding))))
    throw new RefusalError('Choose one permitted private environment value source');
}
function validateDelete(a){
  if(!exact(a,delProps)||!PROJECT.test(a.project??'')||!ID.test(a.id??'')||
    !KEY.test(a.expectedKey??'')||!Number.isSafeInteger(a.expectedUpdatedAt)||
    a.expectedUpdatedAt<1||a.outsideApp!==true||
    (a.confirm!==undefined&&typeof a.confirm!=='boolean')||
    (a.dryRun!==undefined&&typeof a.dryRun!=='boolean'))
    throw new RefusalError('Exact environment identity, revision and outside-app intent required');
}
function envMeta(raw,project){
  if(!plain(raw)||!ID.test(raw.id??'')||!KEY.test(raw.key??'')||
    raw.projectId!==undefined&&raw.projectId!==project||
    !Array.isArray(raw.target)||raw.target.length<1||raw.target.length>3||
    raw.target.some(t=>!TARGETS.has(t))||new Set(raw.target).size!==raw.target.length||
    !Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<1||
    !['plain','sensitive','encrypted','secret','system'].includes(raw.type)||
    raw.customEnvironmentIds!=null&&(!Array.isArray(raw.customEnvironmentIds)||
      raw.customEnvironmentIds.length!==0))
    throw new RefusalError('Environment owner, targets, revision or custom links unverified');
  return {id:raw.id,key:raw.key,targets:ordered(raw.target),updatedAt:raw.updatedAt,
    kind:raw.visibility==='secret'||raw.type!=='plain'?'Secret':'Config'};
}
async function scoped(ctx,project){
  const {client,account}=await readProvider(ctx);
  if(account.scope==='project'&&account.project_id!==project)
    throw new RefusalError('Wrong project for stored credential');
  const row=await client.request('projects_get',{path:{idOrName:project}});
  if(row?.id!==project)throw new RefusalError('Project identity unverified');
  // P-1: the project name rides along so write targets can name the
  // project for the profile guard (profiles key on names).
  return {client,account,
    projectName:typeof row.name==='string'?row.name:null};
}
async function fresh(ctx,before,id){
  const {client,account}=await scoped(ctx,before.project);
  if(account.team_id!==before.teamId)
    throw new TypeError('Selected team changed');
  if(!id)return {client,account};
  const row=envMeta(await client.request('project_env_get',{
    path:{idOrName:before.project,id}
  }),before.project);
  if(row.id!==before.id||row.key!==before.key||
    row.updatedAt!==before.updatedAt||row.kind!==before.oldKind||
    !eq(row.targets,before.oldTargets))
    throw new TypeError('Environment changed before confirmed write');
  return {client,account};
}
function ctxFor({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:row=>db.recordChange(row),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const set=defineWrite({
  name:'vercel_env_set',secretIn:true,
  async before(a,ctx){
    validateSet(a);
    const {account,client,projectName}=await scoped(ctx,a.project);
    const before={project:a.project,projectName,key:a.key,teamId:account.team_id,
      targets:ordered(a.targets),kind:a.kind??'Secret',mode:a.mode};
    if(a.mode==='update'){
      const row=envMeta(await client.request('project_env_get',{
        path:{idOrName:a.project,id:a.id}}),a.project);
      if(row.id!==a.id||row.key!==a.key||row.updatedAt!==a.expectedUpdatedAt||
        row.kind!==before.kind)
        throw new RefusalError('Existing environment identity or kind differs');
      Object.assign(before,{id:row.id,updatedAt:row.updatedAt,oldKind:row.kind,
        oldTargets:row.targets});
    }
    return before;
  },
  async preview(_a,_ctx,b){
    return (b.mode==='create'?'Create':'Replace')+' '+b.kind+' variable '+b.key+
      ' in '+b.project+' for '+b.targets.join(',')+
      '; value hidden; changes apply only to new deployments; redeploy is separate';
  },
  async production(_a,_ctx,b){
    const live=b.targets.includes('production')||(b.oldTargets??[]).includes('production');
    return {production:live,why:live?'Production target is involved':'Only nonproduction targets'};
  },
  async targets(a,b){
    // P-1: the profile guard judges env writes by key and by the caller's
    // outsideApp declaration; both ride on the target (additive fields).
    const outside=a.outsideApp===true;
    return [{kind:'project',id:b.project,outsideApp:outside,
        ...(b.projectName?{projectName:b.projectName}:{})},
      {kind:'env',id:b.id??b.key,projectId:b.project,key:b.key,outsideApp:outside,
        ...(b.projectName?{projectName:b.projectName}:{})}];
  },
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId||
        provider.account.scope==='project'&&provider.account.project_id!==b.project)
        throw new TypeError('Selected connection scope changed');
      await fresh(ctx,b,b.mode==='update'?b.id:null);
    });
    let value;
    if(a.value!==undefined)value=a.value;
    else if(a.generate)value=randomBytes(32).toString(a.generate.encoding);
    else{
      if(typeof ctx.db?.consumePendingInput!=='function')
        throw new TypeError('Owner pending-input service unavailable');
      value=await pendingInputs({db:ctx.db,env:ctx.env}).consume({
        id:a.pendingInputId,account:ctx.connection.account,kind:'env_value'});
      if(typeof value!=='string'||value.length<1||value.length>65536)
        throw new TypeError('Owner pending input unavailable or invalid');
    }
    const body={value,type:b.kind==='Secret'?'sensitive':'plain',target:b.targets};
    const operation=b.mode==='create'?'project_env_create':'project_env_update';
    const path={idOrName:b.project,...(b.mode==='update'?{id:b.id}:{})};
    return provider.write(operation,{path,body:{
      ...(b.mode==='create'?{key:b.key}:{}),...body
    }},{requestKey,tool:'vercel_env_set',shapeResult:row=>{
      const shaped={id:b.mode==='update'?b.id:verifiedCreatedEnvId(row,b.key)};
      // X-1: carry the created row's revision out of the create
      // response itself (no extra read) so the journaled inverse
      // can name the exact delete expectation.
      if(b.mode==='create'){
        const createdRow=row?.created??row;
        const created=Array.isArray(createdRow)&&createdRow.length===1?
          createdRow[0]:createdRow;
        if(Number.isSafeInteger(created?.updatedAt))
          shaped.createdUpdatedAt=created.updatedAt;
      }
      return shaped;
    }});
  },
  async verify(a,ctx,b,applied){
    if(!ID.test(applied?.id??''))return {confirmed:null};
    try{
      const {client,account}=await scoped(ctx,b.project);
      if(account.team_id!==b.teamId)return {confirmed:null};
      const raw=await client.request('project_env_get',{
        path:{idOrName:b.project,id:applied.id}});
      const row=envMeta(raw,b.project);
      if(row.id!==applied.id||row.key!==b.key||row.kind!==b.kind||
        !eq(row.targets,b.targets))
        return {confirmed:false};
      // Sensitive values cannot be independently decrypted. Metadata is proven,
      // but never claim that the stored secret bytes were verified.
      return {confirmed:b.kind==='Secret'?null:raw.value===a.value};
    }catch{return {confirmed:null};}
  },
  // X-1: a create is undone by deleting the created row (identity +
  // revision read back at journal time). An update stores the
  // design's descriptive sentence: a changed value cannot be
  // restored — Vercel keeps no value history and this server never
  // stores values.
  async inverse(a,b,applied,ctx){
    if(b.mode==='update')
      return {undo:'Set '+b.key+' again from the setup page: a changed value cannot be restored (Vercel keeps no value history and this server never stores values). Its previous targets were '+(b.oldTargets??[]).join(', ')};
    if(Number.isSafeInteger(applied?.createdUpdatedAt))
      return {tool:'vercel_env_delete',project:b.project,id:applied.id,
        expectedKey:b.key,expectedUpdatedAt:applied.createdUpdatedAt,
        outsideApp:true};
    try{
      const {client}=await scoped(ctx,b.project);
      const row=envMeta(await client.request('project_env_get',{
        path:{idOrName:b.project,id:applied.id}}),b.project);
      return {tool:'vercel_env_delete',project:b.project,id:applied.id,
        expectedKey:b.key,expectedUpdatedAt:row.updatedAt,outsideApp:true};
    }catch{
      return {undo:'Delete the created variable '+b.key+' with vercel_env_delete (its revision could not be read back)'};
    }
  }
});
const del=defineWrite({
  name:'vercel_env_delete',
  async before(a,ctx){
    validateDelete(a);
    const {client,account,projectName}=await scoped(ctx,a.project);
    const row=envMeta(await client.request('project_env_get',{
      path:{idOrName:a.project,id:a.id}}),a.project);
    if(row.id!==a.id||row.key!==a.expectedKey||
      row.updatedAt!==a.expectedUpdatedAt)
      throw new RefusalError('Requested environment ID/key/revision mismatch');
    return {project:a.project,projectName,teamId:account.team_id,id:row.id,key:row.key,
      oldTargets:row.targets,oldKind:row.kind,updatedAt:row.updatedAt};
  },
  async preview(_a,_ctx,b){
    return 'Permanently delete variable '+b.key+' ('+b.id+') from ALL targets '+
      b.oldTargets.join(',')+' in '+b.project+
      '; existing deployments are unchanged, future deployments lose the variable';
  },
  async production(_a,_ctx,b){
    return {production:b.oldTargets.includes('production'),
      why:b.oldTargets.includes('production')?'Variable includes production':'Preview/development only'};
  },
  async targets(a,b){
    return [{kind:'project',id:b.project,outsideApp:a.outsideApp===true,
        ...(b.projectName?{projectName:b.projectName}:{})},
      {kind:'env',id:b.id,projectId:b.project,key:b.key,outsideApp:a.outsideApp===true,
        ...(b.projectName?{projectName:b.projectName}:{})}];
  },
  async apply(_a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId||
        provider.account.scope==='project'&&provider.account.project_id!==b.project)
        throw new TypeError('Credential scope changed before deletion');
      await fresh(ctx,b,b.id);
    });
    return provider.write('project_env_delete',{path:{idOrName:b.project,id:b.id}},{
      requestKey,tool:'vercel_env_delete',shapeResult:()=>({accepted:true})});
  },
  async verify(_a,ctx,b){
    // A 404 from project GET is not proof that the variable was removed.
    let client,account;
    try{({client,account}=await scoped(ctx,b.project));}
    catch{return {confirmed:null};}
    if(account.team_id!==b.teamId)return {confirmed:null};
    try{
      await client.request('project_env_get',{path:{idOrName:b.project,id:b.id}});
      return {confirmed:false};
    }catch(error){return {confirmed:error?.status===404?true:null};}
  }
});
const output=result=>({isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]});
export const projectEnvWriteTools={
  tools:[
    {name:'vercel_env_set',writes:true,guardedWrite:true,profiles:['everyday','full'],
      area:'env',description:'Create or replace one exact project variable; private value input and independently checked target.',
      inputSchema:setSchema,writeContract:set.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_env_delete',writes:true,guardedWrite:true,profiles:['full'],
      area:'env',description:'Irreversibly delete one exact environment variable from all targets with guarded readback.',
      inputSchema:delSchema,writeContract:del.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_env_set:bindGuardedWrite(set,ctxFor,output),
    vercel_env_delete:bindGuardedWrite(del,ctxFor,output)
  }
};

// Internal allowlisted metadata helpers for server-side Config-only copy.
export {envMeta,scoped};


export function verifiedCreatedEnvId(envelope,expectedKey){
  // Vercel's current POST contract wraps the created row and can report
  // a successful HTTP response containing per-item failures. Never
  // acknowledge a partial creation or serialize any returned raw values.
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||
    (envelope.failed!==undefined&&(!Array.isArray(envelope.failed)||
      envelope.failed.length!==0)))
    throw new TypeError('Environment create returned unknown or failed items');
  const row=envelope.created??envelope;
  const created=Array.isArray(row)&&row.length===1?row[0]:row;
  if(!created||typeof created!=='object'||Array.isArray(created)||
    !ID.test(created.id??'')||created.key!=null&&created.key!==expectedKey)
    throw new TypeError('Provider response lacks exact environment ID/key');
  return created.id;
}
