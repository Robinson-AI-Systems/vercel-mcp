// U-1 metadata discovery never invokes a Vercel operation or grants its authority.
import {apiRead} from '../vercel/api-read-policy.js';
import {searchApi,describeApi} from '../vercel/openapi-index.js';
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
      description:'Read audited project feature-flag metadata through pinned schemas and verified scope; unaudited or secret operations refused.',
      inputSchema:{type:'object',required:['op','params'],additionalProperties:false,properties:{
        op:{type:'string',maxLength:100},params:{type:'object',additionalProperties:false,
          required:['path'],properties:{path:{type:'object'},query:{type:'object'}}}}},annotations:{readOnlyHint:true}}
  ],handlers:{
    async vercel_api_read(input,ctx){return bounded(await apiRead(input,ctx));},
    async vercel_api_search(input){args(input,['query','limit','offset']);return bounded(searchApi(input));},
    async vercel_api_describe(input){args(input,['op','bodyField']);return bounded(describeApi(input));}
  }
};
