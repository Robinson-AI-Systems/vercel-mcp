// Bounded V-4 Sandbox filesystem transport. The REST API accepts gzip tar uploads
// and streams file downloads; the normal JSON Vercel client cannot represent either.
// Only a fixed, pinned Vercel HTTPS origin, exact accounted session and safe paths
// can reach this transport. Never log authorization or file contents.
import {request as httpsRequest} from 'node:https';
import {gzipSync} from 'node:zlib';
import {loadToken} from './tokens.js';
export const SAFE_FILE=/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/;
export function safeSandboxPath(path){
  return typeof path==='string'&&path.length<=128&&SAFE_FILE.test(path)&&
    !path.split('/').some(part=>part==='.'||part==='..');
}
const SESSION=/^sbx_[A-Za-z0-9_-]{3,120}$/;
function ensureSession(x){if(!SESSION.test(x??''))throw new TypeError('Invalid exact sandbox session identity');}
export function sandboxTar(files){
  if(!Array.isArray(files)||files.length<1||files.length>5||
    files.some(f=>!safeSandboxPath(f?.path)||typeof f.content!=='string'||
      Buffer.byteLength(f.content,'utf8')>4096)||
    new Set(files.map(f=>f.path)).size!==files.length)
    throw new TypeError('Use 1–5 safe, distinct relative sandbox files under 4 KB each');
  const blocks=[];
  for(const file of files){
    const data=Buffer.from(file.content,'utf8'),head=Buffer.alloc(512);
    head.write(file.path,0,'utf8');
    const oct=(v,size,offset)=>head.write(v.toString(8).padStart(size-1,'0')+'\0',offset,size,'ascii');
    oct(0o600,8,100);oct(0,8,108);oct(0,8,116);oct(data.length,12,124);oct(0,12,136);
    head.fill(32,148,156);head.write('0',156,'ascii');
    head.write('ustar\0',257,'ascii');head.write('00',263,'ascii');
    oct(head.reduce((sum,x)=>sum+x,0),8,148);
    blocks.push(head,data,Buffer.alloc((512-data.length%512)%512));
  }
  blocks.push(Buffer.alloc(1024));
  const zip=gzipSync(Buffer.concat(blocks));
  if(zip.length>24576)throw new TypeError('Compressed sandbox upload is too large');
  return zip;
}
export async function sandboxBinaryPost(ctx,{sessionId,kind,path,files,requestImpl=httpsRequest}){
  ensureSession(sessionId);
  if(!['read','write'].includes(kind)||
    kind==='read'&&!safeSandboxPath(path)||
    kind==='write'&&(!Array.isArray(files)||files.length===0))
    throw new TypeError('Sandbox filesystem request is not bound to a safe path');
  const {token,account}=await loadToken({db:ctx.db,accountId:ctx.connection.account,env:ctx.env});
  if(account?.id!==ctx.connection.account||typeof account.team_id!=='string'||!account.team_id||
    ctx.connection.mode!=='preview')
    throw new TypeError('Selected sandbox account is unverified');
  const bytes=kind==='write'?sandboxTar(files):Buffer.from(JSON.stringify({path}),'utf8');
  const url=new URL('https://api.vercel.com/v2/sandboxes/sessions/'+encodeURIComponent(sessionId)+
    '/fs/'+kind+'?teamId='+encodeURIComponent(account.team_id));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;if(error)reject(error);else resolve(result);};
    const request=requestImpl(url,{method:'POST',agent:false,timeout:15000,
      headers:{authorization:'Bearer '+token,'content-type':kind==='write'?'application/gzip':'application/json',
        'content-length':bytes.length,...(kind==='write'?{'x-cwd':'/home/vercel-sandbox'}:{})}
    },res=>{
      if(!Number.isInteger(res.statusCode)||res.statusCode<200||res.statusCode>299){
        res.resume();
        finish(new TypeError('Sandbox file '+kind+' rejected by Vercel'));
        return;
      }
      if(kind==='write'){
        res.resume();
        finish(null,{accepted:true,status:res.statusCode});
        return;
      }
      const chunks=[];let length=0;
      res.on('data',piece=>{
        length+=piece.length;
        if(length>4096){res.destroy();finish(new TypeError('Sandbox read exceeded safe 4 KB limit'));}
        else chunks.push(piece);
      });
      res.on('end',()=>finish(null,{accepted:true,status:res.statusCode,
        bytes:Buffer.concat(chunks)}));
      res.on('error',e=>finish(e));
    });
    request.on('timeout',()=>request.destroy(new Error('Sandbox file transport timed out')));
    request.on('error',e=>finish(e));
    request.end(bytes);
  });
}

const CMD_ID=/^cmd_[A-Za-z0-9_-]{3,120}$/;
export function parseSandboxCommandLogs(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length>12288)
    throw new TypeError('Sandbox log receipt exceeded 12 KB');
  const entries=[];
  for(const line of buffer.toString('utf8').split('\n')){
    if(!line.trim())continue;
    if(entries.length>=64)throw new TypeError('Sandbox output exceeded 64 lines');
    let row;
    try{row=JSON.parse(line);}catch{throw new TypeError('Malformed native Sandbox NDJSON output');}
    if(!['stdout','stderr'].includes(row?.stream)||typeof row.data!=='string'||
      Buffer.byteLength(row.data,'utf8')>2048)
      throw new TypeError('Unexpected native Sandbox log entry');
    entries.push({stream:row.stream,data:row.data});
  }
  return entries;
}
export async function sandboxCommandLogs(ctx,{sessionId,commandId,requestImpl=httpsRequest}){
  ensureSession(sessionId);
  if(!CMD_ID.test(commandId??''))throw new TypeError('Invalid exact command ID');
  const {token,account}=await loadToken({db:ctx.db,accountId:ctx.connection.account,env:ctx.env});
  if(account?.id!==ctx.connection.account||typeof account.team_id!=='string'||
    ctx.connection.mode!=='preview')
    throw new TypeError('Selected Sandbox account is unverified');
  const url=new URL('https://api.vercel.com/v2/sandboxes/sessions/'+
    encodeURIComponent(sessionId)+'/cmd/'+encodeURIComponent(commandId)+
    '/logs?teamId='+encodeURIComponent(account.team_id));
  return new Promise((resolve,reject)=>{
    let settled=false,size=0;const buffers=[];
    const finish=(error,value)=>{if(settled)return;settled=true;
      if(error)reject(error);else resolve(value);};
    const req=requestImpl(url,{method:'GET',agent:false,timeout:5000,
      headers:{authorization:'Bearer '+token,accept:'application/x-ndjson'}},res=>{
      if(res.statusCode!==200){
        res.resume();finish(new TypeError('Native command output is unavailable'));return;
      }
      res.on('data',chunk=>{
        size+=chunk.length;
        if(size>12288){res.destroy();finish(new TypeError('Native command output exceeded limit'));}
        else buffers.push(chunk);
      });
      res.on('end',()=>{
        try{finish(null,{entries:parseSandboxCommandLogs(Buffer.concat(buffers))});}
        catch(error){finish(error);}
      });
      res.on('error',error=>finish(error));
    });
    req.on('timeout',()=>req.destroy(new Error('Bounded command log read timed out')));
    req.on('error',error=>finish(error));
    req.end();
  });
}
