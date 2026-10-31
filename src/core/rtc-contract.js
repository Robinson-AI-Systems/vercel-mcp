// RTC 1 public metadata; never publishes account identifiers, credentials or secret input.
import {listMcpTools} from './mcp-server.js';
import { SERVICE_TECHNICAL_NAME, SERVICE_DISPLAY_NAME } from '../service-identity.js';
const IDENT=/^vercel_[a-z0-9_]+$/;
const AREA=/^[a-z][a-z0-9_]{0,47}$/;
const META_MUTATIONS=new Set(['vercel_call']);
const OWNER_TOOLS=new Set(['vercel_set_default_account','vercel_set_spend_limit',
  'vercel_revoke_connection','vercel_enable_production','vercel_disable_production',
  'vercel_remove_account']);
function safeDescription(value){
  const text=typeof value==='string'?value.trim():'';
  return (text||'Read Vercel account metadata').slice(0,160);
}
export function rtcMetadata(tool,registered){
  if(!IDENT.test(tool.name))throw new TypeError('Invalid RTC tool name');
  // A read classification needs affirmative, unambiguous registry evidence:
  // absence, bad scope, or contradictory hints cannot silently become a read.
  // RTC historically scopes explicitly registered reads with no area to
  // the narrow server area; invalid *supplied* areas must not get that default.
  const hasArea=Boolean(registered&&Object.hasOwn(registered,'area'));
  const scoped=!hasArea||(typeof registered.area==='string'&&AREA.test(registered.area));
  const writes=registered?.writes!==false||!scoped||
    registered?.writeContract!==undefined||registered?.guardedWrite===true||
    registered?.localAdmin===true||registered?.secretIn===true||
    registered?.secretOut===true||
    registered?.annotations?.destructiveHint===true||
    registered?.annotations?.readOnlyHint===false||
    tool?.annotations?.readOnlyHint===false||META_MUTATIONS.has(tool.name);
  const money=Boolean(registered?.writeContract?.spend);
  const destructive=Boolean(registered?.annotations?.destructiveHint);
  const area=!hasArea?'server':scoped?registered.area:'unclassified';
  // CONTRACT §3: a money tool's listing text leads with 'MOVES MONEY:'.
  // Applied at this derivation — the single funnel for every RTC
  // catalog row (AUD-BG, 2026-10-31; no tool definition carries the
  // prefix, and the MCP listing surface is separately governed).
  const baseDescription=safeDescription(tool.description);
  const description=money&&!baseDescription.startsWith('MOVES MONEY:')
    ?('MOVES MONEY: '+baseDescription).slice(0,160):baseDescription;
  return {
    name:tool.name,
    description,
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
  // Duplicate declarations are ambiguous: neither the HTTPS catalog nor
  // direct/batch RTC invocation may choose a potentially less safe first row.
  const rows=Array.isArray(registry?.tools)?registry.tools:[];
  const byName=new Map();
  for(const row of rows){
    if(typeof row?.name==='string'){
      const values=byName.get(row.name)||[];
      values.push(row);
      byName.set(row.name,values);
    }
  }
  return listMcpTools(registry,requested)
    .filter(tool=>byName.get(tool.name)?.length===1)
    .map(tool=>rtcMetadata(tool,byName.get(tool.name)[0]));
}
export function rtcManifest(registry,version='0.1.0'){
  const all=rtcCatalog(registry,{profile:'full',listing:'catalog'});
  return {
    rtc:1,server:SERVICE_TECHNICAL_NAME,prefix:'vercel',version,
    apiVersion:'vercel-openapi-2026-10-11',
    areas:[...new Set(all.map(t=>t.area))].sort(),
    counts:{tools:all.length,writes:all.filter(t=>t.writes).length,
      money:all.filter(t=>t.money).length},
    profiles:['read_only','everyday','full'],
    listingModes:['catalog','compact'],modes:['preview','test','production'],devTools:false
  };
}
export function rtcOpenApi(){
  const noArgs={parameters:[],responses:{200:{description:'RTC JSON envelope'}}};
  return {openapi:'3.1.0',info:{title:SERVICE_DISPLAY_NAME+' — RTC 1 HTTPS API',
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
    '/api/tools/_batch':{post:{...noArgs,summary:'Up to 10 scoped reads; large batches return an owner-bound handle'}},
    '/api/results/{handle}':{get:{...noArgs,summary:'Read bounded owner-bound result pages',
      parameters:[
        {name:'page',in:'query',schema:{type:'integer',minimum:0,maximum:10000}},
        {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:20}},
        {name:'detail',in:'query',schema:{type:'string',enum:['summary','full']}},
        {name:'fields',in:'query',schema:{type:'string',maxLength:800}}
      ]}}
  }};
}
