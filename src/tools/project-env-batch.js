// Bounded provider batch mutations. No raw environment values in tool responses.
import {randomBytes} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {writeProvider} from '../vercel/provider.js';
import {pendingInputs} from '../core/pending-inputs.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {envMeta,scoped} from './project-env-write.js';

const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
const ID=/^[A-Za-z0-9_-]{6,128}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGETS=new Set(['production','preview','development']);
const common={
 project:{type:'string',pattern:PROJECT.source},
 confirm:{type:'boolean'},dryRun:{type:'boolean'},
 requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,128}$'}
};
const createItem={type:'object',properties:{
 key:{type:'string',pattern:KEY.source},
 targets:{type:'array',minItems:1,maxItems:3,uniqueItems:true,
   items:{type:'string',enum:['production','preview','development']}},
 kind:{type:'string',enum:['Config','Secret']},
 value:{type:'string',minLength:1,maxLength:65536},
 pendingInputId:{type:'string',pattern:UUID.source},
 generate:{type:'object',properties:{bytes:{type:'integer',const:32},
   encoding:{type:'string',enum:['hex','base64url']}},
   required:['bytes','encoding'],additionalProperties:false}
},required:['key','targets'],additionalProperties:false};
const deleteItem={type:'object',properties:{
 id:{type:'string',pattern:ID.source},expectedKey:{type:'string',pattern:KEY.source},
 expectedUpdatedAt:{type:'integer',minimum:1}
},required:['id','expectedKey','expectedUpdatedAt'],additionalProperties:false};
const schemas={
 create:{type:'object',properties:{...common,
   items:{type:'array',minItems:2,maxItems:10,items:createItem}},
   required:['project','items'],additionalProperties:false},
 delete:{type:'object',properties:{...common,
   outsideApp:{type:'boolean',const:true},
   items:{type:'array',minItems:2,maxItems:10,items:deleteItem}},
   required:['project','items','outsideApp'],additionalProperties:false}
};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const only=(x,allowed)=>obj(x)&&Object.keys(x).every(k=>allowed.includes(k));
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const sorted=x=>[...x].sort();
function base(a,allowed){
 if(!only(a,allowed)||!PROJECT.test(a.project??'')||
   (a.confirm!==undefined&&typeof a.confirm!=='boolean')||
   (a.dryRun!==undefined&&typeof a.dryRun!=='boolean')||
   !Array.isArray(a.items)||a.items.length<2||a.items.length>10)
   throw new TypeError('Invalid bounded project environment batch');
}
function checkCreate(a){
 base(a,['project','items','confirm','dryRun','requestKey']);
 const keys=new Set(),inputs=new Set();let bytes=0;
 for(const item of a.items){
   if(!only(item,['key','targets','kind','value','pendingInputId','generate'])||
     !KEY.test(item.key??'')||keys.has(item.key)||
     !Array.isArray(item.targets)||item.targets.length<1||item.targets.length>3||
     item.targets.some(t=>!TARGETS.has(t))||
     new Set(item.targets).size!==item.targets.length||
     ![undefined,'Config','Secret'].includes(item.kind))
     throw new TypeError('Duplicate or invalid environment key/target');
   keys.add(item.key);
   const kind=item.kind??'Secret';
   const from=['value','pendingInputId','generate'].filter(k=>item[k]!==undefined);
   if(from.length!==1||(kind==='Config'&&from[0]!=='value')||
     (kind==='Secret'&&(from[0]==='value'||item.targets.includes('development'))))
     throw new TypeError('Invalid private value source');
   if(from[0]==='value'){
     if(typeof item.value!=='string'||item.value.length<1||
       item.value.length>65536||credentialLike(item.value))
       throw new TypeError('Invalid Config value');
     bytes+=Buffer.byteLength(item.value);
   }else if(from[0]==='pendingInputId'){
     if(!UUID.test(item.pendingInputId)||inputs.has(item.pendingInputId))
       throw new TypeError('Duplicate/invalid owner pending input');
     inputs.add(item.pendingInputId);bytes+=64;
   }else{
     if(!only(item.generate,['bytes','encoding'])||
       item.generate.bytes!==32||!['hex','base64url'].includes(item.generate.encoding))
       throw new TypeError('Invalid cryptographic generation request');
     bytes+=64;
   }
 }
 if(bytes>65536)throw new TypeError('Batch total value bound exceeded');
}
function checkDelete(a){
 base(a,['project','items','outsideApp','confirm','dryRun','requestKey']);
 if(a.outsideApp!==true)throw new TypeError('Explicit outside-app intent required');
 const ids=new Set(),keys=new Set();
 for(const i of a.items){
   if(!only(i,['id','expectedKey','expectedUpdatedAt'])||
     !ID.test(i.id??'')||!KEY.test(i.expectedKey??'')||
     !Number.isSafeInteger(i.expectedUpdatedAt)||i.expectedUpdatedAt<1||
     ids.has(i.id)||keys.has(i.expectedKey))
     throw new TypeError('Duplicate/invalid deletion identity');
   ids.add(i.id);keys.add(i.expectedKey);
 }
}
function exactRow(raw,project,input){
 const row=envMeta(raw,project);
 if(row.id!==input.id||row.key!==input.expectedKey||
   row.updatedAt!==input.expectedUpdatedAt)
   throw new TypeError('Variable identity or revision drifted');
 return row;
}
function context({db,connection,env,fetchImpl}){
 return {db,connection,env,fetchImpl,shape:compact,
   audit:r=>db.recordChange(r),replayStore:db.requestReplayStore(),
   guardProtected:targets=>checkProtected(targets,{db,connection,env}),
   guardApp:targets=>checkApp(targets,{db,connection,env})};
}
async function scopedAgain(ctx,b,provider){
 if(provider.account.team_id!==b.teamId||
   provider.account.scope==='project'&&provider.account.project_id!==b.project)
   throw new TypeError('Provider credential changed');
 const scope=await scoped(ctx,b.project);
 if(scope.account.team_id!==b.teamId)throw new TypeError('Account scope changed');
 return scope.client;
}
const create=defineWrite({
 name:'vercel_env_set_many',secretIn:true,
 async before(a,ctx){
   checkCreate(a);
   const {account}=await scoped(ctx,a.project);
   return {project:a.project,teamId:account.team_id,items:a.items.map(i=>({
     key:i.key,kind:i.kind??'Secret',targets:sorted(i.targets)}))};
 },
 async preview(_a,_ctx,b){
   return 'Create-only batch of '+b.items.length+' keys ('+
     b.items.map(i=>i.key).join(',')+') in '+b.project+
     '; never upsert; private values hidden; new deployments only';
 },
 async production(_a,_ctx,b){
   const production=b.items.some(i=>i.targets.includes('production'));
   return {production,why:production?'Production variable in batch':'Nonproduction only'};
 },
 async targets(_a,b){
   return [{kind:'project',id:b.project},
     ...b.items.map(i=>({kind:'env',id:i.key,projectId:b.project}))];
 },
 async apply(a,ctx,b,requestKey){
   const provider=await writeProvider(ctx);
   let body;
   await requirePreDispatch(async()=>{
     await scopedAgain(ctx,b,provider);
     body=[];
     for(let i=0;i<b.items.length;i++){
       const item=a.items[i],meta=b.items[i];
       let value;
       if(item.value!==undefined)value=item.value;
       else if(item.generate)value=randomBytes(32).toString(item.generate.encoding);
       else{
         if(typeof ctx.db?.consumePendingInput!=='function')
           throw new TypeError('Owner pending input unavailable');
         value=await pendingInputs({db:ctx.db,env:ctx.env}).consume({
           id:item.pendingInputId,account:ctx.connection.account,kind:'env_value'});
         if(typeof value!=='string'||!value||value.length>65536)
           throw new TypeError('Owner pending input invalid');
       }
       body.push({key:meta.key,value,
         type:meta.kind==='Secret'?'sensitive':'plain',target:meta.targets});
     }
     if(Buffer.byteLength(JSON.stringify(body))>131072)
       throw new TypeError('Provider batch exceeds bound');
   });
   return provider.write('project_env_create',{path:{idOrName:b.project},body},{
     requestKey,tool:'vercel_env_set_many',shapeResult:response=>{
       if(!obj(response)||!Array.isArray(response.failed)||response.failed.length||
         !Array.isArray(response.created)||response.created.length!==b.items.length)
         throw new TypeError('Provider partial/ambiguous create batch');
       const keys=new Set(),ids=new Set(),created=[];
       for(const row of response.created){
         if(!obj(row)||!ID.test(row.id??'')||!KEY.test(row.key??'')||
           keys.has(row.key)||ids.has(row.id)||
           !b.items.some(item=>item.key===row.key))
           throw new TypeError('Unexpected created variable identity');
         keys.add(row.key);ids.add(row.id);created.push({key:row.key,id:row.id});
       }
       return {created};
     }
   });
 },
 async verify(a,ctx,b,result){
   if(!Array.isArray(result?.created)||result.created.length!==b.items.length)
     return {confirmed:null};
   try{
     const {client,account}=await scoped(ctx,b.project);
     if(account.team_id!==b.teamId)return {confirmed:null};
     let secret=false;
     for(let i=0;i<b.items.length;i++){
       const want=b.items[i],id=result.created.find(r=>r.key===want.key)?.id;
       if(!ID.test(id??''))return {confirmed:null};
       const raw=await client.request('project_env_get',{
         path:{idOrName:b.project,id}});
       const found=envMeta(raw,b.project);
       if(found.id!==id||found.key!==want.key||found.kind!==want.kind||
         !same(found.targets,want.targets))return {confirmed:false};
       if(want.kind==='Secret')secret=true;
       else if(raw.value!==a.items[i].value)return {confirmed:false};
     }
     return {confirmed:secret?null:true};
   }catch{return {confirmed:null};}
 }
});
const remove=defineWrite({
 name:'vercel_env_delete_many',
 async before(a,ctx){
   checkDelete(a);
   const {client,account}=await scoped(ctx,a.project),items=[];
   for(const input of a.items){
     const row=exactRow(await client.request('project_env_get',{
       path:{idOrName:a.project,id:input.id}}),a.project,input);
     items.push({id:row.id,key:row.key,updatedAt:row.updatedAt,
       kind:row.kind,targets:row.targets});
   }
   return {project:a.project,teamId:account.team_id,items};
 },
 async preview(_a,_ctx,b){
   return 'Permanently delete '+b.items.length+' exact keys ('+
     b.items.map(i=>i.key).join(',')+') from ALL targets in '+b.project+
     '; existing deployments remain unchanged';
 },
 async production(_a,_ctx,b){
   const production=b.items.some(i=>i.targets.includes('production'));
   return {production,why:production?'Production variable included':'Nonproduction only'};
 },
 async targets(_a,b){
   return [{kind:'project',id:b.project},
     ...b.items.map(i=>({kind:'env',id:i.id,projectId:b.project}))];
 },
 async apply(a,ctx,b,requestKey){
   const provider=await writeProvider(ctx);
   await requirePreDispatch(async()=>{
     const client=await scopedAgain(ctx,b,provider);
     for(let i=0;i<b.items.length;i++){
       const old=b.items[i];
       const row=exactRow(await client.request('project_env_get',{
         path:{idOrName:b.project,id:old.id}}),b.project,a.items[i]);
       if(row.kind!==old.kind||!same(row.targets,old.targets))
         throw new TypeError('Variable changed before batch deletion');
     }
   });
   const ids=b.items.map(i=>i.id);
   return provider.write('project_env_delete_batch',{
     path:{idOrName:b.project},body:{ids}
   },{requestKey,tool:'vercel_env_delete_many',shapeResult:response=>{
     if(!obj(response)||!Array.isArray(response.ids)||
       response.ids.length!==ids.length||
       new Set(response.ids).size!==ids.length||
       !same(sorted(response.ids),sorted(ids))||
       !Number.isSafeInteger(Number(response.deleted))||
       Number(response.deleted)!==ids.length)
       throw new TypeError('Partial or unverified provider batch deletion');
     return {deleted:ids.length};
   }});
 },
 async verify(_a,ctx,b){
   let client,account;
   try{({client,account}=await scoped(ctx,b.project));}
   catch{return {confirmed:null};}
   if(account.team_id!==b.teamId)return {confirmed:null};
   let present=false,unknown=false;
   for(const row of b.items){
     try{
       await client.request('project_env_get',{
         path:{idOrName:b.project,id:row.id}});
       present=true;
     }catch(error){if(error?.status!==404)unknown=true;}
   }
   return {confirmed:present?false:unknown?null:true};
 }
});
const output=x=>({isError:['refused_by_guard','outcome_unknown'].includes(x.status),
 content:[{type:'text',text:JSON.stringify(x)}]});
export const projectEnvBatchTools={
 tools:[
   {name:'vercel_env_set_many',writes:true,guardedWrite:true,
     profiles:['everyday','full'],area:'env',
     description:'Create 2–10 new env keys in one guarded provider batch; private values, per-key readback.',
     inputSchema:schemas.create,writeContract:create.writeContract,
     annotations:{readOnlyHint:false,destructiveHint:false}},
   {name:'vercel_env_delete_many',writes:true,guardedWrite:true,
     profiles:['full'],area:'env',
     description:'Permanently delete 2–10 exact env IDs across all targets in one guarded provider batch.',
     inputSchema:schemas.delete,writeContract:remove.writeContract,
     annotations:{readOnlyHint:false,destructiveHint:true}}
 ],
 handlers:{
   vercel_env_set_many:bindGuardedWrite(create,context,output),
   vercel_env_delete_many:bindGuardedWrite(remove,context,output)
 }
};
