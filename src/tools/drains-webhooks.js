// M-2: drains and webhooks (design BATCH-M M2; dossier
// batch-m-dossier-2026-10-30.md). Drain delivery destinations and
// webhook endpoints are data-leaving-the-team surfaces: only public
// HTTPS endpoints are accepted, previews and reads show the host
// (never the delivery secret or header values), and a drain test
// that the provider reports as failed is reported as failed — the
// contract answers a failed test with a 200 carrying an error field,
// not an HTTP error. The webhook signing secret exists only in the
// create response; it is captured out of the shaped result into the
// one-time-secret store and never returned, journaled or replayed.
import {defineWrite,bindGuardedWrite,requirePreDispatch,RefusalError} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest,readOpenApi} from '../vercel/openapi-validation.js';
import {oneTimeSecrets} from '../core/one-time-secrets.js';

const READ=['read_only','everyday','full'];
const REQUEST_KEY=/^[a-zA-Z0-9_-]{8,128}$/;
const DRAIN_ID=/^[A-Za-z0-9_-]{3,128}$/;
const control=/[\x00-\x1f\x7f]/;
const RESULT_STORE_CAP=1048576;
const PRICING='https://vercel.com/pricing';
const KINDS=['log','trace','analytics','audit_log','ai_gateway','connect','speed_insights'];
const output=x=>({content:[{type:'text',text:JSON.stringify(compact(x,RESULT_STORE_CAP))}]});
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
function strictArgs(args,keys,what){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!keys.includes(k)))
    throw new RefusalError('Unsupported '+what+' selector');
}
function safeText(value,max){
  return typeof value==='string'&&value.length>0&&value.length<=max&&
    !control.test(value)&&!credentialLike(value);
}
function safeLabel(value,max=128){
  return safeText(value,max)?value:null;
}
function hostOf(value){
  try{return new URL(value).hostname||null;}catch{return null;}
}
function privateHost(host){
  const h=(host.startsWith('[')&&host.endsWith(']')?
    host.slice(1,-1):host).toLowerCase();
  if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||
    h.endsWith('.internal')||h.endsWith('.lan')||h.endsWith('.home'))return true;
  if(!h.includes('.')&&!/^\d+\.\d+\.\d+\.\d+$/.test(h)&&!h.includes(':'))return true;
  const v4=/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if(v4){
    const [a,b]=[Number(v4[1]),Number(v4[2])];
    return a===0||a===10||a===127||(a===172&&b>=16&&b<=31)||
      (a===192&&b===168)||(a===169&&b===254)||(a===100&&b>=64&&b<=127)||a>=224;
  }
  if(h.includes(':')){
    return h==='::1'||h==='::'||h.startsWith('fc')||h.startsWith('fd')||
      /^fe[89ab]/.test(h);
  }
  return false;
}
function publicEndpoint(value,what){
  if(!safeText(value,2048))
    throw new RefusalError(what+' endpoint is missing or unsafe');
  let url;
  try{url=new URL(value);}catch{
    throw new RefusalError(what+' endpoint must be a valid public HTTPS URL');
  }
  if(url.protocol!=='https:')
    throw new RefusalError(what+' endpoint must use HTTPS');
  const host=url.hostname;
  if(!host||privateHost(host))
    throw new RefusalError(what+' endpoint must be a public host (private, loopback and intranet destinations are refused)');
  return {url:value,host};
}
function schemasFrom(sources){
  if(sources===undefined)return {log:{version:'v2'}};
  if(!sources||typeof sources!=='object'||Array.isArray(sources)||
    !Object.keys(sources).length)
    throw new RefusalError('Data kinds must be a non-empty map of kind to version');
  const out={};
  for(const [kind,version] of Object.entries(sources)){
    if(!KINDS.includes(kind))
      throw new RefusalError('Unknown drain data kind: '+kind);
    if(!safeText(version,16))
      throw new RefusalError('Unsafe schema version for '+kind);
    out[kind]={version};
  }
  return out;
}
function deliveryShape(delivery){
  if(!delivery||typeof delivery!=='object')return null;
  const type=typeof delivery.type==='string'?delivery.type:null;
  let host=null;
  if(type==='http'&&typeof delivery.endpoint==='string')host=hostOf(delivery.endpoint);
  if(type==='otlphttp'&&typeof delivery.endpoint?.traces==='string')
    host=hostOf(delivery.endpoint.traces);
  if((type==='clickhouse'||type==='s3')&&typeof delivery.endpoint==='string')
    host=hostOf(delivery.endpoint);
  return {type,host,
    encoding:typeof delivery.encoding==='string'?delivery.encoding:null,
    headerNames:delivery.headers&&typeof delivery.headers==='object'?
      Object.keys(delivery.headers).slice(0,20):[]};
}
function shapeDrain(raw){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!DRAIN_ID.test(raw.id))
    throw new RefusalError('Drain metadata was not recognized');
  return {
    id:raw.id,name:safeLabel(raw.name),
    status:typeof raw.status==='string'?raw.status:null,
    types:raw.schemas&&typeof raw.schemas==='object'?Object.keys(raw.schemas):[],
    destination:deliveryShape(raw.delivery),
    projects:Array.isArray(raw.projectIds)?raw.projectIds.slice(0,50):null,
    sampling:Array.isArray(raw.sampling)?raw.sampling.slice(0,5).map(s=>({
      type:typeof s?.type==='string'?s.type:null,
      rate:typeof s?.rate==='number'?s.rate:null,
      env:typeof s?.env==='string'?s.env:null})):[],
    firstErrorTimestamp:typeof raw.firstErrorTimestamp==='number'?
      raw.firstErrorTimestamp:null,
    disabledReason:typeof raw.disabledReason==='string'?raw.disabledReason:null,
    createdAt:typeof raw.createdAt==='number'?raw.createdAt:null,
    updatedAt:typeof raw.updatedAt==='number'?raw.updatedAt:null
  };
}
function shapeWebhook(raw){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!DRAIN_ID.test(raw.id))
    throw new RefusalError('Webhook metadata was not recognized');
  return {
    id:raw.id,urlHost:typeof raw.url==='string'?hostOf(raw.url):null,
    events:Array.isArray(raw.events)?raw.events.slice(0,20):[],
    eventCount:Array.isArray(raw.events)?raw.events.length:0,
    projects:Array.isArray(raw.projectIds)?raw.projectIds.slice(0,50):null,
    createdAt:typeof raw.createdAt==='number'?raw.createdAt:null,
    updatedAt:typeof raw.updatedAt==='number'?raw.updatedAt:null
  };
}
async function getDrain(client,id){
  let raw;
  try{raw=await client.request('drains_get',{path:{id}});}
  catch(error){
    if(error?.status===404)
      throw new RefusalError('Drain was not found on the selected team');
    if(error?.status===403)
      throw new RefusalError('This credential cannot access that drain');
    throw error;
  }
  return shapeDrain(raw);
}
async function getWebhook(client,id){
  let raw;
  try{raw=await client.request('webhooks_get',{path:{id}});}
  catch(error){
    if(error?.status===404)
      throw new RefusalError('Webhook was not found on the selected team');
    if(error?.status===403)
      throw new RefusalError('This credential cannot access that webhook');
    throw error;
  }
  return shapeWebhook(raw);
}

/* ------------------------------- reads ------------------------------- */
export const drainsWebhooksReadTools={
  tools:[
    {name:'vercel_drain_list',writes:false,area:'drains',profiles:READ,
      description:'Drains on the selected team: data kinds, destination host, projects, status, first error. No secrets; the contract has no last-delivery field.',
      inputSchema:schema({project:{type:'string',minLength:1,maxLength:128}}),
      annotations:{readOnlyHint:true}},
    {name:'vercel_webhook_list',writes:false,area:'webhooks',profiles:READ,
      description:'Account webhooks: URL host, events and projects. Signing secrets are never listed.',
      inputSchema:schema({project:{type:'string',minLength:1,maxLength:128}}),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_drain_list(args,ctx){
      strictArgs(args,['project'],'drain list');
      if(args.project!==undefined&&!safeText(args.project,128))
        throw new RefusalError('Project selector is unsafe');
      const {client}=await readProvider(ctx);
      const page=await client.request('drains_list',
        args.project?{query:{projectId:args.project}}:{});
      if(!page||!Array.isArray(page.drains))
        throw new RefusalError('Drain inventory was not recognized');
      const rows=page.drains.slice(0,100).map(shapeDrain);
      return output({drains:rows,shown:rows.length,
        providerRows:page.drains.length,truncated:page.drains.length>rows.length,
        note:'Delivery secrets and header values are never returned; the contract has no pagination and no last-delivery field'});
    },
    async vercel_webhook_list(args,ctx){
      strictArgs(args,['project'],'webhook list');
      if(args.project!==undefined&&!safeText(args.project,128))
        throw new RefusalError('Project selector is unsafe');
      const {client}=await readProvider(ctx);
      const page=await client.request('webhooks_list',
        args.project?{query:{projectId:args.project}}:{});
      if(!Array.isArray(page))
        throw new RefusalError('Webhook inventory was not recognized');
      const rows=page.slice(0,100).map(shapeWebhook);
      return output({webhooks:rows,shown:rows.length,
        providerRows:page.length,truncated:page.length>rows.length,
        note:'Signing secrets exist only in the create response and are never listed'});
    }
  }
};

/* ------------------------------- writes ------------------------------ */
function ctxFor({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    checkSpend:declaration=>declaration.cents===0?
      {allowed:true,code:'allowed',explanation:'No charge for this change'}:
      {allowed:false,code:'owner_required',explanation:'Owner purchase grant required'},
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const resultMapper=result=>({
  isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]
});
const flags={
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST_KEY.source}
};
function flagsCheck(args,props){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!Object.hasOwn(props,k))||
    (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
    (args.dryRun!==undefined&&typeof args.dryRun!=='boolean')||
    (args.requestKey!==undefined&&
      (typeof args.requestKey!=='string'||!REQUEST_KEY.test(args.requestKey))))
    throw new RefusalError('Invalid write request');
}
function httpDelivery(endpoint,encoding){
  return {type:'http',endpoint,encoding:encoding??'json',
    headers:{},compression:'none'};
}

/* drain create */
const createProps={
  name:{type:'string',minLength:1,maxLength:128},
  endpoint:{type:'string',maxLength:2048},
  encoding:{type:'string',enum:['json','ndjson']},
  sources:{type:'object'},
  projects:{type:'string',enum:['some','all']},
  projectIds:{type:'array',items:{type:'string'},maxItems:50},
  samplingRate:{type:'number',minimum:0,maximum:1},
  ...flags
};
const drainCreate=defineWrite({
  name:'vercel_drain_create',risk:{spend:true},
  async before(args,ctx){
    flagsCheck(args,createProps);
    if(!safeText(args.name,128))throw new RefusalError('Unsafe drain name');
    const dest=publicEndpoint(args.endpoint,'Drain');
    const schemas=schemasFrom(args.sources);
    const projects=args.projects??'all';
    if(projects==='some'&&(!Array.isArray(args.projectIds)||!args.projectIds.length||
      args.projectIds.some(id=>!safeText(id,128))))
      throw new RefusalError('Project-scoped drains need at least one valid project id');
    if(args.samplingRate!==undefined&&
      (typeof args.samplingRate!=='number'||args.samplingRate<0||args.samplingRate>1))
      throw new RefusalError('Sampling rate must be between 0 and 1');
    const body={name:args.name,projects,schemas,
      delivery:httpDelivery(dest.url,args.encoding),
      ...(projects==='some'?{projectIds:args.projectIds}:{}),
      ...(args.samplingRate!==undefined?
        {sampling:[{type:'head_sampling',rate:args.samplingRate}]}:{})};
    validateRequest('drains_create',{body});
    const {account}=await readProvider(ctx);
    return {name:args.name,host:dest.host,body,teamId:account.team_id,
      types:Object.keys(schemas),projects,
      projectIds:projects==='some'?args.projectIds:null};
  },
  async preview(_args,_ctx,before){
    return 'Create drain "'+before.name+'" sending '+
      before.types.join(', ')+' data to https://'+before.host+
      ' for '+(before.projects==='all'?'all projects':
        before.projectIds.length+' named project(s)')+
      '; delivery is billed per GB ('+PRICING+')'+
      '; the destination receives team data — confirm the host is yours'+
      '; header values and a delivery secret are not set by this tool (add them in the dashboard or via the universal write tool)';
  },
  async production(){
    return {production:false,
      why:'Drains move data out of the team; BATCH-B classes data leaving the team as a confirm step, not a production change'};
  },
  async spend(){
    return {cents:null,recurring:true,
      description:'Drain delivery is billed per GB of data delivered ('+PRICING+')'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.name}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId||
        ctx.connection?.profile==='read_only')
        throw new TypeError('Team authority changed');
    });
    return provider.write('drains_create',{body:before.body},
      {requestKey,tool:'vercel_drain_create',shapeResult:row=>{
        const shaped=shapeDrain(row);
        return {drainId:shaped.id,status:shaped.status};
      }});
  },
  async verify(_args,ctx,before,applied){
    const {client}=await readProvider(ctx);
    try{
      const row=await getDrain(client,applied.drainId);
      return {confirmed:row.id===applied.drainId,drainId:applied.drainId};
    }catch{return {confirmed:null,drainId:applied.drainId};}
  },
  async publicReceipt(_args,before,applied){
    return {drainId:applied.drainId,name:before.name,host:before.host};
  }
});

/* drain delete */
const deleteProps={id:{type:'string'},...flags};
const drainDelete=defineWrite({
  name:'vercel_drain_delete',
  async before(args,ctx){
    flagsCheck(args,deleteProps);
    if(typeof args.id!=='string'||!DRAIN_ID.test(args.id))
      throw new RefusalError('Invalid drain identifier');
    const {client,account}=await readProvider(ctx);
    const current=await getDrain(client,args.id);
    return {id:args.id,current,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Delete drain "'+(before.current.name??before.id)+'" ('+before.id+')'+
      ' sending '+(before.current.types.join(', ')||'no')+' data to '+
      (before.current.destination?.host??'an unknown host')+
      '; delivery stops immediately and the drain cannot be restored';
  },
  async production(){
    return {production:false,
      why:'Deleting a drain stops an outbound data flow; it changes no production resource'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.current.name??before.id}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
      const current=await provider.read('drains_get',{path:{id:before.id}})
        .catch(()=>null);
      if(current&&current.id!==before.id)
        throw new TypeError('Target drain changed after preview');
    });
    return provider.write('drains_delete',{path:{id:before.id}},
      {requestKey,tool:'vercel_drain_delete',shapeResult:()=>({drainId:before.id})});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    try{
      const row=await client.request('drains_get',{path:{id:before.id}});
      return {confirmed:!(row&&row.id===before.id),drainId:before.id};
    }catch(error){
      return {confirmed:error?.status===404?true:null,drainId:before.id};
    }
  },
  async publicReceipt(_args,before){
    return {drainId:before.id};
  }
});

/* drain update */
const updateProps={
  id:{type:'string'},
  status:{type:'string',enum:['enabled','disabled']},
  endpoint:{type:'string',maxLength:2048},
  encoding:{type:'string',enum:['json','ndjson']},
  sources:{type:'object'},
  projects:{type:'string',enum:['some','all']},
  projectIds:{type:'array',items:{type:'string'},maxItems:50},
  samplingRate:{type:'number',minimum:0,maximum:1},
  ...flags
};
const drainUpdate=defineWrite({
  name:'vercel_drain_update',
  async before(args,ctx){
    flagsCheck(args,updateProps);
    if(typeof args.id!=='string'||!DRAIN_ID.test(args.id))
      throw new RefusalError('Invalid drain identifier');
    const {client,account}=await readProvider(ctx);
    const current=await getDrain(client,args.id);
    const patch={};
    const changes=[];
    let widening=false;
    if(args.status!==undefined&&args.status!==current.status){
      patch.status=args.status;changes.push('status '+current.status+' -> '+args.status);
      if(args.status==='enabled')widening=true;
    }
    if(args.endpoint!==undefined){
      const dest=publicEndpoint(args.endpoint,'Drain');
      const oldHost=current.destination?.host??null;
      patch.delivery=httpDelivery(dest.url,args.encoding??current.destination?.encoding??'json');
      changes.push('destination '+(oldHost??'?')+' -> '+dest.host);
      if(dest.host!==oldHost)widening=true;
    }else if(args.encoding!==undefined&&current.destination?.type==='http'){
      throw new RefusalError('Encoding can only change together with a new endpoint in this tool');
    }
    if(args.sources!==undefined){
      const schemas=schemasFrom(args.sources);
      patch.schemas=schemas;
      const added=Object.keys(schemas).filter(k=>!current.types.includes(k));
      changes.push('data kinds '+current.types.join(', ')+' -> '+Object.keys(schemas).join(', '));
      if(added.length)widening=true;
    }
    if(args.projects!==undefined||args.projectIds!==undefined){
      const projects=args.projects??(args.projectIds?'some':undefined);
      if(projects==='some'){
        const ids=args.projectIds??current.projects??[];
        if(!ids.length||ids.some(id=>!safeText(id,128)))
          throw new RefusalError('Project-scoped drains need at least one valid project id');
        patch.projects='some';patch.projectIds=ids;
        // A null project list means the provider did not report the
        // scope: growth is provable only against a reported list.
        const grew=Array.isArray(current.projects)&&
          ids.some(id=>!current.projects.includes(id));
        changes.push('projects -> '+ids.length+' named project(s)'+
          (current.projects===null?' (previous scope unreported)':''));
        if(grew)widening=true;
      }else if(projects==='all'){
        patch.projects='all';changes.push('projects -> all projects');
        if(Array.isArray(current.projects))widening=true;
      }
    }
    if(args.samplingRate!==undefined){
      if(typeof args.samplingRate!=='number'||args.samplingRate<0||args.samplingRate>1)
        throw new RefusalError('Sampling rate must be between 0 and 1');
      patch.sampling=[{type:'head_sampling',rate:args.samplingRate}];
      const oldRate=current.sampling[0]?.rate??null;
      changes.push('sampling rate '+(oldRate??'unset')+' -> '+args.samplingRate);
      if(oldRate!==null&&args.samplingRate>oldRate)widening=true;
    }
    if(!Object.keys(patch).length)
      throw new RefusalError('Nothing to change: every named field already matches the drain');
    validateRequest('drains_update',{path:{id:args.id},body:patch});
    return {id:args.id,current,patch,changes,widening,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Update drain "'+(before.current.name??before.id)+'" ('+before.id+'): '+
      before.changes.join('; ')+
      (before.widening?
        '; THIS WIDENS what leaves the team — confirm class applies':
        '; this pauses or narrows the flow');
  },
  async production(){
    return {production:false,
      why:'Drain changes steer an outbound data flow; they change no production resource'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:before.current.name??before.id}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
    });
    return provider.write('drains_update',{path:{id:before.id},body:before.patch},
      {requestKey,tool:'vercel_drain_update',shapeResult:row=>{
        const shaped=shapeDrain(row);
        return {drainId:shaped.id,status:shaped.status};
      }});
  },
  async verify(_args,ctx,before,_applied){
    const {client}=await readProvider(ctx);
    try{
      const row=await getDrain(client,before.id);
      const statusOk=before.patch.status===undefined||row.status===before.patch.status;
      return {confirmed:row.id===before.id&&statusOk,drainId:before.id};
    }catch{return {confirmed:null,drainId:before.id};}
  },
  async publicReceipt(_args,before){
    return {drainId:before.id,changes:before.changes,widening:before.widening};
  }
});

/* drain test */
const testProps={
  endpoint:{type:'string',maxLength:2048},
  encoding:{type:'string',enum:['json','ndjson']},
  sources:{type:'object'},
  ...flags
};
const drainTest=defineWrite({
  name:'vercel_drain_test',
  async before(args,ctx){
    flagsCheck(args,testProps);
    const dest=publicEndpoint(args.endpoint,'Drain test');
    const schemas=schemasFrom(args.sources);
    const body={schemas,delivery:httpDelivery(dest.url,args.encoding)};
    validateRequest('drains_test',{body});
    const {account}=await readProvider(ctx);
    return {host:dest.host,body,teamId:account.team_id,types:Object.keys(schemas)};
  },
  async preview(_args,_ctx,before){
    return 'Send one test delivery of '+before.types.join(', ')+
      ' data to https://'+before.host+'; nothing is created';
  },
  async production(){
    return {production:false,why:'A test delivery creates and changes nothing'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:'drain test '+before.host}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    return provider.write('drains_test',{body:before.body},
      {requestKey,tool:'vercel_drain_test',shapeResult:row=>{
        if(!row||typeof row!=='object')return {delivered:false,error:'empty response'};
        return {delivered:!row.error,
          error:typeof row.error==='string'?row.error.slice(0,200):null,
          status:typeof row.status==='number'?row.status:null};
      }});
  },
  async verify(_args,_ctx,_before,applied){
    return {confirmed:applied.delivered===true,delivered:applied.delivered,
      error:applied.error};
  },
  async publicReceipt(_args,before,applied){
    return {host:before.host,delivered:applied.delivered,error:applied.error};
  }
});

/* webhook create */
let eventEnumCache=null;
function webhookEvents(){
  if(eventEnumCache)return eventEnumCache;
  try{
    const body=readOpenApi().paths?.['/v1/webhooks']?.post?.requestBody
      ?.content?.['application/json']?.schema;
    const events=body?.properties?.events?.items?.enum;
    eventEnumCache=Array.isArray(events)&&events.length?events:null;
  }catch{eventEnumCache=null;}
  return eventEnumCache;
}
const webhookCreateProps={
  url:{type:'string',maxLength:2048},
  events:{type:'array',items:{type:'string'},minItems:1,maxItems:50},
  projectIds:{type:'array',items:{type:'string'},maxItems:50},
  ...flags
};
const webhookCreate=defineWrite({
  name:'vercel_webhook_create',secretOut:true,oneTimeDelivery:true,
  async before(args,ctx){
    flagsCheck(args,webhookCreateProps);
    const dest=publicEndpoint(args.url,'Webhook');
    if(!Array.isArray(args.events)||!args.events.length||
      args.events.some(e=>!safeText(e,96)))
      throw new RefusalError('Webhook events must be a non-empty list of event names');
    const known=webhookEvents();
    if(known){
      const bad=args.events.filter(e=>!known.includes(e));
      if(bad.length)
        throw new RefusalError('Unknown webhook event: '+bad[0]+' (event names come from the pinned contract)');
    }
    if(args.projectIds!==undefined&&
      (!Array.isArray(args.projectIds)||args.projectIds.some(id=>!safeText(id,128))))
      throw new RefusalError('Unsafe webhook project list');
    const body={url:dest.url,events:args.events,
      ...(args.projectIds?{projectIds:args.projectIds}:{})};
    validateRequest('webhooks_create',{body});
    const {account}=await readProvider(ctx);
    return {host:dest.host,body,teamId:account.team_id,events:args.events};
  },
  async preview(_args,_ctx,before){
    return 'Create a webhook delivering '+before.events.length+
      ' event kind(s) to https://'+before.host+
      '; account webhooks require a Pro or Enterprise plan — if Vercel refuses on plan, that verdict is reported with the remedy'+
      '; the signing secret is shown once through vercel_reveal_one_time_secret and never in this result';
  },
  async production(){
    return {production:false,
      why:'A webhook subscription changes no production resource; it registers an outbound notification'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:'webhook '+before.host}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
    });
    let captured=null;
    const created=await provider.write('webhooks_create',{body:before.body},
      {requestKey,tool:'vercel_webhook_create',shapeResult:row=>{
        if(!row||typeof row.id!=='string'||typeof row.secret!=='string'||!row.secret)
          throw new TypeError('Provider did not return the webhook identity and signing secret');
        captured=row.secret;
        const shaped=shapeWebhook(row);
        return {webhookId:shaped.id,urlHost:shaped.urlHost};
      }});
    const receipt=await oneTimeSecrets({db:ctx.db,env:ctx.env}).issue({
      account:ctx.connection.account,kind:'webhook_signing_secret',
      label:'Webhook '+created.webhookId+' signing secret',value:captured});
    return {...created,ownerRevealRef:receipt.id,expiresAt:receipt.expiresAt};
  },
  async verify(_args,ctx,before,applied){
    const {client}=await readProvider(ctx);
    try{
      const row=await getWebhook(client,applied.webhookId);
      return {confirmed:row.id===applied.webhookId,
        webhookId:applied.webhookId,
        ownerRevealRef:applied.ownerRevealRef,expiresAt:applied.expiresAt};
    }catch{
      return {confirmed:null,webhookId:applied.webhookId,
        ownerRevealRef:applied.ownerRevealRef,expiresAt:applied.expiresAt};
    }
  },
  async publicReceipt(_args,before,applied){
    return {webhookId:applied.webhookId,urlHost:applied.urlHost,
      events:before.events.length};
  }
});

/* webhook delete */
const webhookDelete=defineWrite({
  name:'vercel_webhook_delete',
  async before(args,ctx){
    flagsCheck(args,deleteProps);
    if(typeof args.id!=='string'||!DRAIN_ID.test(args.id))
      throw new RefusalError('Invalid webhook identifier');
    const {client,account}=await readProvider(ctx);
    const current=await getWebhook(client,args.id);
    return {id:args.id,current,teamId:account.team_id};
  },
  async preview(_args,_ctx,before){
    return 'Delete webhook '+before.id+' delivering to '+
      (before.current.urlHost??'an unknown host')+' ('+
      before.current.eventCount+' event kind(s))'+
      '; receivers stop getting events immediately and the signing secret dies with it';
  },
  async production(){
    return {production:false,
      why:'Deleting a webhook stops an outbound notification; it changes no production resource'};
  },
  async targets(_args,before){
    return [{kind:'account',id:before.teamId,name:'webhook '+before.id}];
  },
  async apply(_args,ctx,before,requestKey){
    const provider=await writeProvider(ctx);
    await requirePreDispatch(async()=>{
      if(provider.account.team_id!==before.teamId)
        throw new TypeError('Team authority changed');
    });
    return provider.write('webhooks_delete',{path:{id:before.id}},
      {requestKey,tool:'vercel_webhook_delete',shapeResult:()=>({webhookId:before.id})});
  },
  async verify(_args,ctx,before){
    const {client}=await readProvider(ctx);
    try{
      const row=await client.request('webhooks_get',{path:{id:before.id}});
      return {confirmed:!(row&&row.id===before.id),webhookId:before.id};
    }catch(error){
      return {confirmed:error?.status===404?true:null,webhookId:before.id};
    }
  },
  async publicReceipt(_args,before){
    return {webhookId:before.id};
  }
});

export const drainsWebhooksWriteTools={
  tools:[
    {name:'vercel_drain_create',writes:true,guardedWrite:true,
      area:'drains',profiles:['full'],
      description:'Create an HTTP drain to a public HTTPS endpoint (metered per GB); other delivery types are list-visible only here — the universal write tool creates those.',
      inputSchema:{type:'object',properties:createProps,required:['name','endpoint'],additionalProperties:false},
      writeContract:drainCreate.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_drain_delete',writes:true,guardedWrite:true,
      area:'drains',profiles:['full'],
      description:'Delete a drain; delivery stops immediately and the drain cannot be restored.',
      inputSchema:{type:'object',properties:deleteProps,required:['id'],additionalProperties:false},
      writeContract:drainDelete.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
    {name:'vercel_drain_update',writes:true,guardedWrite:true,
      area:'drains',profiles:['full'],
      description:'Pause or resume a drain or change its destination, data kinds, projects or sampling; the preview is before/after and names widening.',
      inputSchema:{type:'object',properties:updateProps,required:['id'],additionalProperties:false},
      writeContract:drainUpdate.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_drain_test',writes:true,guardedWrite:true,
      area:'drains',profiles:['everyday','full'],
      description:'Send one test delivery to a public HTTPS endpoint; a failed delivery is reported as failed, nothing is created.',
      inputSchema:{type:'object',properties:testProps,required:['endpoint'],additionalProperties:false},
      writeContract:drainTest.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_webhook_create',writes:true,guardedWrite:true,
      area:'webhooks',profiles:['full'],
      description:'Create an account webhook (Pro/Enterprise); its signing secret is delivered once via vercel_reveal_one_time_secret, never in the result.',
      inputSchema:{type:'object',properties:webhookCreateProps,required:['url','events'],additionalProperties:false},
      writeContract:webhookCreate.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_webhook_delete',writes:true,guardedWrite:true,
      area:'webhooks',profiles:['full'],
      description:'Delete a webhook; receivers stop getting events immediately.',
      inputSchema:{type:'object',properties:deleteProps,required:['id'],additionalProperties:false},
      writeContract:webhookDelete.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}
  ],
  handlers:{
    vercel_drain_create:bindGuardedWrite(drainCreate,ctxFor,resultMapper),
    vercel_drain_delete:bindGuardedWrite(drainDelete,ctxFor,resultMapper),
    vercel_drain_update:bindGuardedWrite(drainUpdate,ctxFor,resultMapper),
    vercel_drain_test:bindGuardedWrite(drainTest,ctxFor,resultMapper),
    vercel_webhook_create:bindGuardedWrite(webhookCreate,ctxFor,resultMapper),
    vercel_webhook_delete:bindGuardedWrite(webhookDelete,ctxFor,resultMapper)
  }
};
