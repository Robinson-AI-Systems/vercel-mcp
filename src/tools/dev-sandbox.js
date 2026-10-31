// V-4: complete, bounded, run-owned preview Sandbox lifecycle.
// Metered creation uses the user's selected delegation/approval policy, not
// a developer-imposed daily quota. This repository's builder cannot spend.
import {createHash} from 'node:crypto';
import {defineWrite,bindGuardedWrite,requirePreDispatch, RefusalError } from '../core/write.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {safeSandboxPath,sandboxTar} from '../vercel/sandbox-binary.js';
import {ownerRun,safeText} from './dev-observe-common.js';
import {context,respond,RUN,PROJ,KEY} from './dev-preview-common.js';
const SBX=/^sbx_[A-Za-z0-9_-]{3,120}$/;
const CMD=/^[A-Za-z0-9_-]{3,128}$/;
const SHA=/^[a-f0-9]{40}$/;
const REPO=/^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(?:\.git)?$/;
const base={
  runId:{type:'string',pattern:RUN.source},project:{type:'string',pattern:PROJ.source},
  session:{type:'string',pattern:SBX.source},requestKey:{type:'string',pattern:KEY.source},
  dryRun:{type:'boolean'},confirm:{type:'boolean'}
};
const build=(props,required)=>({type:'object',properties:props,required,additionalProperties:false});
const createProps={...base,minutes:{type:'integer',minimum:1,maximum:1440},
  vcpus:{type:'integer',minimum:1,maximum:8},
  network:{type:'string',enum:['deny-all','allow-all','custom']},
  allowedDomains:{type:'array',minItems:1,maxItems:20,
    items:{type:'string',maxLength:253}},
  githubRepo:{type:'string',pattern:REPO.source},gitSha:{type:'string',pattern:SHA.source}};
delete createProps.session;
const createSchema=build(createProps,['runId','project','requestKey']);
const runProps={...base,action:{type:'string',enum:['start','inspect']},
  commandId:{type:'string',pattern:CMD.source},command:{type:'string',minLength:1,maxLength:80},
  args:{type:'array',maxItems:20,items:{type:'string',maxLength:200}}};
const runSchema=build(runProps,['runId','project','session','requestKey']);
const fileProps={...base,files:{type:'array',minItems:1,maxItems:5,
  items:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:128},
    content:{type:'string',maxLength:4096}},required:['path','content'],additionalProperties:false}}};
const filesSchema=build(fileProps,['runId','project','session','files','requestKey']);
const readProps={runId:base.runId,project:base.project,session:base.session,
  path:{type:'string',minLength:1,maxLength:128}};
const readSchema=build(readProps,['runId','project','session','path']);
const stopSchema=build(base,['runId','project','session','requestKey']);
function validate(a,schema){
  if(!a||typeof a!=='object'||Array.isArray(a)||
    schema.required.some(k=>!Object.hasOwn(a,k))||
    Object.keys(a).some(k=>!Object.hasOwn(schema.properties,k))||
    !RUN.test(a.runId??'')||!PROJ.test(a.project??'')||
    a.session!==undefined&&!SBX.test(a.session)||
    a.requestKey!==undefined&&!KEY.test(a.requestKey)||
    a.confirm!==undefined&&typeof a.confirm!=='boolean'||
    a.dryRun!==undefined&&typeof a.dryRun!=='boolean')
    throw new RefusalError('Exact preview Sandbox run and declared fields required');
}
function rowIdentity(row,session,project){
  // The pinned provider returns {session:{id,projectId,status,...},routes}.
  // Top-level sessionId/projectId is never a real Vercel read response.
  const actual=row?.session;
  if(!actual||typeof actual!=='object'||Array.isArray(actual)||
    actual.id!==session||
    actual.projectId!==project||
    typeof actual.status!=='string')
    throw new RefusalError('Vercel did not attest exact Sandbox session and project');
  return actual.status.toLowerCase();
}
function previewBuilder(ctx){
  if(ctx.connection?.mode!=='preview'||!['everyday','full'].includes(ctx.connection?.profile))
    throw new RefusalError('Preview-only delegated builder access required');
}
function dayDenver(now=Date.now()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
export {dayDenver};
export function boundedSandboxMinutes(requested){
  const minutes=requested??10;
  if(!Number.isSafeInteger(minutes)||minutes<1||minutes>1440)
    throw new RefusalError('Sandbox session must be one to 1440 minutes (provider Pro maximum)');
  return minutes;
}
const DOMAIN=/^(?:\*|(?:\*\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63})$/;
// V-6 (UA-08): the caller's chosen Sandbox shape, normalized to the pinned
// provider contract (vendored POST /v4/sandboxes: vcpus is 1 or an even
// number, memory must equal vcpus * 2048, networkPolicy modes are deny-all /
// allow-all / custom with allowedDomains). Omitted arguments reproduce the
// historical V-4 shape exactly; nothing caller-supplied is silently dropped.
export function sandboxShape(a){
  const vcpus=a.vcpus??1;
  if(!Number.isSafeInteger(vcpus)||vcpus<1||vcpus>8||(vcpus!==1&&vcpus%2!==0))
    throw new RefusalError('Sandbox size must be 1, 2, 4, 6 or 8 vCPUs (memory is 2 GB per vCPU)');
  const network=a.network??'deny-all';
  if(!['deny-all','allow-all','custom'].includes(network))
    throw new RefusalError('Sandbox network must be deny-all, allow-all or custom');
  let networkPolicy={mode:network};
  if(a.allowedDomains!==undefined&&network!=='custom')
    throw new RefusalError('Allowed domains apply only when the Sandbox network is custom');
  if(network==='custom'){
    if(!Array.isArray(a.allowedDomains)||a.allowedDomains.length<1||a.allowedDomains.length>20||
      a.allowedDomains.some(d=>typeof d!=='string'||d.length>253||!DOMAIN.test(d)))
      throw new RefusalError('A custom Sandbox network needs 1 to 20 allowed domain patterns');
    networkPolicy={mode:'custom',
      allowedDomains:[...new Set(a.allowedDomains)].sort()};
  }
  return {vcpus,memoryMb:vcpus*2048,network,networkPolicy};
}
export function sandboxSizeText(shape){
  return shape.vcpus===1?'1 vCPU / 2 GB':
    shape.vcpus+' vCPUs / '+(shape.vcpus*2)+' GB';
}
export function sandboxNetworkText(shape){
  if(shape.network==='allow-all')return 'external network is fully allowed';
  if(shape.network==='custom')
    return 'external network is limited to '+shape.networkPolicy.allowedDomains.length+
      ' allowed domain pattern(s)';
  return 'external network is denied';
}
// The exact provider creation body for a bound Sandbox shape. Pure so tests
// can prove the default body is byte-identical to the historical V-4 body
// and that every sized/custom body satisfies the vendored OpenAPI contract.
export function sandboxCreateBody(b){
  return {projectId:b.project,name:b.name,persistent:false,timeout:b.minutes*60000,
    resources:{vcpus:b.vcpus,memory:b.memoryMb},
    networkPolicy:b.networkPolicy,tags:{rtc_run:b.runId},
    ...(b.repo?{source:{type:'git',url:b.repo,revision:b.sha,depth:1}}:{})};
}
async function boundSession(a,ctx,{allowStopped=false}={}){
  // Caller has already validated its full action schema. Re-validating
  // against stopSchema here would reject legitimate command/files/read fields.
  if(!RUN.test(a.runId??'')||!PROJ.test(a.project??'')||!SBX.test(a.session??''))
    throw new RefusalError('Exact run-owned sandbox session required');
  const b=await ownerRun(ctx,a);
  const objects=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:a.runId});
  if(!Array.isArray(objects)||objects.length>=100)throw new RefusalError('Incomplete run inventory');
  const tracked=objects.find(x=>x.object_type==='sandbox'&&x.object_id===a.session&&
    x.project_id===a.project&&x.status==='active');
  if(!tracked)throw new RefusalError('Selected Sandbox is not an active recorded run session');
  const status=rowIdentity(await b.client.request('sandbox_session_get',{
    path:{sessionId:a.session}}),a.session,a.project);
  if(!allowStopped&&status!=='running')
    throw new RefusalError('Sandbox is not running or is already stopping');
  // Do not carry raw project/provider client or other run-object details into
  // defineWrite's generic audit snapshot. Nearby objects can contain encrypted
  // bypass credentials or synthetic webhook ciphertext.
  return {runId:a.runId,project:a.project,
    account:{team_id:b.account.team_id},session:a.session,status};
}
function teamWrite(ctx,b){
  return writeProvider(ctx).then(p=>{
    if(p.account.team_id!==b.account.team_id||
      p.account.scope==='project'&&p.account.project_id!==b.project)
      throw new TypeError('Sandbox provider scope changed');
    return p;
  });
}
const creation=defineWrite({
  name:'vercel_dev_sandbox_create',risk:{spend:true,ownerApprovedMetered:true},
  async before(a,ctx){
    validate(a,createSchema);previewBuilder(ctx);
    const minutes=boundedSandboxMinutes(a.minutes);
    const shape=sandboxShape(a);
    if(Boolean(a.githubRepo)!==Boolean(a.gitSha)||
      a.githubRepo!==undefined&&(!REPO.test(a.githubRepo)||!SHA.test(a.gitSha)))
      throw new RefusalError('Bounded Sandbox timeout and exact optional public Git SHA required');
    const b=await ownerRun(ctx,a);
    const name='rtc-'+a.runId.replaceAll('_','-')+'-'+
      createHash('sha256').update(a.requestKey).digest('hex').slice(0,10);
    return {runId:b.runId,project:b.project,
      account:{team_id:b.account.team_id},
      name,minutes,day:dayDenver(),sha:a.gitSha,repo:a.githubRepo,...shape};
  },
  async preview(_a,_ctx,b){
    return 'Create one isolated, ephemeral '+b.minutes+'-minute '+
      sandboxSizeText(b)+' Sandbox in '+
      b.project+' for run '+b.runId+'; '+sandboxNetworkText(b)+
      '. Compute, storage and egress are metered; an independent, transaction-specific grant is required without any MCP-imposed daily minutes quota.';
  },
  async spend(_a,_ctx,b){
    return {cents:null,recurring:true,description:'Vercel Sandbox for '+b.minutes+
      ' minutes (metered CPU and provisioned memory at '+sandboxSizeText(b)+'; '+
      sandboxNetworkText(b)+', ephemeral storage, exact runtime timeout; estimated amount varies by region and is NOT a guaranteed dollar limit)'};
  },
  async production(){return {production:false,why:'Ephemeral non-persistent sandbox, no provider production deployment'};},
  async targets(_a,b){return [{kind:'project',id:b.project}];},
  async apply(_a,ctx,b,key){
    const provider=await teamWrite(ctx,b);
    await requirePreDispatch(async()=>{
      const row=await provider.read('projects_get',{path:{idOrName:b.project}});
      if(row?.id!==b.project||row.accountId!==b.account.team_id)
        throw new TypeError('Project/team identity changed before metered creation');
    });
    // Record projected usage before POST; no arbitrary daily refusal.
    // An ambiguous provider response does not erase the projected usage.
    const usage=await ctx.db.recordDevSandboxMinutes({
      account:ctx.connection.account,minutes:b.minutes,day:b.day});
    if(usage?.recorded!==true)
      throw new TypeError('Sandbox usage accounting unavailable');
    const intent='intent-sandbox-'+createHash('sha256').update(b.name).digest('hex').slice(0,32);
    await ctx.db.addDevRunObject({account:ctx.connection.account,id:b.runId,
      type:'intent',objectId:intent,projectId:b.project,
      detail:{kind:'sandbox_create',name:b.name,minutes:b.minutes}});
    const body=sandboxCreateBody(b);
    const created=await provider.write('sandbox_create',{body},{
      tool:'vercel_dev_sandbox_create',requestKey:key,
      shapeResult:row=>{
        const id=row?.session?.id;
        if(!SBX.test(id??'')||row.session.projectId!==b.project||
          row.session.sourceSandboxName!==b.name||row?.sandbox?.name!==b.name)
          throw new TypeError('Vercel did not return an exact Sandbox session ID');
        return {session:id};
      }});
    await ctx.db.addDevRunObject({account:ctx.connection.account,id:b.runId,
      type:'sandbox',objectId:created.session,projectId:b.project,
      detail:{name:b.name,minutes:b.minutes,day:b.day,
        vcpus:b.vcpus,memoryMb:b.memoryMb,network:b.network}});
    if(!await ctx.db.setDevRunObjectOutcome({account:ctx.connection.account,id:b.runId,
      type:'intent',objectId:intent,status:'cleaned'}))
      throw new TypeError('Sandbox intent still unresolved in durable store');
    return {session:created.session,minutesRecorded:b.minutes,day:b.day};
  },
  async publicReceipt(_a,_b,_r,v){
    return {session:v.session,status:v.status,minutesRecorded:v.minutesRecorded};
  },
  async verify(_a,ctx,b,result){
    const {client,account}=await readProvider(ctx);
    if(account.team_id!==b.account.team_id||!SBX.test(result?.session??''))
      return {confirmed:null};
    const row=await client.request('sandbox_session_get',{path:{sessionId:result.session}});
    const status=rowIdentity(row,result.session,b.project);
    const objs=await ctx.db.listDevRunObjects({account:ctx.connection.account,id:b.runId});
    return {confirmed:status==='running'&&objs.some(o=>
      o.object_type==='sandbox'&&o.object_id===result.session&&o.status==='active'),
      session:result.session,status,minutesRecorded:result.minutesRecorded};
  }
});
const command=defineWrite({
  name:'vercel_dev_sandbox_run',
  async before(a,ctx){
    validate(a,runSchema);previewBuilder(ctx);
    const inspect=a.action==='inspect';
    if(a.action!==undefined&&!['start','inspect'].includes(a.action)||
      inspect&&(a.command!==undefined||a.args!==undefined||!CMD.test(a.commandId??''))||
      !inspect&&(a.commandId!==undefined||typeof a.command!=='string'||
        !/^[A-Za-z0-9_./-]{1,80}$/.test(a.command)||a.command.includes('..')||
        a.command.startsWith('/')||
        a.args!==undefined&&(!Array.isArray(a.args)||a.args.length>20||
          a.args.some(x=>typeof x!=='string'||x.length>200||/[\x00-\x1f\x7f]/.test(x)))))
      throw new RefusalError('Start requires bounded executable/args; inspect requires exact command ID');
    return {...await boundSession(a,ctx),action:inspect?'inspect':'start',
      commandId:inspect?a.commandId:null,command:a.command,
      argCount:(a.args??[]).length};
  },
  async preview(_a,_ctx,b){
    return b.action==='inspect'?
      'Inspect recorded Sandbox command '+b.commandId+' and return bounded redacted output behind a private result handle.':
      'Run one bounded '+b.command+' command ('+b.argCount+
      ' arguments) in the recorded preview Sandbox. Inspect the returned command ID for full output.';
  },
  async production(){return {production:false,why:'Pre-attested isolated preview session'};},
  async targets(_a,b){return [{kind:'project',id:b.project}];},
  async apply(a,ctx,b,key){
    if(b.action==='inspect')return {commandId:b.commandId,inspected:true};
    const provider=await teamWrite(ctx,b);
    await requirePreDispatch(async()=>rowIdentity(await provider.read('sandbox_session_get',{
      path:{sessionId:b.session}}),b.session,b.project)==='running'||
      Promise.reject(new TypeError('Sandbox stopped before command')));
    const intent='intent-cmd-'+createHash('sha256').update(key).digest('hex').slice(0,32);
    await ctx.db.addDevRunObject({account:ctx.connection.account,id:b.runId,
      type:'intent',objectId:intent,projectId:b.project,
      detail:{kind:'sandbox_cmd',session:b.session}});
    const result=await provider.write('sandbox_command_run',{
      path:{sessionId:b.session},
      body:{command:b.command,args:a.args??[],timeout:45000,wait:false,logs:false}
    },{tool:'vercel_dev_sandbox_run',requestKey:key,
      shapeResult:raw=>{
        const id=raw?.command?.id;
        if(!CMD.test(id??''))throw new TypeError('Command identity unavailable');
        return {commandId:id};
      }});
    await ctx.db.setDevRunObjectOutcome({account:ctx.connection.account,
      id:b.runId,type:'intent',objectId:intent,status:'cleaned'});
    return result;
  },
  async publicReceipt(_a,_b,_r,v){
    return {commandId:v.commandId,state:v.state,exitCode:v.exitCode,
      outputPreview:v.outputPreview,outputHandle:v.outputHandle,
      logAvailable:v.logAvailable,logComplete:v.logComplete,outputRetention:v.outputRetention,
      refresh:v.refresh};
  },
  async verify(_a,ctx,b,result){
    const {client}=await readProvider(ctx);
    const row=await client.request('sandbox_command_get',{
      path:{sessionId:b.session,cmdId:result.commandId}});
    if(row?.command?.id!==result.commandId||
      row.command.sessionId!==b.session)
      return {confirmed:false};
    let handle=null,preview=[],logAvailable=false,logComplete=false;
    try{
      const params={sessionId:b.session,commandId:result.commandId};
      const output=ctx.sandboxCommandLogs?
        await ctx.sandboxCommandLogs(ctx,params):
        await client.sandboxOutput(ctx,params);
      if(!Array.isArray(output?.entries)||output.entries.length>64)
        throw new TypeError('Native command logs were not bounded');
      const lines=output.entries.map(e=>({
        stream:e.stream,text:safeText(e.data,512)??'[hidden]'}));
      logAvailable=true;logComplete=row.command.exitCode!=null;
      preview=lines.slice(0,3).map(e=>({stream:e.stream,text:e.text.slice(0,160)}));
      if(lines.length&&/^resown_[a-f0-9]{64}$/.test(ctx.connection?.resultOwner??'')&&
        typeof ctx.db.putResult==='function'){
        const stored=await ctx.db.putResult({account:ctx.connection.account,
          owner:ctx.connection.resultOwner,body:lines,
          summary:'Sandbox command '+result.commandId+' logs',ttlMs:600000});
        handle=stored.handle;
      }
    }catch{
      // A streaming timeout/parse failure never means a successful empty log.
      logAvailable=false;logComplete=false;preview=[];
    }
    return {confirmed:true,commandId:result.commandId,
      state:row.command.exitCode==null?'running':'finished',
      exitCode:Number.isInteger(row.command.exitCode)?row.command.exitCode:null,
      outputPreview:preview,outputHandle:handle,logAvailable,logComplete,
      outputRetention:'10 minutes',refresh:'Call action=inspect with exact commandId'};
  }
});
const writeFiles=defineWrite({
  name:'vercel_dev_sandbox_write_files',
  async before(a,ctx){
    validate(a,filesSchema);previewBuilder(ctx);
    sandboxTar(a.files);
    return {...await boundSession(a,ctx),
      names:a.files.map(f=>f.path),digests:a.files.map(f=>
        createHash('sha256').update(f.content,'utf8').digest('hex'))};
  },
  async preview(_a,_ctx,b){return 'Write '+b.names.length+
    ' bounded file(s) into run-owned isolated Sandbox '+b.session+'; never touches a Vercel deployment.';},
  async production(){return {production:false,why:'Isolated preview Sandbox filesystem only'};},
  async targets(_a,b){return [{kind:'project',id:b.project}];},
  async apply(a,ctx,b,key){
    await requirePreDispatch(async()=>{
      const {client}=await readProvider(ctx);
      if(rowIdentity(await client.request('sandbox_session_get',{path:{sessionId:b.session}}),
        b.session,b.project)!=='running')throw new TypeError('Sandbox stopped before file upload');
    });
    const intent='intent-files-'+createHash('sha256').update(key).digest('hex').slice(0,32);
    await ctx.db.addDevRunObject({account:ctx.connection.account,id:b.runId,
      type:'intent',objectId:intent,projectId:b.project,
      detail:{kind:'sandbox_files',session:b.session,names:b.names}});
    const provider=await teamWrite(ctx,b);
    const params={sessionId:b.session,kind:'write',files:a.files};
    const result=ctx.sandboxBinaryPost?
      await ctx.sandboxBinaryPost(ctx,params):
      await provider.sandboxFile(params,{requestKey:key,tool:'vercel_dev_sandbox_write_files'});
    if(result?.accepted!==true)throw new TypeError('Provider did not acknowledge file upload');
    await ctx.db.setDevRunObjectOutcome({account:ctx.connection.account,
      id:b.runId,type:'intent',objectId:intent,status:'cleaned'});
    return {written:b.names,sha256:b.digests,providerAccepted:true};
  },
  async publicReceipt(_a,_b,_r,v){
    return {fileCount:v.fileCount,contentsReturned:v.contentsReturned};
  },
  async verify(_a,ctx,b,_r){
    const digests=[];
    const {client}=await readProvider(ctx);
    for(const name of b.names){
      const params={sessionId:b.session,kind:'read',path:name};
      const read=ctx.sandboxBinaryPost?
        await ctx.sandboxBinaryPost(ctx,params):
        await client.sandboxFilesystem(ctx,params);
      if(read.accepted!==true||!Buffer.isBuffer(read.bytes))return {confirmed:null};
      digests.push(createHash('sha256').update(read.bytes).digest('hex'));
    }
    return {confirmed:digests.every((x,i)=>x===b.digests[i]),
      fileCount:b.names.length,contentsReturned:false};
  }
});
const stop=defineWrite({
  name:'vercel_dev_sandbox_stop',
  async before(a,ctx){validate(a,stopSchema);previewBuilder(ctx);
    return boundSession(a,ctx,{allowStopped:true});},
  async preview(_a,_ctx,b){return 'Stop exact run-owned Sandbox '+b.session+
    ' now, terminating its processes and ending further compute usage.';},
  async production(){return {production:false,why:'Only recorded nonproduction Sandbox session'};},
  async targets(_a,b){return [{kind:'project',id:b.project}];},
  async apply(_a,ctx,b,key){
    const provider=await teamWrite(ctx,b);
    const fresh=await provider.read('sandbox_session_get',{path:{sessionId:b.session}});
    const state=rowIdentity(fresh,b.session,b.project);
    if(state==='stopped')return {requested:false,alreadyStopped:true};
    if(state!=='running')throw new TypeError('Sandbox stop status is ambiguous');
    await requirePreDispatch(async()=>{
      const next=await provider.read('sandbox_session_get',{path:{sessionId:b.session}});
      if(rowIdentity(next,b.session,b.project)!=='running')
        throw new TypeError('Sandbox status changed before stop');
    });
    await provider.write('sandbox_stop',{path:{sessionId:b.session}},
      {tool:'vercel_dev_sandbox_stop',requestKey:key,
        shapeResult:()=>({accepted:true})});
    return {requested:true};
  },
  async publicReceipt(_a,_b,_r,v){return {session:v.session,status:v.status};},
  async verify(_a,ctx,b){
    const {client}=await readProvider(ctx);
    const current=await client.request('sandbox_session_get',{path:{sessionId:b.session}});
    const status=rowIdentity(current,b.session,b.project);
    if(status==='stopped'){
      await ctx.db.setDevRunObjectOutcome({account:ctx.connection.account,id:b.runId,
        type:'sandbox',objectId:b.session,status:'cleaned'});
    }
    return {confirmed:status==='stopped',status,session:b.session};
  }
});
function spec(name,schema,profile,readOnly,handler){
  return {name,area:'developer',profiles:profile,inputSchema:schema,
    ...(readOnly?{writes:false}:{writes:true,guardedWrite:true,writeContract:handler.writeContract}),
    annotations:{readOnlyHint:readOnly,destructiveHint:name==='vercel_dev_sandbox_stop'},
    description:{
      vercel_dev_sandbox_create:'Provision a time-bounded preview Sandbox with your choice of vCPUs and network access; metered cost follows the account purchase policy.',
      vercel_dev_sandbox_run:'Start an owned Sandbox command or inspect its exact ID for bounded output and bearer-scoped full result handle.',
      vercel_dev_sandbox_write_files:'Upload up to five bounded, safe relative files into the owned active Sandbox.',
      vercel_dev_sandbox_read_file:'Read one bounded file from the exact owned active preview Sandbox with secret-safe shaping.',
      vercel_dev_sandbox_stop:'Stop an exact owned Sandbox and verify it is stopped before clearing its lifecycle record.'
    }[name]};
}
export const devSandboxTools={
  tools:[
    spec('vercel_dev_sandbox_create',createSchema,['everyday','full'],false,creation),
    spec('vercel_dev_sandbox_run',runSchema,['everyday','full'],false,command),
    spec('vercel_dev_sandbox_write_files',filesSchema,['everyday','full'],false,writeFiles),
    spec('vercel_dev_sandbox_read_file',readSchema,['read_only','everyday','full'],true),
    spec('vercel_dev_sandbox_stop',stopSchema,['everyday','full'],false,stop)
  ],
  handlers:{
    vercel_dev_sandbox_create:bindGuardedWrite(creation,context,respond),
    vercel_dev_sandbox_run:bindGuardedWrite(command,c=>({...context(c),sandboxCommandLogs:c.sandboxCommandLogs}),respond),
    vercel_dev_sandbox_write_files:bindGuardedWrite(writeFiles,c=>({
      ...context(c),sandboxBinaryPost:c.sandboxBinaryPost}),respond),
    async vercel_dev_sandbox_read_file(a,ctx){
      validate(a,readSchema);
      if(!safeSandboxPath(a.path))throw new TypeError('Invalid sandbox file path');
      await boundSession({...a,requestKey:'read-only-file'},ctx);
      const {client}=await readProvider(ctx);
      const params={sessionId:a.session,kind:'read',path:a.path};
      const read=ctx.sandboxBinaryPost?
        await ctx.sandboxBinaryPost(ctx,params):
        await client.sandboxFilesystem(ctx,params);
      if(read?.accepted!==true||!Buffer.isBuffer(read.bytes))
        throw new TypeError('Sandbox file read was not independently confirmed');
      return {content:[{type:'text',text:JSON.stringify({
        session:a.session,path:a.path,bytes:read.bytes.length,
        content:safeText(read.bytes.toString('utf8'),4096),
        complete:true,containsRawCredentials:false})}]};
    },
    vercel_dev_sandbox_stop:bindGuardedWrite(stop,context,respond)
  }
};
