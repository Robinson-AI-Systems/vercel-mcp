// CI-only: upstream Hub wire probes and real CLI agent-check against THIS
// repository's RTC HTTP adapter, hosted on localhost with an in-memory fake DB.
// No Vercel credentials, live services, relay issues or paid operations.
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registry} from '../src/tools/index.js';
import {rtcManifest,rtcOpenApi} from '../src/core/rtc-contract.js';
import {rtcDoor} from '../src/rtc/door.js';
const root=resolve('rtc-hub');
const {runConformance}=await import(pathToFileURL(root+'/packages/conformance/src/run.js').href);
const {checkAgent}=await import(pathToFileURL(root+'/packages/cli/src/agent-check.js').href);
const pass='rtc_pass_'+randomBytes(32).toString('base64url');
let state='ok';
let allowedReads=0;
const db={
 async authorizeRtcPass(value){
   if(value!==pass)return {status:'permission'};
   return state==='ok'?{status:'ok',account:'team_FAKE',id:'pass_'+'b'.repeat(20),
      profile:'read_only',mode:'preview',listing:'catalog',areas:['server']}:
     {status:state};
 },
 async listVercelAccounts(){
   allowedReads++;
   return [{id:'team_FAKE',team_slug:'fake',label:'Local CI fixture',
     scope:'team',project_name:null,production_enabled:false,
     token_last4:null,spend_limit_cents:0}];
 },
 async getTodaySpendCents(){return 0;},
 async getResult(){return null;}
};
const door=rtcDoor({db,registry,env:{VERCEL_ENV:'preview'}});
function answer(res,status,data){
 res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
 res.end(JSON.stringify(data));
}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.method==='GET'&&url.pathname==='/api/contract')
   return answer(res,200,rtcManifest(registry));
 if(req.method==='GET'&&url.pathname==='/api/openapi.json')
   return answer(res,200,rtcOpenApi());
 const path=url.pathname;
 let route,query=Object.fromEntries(url.searchParams);
 if(path==='/api/whoami')route='whoami';
 else if(path==='/api/tools')route='list';
 else if(path==='/api/tools/_batch')route='batch';
 else if(path.startsWith('/api/tools/')){
   route=req.method==='GET'?'describe':'invoke';
   query.name=decodeURIComponent(path.slice('/api/tools/'.length));
 }else if(path.startsWith('/api/results/')){
   route='result';query.handle=decodeURIComponent(path.slice('/api/results/'.length));
 }
 if(!route)return answer(res,404,{ok:false,error:{code:'not_found',what:'not found',
   cause:'not found',todo:'Check the route',technical:''}});
 try{
   let body;
   if(req.method==='POST'){
     let data='';
     for await(const chunk of req){
       data+=chunk.toString('utf8');
       if(Buffer.byteLength(data)>16384)throw new Error('Oversized fixture request');
     }
     body=data?JSON.parse(data):{};
   }
   const adapted={
     setHeader:(k,v)=>{res.setHeader(k,v);return adapted;},
     status:(n)=>{res.statusCode=n;return adapted;},
     send:(v)=>{res.end(v);return adapted;}
   };
   return await door({method:req.method,headers:req.headers,query,body},adapted,route);
 }catch{return answer(res,400,{ok:false,error:{code:'invalid_args',
   what:'Invalid request',cause:'Invalid request',todo:'Check inputs',technical:''}});}
});
await new Promise((ok,err)=>server.listen(0,'127.0.0.1',error=>error?err(error):ok()));
const url='http://127.0.0.1:'+server.address().port;
try{
 const report=await runConformance({url,passes:{}});
 const required=['manifest','manifest.openapi','passes'];
 if(!required.every(name=>report.checks.some(item=>item.name===name&&item.ok&&!item.skipped)))
   throw new Error('Upstream RTC public manifest or unauthorized-request wire probe failed');
 const log=[];
 const env={RTOOL_SERVERS:'vercel='+url,RTC_TEST_PASS:pass,RTOOL_PASS_VERCEL:pass};
 const reader=async()=>{const error=new Error('no personal config');error.code='ENOENT';throw error;};
 const exit=await checkAgent({server:'vercel',readTool:'vercel_whoami',
   passEnv:'RTC_TEST_PASS',expectRoute:'direct',authorizedRealRun:true,
   env,reader,write:line=>log.push(JSON.parse(line))});
 if(exit!==0||log[0]?.route!=='direct'||log[0]?.code!=='verified'||allowedReads<1)
   throw new Error('Upstream CLI direct read-only route verification failed');
 const forbidden=await fetch(url+'/api/tools/vercel_project_create',{
   method:'POST',headers:{authorization:'Bearer '+pass,'content-type':'application/json'},
   body:JSON.stringify({name:'must-not-create',confirm:true})
 });
 if(forbidden.status!==403||!['outside_scope','refused_by_guard'].includes(
   (await forbidden.json()).error?.code))
   throw new Error('Read-only pass reached a guarded project write');
 state='pass_revoked';
 const revoked=await fetch(url+'/api/whoami',{headers:{authorization:'Bearer '+pass}});
 if(revoked.status!==401||(await revoked.json()).error?.code!=='pass_revoked')
   throw new Error('Revoked pass was not refused by HTTP door');
 console.log('RTC Hub pinned wire probes: public contract, OpenAPI, unauthorized requests PASS');
 console.log('RTC Hub CLI local direct: read-only scoped real-handler call PASS; write/refusal/revoke PASS');
 console.log('Full RTC write/pass-suite and hosted direct/relay/Sandbox routes are NOT certified');
}finally{
 state='pass_revoked';
 await new Promise((ok,err)=>server.close(e=>e?err(e):ok()));
}
