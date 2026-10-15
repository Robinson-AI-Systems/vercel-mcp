// E-3: guarded item patch and version-checked store removal.
// A live-linked store is always treated as production; unknown links fail closed.
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {STORE,SLUG,KEY,selected,exact,strictArgs,schema} from './globalconfig-common.js';

const REVISION={type:'integer',minimum:1};
const REQUEST={type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'};
const baseProps={
  id:{type:'string',pattern:STORE.source},
  expectedSlug:{type:'string',pattern:SLUG.source},
  expectedUpdatedAt:REVISION,
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},
  dryRun:{type:'boolean'},
  requestKey:REQUEST
};
const common=Object.keys(baseProps);
const OPS=new Set(['create','update','delete','upsert']);
const patchProps={
  ...baseProps,
  items:{type:'array',minItems:1,maxItems:10,items:{
    type:'object',required:['operation','key'],additionalProperties:false,
    properties:{
      operation:{type:'string',enum:[...OPS]},
      key:{type:'string',pattern:KEY.source},
      value:{}
    }
  }}
};
function validBase(a,keys){
  strictArgs(a,keys);
  if(!STORE.test(a.id??'')||!SLUG.test(a.expectedSlug??'')||
    !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1||
    a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!/^[A-Za-z0-9_-]{8,128}$/.test(a.requestKey))
    throw new TypeError('Exact Global Config store ID, slug, revision and outside-app intent required');
}
function safeJson(value,depth=0){
  if(depth>8)throw new TypeError('Config values cannot be deeply nested');
  if(typeof value==='string'){
    if(credentialLike(value)||/[\x00-\x08\x0b-\x1f\x7f]/.test(value))
      throw new TypeError('Global Config cannot store credentials or control bytes');
    return;
  }
  if(value===null||typeof value==='boolean'||typeof value==='number'){
    if(typeof value==='number'&&!Number.isFinite(value))
      throw new TypeError('Global Config value must be finite');
    return;
  }
  if(Array.isArray(value)){
    if(value.length>100)throw new TypeError('Config array is oversized');
    value.forEach(x=>safeJson(x,depth+1));return;
  }
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object){
    if(Object.keys(value).length>100)throw new TypeError('Config object is oversized');
    for(const [key,part] of Object.entries(value)){
      if(credentialLike(key)||key==='__proto__'||key==='constructor'||
        key==='prototype'||/[\x00-\x1f\x7f]/.test(key))
        throw new TypeError('Unsafe Global Config item field');
      safeJson(part,depth+1);
    }
    return;
  }
  throw new TypeError('Unsupported Global Config value');
}
function validItems(a){
  validBase(a,Object.keys(patchProps));
  if(!Array.isArray(a.items)||a.items.length<1||a.items.length>10)
    throw new TypeError('One to ten exact changes required');
  const seen=new Set();
  for(const item of a.items){
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).some(k=>!['operation','key','value'].includes(k))||
      !OPS.has(item.operation)||!KEY.test(item.key??'')||
      credentialLike(item.key)||seen.has(item.key))
      throw new TypeError('Invalid Global Config operation or duplicate key');
    seen.add(item.key);
    if(item.operation==='delete'){
      if(Object.hasOwn(item,'value'))throw new TypeError('Delete cannot supply an item value');
    }else{
      if(!Object.hasOwn(item,'value'))
        throw new TypeError('Upsert/update/create requires an explicit value');
      safeJson(item.value);
      if(Buffer.byteLength(JSON.stringify(item.value),'utf8')>8192)
        throw new TypeError('Item exceeds safe request size');
    }
  }
}
function allItems(raw){
  // This endpoint returns a complete key map for an exact store in the pinned
  // contract. A truncated or wrapped pagination response is not write proof.
  if(raw?.pagination?.next!==undefined&&raw.pagination.next!==null)
    throw new TypeError('Paginated Global Config items cannot be patched');
  const items=raw?.items??raw;
  if(!items||typeof items!=='object'||Array.isArray(items)||
    Object.keys(items).length>200)
    throw new TypeError('Global Config item inventory unverified');
  const keys=Object.keys(items);
  if(keys.some(key=>!KEY.test(key)||credentialLike(key)))
    throw new TypeError('Unknown Global Config item key');
  return items;
}
function assertOperations(items,existing){
  for(const item of items){
    const exists=Object.hasOwn(existing,item.key);
    if(item.operation==='create'&&exists||
      ['update','delete'].includes(item.operation)&&!exists)
      throw new TypeError('Global Config item key state differs from requested operation');
  }
}
async function store(ctx,args){
  const {client,account,row}=await exact(ctx,args.id);
  if(!['team','full'].includes(account.scope)||
    row.slug!==args.expectedSlug||
    row.updatedAt!==args.expectedUpdatedAt||
    !Array.isArray(row.projects)||row.projects.length>20||
    row.itemCount===null)
    throw new TypeError('Global Config owner, connections or revision cannot be classified');
  // A team-owned store can connect to other projects. Prove every project ID
  // and owning team rather than assuming a link is harmless.
  for(const project of row.projects){
    const meta=await client.request('projects_get',{path:{idOrName:project}});
    if(meta?.id!==project||meta.accountId!==account.team_id)
      throw new TypeError('Connected project team could not be proven');
  }
  return {client,account,row};
}
function targets(b){
  return [{kind:'account',id:b.teamId},
    {kind:'store',id:b.id,accountId:b.teamId},
    ...b.projects.map(id=>({kind:'project',id}))];
}
function same(a,b){
  return a.id===b.id&&a.teamId===b.teamId&&a.slug===b.slug&&
    a.updatedAt===b.updatedAt&&a.itemCount===b.itemCount&&
    JSON.stringify(a.projects)===JSON.stringify(b.projects)&&
    JSON.stringify(a.keys)===JSON.stringify(b.keys);
}
async function beforePatch(a,ctx){
  validItems(a);
  const {client,account,row}=await store(ctx,a);
  const items=allItems(await client.request('global_config_items',
    {path:{edgeConfigId:row.id}}));
  if(Object.keys(items).length!==row.itemCount)
    throw new TypeError('Incomplete Global Config item inventory');
  assertOperations(a.items,items);
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    updatedAt:row.updatedAt,itemCount:row.itemCount,
    projects:[...row.projects].sort(),keys:Object.keys(items).sort(),
    ops:a.items.map(x=>({operation:x.operation,key:x.key}))};
}
async function beforeDelete(a,ctx){
  validBase(a,common);
  if(ctx.connection?.profile!=='full')
    throw new TypeError('Irreversible store deletion needs a full profile');
  const {client,account,row}=await store(ctx,a);
  const contents=allItems(await client.request('global_config_items',
    {path:{edgeConfigId:row.id}}));
  if(Object.keys(contents).length!==row.itemCount)
    throw new TypeError('Store contents could not be completely enumerated');
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    updatedAt:row.updatedAt,itemCount:row.itemCount,
    projects:[...row.projects].sort(),keys:Object.keys(contents).sort()};
}
function context({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:r=>db.recordChange(r),replayStore:db.requestReplayStore(),
    guardProtected:t=>checkProtected(t,{db,connection,env}),
    guardApp:t=>checkApp(t,{db,connection,env})};
}
async function dispatch(ctx,a,b,inspect){
  const provider=await writeProvider(ctx);
  await requirePreDispatch(async()=>{
    if(provider.account.team_id!==b.teamId||
      !['team','full'].includes(provider.account.scope))
      throw new TypeError('Stored team scope changed');
    const current=await inspect(a,ctx);
    if(!same(b,current))
      throw new TypeError('Store, connected projects, item inventory or revision changed');
  });
  return provider;
}
function classification(_a,_ctx,b){
  return {production:b.projects.length>0,
    why:b.projects.length?'Connected projects can immediately read store changes':
      'Proven unlinked store with no production readers'};
}
const patch=defineWrite({
  name:'vercel_globalconfig_patch_items',
  before:beforePatch,
  async preview(_a,_ctx,b){
    return 'Change '+b.ops.length+' named items in Global Config '+b.slug+
      ' ('+b.id+'): '+b.ops.map(x=>x.operation+' '+x.key).join(', ')+
      '; actual values hidden; linked projects may read the changes immediately';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await dispatch(ctx,a,b,beforePatch);
    return provider.write('global_config_patch_items',{
      path:{edgeConfigId:b.id},body:{items:a.items}
    },{requestKey,tool:'vercel_globalconfig_patch_items',
      shapeResult:()=>({id:b.id,affected:b.ops.length})});
  },
  async verify(a,ctx,b){
    try{
      const {client,account,row}=await exact(ctx,b.id);
      if(account.team_id!==b.teamId||row.slug!==b.slug||
        row.updatedAt<=b.updatedAt||
        JSON.stringify([...row.projects].sort())!==JSON.stringify(b.projects))
        return {confirmed:null};
      const content=allItems(await client.request('global_config_items',
        {path:{edgeConfigId:b.id}}));
      for(const item of a.items){
        const exists=Object.hasOwn(content,item.key);
        if(item.operation==='delete'&&exists||item.operation!=='delete'&&
          (!exists||JSON.stringify(content[item.key])!==JSON.stringify(item.value)))
          return {confirmed:false};
      }
      return {confirmed:true};
    }catch{return {confirmed:null};}
  }
});
const remove=defineWrite({
  name:'vercel_globalconfig_delete',
  before:beforeDelete,
  async preview(_a,_ctx,b){
    return 'IRREVERSIBLY delete Global Config '+b.slug+' ('+b.id+') with '+
      b.itemCount+' items and '+b.projects.length+' verified project links ['+
      b.projects.join(', ')+']. Connected applications can lose configuration';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await dispatch(ctx,a,b,beforeDelete);
    return provider.write('global_config_delete',{
      path:{edgeConfigId:b.id}
    },{requestKey,tool:'vercel_globalconfig_delete',
      shapeResult:()=>({id:b.id,deleted:true})});
  },
  async verify(_a,ctx,b){
    try{
      const {account,client}=await selected(ctx,true);
      if(account.team_id!==b.teamId)return {confirmed:null};
      try{
        await client.request('global_config_get',{path:{edgeConfigId:b.id}});
        return {confirmed:false};
      }catch(err){
        return {confirmed:err?.status===404?true:null};
      }
    }catch{return {confirmed:null};}
  }
});
const out=r=>({isError:['refused_by_guard','outcome_unknown'].includes(r.status),
  content:[{type:'text',text:JSON.stringify(r)}]});
export const globalConfigMutateTools={
  tools:[
    {name:'vercel_globalconfig_patch_items',writes:true,guardedWrite:true,
      profiles:['everyday','full'],area:'env',
      description:'Guarded batch item create/update/upsert/delete with live-link impact, revision checks and independent readback.',
      inputSchema:schema(patchProps,['id','expectedSlug','expectedUpdatedAt','items','outsideApp']),
      writeContract:patch.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false}},
    {name:'vercel_globalconfig_delete',writes:true,guardedWrite:true,
      profiles:['full'],area:'env',
      description:'Irreversibly remove one exactly verified store; live-connected projects require production authorization.',
      inputSchema:schema(baseProps,['id','expectedSlug','expectedUpdatedAt','outsideApp']),
      writeContract:remove.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    vercel_globalconfig_patch_items:bindGuardedWrite(patch,context,out),
    vercel_globalconfig_delete:bindGuardedWrite(remove,context,out)
  }
};
