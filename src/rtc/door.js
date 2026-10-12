// RTC 1 HTTPS pass door. Reuses the exact MCP dispatch and result shaper.
 // No OAuth bearer token, Vercel credential or caller-provided privilege is accepted.
import {createHash} from 'node:crypto';
import {send} from '../core/http.js';
import {rtcCatalog} from '../core/rtc-contract.js';
import {dispatchReadOnlyTool} from '../core/mcp-server.js';
import {shapeStoredMcpResult} from '../vercel/result-delivery.js';
import {vercelErrorResult} from '../tools/errors.js';
import {prepareResult} from '../core/result-rules.js';
const NAME=/^vercel_[a-z0-9_]{1,96}$/;
const HANDLE=/^res_[a-f0-9]{32}$/;
const PASS=/^Bearer (rtc_pass_[A-Za-z0-9_-]{43})$/;
const ACCOUNT=/^[a-zA-Z0-9_/-]{3,256}$/;
const PASS_ID=/^pass_[a-f0-9]{20}$/;
const AREA=/^[a-z][a-z0-9_]{0,47}$/;
const BLOCKED=new Set(['vercel_call','vercel_batch','vercel_search_tools',
  'vercel_describe_tool']);
const MESSAGES={
 permission:'A valid RTC pass is required',
 pass_expired:'The RTC pass has expired',
 pass_revoked:'The RTC pass has been revoked',
 rate_limited:'RTC pass rate limit exceeded',
 refused_by_guard:'This read-only pass cannot execute the requested operation',
 outside_scope:'This tool is outside the pass scope',
 not_found:'The requested tool or result is unavailable',
 invalid_args:'Invalid RTC API request',
 service_error:'The service could not complete the read'
};
const STATUS={permission:401,pass_expired:401,pass_revoked:401,
  rate_limited:429,refused_by_guard:403,outside_scope:403,
  not_found:404,invalid_args:400,service_error:503};
function fail(res,code){
  if(code==='rate_limited')res.setHeader('Retry-After','60');
  const what=MESSAGES[code]||MESSAGES.service_error;
  return send(res,STATUS[code]||503,{ok:false,error:{
    code,what,cause:what,todo:'Check the pass, scope or requested operation.',
    technical:''}});
}
function getBody(req){
  if(req.body===undefined||req.body===null)return {};
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)
    throw new TypeError('Invalid request size');
  const body=typeof req.body==='string'?JSON.parse(raw):req.body;
  if(!body||typeof body!=='object'||Array.isArray(body))
    throw new TypeError('Invalid request body');
  return body;
}
function argumentsFor(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new TypeError('Invalid tool arguments');
  const body={...input};
  if(Array.isArray(body.fields)){
    if(body.fields.length>20||body.fields.some(x=>typeof x!=='string'))
      throw new TypeError('Invalid result projection');
    body.fields=body.fields.join(',');
  }
  return body;
}
function listing(req,pass,registry){
  const requested=req.query||{};
  if(Object.keys(requested).some(k=>!['q','area','audience','limit','listing','cursor'].includes(k)))
    throw new TypeError('Unknown tool list selector');
  const limit=requested.limit===undefined?20:Number(requested.limit);
  if(!Number.isInteger(limit)||limit<1||limit>100||
    (requested.listing!==undefined&&!['catalog','compact'].includes(requested.listing)))
    throw new TypeError('Invalid listing limit');
  // next is a bounded numeric offset, not a token granting a new scope.
  if(requested.cursor!==undefined &&
    (typeof requested.cursor!=='string' ||
      !/^(0|[1-9][0-9]{0,4})$/.test(requested.cursor)))
    throw new TypeError('Invalid listing cursor');
  const cursor=Number(requested.cursor??0);
  for(const field of ['q','area','audience']){
    if(requested[field]!==undefined&&typeof requested[field]!=='string')
      throw new TypeError('Invalid search selector');
  }
  const catalog=rtcCatalog(registry,{...pass,
    listing:requested.listing||pass.listing});
  const q=String(requested.q??'').toLowerCase();
  if(q.length>120||String(requested.area??'').length>48||
    String(requested.audience??'').length>48)
    throw new TypeError('Invalid search selector');
  const safe=catalog.filter(t=>t.writes===false&&!BLOCKED.has(t.name)&&
    pass.areas.includes(t.area));
  const matching=safe.filter(t=>(!q||(t.name+' '+t.description).toLowerCase().includes(q))&&
    (!requested.area||t.area===requested.area)&&
    (!requested.audience||t.audience.includes(requested.audience)));
  return {tools:matching.slice(cursor,cursor+limit),count:matching.length,
    next:cursor+limit<matching.length?cursor+limit:null};
}
function named(req,registry,pass){
  const name=req.query?.name;
  if(typeof name!=='string'||!NAME.test(name))return null;
  return listing({query:{listing:'catalog'}},pass,registry).tools.find(t=>t.name===name)||
    rtcCatalog(registry,{...pass,listing:'catalog'}).find(t=>
      t.name===name&&!t.writes&&!BLOCKED.has(t.name)&&pass.areas.includes(t.area))||null;
}
async function invoke(name,args,ctx){
  const response=await dispatchReadOnlyTool({registry:ctx.registry,name,args,
    connection:ctx.connection,db:ctx.db,env:ctx.env,
    fetchImpl:ctx.fetchImpl,formatError:vercelErrorResult,
    shapeResult:shapeStoredMcpResult});
  if(response?.isError||!Array.isArray(response?.content)||response.content.length!==1||
    response.content[0]?.type!=='text')return null;
  try{return JSON.parse(response.content[0].text);}
  catch{return null;}
}
async function requirePass(req,db,res,route){
  const m=PASS.exec(String(req.headers?.authorization||''));
  if(!m){fail(res,'permission');return null;}
  let units=1;
  if(route==='batch' && req.method==='POST'){
    // Reserve every read atomically before the first provider call; never
    // multiply a 60/minute pass into 600/minute via ten-item batches.
    let body;
    try{body=getBody(req);}catch{fail(res,'invalid_args');return null;}
    if(Object.keys(body).some(k=>k!=='calls')||!Array.isArray(body.calls)||
      body.calls.length<1||body.calls.length>10){
      fail(res,'invalid_args');return null;
    }
    units=body.calls.length;
  }
  const record=await db.authorizeRtcPass(m[1],units);
  if(record?.status!=='ok'){fail(res,record?.status in MESSAGES?record.status:'permission');return null;}
  // A malformed database authorization record is never a valid scoped pass.
  // Scope/account/identity must be independently well formed before dispatch.
  if(!ACCOUNT.test(record.account||'')||!PASS_ID.test(record.id||'')||
    record.mode!=='preview'||record.profile!=='read_only'||
    !Array.isArray(record.areas)||record.areas.length===0||
    record.areas.length>12||new Set(record.areas).size!==record.areas.length||
    record.areas.some(area=>typeof area!=='string'||!AREA.test(area))||
    !['compact','catalog'].includes(record.listing)){
    fail(res,'permission');return null;
  }
  const connection={account:record.account,profile:'read_only',mode:'preview',
    listing:record.listing,clientId:record.id};
  Object.defineProperty(connection,'resultOwner',{value:'resown_'+
    createHash('sha256').update('rmcp-result-owner-v1:').update(m[1]).digest('hex')});
  return {pass:record,connection:Object.freeze(connection)};
}
export function rtcDoor({db,registry,env=process.env,fetchImpl}){
  return async function handler(req,res,route){
    try{
      const auth=await requirePass(req,db,res,route);
      if(!auth)return;
      const {pass,connection}=auth;
      const ctx={db,registry,env,fetchImpl,connection};
      if(route==='whoami'){
        if(req.method!=='GET')return fail(res,'invalid_args');
        return send(res,200,{ok:true,result:{
          profile:'read_only',mode:'preview',listing:pass.listing,areas:pass.areas}});
      }
      if(route==='list'){
        if(req.method!=='GET')return fail(res,'invalid_args');
        let view;
        try{view=listing(req,pass,registry);}
        catch{return fail(res,'invalid_args');}
        return send(res,200,{ok:true,result:view});
      }
      if(route==='describe'||route==='invoke'){
        if(route==='describe'&&req.method!=='GET'||
          route==='invoke'&&req.method!=='POST')return fail(res,'invalid_args');
        const def=named(req,registry,pass);
        if(!def){
          const name=req.query?.name;
          if(typeof name==='string'&&NAME.test(name)&&
            registry.tools.some(t=>t.name===name))
            return fail(res,'outside_scope');
          return fail(res,'not_found');
        }
        if(route==='describe')return send(res,200,{ok:true,result:def});
        let body;
        try{body=argumentsFor(getBody(req));}
        catch{return fail(res,'invalid_args');}
        const data=await invoke(def.name,body,ctx);
        if(data===null)return fail(res,'service_error');
        if(data.status==='stored'&&typeof data.handle==='string')
          return send(res,200,{ok:true,result:data,handle:data.handle});
        return send(res,200,{ok:true,result:data});
      }
      if(route==='batch'){
        if(req.method!=='POST')return fail(res,'invalid_args');
        let body;
        try{body=getBody(req);}
        catch{return fail(res,'invalid_args');}
        if(Object.keys(body).some(k=>k!=='calls')||!Array.isArray(body.calls)||
          body.calls.length<1||body.calls.length>10)return fail(res,'invalid_args');
        const approved=[];
        for(const call of body.calls){
          if(!call||typeof call!=='object'||Array.isArray(call)||
            Object.keys(call).some(k=>!['name','args'].includes(k))||
            typeof call.name!=='string')return fail(res,'invalid_args');
          const def=named({query:{name:call.name}},registry,pass);
          if(!def)return fail(res,'refused_by_guard');
          let args;
          try{args=argumentsFor(call.args||{});}
          catch{return fail(res,'invalid_args');}
          approved.push({name:def.name,args});
        }
        const results=[];
        for(const call of approved){
          const result=await invoke(call.name,call.args,ctx);
          if(result===null)return fail(res,'service_error');
          results.push(result);
        }
        return send(res,200,{ok:true,result:{results}});
      }
      if(route==='result'){
        if(req.method!=='GET')return fail(res,'invalid_args');
        const handle=req.query?.handle;
        if(typeof handle!=='string'||!HANDLE.test(handle))return fail(res,'invalid_args');
        const stored=await db.getResult({account:connection.account,
          owner:connection.resultOwner,handle});
        if(!stored)return fail(res,'not_found');
        const fields=req.query?.fields;
        if(fields!==undefined&&typeof fields!=='string')return fail(res,'invalid_args');
        const data=prepareResult(stored.body,{detail:'full',fields});
        return send(res,200,{ok:true,result:data.result});
      }
      return fail(res,'not_found');
    }catch{return fail(res,'service_error');}
  };
}
