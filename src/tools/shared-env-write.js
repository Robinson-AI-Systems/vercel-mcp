// E-2: team-scoped shared environment variable lifecycle. Writes never return
// provider values; shared scope/links/production impact must be independently proven.
import {randomBytes} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {pendingInputs} from '../core/pending-inputs.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';

const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
const ENV=/^env_[A-Za-z0-9_-]{3,124}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const TARGETS=new Set(['preview','development','production']);
const PENDING=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST=/^[A-Za-z0-9_-]{8,128}$/;
const props={
  project:{type:'string',pattern:PROJECT.source},
  mode:{type:'string',enum:['create','update','unlink','delete']},
  key:{type:'string',pattern:KEY.source},
  expectedKey:{type:'string',pattern:KEY.source},
  id:{type:'string',pattern:ENV.source},
  expectedUpdatedAt:{type:'integer',minimum:1},
  kind:{type:'string',enum:['Secret','Config']},
  expectedKind:{type:'string',enum:['Secret','Config']},
  value:{type:'string',minLength:1,maxLength:65536},
  pendingInputId:{type:'string',pattern:PENDING.source},
  generate:{type:'object',properties:{
    bytes:{type:'integer',const:32},
    encoding:{type:'string',enum:['hex','base64url']}
  },required:['bytes','encoding'],additionalProperties:false},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST.source}
};
const setKeys=['mode','project','key','id','expectedUpdatedAt','kind',
  'value','pendingInputId','generate','outsideApp','confirm','dryRun','requestKey'];
const removeKeys=['mode','project','id','expectedKey','expectedKind',
  'expectedUpdatedAt','outsideApp','confirm','dryRun','requestKey'];
const only=(a,keys)=>a&&typeof a==='object'&&!Array.isArray(a)&&
  Object.keys(a).every(k=>keys.includes(k));
function validControl(a){
  return a.confirm===undefined||typeof a.confirm==='boolean';
}
function validKind(k){return ['Secret','Config'].includes(k);}
function goodSource(a,kind){
  const sources=['value','pendingInputId','generate'].filter(k=>a[k]!==undefined);
  if(sources.length!==1)return false;
  if(kind==='Config'){
    return sources[0]==='value'&&typeof a.value==='string'&&
      a.value.length>0&&a.value.length<=65536&&!credentialLike(a.value);
  }
  if(sources[0]==='value')return false;
  if(sources[0]==='pendingInputId')return PENDING.test(a.pendingInputId??'');
  return a.generate&&typeof a.generate==='object'&&!Array.isArray(a.generate)&&
    Object.keys(a.generate).sort().join(',')==='bytes,encoding'&&
    a.generate.bytes===32&&['hex','base64url'].includes(a.generate.encoding);
}
function validSet(a){
  if(!only(a,setKeys)||!['create','update'].includes(a.mode)||
    !PROJECT.test(a.project??'')||!KEY.test(a.key??'')||
    credentialLike(a.key)||!validKind(a.kind)||!goodSource(a,a.kind)||
    a.outsideApp!==true||!validControl(a)||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!REQUEST.test(a.requestKey)||
    (a.mode==='create'&&(a.id!==undefined||a.expectedUpdatedAt!==undefined))||
    (a.mode==='update'&&(!ENV.test(a.id??'')||
      !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1)))
    throw new RefusalError('Shared write requires exact nonproduction project, kind and private value source');
}
function validRemoval(a){
  if(!only(a,removeKeys)||!['unlink','delete'].includes(a.mode)||
    !ENV.test(a.id??'')||!KEY.test(a.expectedKey??'')||
    credentialLike(a.expectedKey)||!validKind(a.expectedKind)||
    !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1||
    a.outsideApp!==true||!validControl(a)||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!REQUEST.test(a.requestKey)||
    (a.mode==='unlink'&&!PROJECT.test(a.project??''))||
    (a.mode==='delete'&&a.project!==undefined))
    throw new RefusalError('Shared removal needs exact ID, revision, kind and unlink/delete intent');
}
function rowMeta(raw,teamId){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    !ENV.test(raw.id??'')||!KEY.test(raw.key??'')||
    (raw.ownerId!=null&&raw.ownerId!==teamId)||
    !Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<1||
    !['plain','encrypted','sensitive'].includes(raw.type)||
    (raw.customEnvironmentIds!==undefined&&(!Array.isArray(raw.customEnvironmentIds)||
      raw.customEnvironmentIds.length>50)))
    throw new RefusalError('Shared variable ownership, identity or custom links unknown');
  const projects=typeof raw.projectId==='string'?[raw.projectId]:raw.projectId;
  const target=typeof raw.target==='string'?[raw.target]:raw.target;
  if(!Array.isArray(projects)||projects.length>50||
    projects.some(x=>!PROJECT.test(x))||new Set(projects).size!==projects.length||
    !Array.isArray(target)||target.length<1||target.length>3||
    target.some(t=>!TARGETS.has(t))||new Set(target).size!==target.length)
    throw new RefusalError('Cannot safely classify shared variable project or production targets');
  return {id:raw.id,key:raw.key,kind:raw.visibility==='secret'||
    raw.type!=='plain'?'Secret':'Config',projects:[...projects].sort(),
    updatedAt:raw.updatedAt,previewOnly:target.length===1&&target[0]==='preview',
    noCustomLinks:Array.isArray(raw.customEnvironmentIds)&&
      raw.customEnvironmentIds.length===0};
}
async function inventory(client,teamId){
  const page=await client.request('shared_env_list');
  if(!Array.isArray(page?.data)||page.data.length>100||
    !page.pagination||page.pagination.next!==null)
    throw new RefusalError('Complete selected-team shared variable inventory unavailable');
  const seenIds=new Set(),rows=page.data.map(r=>{
    const meta=rowMeta(r,teamId);
    if(seenIds.has(meta.id))throw new RefusalError('Duplicate shared variable ID');
    seenIds.add(meta.id);return meta;
  });
  return rows;
}
async function selected(ctx,project){
  const {client,account}=await readProvider(ctx);
  if(!['team','full'].includes(account.scope))
    throw new RefusalError('Team-scoped stored connection required for shared writes');
  if(project){
    const p=await client.request('projects_get',{path:{idOrName:project}});
    if(p?.id!==project||p.accountId!=null&&p.accountId!==account.team_id)
      throw new RefusalError('Project does not belong to selected Vercel team');
  }
  return {client,account};
}
async function beforeSet(a,ctx){
  validSet(a);
  const {client,account}=await selected(ctx,a.project);
  const rows=await inventory(client,account.team_id);
  let item=null;
  if(a.mode==='create'){
    if(rows.some(x=>x.key===a.key))
      throw new RefusalError('Shared variable key already exists in selected team');
  } else {
    item=rows.find(x=>x.id===a.id);
    if(!item||item.key!==a.key||item.kind!==a.kind||
      !item.previewOnly||!item.noCustomLinks||
      item.updatedAt!==a.expectedUpdatedAt||
      item.projects.length!==1||item.projects[0]!==a.project)
      throw new RefusalError('Shared variable kind, revision or project link changed');
  }
  return {mode:a.mode,project:a.project,teamId:account.team_id,
    id:item?.id??null,key:a.key,kind:a.kind,
    updatedAt:item?.updatedAt??null};
}
async function beforeRemoval(a,ctx){
  validRemoval(a);
  if(ctx.connection?.profile!=='full')
    throw new RefusalError('Full profile required for shared unlink or deletion');
  const {client,account}=await selected(ctx,a.project);
  const rows=await inventory(client,account.team_id);
  const row=rows.find(x=>x.id===a.id);
  if(!row||row.key!==a.expectedKey||row.kind!==a.expectedKind||
    !row.previewOnly||!row.noCustomLinks||
    row.updatedAt!==a.expectedUpdatedAt||
    (a.mode==='unlink'&&!row.projects.includes(a.project))||
    (a.mode==='delete'&&row.projects.length!==0))
    throw new RefusalError('Shared variable changed or deletion still has project links');
  return {mode:a.mode,project:a.project??null,teamId:account.team_id,
    id:row.id,key:row.key,kind:row.kind,updatedAt:row.updatedAt,
    projects:row.projects};
}
function same(before,now){
  return before.mode===now.mode&&before.project===now.project&&
    before.teamId===now.teamId&&before.id===now.id&&
    before.key===now.key&&before.kind===now.kind&&
    before.updatedAt===now.updatedAt&&
    (before.projects===undefined||JSON.stringify(before.projects)===JSON.stringify(now.projects));
}
async function providerFor(ctx,a,b,inspect){
  const provider=await writeProvider(ctx);
  await requirePreDispatch(async()=>{
    if(provider.account.team_id!==b.teamId)throw new TypeError('Vercel team changed');
    const current=await inspect(a,ctx);
    if(!same(b,current))throw new TypeError('Shared environment links or revision changed');
  });
  return provider;
}
async function valueFor(a,ctx){
  if(a.value!==undefined)return a.value;
  if(a.generate)return randomBytes(32).toString(a.generate.encoding);
  if(typeof ctx.db?.consumePendingInput!=='function')
    throw new TypeError('Owner pending input service unavailable');
  const value=await pendingInputs({db:ctx.db,env:ctx.env}).consume({
    id:a.pendingInputId,account:ctx.connection.account,kind:'env_value'});
  if(typeof value!=='string'||value.length<1||value.length>65536)
    throw new TypeError('Owner private value unavailable');
  return value;
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:row=>db.recordChange(row),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
function accountTargets(b){
  return [
    {kind:'account',id:b.teamId},
    ...(b.project?[{kind:'project',id:b.project}]:[]),
    {kind:'shared_env',id:b.id??b.key,accountId:b.teamId}
  ];
}
const set=defineWrite({
  name:'vercel_shared_env_set',secretIn:true,
  before:beforeSet,
  async preview(_a,_ctx,b){
    return (b.mode==='create'?'Create':'Replace')+' selected-team '+b.kind+
      ' shared variable '+b.key+' for project '+b.project+
      ' on preview only; value hidden, existing deployments unaffected';
  },
  async production(){return {production:false,why:'Exact preview-only target and single verified nonproduction project link'};},
  async targets(_a,b){return accountTargets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await providerFor(ctx,a,b,beforeSet);
    const value=await valueFor(a,ctx);
    if(b.mode==='create'){
      return provider.write('shared_env_create',{body:{
        evs:[{key:b.key,value}],type:b.kind==='Secret'?'encrypted':'plain',
        target:['preview'],projectId:[b.project]
      }},{requestKey,tool:'vercel_shared_env_set',shapeResult:result=>{
        const rows=result?.created;
        if(!Array.isArray(result?.failed)||result.failed.length!==0||
          !Array.isArray(rows)||rows.length!==1||
          !ENV.test(rows[0]?.id??'')||rows[0]?.key!==b.key)
          throw new TypeError('Shared create response cannot identify one variable');
        return {id:rows[0].id};
      }});
    }
    return provider.write('shared_env_update',{body:{
      updates:{[b.id]:{value}}
    }},{requestKey,tool:'vercel_shared_env_set',shapeResult:result=>{
      if(!Array.isArray(result?.failed)||result.failed.length!==0||
        !Array.isArray(result?.updated)||result.updated.length!==1||
        result.updated[0]?.id!==b.id)
        throw new TypeError('Shared update response is partial or ambiguous');
      return {id:b.id};
    }});
  },
  async verify(_a,ctx,b,applied){
    if(!ENV.test(applied?.id??''))return {confirmed:null};
    try{
      const {client,account}=await selected(ctx,b.project);
      if(account.team_id!==b.teamId)return {confirmed:null};
      const rows=await inventory(client,b.teamId),now=rows.find(x=>x.id===applied.id);
      if(!now||now.key!==b.key||now.kind!==b.kind||
        now.projects.length!==1||now.projects[0]!==b.project)
        return {confirmed:false};
      if(b.updatedAt!=null&&now.updatedAt<=b.updatedAt)return {confirmed:false};
      // No decryption or equality proof of even Config bytes via shared GET:
      // metadata proves the target, not the stored private value.
      return {confirmed:null};
    }catch{return {confirmed:null};}
  }
});
const remove=defineWrite({
  name:'vercel_shared_env_delete',
  before:beforeRemoval,
  async preview(_a,_ctx,b){
    return b.mode==='unlink'?'Unlink shared variable '+b.key+' ('+b.id+
      ') from exact preview project '+b.project+'; other links preserved':
      'IRREVERSIBLY delete unlinked shared variable '+b.key+' ('+b.id+
      ') in selected team; no project links permitted';
  },
  async production(){return {production:false,why:'Verified preview-only variable; no production target or custom environments'};},
  async targets(_a,b){return accountTargets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await providerFor(ctx,a,b,beforeRemoval);
    if(b.mode==='unlink')
      return provider.write('shared_env_unlink',{
        path:{id:b.id,projectId:b.project}
      },{requestKey,tool:'vercel_shared_env_delete',shapeResult:r=>{
        if(r?.id!==b.id)throw new TypeError('Unlink response ID unverified');
        return {id:b.id};
      }});
    return provider.write('shared_env_delete',{body:{ids:[b.id]}},{
      requestKey,tool:'vercel_shared_env_delete',shapeResult:r=>{
        if(!Array.isArray(r?.failed)||r.failed.length!==0||
          !Array.isArray(r?.deleted)||r.deleted.length!==1||
          !(r.deleted[0]===b.id||r.deleted[0]?.id===b.id))
          throw new TypeError('Shared delete must prove exact successful ID');
        return {id:b.id};
      }});
  },
  async verify(_a,ctx,b){
    try{
      const {client,account}=await selected(ctx,b.project);
      if(account.team_id!==b.teamId)return {confirmed:null};
      const rows=await inventory(client,b.teamId),now=rows.find(x=>x.id===b.id);
      if(b.mode==='delete')return {confirmed:now?false:true};
      if(!now)return {confirmed:null};
      if(now.key!==b.key||now.kind!==b.kind)return {confirmed:false};
      const old=b.projects.filter(x=>x!==b.project);
      return {confirmed:JSON.stringify(now.projects)===JSON.stringify(old)};
    }catch{return {confirmed:null};}
  }
});
const out=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const sharedEnvWriteTools={
  tools:[
    {name:'vercel_shared_env_set',writes:true,guardedWrite:true,
      profiles:['everyday','full'],area:'env',
      description:'Create or replace exactly one preview-only, project-linked shared variable with private input and metadata-only readback.',
      inputSchema:{type:'object',properties:Object.fromEntries(setKeys.map(k=>[k,props[k]])),
        required:['mode','project','key','kind','outsideApp'],additionalProperties:false},
      writeContract:set.writeContract,annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_shared_env_delete',writes:true,guardedWrite:true,
      profiles:['full'],area:'env',
      description:'Explicitly unlink one selected project or delete a completely unlinked preview shared variable by exact ID/revision.',
      inputSchema:{type:'object',properties:Object.fromEntries(removeKeys.map(k=>[k,props[k]])),
        required:['mode','id','expectedKey','expectedKind','expectedUpdatedAt','outsideApp'],
        additionalProperties:false},
      writeContract:remove.writeContract,annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_shared_env_set:bindGuardedWrite(set,context,out),
    vercel_shared_env_delete:bindGuardedWrite(remove,context,out)
  }
};
