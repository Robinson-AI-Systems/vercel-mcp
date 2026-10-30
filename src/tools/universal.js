// U-1 metadata discovery never invokes a Vercel operation or grants its authority.
import {apiRead} from '../vercel/api-read-policy.js';
import {apiWriteSpec} from '../vercel/api-write-policy.js';
import {searchApi,describeApi} from '../vercel/openapi-index.js';
import {defineWrite,bindGuardedWrite} from '../core/write.js';
import {compact} from '../core/util.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {accountSpendGuard} from '../vercel/spend.js';
const out=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function args(value,allowed){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))
    throw new TypeError('Invalid API metadata request');
}
function bounded(value){
  if(Buffer.byteLength(JSON.stringify(value))>7600)
    throw new TypeError('Schema is too large; inspect a specific bodyField');
  return out(value);
}
// The guarded write context, composed like every other write namespace:
// the raw dispatch context carries db/connection/env/fetchImpl only.
function writeCtx({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env}),
    checkSpend:accountSpendGuard({db,account:connection.account})};
}
const resultMapper=result=>({
  isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]
});
const apiWrite=defineWrite(apiWriteSpec);
const writeProps={
  op:{type:'string',minLength:1,maxLength:100},
  params:{type:'object',required:['path'],properties:{
    path:{type:'object'},query:{type:'object'},body:{}}},
  dryRun:{type:'boolean'},confirm:{type:'boolean'},
  requestKey:{type:'string',pattern:'^[a-zA-Z0-9_-]{8,128}$'}
};
export const universalTools={
  tools:[
    {name:'vercel_api_search',writes:false,area:'universal',profiles:['read_only','everyday','full'],
      description:'Search pinned Vercel API operation metadata with bounded pages; discovery does not authorize execution.',
      inputSchema:{type:'object',required:['query'],additionalProperties:false,properties:{
        query:{type:'string',minLength:1,maxLength:120},limit:{type:'integer',minimum:1,maximum:20},
        offset:{type:'integer',minimum:0,maximum:500}}},annotations:{readOnlyHint:true}},
    {name:'vercel_api_describe',writes:false,area:'universal',profiles:['read_only','everyday','full'],
      description:'Inspect a documented Vercel operation and trimmed request schema, including a specific nested body field.',
      inputSchema:{type:'object',required:['op'],additionalProperties:false,properties:{
        op:{type:'string',maxLength:100},bodyField:{type:'string',maxLength:120}}},annotations:{readOnlyHint:true}}
    ,{name:'vercel_api_read',writes:false,area:'universal',profiles:['read_only','everyday','full'],
      description:'Audited, scoped flag/segment metadata and capacity GETs; single flags require exact IDs. Values, targeting and secrets are refused.',
      inputSchema:{type:'object',required:['op','params'],additionalProperties:false,properties:{
        op:{type:'string',maxLength:100},params:{type:'object',additionalProperties:false,
          required:['path'],properties:{path:{type:'object'},query:{type:'object'}}}}},annotations:{readOnlyHint:true}}
    ,{name:'vercel_api_write',writes:true,guardedWrite:true,area:'universal',profiles:['full'],
      description:'Run a documented Vercel API write that has no hand-built tool, through the full safety layer (confirm, spend, access, production) with read-back.',
      inputSchema:{type:'object',required:['op','params'],additionalProperties:false,properties:writeProps},
      writeContract:apiWrite.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}
  ],handlers:{
    async vercel_api_read(input,ctx){return bounded(await apiRead(input,ctx));},
    async vercel_api_search(input){args(input,['query','limit','offset']);return bounded(searchApi(input));},
    async vercel_api_describe(input){args(input,['op','bodyField']);return bounded(describeApi(input));},
    vercel_api_write:bindGuardedWrite(apiWrite,writeCtx,resultMapper)
  }
};
