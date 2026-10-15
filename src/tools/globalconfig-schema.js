// E-4: Global Config schema read, compatible set, and reversible removal.
// One coherent lifecycle: provider-owned store scope, item-aware preview,
// exact revision recheck, linked-app production classification and readback.
import Ajv from 'ajv';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {STORE,SLUG,KEY,exact,strictArgs,schema,output} from './globalconfig-common.js';
import {store,allItems,targets,classification,context} from './globalconfig-mutate.js';

const REQUEST=/^[A-Za-z0-9_-]{8,128}$/;
const props={
  id:{type:'string',pattern:STORE.source},
  expectedSlug:{type:'string',pattern:SLUG.source},
  expectedUpdatedAt:{type:'integer',minimum:1},
  mode:{type:'string',enum:['set','remove']},
  definition:{type:'object'},
  outsideApp:{type:'boolean',const:true},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST.source}
};
function strictSchema(value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new TypeError('Global Config schema is not a JSON Schema object');
  const serialized=JSON.stringify(value);
  if(!serialized||Buffer.byteLength(serialized,'utf8')>3072)
    throw new TypeError('Schema must be bounded and serializable');
  const seen=new WeakSet();
  function check(v,depth){
    if(depth>12)throw new TypeError('Schema nesting too deep');
    if(typeof v==='string'){
      if(credentialLike(v)||/[\x00-\x08\x0b-\x1f\x7f]/.test(v))
        throw new TypeError('Credential-shaped or control data forbidden in schema');
      return;
    }
    if(v===null||typeof v==='boolean'||typeof v==='number'){
      if(typeof v==='number'&&!Number.isFinite(v))
        throw new TypeError('Schema contains a non-finite number');
      return;
    }
    if(!v||typeof v!=='object'||seen.has(v))
      throw new TypeError('Invalid or cyclic JSON Schema data');
    seen.add(v);
    try{
      if(Array.isArray(v)){
        if(v.length>100)throw new TypeError('Schema array too large');
        v.forEach(child=>check(child,depth+1));return;
      }
      if(Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length>100)
        throw new TypeError('Only plain JSON Schema objects are permitted');
      for(const [key,child] of Object.entries(v)){
        if(key==='__proto__'||key==='constructor'||key==='prototype'||
          credentialLike(key)||/[\x00-\x1f\x7f]/.test(key))
          throw new TypeError('Unsafe JSON Schema field');
        if(['$ref','$dynamicRef','$recursiveRef'].includes(key)&&
          (typeof child!=='string'||!child.startsWith('#/')))
          throw new TypeError('External schema resolution is disabled');
        check(child,depth+1);
      }
    }finally{seen.delete(v);}
  }
  check(value,0);
  return value;
}
function schemaFrom(raw){
  if(raw===null)return null;
  const candidate=raw?.definition??raw?.schema??raw;
  return strictSchema(candidate);
}
async function getSchema(client,id){
  try{
    const value=await client.request('global_config_schema_get',
      {path:{edgeConfigId:id}});
    return schemaFrom(value);
  }catch(err){
    if(err?.status===404)return null;
    throw err;
  }
}
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==='object')return Object.fromEntries(
    Object.entries(v).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,value])=>[key,canonical(value)]));
  return v;
}
const eq=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function validity(definition,items){
  if(definition===null)return {valid:true,invalidKeys:[],errors:0};
  let validate;
  try{
    validate=new Ajv({allErrors:true,strict:false,validateFormats:false,
      code:{source:false},allowUnionTypes:true}).compile(definition);
  }catch{
    throw new TypeError('Schema cannot be safely compiled offline');
  }
  if(validate(items))return {valid:true,invalidKeys:[],errors:0};
  const failures=validate.errors??[];
  const invalid=new Set();
  for(const item of failures.slice(0,200)){
    const parts=String(item.instancePath??'').split('/').filter(Boolean);
    let name=parts[0]?.replace(/~1/g,'/').replace(/~0/g,'~');
    if(!name||!Object.hasOwn(items,name)){
      const key=item.params?.additionalProperty??item.params?.missingProperty;
      name=typeof key==='string'&&Object.hasOwn(items,key)?key:'_schema_';
    }
    invalid.add(KEY.test(name)?name:'_schema_');
  }
  if(failures.length>200)invalid.add('_schema_');
  return {valid:false,invalidKeys:[...invalid].sort(),errors:failures.length};
}
function argsValid(a){
  strictArgs(a,Object.keys(props));
  if(!STORE.test(a.id??'')||!SLUG.test(a.expectedSlug??'')||
    !Number.isSafeInteger(a.expectedUpdatedAt)||a.expectedUpdatedAt<1||
    !['set','remove'].includes(a.mode)||a.outsideApp!==true||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean'||
    a.requestKey!==undefined&&!REQUEST.test(a.requestKey)||
    (a.mode==='set'&&!Object.hasOwn(a,'definition'))||
    (a.mode==='remove'&&Object.hasOwn(a,'definition')))
    throw new TypeError('Exact schema action, store revision and outside-app intent required');
  if(a.mode==='set')strictSchema(a.definition);
}
async function before(a,ctx){
  argsValid(a);
  if(a.mode==='remove'&&ctx.connection?.profile!=='full')
    throw new TypeError('Full profile required for schema removal');
  const {client,account,row}=await store(ctx,a);
  const [prior,raw]=await Promise.all([
    getSchema(client,row.id),
    client.request('global_config_items',{path:{edgeConfigId:row.id}})
  ]);
  const items=allItems(raw);
  if(Object.keys(items).length!==row.itemCount)
    throw new TypeError('Full current store item inventory not available');
  const definition=a.mode==='set'?a.definition:null;
  if(eq(prior,definition))
    throw new TypeError('Store already has the requested schema');
  const result=validity(definition,items);
  // A dry-run can explain the whole incompatibility. Confirming an incompatible
  // schema is not a safe provider mutation even if its backend might accept it.
  if(!result.valid&&a.dryRun!==true)
    throw new TypeError('New schema cannot validate current store items');
  return {id:row.id,slug:row.slug,teamId:account.team_id,
    updatedAt:row.updatedAt,itemCount:row.itemCount,
    projects:[...row.projects].sort(),mode:a.mode,
    beforeDefinition:prior,desiredDefinition:definition,
    keys:Object.keys(items).sort(),invalidKeys:result.invalidKeys,
    validationErrors:result.errors};
}
function unchanged(b,c){
  return b.id===c.id&&b.slug===c.slug&&b.teamId===c.teamId&&
    b.updatedAt===c.updatedAt&&b.itemCount===c.itemCount&&
    b.mode===c.mode&&eq(b.beforeDefinition,c.beforeDefinition)&&
    eq(b.desiredDefinition,c.desiredDefinition)&&
    JSON.stringify(b.keys)===JSON.stringify(c.keys)&&
    JSON.stringify(b.projects)===JSON.stringify(c.projects);
}
const write=defineWrite({
  name:'vercel_globalconfig_set_schema',
  before,
  async preview(_a,_ctx,b){
    return (b.mode==='remove'?'Remove':'Set')+' Global Config schema on '+
      b.slug+' ('+b.id+'), checking '+b.keys.length+' existing keys. '+
      (b.invalidKeys.length?'Incompatible keys: '+b.invalidKeys.join(', ')+'. ':
        'All current items compatible. ')+
      'Connected projects: '+b.projects.join(', ')+
      '. Live readers are affected immediately, no item values shown';
  },
  production:classification,
  async targets(_a,b){return targets(b);},
  async apply(a,ctx,b,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==b.teamId)
        throw new TypeError('Selected stored team changed');
      const fresh=await before(a,ctx);
      if(!unchanged(b,fresh))
        throw new TypeError('Schema, store revision or connected inventory changed');
    });
    const op=b.mode==='set'?'global_config_schema_set':
      'global_config_schema_delete';
    return provider.write(op,{
      path:{edgeConfigId:b.id},
      ...(b.mode==='set'?{body:{definition:b.desiredDefinition}}:{})
    },{requestKey,tool:'vercel_globalconfig_set_schema',
      shapeResult:()=>({store:b.id,mode:b.mode})});
  },
  async verify(_a,ctx,b){
    try{
      const {client,account,row}=await exact(ctx,b.id);
      if(account.team_id!==b.teamId||row.slug!==b.slug||
        JSON.stringify([...row.projects].sort())!==JSON.stringify(b.projects))
        return {confirmed:null};
      const actual=await getSchema(client,b.id);
      return {confirmed:eq(actual,b.desiredDefinition)};
    }catch{return {confirmed:null};}
  },
  async inverse(_a,b){
    return {tool:'vercel_globalconfig_set_schema',id:b.id,
      expectedSlug:b.slug,mode:b.beforeDefinition===null?'remove':'set',
      requiresFreshRevision:true,
      ...(b.beforeDefinition!==null?{definition:b.beforeDefinition}:{})};
  }
});
const out=x=>({isError:['refused_by_guard','outcome_unknown'].includes(x.status),
  content:[{type:'text',text:JSON.stringify(x)}]});
export const globalConfigSchemaTools={
  tools:[
    {name:'vercel_globalconfig_get_schema',writes:false,
      profiles:['read_only','everyday','full'],area:'env',
      description:'Read a safe, bounded Global Config JSON Schema or explicit absence for one exact store.',
      inputSchema:schema({id:{type:'string',pattern:STORE.source}},['id']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_globalconfig_set_schema',writes:true,guardedWrite:true,
      profiles:['everyday','full'],area:'env',
      description:'Set compatible JSON Schema or remove under full owner profile with keyed impact preview and readback.',
      inputSchema:schema(props,
        ['id','expectedSlug','expectedUpdatedAt','mode','outsideApp']),
      writeContract:write.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true}}
  ],
  handlers:{
    async vercel_globalconfig_get_schema(args,ctx){
      strictArgs(args,['id']);
      const {client,row}=await exact(ctx,args.id);
      const definition=await getSchema(client,row.id);
      return output({store:row.id,schema:compact(definition),
        hasSchema:definition!==null,hasSecretValues:false});
    },
    vercel_globalconfig_set_schema:bindGuardedWrite(write,context,out)
  }
};
