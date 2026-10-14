// D-2a: bounded deployment list/detail reads. Stored account controls every team
// and project scope; never trust arbitrary upstream metadata or a caller token.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';

const PROFILES=['read_only','everyday','full'];
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const HOST=/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const asText=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
function validateArgs(args,keys){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!keys.includes(k)))throw new TypeError('Invalid deployment read request');
}
function name(value,max=128){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !/[\x00-\x1f\x7f]/.test(value)&&!credentialLike(value)?value:null;
}
function deploymentLocator(value){
  if(typeof value!=='string'||value.length<3||value.length>253||credentialLike(value))
    throw new TypeError('Invalid deployment identifier');
  if(value.startsWith('https://')){
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port||
      url.pathname!=='/'||url.search||url.hash)throw new TypeError('Unsafe deployment URL');
    value=url.hostname.toLowerCase();
  }
  if(!(IDENT.test(value)||HOST.test(value.toLowerCase())&&value.includes('.')||
    /^dpl_[A-Za-z0-9_-]{3,120}$/.test(value))||
    value.includes('..')||value.startsWith('.')||value.endsWith('.'))
    throw new TypeError('Invalid deployment identifier');
  return value;
}
export function projectFor(args,account){
  const requested=args.project;
  if(requested!==undefined && (typeof requested!=='string'||!IDENT.test(requested)))
    throw new TypeError('Select a valid project ID');
  if(account.scope==='project'){
    if(typeof account.project_id!=='string'||!IDENT.test(account.project_id)||
      requested!==undefined&&requested!==account.project_id)
      throw new TypeError('Connection cannot inspect a different project');
    return account.project_id;
  }
  if(requested===undefined)throw new TypeError('Select the exact project ID to read deployments');
  return requested;
}
function deploymentProject(row){
  if(row?.projectId!=null&&row?.project?.id!=null&&row.projectId!==row.project.id)
    throw new TypeError('Conflicting provider project identity');
  const project=row?.projectId??row?.project?.id;
  if(typeof project!=='string'||!IDENT.test(project))
    throw new TypeError('Deployment project identity is unverified');
  return project;
}
function summary(row,project){
  if(!row||typeof row!=='object'||Array.isArray(row)||
    deploymentProject(row)!==project)throw new TypeError('Deployment outside requested project');
  const id=name(row.uid??row.id,128);
  if(!id)throw new TypeError('Provider deployment ID is unsafe');
  const git=row.meta&&typeof row.meta==='object'?row.meta:{};
  const aliases=Array.isArray(row.alias)?row.alias.slice(0,10)
    .map(alias=>name(typeof alias==='string'?alias:alias?.alias,253)).filter(Boolean):[];
  return {id,projectId:project,
    url:name(row.url,253),state:name(row.readyState??row.state,40),
    target:name(row.target,64),createdAt:Number.isSafeInteger(row.created)?row.created:
      Number.isSafeInteger(row.createdAt)?row.createdAt:null,
    readyAt:Number.isSafeInteger(row.ready)?row.ready:null,
    branch:name(git.githubCommitRef??row.gitSource?.ref,128),
    commit:name(git.githubCommitSha,64),
    aliases};
}
function cursorFor(reply,items,limit){
  if(!reply?.pagination||!Object.hasOwn(reply.pagination,'next')||
    items.length>limit)throw new TypeError('Incomplete deployment page');
  const p=reply.pagination,next=p.next;
  if(next===null){
    if(p.hasNext===true||p.hasMore===true||reply.hasMore===true)
      throw new TypeError('Contradictory deployment pagination');
    return null;
  }
  const n=typeof next==='string'&&/^[1-9][0-9]{0,15}$/.test(next)?
    Number(next):next;
  if(!Number.isSafeInteger(n)||n<=0||
    p.hasNext===false||p.hasMore===false||reply.hasMore===false)
    throw new TypeError('Unsafe deployment pagination cursor');
  return n;
}

// A deployment ID is checked against its account-scoped project before either
// ancillary GET. File names and log text may contain secrets: do not return raw.
export async function scopedDeployment(args,ctx,requestOptions={}){
  if(typeof args.deployment!=='string'||!/^dpl_[A-Za-z0-9_-]{3,120}$/.test(args.deployment))
    throw new TypeError('Select a valid deployment ID');
  const {client,account}=await readProvider(ctx);
  const project=projectFor(args,account);
  const row=await client.request('deployments_get',{path:{idOrUrl:args.deployment}},requestOptions);
  const verified=summary(row,project);
  if(verified.id!==args.deployment)throw new TypeError('Deployment identity changed');
  return {client,account,project,verified};
}
function buildEventSummary(events){
  if(!Array.isArray(events))throw new TypeError('Invalid deployment events response');
  const tally={error:0,warning:0,command:0,other:0};
  let firstError=null,scanned=0;
  for(const event of events.slice(0,5000)){
    if(!event||typeof event!=='object'||Array.isArray(event))
      throw new TypeError('Malformed deployment event');
    scanned++;
    // No payload.text or arbitrary metadata ever leaves this process.
    const kind=typeof event.type==='string'?event.type.toLowerCase():'';
    const level=typeof event.payload?.level==='string'?event.payload.level.toLowerCase():'';
    const category=kind==='error'||level==='error'?'error':
      kind==='warning'||level==='warn'||level==='warning'?'warning':
      kind==='command'?'command':'other';
    tally[category]++;
    if(category==='error'&&!firstError){
      const step=event.payload?.info?.step;
      firstError={eventIndex:scanned-1,
        step:typeof step==='string'&&/^[A-Za-z0-9 _.-]{1,64}$/.test(step)&&
        !credentialLike(step)?step:null,
        note:'Build error present; inspect the deployment in Vercel for unredacted details'};
    }
  }
  return {scanned,tally,firstError,returnedByProvider:events.length,
    boundedScan:events.length>5000,
    complete:false,reason:'Build-event pagination or availability cannot be proven by one bounded GET',
    containsRawLogText:false};
}
function safeFileTree(tree){
  if(!Array.isArray(tree))throw new TypeError('Invalid deployment file tree');
  const stack=tree.map(n=>({n,path:'',depth:0})).reverse(), files=[];
  let scanned=0;
  while(stack.length&&scanned<1000){
    const {n,path,depth}=stack.pop();
    if(!n||typeof n!=='object'||Array.isArray(n)||depth>8)
      throw new TypeError('Malformed or overdeep deployment file tree');
    const part=n.name;
    if(typeof part!=='string'||part.length<1||part.length>100||
      !/^[A-Za-z0-9._-]+$/.test(part)||part==='.'||part==='..'||
      credentialLike(part))throw new TypeError('Unsafe deployment file path');
    const full=path?path+'/'+part:part;
    if(full.length>500)throw new TypeError('File path too deep');
    const type=n.type;
    if(type!=='file'&&type!=='directory')
      throw new TypeError('Unknown deployment file type');
    scanned++;
    if(files.length<20)files.push({path:full,type,
      fileId:type==='file'&&typeof n.uid==='string'&&/^[a-fA-F0-9]{32,128}$/.test(n.uid)?n.uid:null});
    if(n.children!==undefined){
      if(type!=='directory'||!Array.isArray(n.children))
        throw new TypeError('Invalid file tree children');
      for(const child of [...n.children].reverse())stack.push({n:child,path:full,depth:depth+1});
    }
  }
  return {files,scanned,more:stack.length>0||scanned>20,
    complete:stack.length===0&&scanned<=20,
    availability:tree.length===0?'unknown':'file_tree',
    note:tree.length===0?'Provider returned no file tree; this does not prove deployment has no files':null};
}

export const deploymentReadTools={
  tools:[
    {name:'vercel_deploy_list',writes:false,profiles:PROFILES,area:'deployments',
      description:'List up to 20 safe deployment summaries for an exact project with a continuation cursor.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        limit:{type:'integer',minimum:1,maximum:20},
        until:{type:'integer',minimum:1},since:{type:'integer',minimum:1},
        target:{type:'string',enum:['production','preview']},
        state:{type:'string',enum:['BUILDING','ERROR','INITIALIZING','QUEUED','READY','CANCELED','BLOCKED']},
        branch:{type:'string',minLength:1,maxLength:100},
        sha:{type:'string',minLength:7,maxLength:64}}),annotations:{readOnlyHint:true}},
    {name:'vercel_deploy_get',writes:false,profiles:PROFILES,area:'deployments',
      description:'Read one deployment by ID or HTTPS hostname, independently verifying the project.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',minLength:3,maxLength:253}},['deployment']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_deploy_get_build_logs',writes:false,profiles:PROFILES,area:'deployments',
      description:'Summarize up to 5000 build events for a verified deployment without returning raw potentially secret text.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',minLength:7,maxLength:128}},['deployment']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_deploy_get_runtime_logs',writes:false,profiles:PROFILES,area:'deployments',
      description:'Summarize a bounded slice of streamed runtime events for an exact deployment and time window, without raw log messages.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',minLength:7,maxLength:128},
        sinceMs:{type:'integer',minimum:1},untilMs:{type:'integer',minimum:1},
        level:{type:'string',enum:['error','warning','info','fatal','debug']},
        status:{type:'integer',minimum:100,maximum:599},
        path:{type:'string',maxLength:150}},['deployment']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_deploy_wait',writes:false,profiles:PROFILES,area:'deployments',
      description:'Boundedly poll a project-verified deployment status; return terminal state or instructions to call again.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',minLength:7,maxLength:128},
        waitSeconds:{type:'integer',minimum:0,maximum:8}},['deployment']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_deploy_get_file',writes:false,profiles:PROFILES,area:'deployments',
      description:'Read a bounded verified text file from a deployment, refusing secrets and unknown response shapes.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',minLength:7,maxLength:128},
        fileId:{type:'string',minLength:32,maxLength:128}},['deployment','fileId']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_deploy_list_files',writes:false,profiles:PROFILES,area:'deployments',
      description:'Read up to 20 safe deployment file-tree paths from an independently verified project/deployment.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',minLength:7,maxLength:128}},['deployment']),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_deploy_get_file(args,ctx){
      validateArgs(args,['project','deployment','fileId']);
      if(typeof args.fileId!=='string'||!/^[a-fA-F0-9]{32,128}$/.test(args.fileId))
        throw new TypeError('Select a valid file identifier from deployment file listing');
      const {client,project}=await scopedDeployment(args,ctx,{timeoutMs:4000});
      // A file ID alone must not grant a different or unlisted resource.
      const listed=await client.request('deployments_files_list',{path:{id:args.deployment}});
      const files=safeFileTree(listed);
      const selected=files.files.find(row=>row.type==='file'&&row.fileId===args.fileId);
      if(!selected)throw new TypeError('File was not independently verified in the bounded deployment tree');
      if(/(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|credentials?|secrets?)(?:$|\/|\.)/i.test(selected.path))
        throw new TypeError('Sensitive file paths are not readable through MCP');
      const payload=await client.request('deployments_file_get',{
        path:{id:args.deployment,fileId:args.fileId},
        query:{path:selected.path}
      },{fileContent:true,timeoutMs:6000});
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||
        typeof payload.content!=='string'||
        payload.encoding!==undefined&&payload.encoding!=='base64'||
        payload.fileId!==undefined&&payload.fileId!==args.fileId||
        payload.deploymentId!==undefined&&payload.deploymentId!==args.deployment||
        payload.path!==undefined&&payload.path!==selected.path)
        throw new TypeError('Unrecognized or mismatched Vercel file response');
      const encoded=payload.content;
      if(encoded.length>4096||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
        throw new TypeError('Deployment file is not safely sized canonical base64');
      const raw=Buffer.from(encoded,'base64');
      if(raw.length>2048||raw.toString('base64')!==encoded)
        throw new TypeError('Deployment file exceeds safe text read limit');
      let content;
      try{content=new TextDecoder('utf-8',{fatal:true}).decode(raw);}
      catch{throw new TypeError('Binary deployment files cannot be returned');}
      // Valid UTF-8 does not imply a text file: NUL and other C0 binary
      // controls can survive decoding and must not escape as source text.
      if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content))
        throw new TypeError('Binary deployment files cannot be returned');
      if(credentialLike(content)||/((?:password|secret|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*\S+)/i.test(content))
        throw new TypeError('Deployment source contains potentially sensitive content');
      return asText({project,deployment:args.deployment,fileId:args.fileId,
        path:selected.path,content,bytes:raw.length,
        note:'Small verified UTF-8 file only; raw or secret-bearing files are deliberately unavailable'});
    },
    async vercel_deploy_get_runtime_logs(args,ctx){
      validateArgs(args,['project','deployment','sinceMs','untilMs','level','status','path']);
      const until=args.untilMs??Date.now(),since=args.sinceMs??until-1800000;
      if(!Number.isSafeInteger(until)||!Number.isSafeInteger(since)||since<1||
         until> Date.now()+1000||since>=until||until-since>86400000)
        throw new TypeError('Select a valid runtime log window of at most 24 hours');
      if(args.level!==undefined && !['error','warning','info','fatal','debug'].includes(args.level))
        throw new TypeError('Invalid runtime log level');
      if(args.status!==undefined && (!Number.isInteger(args.status)||args.status<100||args.status>599))
        throw new TypeError('Invalid response status');
      if(args.path!==undefined && (typeof args.path!=='string'||
        !/^\/[A-Za-z0-9/_-]{0,149}$/.test(args.path)||credentialLike(args.path)))
        throw new TypeError('Invalid runtime path filter');
      const {client,project}=await scopedDeployment(args,ctx,{timeoutMs:4000});
      const received=await client.request('runtime_logs_get',{
        path:{projectId:project,deploymentId:args.deployment}
      },{streamLogs:true,timeoutMs:6000});
      let matched=0,inWindow=0;
      const levels={error:0,warning:0,info:0,fatal:0,debug:0,other:0};
      const statuses={};
      for(const row of received.records){
        if(row.deploymentId!=null && row.deploymentId!==args.deployment ||
          row.projectId!=null && row.projectId!==project)
          throw new TypeError('Provider log entry belongs to a different resource');
        // Provider wire responses may use either field naming family.
        // Conflicting simultaneous aliases must never satisfy a filter.
        if(row.timestampInMs!=null&&row.timestamp!=null&&row.timestampInMs!==row.timestamp||
          row.responseStatusCode!=null&&row.statusCode!=null&&row.responseStatusCode!==row.statusCode||
          row.requestPath!=null&&row.path!=null&&row.requestPath!==row.path)
          throw new TypeError('Contradictory provider runtime log metadata');
        const stamp=row.timestampInMs??row.timestamp;
        if(!Number.isSafeInteger(stamp)||stamp<1)throw new TypeError('Runtime log has no verifiable timestamp');
        if(stamp<since||stamp>until)continue;
        inWindow++;
        const status=row.responseStatusCode??row.statusCode;
        const requestPath=row.requestPath??row.path;
        if(args.level!==undefined&&row.level!==args.level)continue;
        if(args.status!==undefined&&status!==args.status)continue;
        if(args.path!==undefined&&requestPath!==args.path)continue;
        matched++;
        const level=['error','warning','info','fatal','debug'].includes(row.level)?row.level:'other';
        levels[level]++;
        if(Number.isSafeInteger(status)&&status>=100&&status<=599)
          statuses[status]=(statuses[status]||0)+1;
        // Do not expose raw messages, paths, hostnames, IDs or metadata.
      }
      return asText({project,deployment:args.deployment,sinceMs:since,untilMs:until,
        scanned:received.records.length,inWindow,matched,levels,statuses,
        transport:received.stream,containsRawLogText:false,
        note:'Streamed sample only. Zero matches does not certify no logs in this window'});
    },
    async vercel_deploy_wait(args,ctx){
      validateArgs(args,['project','deployment','waitSeconds']);
      const seconds=args.waitSeconds??4;
      if(!Number.isSafeInteger(seconds)||seconds<0||seconds>8)
        throw new TypeError('Invalid bounded wait duration');
      // Vercel's serverless invocation budget is not a 45-second guarantee.
      // Each poll independently proves account/project/deployment identity.
      const start=Date.now(),deadline=start+seconds*1000;
      let verified,project,reads=0;
      do{
        ({verified,project}=await scopedDeployment(args,ctx,{timeoutMs:4000}));
        reads++;
        const state=verified.state;
        if(['READY','ERROR','CANCELED'].includes(state))break;
        const left=deadline-Date.now();
        if(reads>=3||left<=1500)break;
        await new Promise(resolve=>setTimeout(resolve,Math.min(1500,left)));
      }while(Date.now()<deadline);
      const state=verified.state;
      const done=['READY','ERROR','CANCELED'].includes(state);
      return asText({project,deployment:args.deployment,state,
        done,successful:state==='READY',polls:reads,
        waitedSeconds:Math.min(45,Math.max(0,Math.ceil((Date.now()-start)/1000))),
        next:done?null:'Call vercel_deploy_wait again with the same deployment and project ID',
        note:done?null:'A bounded read cannot certify the final state of an unfinished or unknown deployment'});
    },
    async vercel_deploy_get_build_logs(args,ctx){
      validateArgs(args,['project','deployment']);
      const {client,project}=await scopedDeployment(args,ctx);
      const events=await client.request('deployments_events',{
        path:{idOrUrl:args.deployment},
        query:{limit:100,follow:0,direction:'backward'}});
      return asText({project,deployment:args.deployment,
        ...buildEventSummary(events)});
    },
    async vercel_deploy_list_files(args,ctx){
      validateArgs(args,['project','deployment']);
      const {client,project}=await scopedDeployment(args,ctx);
      let files;
      try {
        files=await client.request('deployments_files_list',{path:{id:args.deployment}});
      } catch(error) {
        // A verified Git-created deployment may have no retrievable uploaded
        // source tree at this optional Vercel endpoint. Do not imply that the
        // independently verified deployment disappeared, or that it is empty.
        // 401/403/5xx remain errors; no alternative source or secret is read.
        if(error?.status!==404)throw error;
        return asText({project,deployment:args.deployment,
          files:[],scanned:0,more:false,complete:false,
          availability:'not_exposed',
          note:'Vercel did not expose a source file tree for this verified deployment. Git-built deployments may not provide one; zero returned paths does not establish an empty deployment'});
      }
      return asText({project,deployment:args.deployment,...safeFileTree(files)});
    },
    async vercel_deploy_list(args,ctx){
      validateArgs(args,['project','limit','until','since','target','state','branch','sha']);
      const limit=args.limit??20;
      if(!Number.isInteger(limit)||limit<1||limit>20||
        args.until!==undefined&&(!Number.isSafeInteger(args.until)||args.until<=0)||
        args.since!==undefined&&(!Number.isSafeInteger(args.since)||args.since<=0)||
        args.since!==undefined&&args.until!==undefined&&args.since>=args.until)
        throw new TypeError('Invalid deployment page');
      if(args.state!==undefined&&!['BUILDING','ERROR','INITIALIZING','QUEUED','READY','CANCELED','BLOCKED'].includes(args.state))
        throw new TypeError('Invalid deployment state filter');
      if(args.target!==undefined&&!['production','preview'].includes(args.target))
        throw new TypeError('Invalid deployment environment filter');
      if(args.branch!==undefined&&(typeof args.branch!=='string'||
        !/^[A-Za-z0-9._/-]{1,100}$/.test(args.branch)||
        args.branch.includes('..')||credentialLike(args.branch)))
        throw new TypeError('Invalid Git branch filter');
      if(args.sha!==undefined&&(typeof args.sha!=='string'||!/^[0-9a-fA-F]{7,64}$/.test(args.sha)))
        throw new TypeError('Invalid commit SHA filter');
      const {client,account}=await readProvider(ctx);
      const project=projectFor(args,account);
      const reply=await client.request('deployments_list',{
        query:{projectId:project,limit,...(args.until?{until:args.until}:{}),
          ...(args.since?{since:args.since}:{}),
          ...(args.target?{target:args.target}:{}),
          ...(args.state?{state:args.state}:{}),
          ...(args.branch?{branch:args.branch}:{}),
          ...(args.sha?{sha:args.sha}:{})}});
      if(!Array.isArray(reply?.deployments))
        throw new TypeError('Provider did not return deployment inventory');
      const next=cursorFor(reply,reply.deployments,limit);
      const seen=new Set();
      const deployments=reply.deployments.map(row=>{
        const safe=summary(row,project);
        if(seen.has(safe.id))throw new TypeError('Duplicate deployment identity');
        seen.add(safe.id);
        if(args.state && safe.state!==args.state)
          throw new TypeError('Provider returned a deployment outside the state filter');
        if(args.target==='production' && safe.target!=='production')
          throw new TypeError('Provider returned a deployment outside the production filter');
        if(args.target==='preview' && ![null,'preview'].includes(safe.target))
          throw new TypeError('Provider returned a deployment outside the preview filter');
        if(args.branch && safe.branch!==args.branch)
          throw new TypeError('Provider returned a deployment outside the branch filter');
        if(args.sha && safe.commit!==args.sha)
          throw new TypeError('Provider returned a deployment outside the commit filter');
        return safe;
      });
      const filters=Object.fromEntries(['state','target','branch','sha','since']
        .filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
      return asText({project,deployments,count:deployments.length,filters,
        next,complete:next===null,
        nextStep:next===null?null:
          'Call vercel_deploy_list with this project, the same filters, and until='+next});
    },
    async vercel_deploy_get(args,ctx){
      validateArgs(args,['project','deployment']);
      const locator=deploymentLocator(args.deployment);
      const {client,account}=await readProvider(ctx);
      const project=projectFor(args,account);
      const response=await client.request('deployments_get',{path:{idOrUrl:locator}});
      const data=summary(response,project);
      const errorCode=name(response.errorCode,80);
      return asText({...data,errorCode,aliasesCapped:Array.isArray(response.alias)&&
        response.alias.length>10});
    }
  }
};
