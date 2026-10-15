// V-3: bounded build/runtime tail, scoped continuation and honest build diagnosis.
import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {ownerDeployment,base,schema,reply,assertInput,safeText} from './dev-observe-common.js';
import {diagnoseBuildText} from '../dev/build-failures.js';
const MAX=100,MAX_EVENTS=250;
const props={...base,source:{type:'string',enum:['build','runtime']},
  cursor:{type:'string',minLength:24,maxLength:1500},
  limit:{type:'integer',minimum:1,maximum:100}};
const tailSchema=schema(props,['runId','project','deployment']);
const diagSchema=schema(base,['runId','project','deployment']);
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x)?x:null;
function signal(ctx){
  const secret=ctx.env?.TOKEN_ENCRYPTION_KEY;
  if(typeof secret!=='string'||secret.length<32)
    throw new TypeError('Signed, account-bound cursor service is not configured');
  return secret;
}
function hmac(secret,raw){
  return createHmac('sha256',secret).update(raw).digest('base64url');
}
function parseCursor(raw,ctx,a,source){
  if(raw===undefined)return {timestamp:0,seen:[]};
  const parts=String(raw).split('.');
  if(parts.length!==2||parts[0].length>1400||parts[1].length!==43)
    throw new TypeError('Invalid bounded log cursor');
  const check=hmac(signal(ctx),parts[0]),have=parts[1];
  if(!timingSafeEqual(Buffer.from(check),Buffer.from(have)))
    throw new TypeError('Unverified log cursor');
  let value;
  try{value=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}
  catch{throw new TypeError('Unreadable log cursor');}
  if(value?.v!==1||value.account!==ctx.connection.account||
     value.runId!==a.runId||value.project!==a.project||
     value.deployment!==a.deployment||value.source!==source||
     !Number.isSafeInteger(value.timestamp)||value.timestamp<0||
     !Number.isSafeInteger(value.exp)||value.exp<Date.now()||
     value.exp>Date.now()+3600000||
     !Array.isArray(value.seen)||value.seen.length>MAX||
     value.seen.some(id=>!safeId(id)))
    throw new TypeError('Expired, foreign or malformed log cursor');
  return {timestamp:value.timestamp,seen:value.seen};
}
function encodeCursor(ctx,a,source,when,seen){
  const value={v:1,account:ctx.connection.account,runId:a.runId,
    project:a.project,deployment:a.deployment,source,
    timestamp:when,seen:seen.slice(0,MAX),exp:Date.now()+3600000};
  const raw=Buffer.from(JSON.stringify(value)).toString('base64url');
  const encoded=raw+'.'+hmac(signal(ctx),raw);
  if(encoded.length>1500)throw new TypeError('Continuation token exceeded bound');
  return encoded;
}
function eventRow(event,source){
  if(!event||typeof event!=='object'||Array.isArray(event))
    throw new TypeError('Malformed provider log event');
  const when=event.created??event.date??event.timestamp??event.payload?.date;
  if(!Number.isSafeInteger(when)||when<0)
    throw new TypeError('Log timestamp is not canonical');
  const kind=String(event.type??event.level??'event').slice(0,48);
  const message=event.payload?.text??event.text??event.message??'';
  const ident=event.payload?.id??event.id??
    createHash('sha256').update(JSON.stringify([when,kind,message])).digest('hex').slice(0,20);
  if(!safeId(ident))throw new TypeError('Unstable or sensitive log event identity');
  return {id:ident,created:when,kind:safeText(kind,48),
    message:safeText(message,180),source};
}
function incremental(rows,cursor,limit){
  if(!Array.isArray(rows)||rows.length>MAX_EVENTS)
    throw new TypeError('Provider returned an unbounded or unreadable log page');
  const normalized=rows.map(x=>x).sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));
  const existing=new Set(cursor.seen);
  const additions=normalized.filter(x=>x.created>cursor.timestamp||
    x.created===cursor.timestamp&&!existing.has(x.id));
  const next=additions.slice(0,limit);
  const last=next.at(-1);
  const when=last?.created??cursor.timestamp;
  const seen=last?[...new Set([
    ...(when===cursor.timestamp?cursor.seen:[]),
    ...next.filter(x=>x.created===when).map(x=>x.id)
  ])].slice(-MAX):cursor.seen;
  return {next,when,seen,morePossible:additions.length>limit||rows.length>=MAX};
}
export const devObserveTools={
  tools:[
    {name:'vercel_dev_tail_logs',area:'developer',writes:false,
      profiles:['read_only','everyday','full'],
      description:'Read bounded new build or runtime event lines with signed owner/deployment-scoped continuation.',
      inputSchema:tailSchema,annotations:{readOnlyHint:true}},
    {name:'vercel_dev_diagnose_build',area:'developer',writes:false,
      profiles:['read_only','everyday','full'],
      description:'Classify the first recorded preview build failure with finite cause and non-mutating fix guidance.',
      inputSchema:diagSchema,annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_dev_tail_logs(a,ctx){
      assertInput(a,Object.keys(props),tailSchema.required);
      if(a.limit!==undefined&&(!Number.isInteger(a.limit)||a.limit<1||a.limit>100)||
         a.source!==undefined&&!['build','runtime'].includes(a.source))
        throw new TypeError('Invalid log tail source or limit');
      if(ctx.connection?.mode!=='preview')
        throw new TypeError('Production connection cannot inspect development runs');
      const source=a.source??'build',cursor=parseCursor(a.cursor,ctx,a,source);
      const b=await ownerDeployment(ctx,a);
      let events,cutoff=null;
      if(source==='build'){
        events=await b.client.request('deployments_events',{
          path:{idOrUrl:a.deployment},
          query:{direction:'forward',follow:0,limit:100,
            ...(cursor.timestamp?{since:Math.max(0,cursor.timestamp-1)}:{})}});
      }else{
        const result=await b.client.request('runtime_logs_get',{
          path:{projectId:a.project,deploymentId:a.deployment}},
          {streamLogs:true,timeoutMs:5000});
        events=result?.records;
        cutoff=result?.stream?.cutoff??'unknown';
      }
      if(!Array.isArray(events))throw new TypeError('Log provider did not return an event array');
      const rows=events.map(x=>eventRow(x,source));
      const sample=incremental(rows,cursor,a.limit??50);
      return reply({runId:a.runId,project:a.project,deployment:a.deployment,
        source,lines:sample.next.map(({id,...rest})=>rest),returned:sample.next.length,
        cursor:encodeCursor(ctx,a,source,sample.when,sample.seen),
        complete:false,morePossible:sample.morePossible,
        evidence:'bounded provider event sample; not a certified complete history',
        ...(cutoff?{upstreamCutoff:cutoff}:{})});
    },
    async vercel_dev_diagnose_build(a,ctx){
      assertInput(a,Object.keys(base),diagSchema.required);
      const b=await ownerDeployment(ctx,a);
      const events=await b.client.request('deployments_events',{
        path:{idOrUrl:a.deployment},query:{direction:'forward',follow:0,limit:MAX_EVENTS}});
      if(!Array.isArray(events)||events.length>MAX_EVENTS)
        throw new TypeError('Build event inventory cannot be diagnosed safely');
      const first=events.find(e=>e?.type==='fatal'||e?.type==='stderr'||
        e?.level==='error'||e?.payload?.level==='error');
      const raw=first?.payload?.text??first?.text;
      const diagnosis=diagnoseBuildText(raw);
      return reply({runId:a.runId,deployment:a.deployment,
        state:first?'failure_detected':'unverified_no_error_in_sample',
        rule:diagnosis.rule,cause:diagnosis.cause,fix:diagnosis.fix,
        errorSnippet:first?safeText(raw,180):null,
        firstErrorAt:Number.isSafeInteger(first?.created)?first.created:null,
        scanned:events.length,complete:false,containsRawCredentials:false,
        evidence:'First matched event from a bounded provider page; inspect provider for full build evidence'});
    }
  }
};
