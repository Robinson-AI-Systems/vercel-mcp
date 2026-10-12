// RTC 1 public metadata; never publishes account identifiers, credentials or secret input.
import {listMcpTools} from './mcp-server.js';
const IDENT=/^vercel_[a-z0-9_]+$/;
const META_MUTATIONS=new Set(['vercel_call']);
const OWNER_TOOLS=new Set(['vercel_set_default_account','vercel_set_spend_limit',
  'vercel_revoke_connection','vercel_enable_production','vercel_disable_production']);
function safeDescription(value){
  const text=typeof value==='string'?value.trim():'';
  return (text||'Read Vercel account metadata').slice(0,160);
}
export function rtcMetadata(tool,registered){
  if(!IDENT.test(tool.name))throw new TypeError('Invalid RTC tool name');
  const writes=registered?.writes===true||META_MUTATIONS.has(tool.name);
  const money=Boolean(registered?.writeContract?.spend);
  const destructive=Boolean(registered?.annotations?.destructiveHint);
  const area=registered?.area||'server';
  return {
    name:tool.name,
    description:safeDescription(tool.description),
    inputSchema:tool.inputSchema?.type==='object'?tool.inputSchema:
      {type:'object',properties:{}},
    area,profiles:registered?.profiles||['read_only'],
    writes,money,destructive,
    audience:OWNER_TOOLS.has(tool.name)?['owner']:
      ['builder','operator'],
    annotations:{
      readOnlyHint:!writes,destructiveHint:destructive,
      idempotentHint:!writes,openWorldHint:true
    }
  };
}
export function rtcCatalog(registry,connection){
  const requested={...connection,listing:connection?.listing||'catalog'};
  return listMcpTools(registry,requested)
    .map(tool=>rtcMetadata(tool,registry.tools.find(row=>row.name===tool.name)));
}
export function rtcManifest(registry,version='0.1.0'){
  const all=rtcCatalog(registry,{profile:'full',listing:'catalog'});
  return {
    rtc:1,server:'robinson-vercel-mcp',prefix:'vercel',version,
    apiVersion:'vercel-openapi-2026-10-11',
    areas:[...new Set(all.map(t=>t.area))].sort(),
    counts:{tools:all.length,writes:all.filter(t=>t.writes).length,
      money:all.filter(t=>t.money).length},
    profiles:['read_only','everyday','full'],
    listingModes:['catalog','compact'],modes:['preview','production'],devTools:false
  };
}
export function rtcOpenApi(){
  const noArgs={parameters:[],responses:{200:{description:'RTC JSON envelope'}}};
  return {openapi:'3.1.0',info:{title:'Robinson Vercel RTC 1 HTTPS API',
    version:'0.1.0'},paths:{
    '/api/contract':{get:{...noArgs,summary:'Public RTC manifest'}},
    '/api/openapi.json':{get:{...noArgs,summary:'Public HTTPS API documentation'}},
    '/api/whoami':{get:{...noArgs,summary:'Pass scope, never pass value'}},
    '/api/tools':{get:{...noArgs,summary:'Authorized tool discovery',
      parameters:[
        {name:'q',in:'query',schema:{type:'string',maxLength:120}},
        {name:'area',in:'query',schema:{type:'string',maxLength:48}},
        {name:'audience',in:'query',schema:{type:'string',maxLength:48}},
        {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}},
        {name:'cursor',in:'query',schema:{type:'integer',minimum:0,maximum:99999}},
        {name:'listing',in:'query',schema:{type:'string',enum:['catalog','compact']}}
      ]}},
    '/api/tools/{name}':{get:{...noArgs,summary:'Authorized tool metadata'},
      post:{...noArgs,summary:'Invoke authorized tool through MCP guard'}},
    '/api/tools/_batch':{post:{...noArgs,summary:'At most 10 read-only calls'}},
    '/api/results/{handle}':{get:{...noArgs,summary:'Read owner-bound result handle'}}
  }};
}
