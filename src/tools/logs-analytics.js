// M-1: logs, observability and analytics (design BATCH-M M1; dossier
// batch-m-dossier-2026-10-30.md). The observability query endpoint's
// pinned contract documents its request body but leaves the 200
// response an untyped object, so reads shape defensively and say what
// the provider actually returned — rows are never invented, a cut
// page is reported as truncated, and promised fields the provider did
// not supply come back null beside a fieldsPresent list (dossier
// S-1/S-9). The analytics toggles are guarded writes: turning a
// product ON declares metered spend, OFF declares $0, and a provider
// refusal (e.g. the documented 402) classifies — the tool never
// pre-judges plan or billing verdicts (IN-18).
import {defineWrite,bindGuardedWrite,requirePreDispatch,RefusalError} from '../core/write.js';
import {compact,credentialLike} from '../core/util.js';
import {readProvider,writeProvider} from '../vercel/provider.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {validateRequest} from '../vercel/openapi-validation.js';

const READ=['read_only','everyday','full'];
const ID=/^prj_[A-Za-z0-9_-]{3,124}$/;
const REQUEST_KEY=/^[a-zA-Z0-9_-]{8,128}$/;
const METRIC=/^[a-z0-9][a-z0-9._-]{0,127}$/i;
const control=/[\x00-\x1f\x7f]/;
const RESULT_STORE_CAP=1048576;
const PRICING='https://vercel.com/pricing';
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
function windowOf(args,{def,max}){
  const minutes=args.windowMinutes??def;
  if(!Number.isSafeInteger(minutes)||minutes<1||minutes>max)
    throw new RefusalError('Window must be a whole number of minutes between 1 and '+max);
  const until=Date.now();
  return {minutes,start:until-minutes*60000,until};
}
async function resolveProject(client,idOrName){
  if(!safeText(idOrName,128))
    throw new RefusalError('Project selector is missing or unsafe');
  let row;
  try{
    row=await client.request('projects_get',{path:{idOrName}});
  }catch(error){
    if(error?.status===404)
      throw new RefusalError('Project was not found on the selected team');
    if(error?.status===403)
      throw new RefusalError('This credential cannot access that project');
    throw error;
  }
  if(!row||typeof row.id!=='string'||!ID.test(row.id))
    throw new RefusalError('Project identity could not be verified');
  return {id:row.id,name:safeText(row.name,128)?row.name:null};
}
// Provider rows are untrusted text: keep scalar values only, screen
// credential-shaped strings, bound every field.
function shapeRow(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const out={};
  for(const [key,value] of Object.entries(row).slice(0,24)){
    if(key.length>64||control.test(key))continue;
    if(typeof value==='string'){
      if(credentialLike(value))continue;
      out[key]=value.length>200?value.slice(0,200):value;
    }else if(typeof value==='number'&&Number.isFinite(value)||
      typeof value==='boolean'||value===null){
      out[key]=value;
    }
  }
  return out;
}
function rowsOf(page){
  if(Array.isArray(page))return page;
  if(!page||typeof page!=='object')return null;
  for(const key of ['data','rows','results','events']){
    if(Array.isArray(page[key]))return page[key];
  }
  return null;
}

/* --------------------------- logs query --------------------------- */
const queryProps={
  metric:{type:'string',minLength:1,maxLength:128},
  project:{type:'string',minLength:1,maxLength:128},
  filter:{type:'string',maxLength:2048},
  groupBy:{type:'array',items:{type:'string',maxLength:64},maxItems:5},
  aggregation:{type:'string',maxLength:128},
  limit:{type:'integer',minimum:1,maximum:50},
  windowMinutes:{type:'integer',minimum:1,maximum:10080}
};
async function runQuery(ctx,body){
  const {client}=await readProvider(ctx);
  return client.request('observability_query',{body});
}
async function queryScope(ctx,args){
  const {client,account}=await readProvider(ctx);
  if(args.project!==undefined){
    const project=await resolveProject(client,args.project);
    return {scope:{projectId:project.id},project};
  }
  if(!account?.team_id)throw new RefusalError('Selected team account required');
  return {scope:{ownerId:account.team_id},project:null};
}
function queryBody({metric,scope,window,limit,filter,groupBy,aggregation}){
  const body={metric,scope,
    startTime:new Date(window.start).toISOString(),
    endTime:new Date(window.until).toISOString(),limit};
  if(filter!==undefined)body.filter=filter;
  if(groupBy!==undefined)body.groupBy=groupBy;
  if(aggregation!==undefined)body.aggregation=aggregation;
  return body;
}

/* ------------------------- errors summary ------------------------- */
const ERRORS_METRIC='vercel.function_invocation.count';
function firstNumber(row,keys){
  for(const key of keys){
    if(typeof row?.[key]==='number'&&Number.isFinite(row[key]))return row[key];
  }
  return null;
}
function shapeErrorRow(row){
  const shaped=shapeRow(row)??{};
  const message=typeof shaped.message==='string'?shaped.message:
    typeof shaped.errorMessage==='string'?shaped.errorMessage:null;
  return {
    errorCode:typeof shaped.errorCode==='string'?shaped.errorCode:null,
    message,
    count:firstNumber(shaped,['count','value','invocations','total','sum']),
    firstSeen:shaped.firstSeen??shaped.first_seen??null,
    lastSeen:shaped.lastSeen??shaped.last_seen??null,
    exampleRequestId:shaped.exampleRequestId??shaped.requestId??
      shaped.sampleRequestId??null
  };
}

/* --------------------------- page views --------------------------- */
const DIMENSIONS=['hour','day','week','month','year','country','deviceType',
  'environment','requestPath','referrerHostname','osName','browserName',
  'route','utmSource','utmMedium','utmCampaign','utmContent','utmTerm','flags'];
const MEASURES=['pageviews','visitors','count','events','value','total'];
const pageviewProps={
  project:{type:'string',minLength:1,maxLength:128},
  by:{type:'array',items:{type:'string',enum:DIMENSIONS},minItems:1,maxItems:2},
  limit:{type:'integer',minimum:1,maximum:100},
  windowMinutes:{type:'integer',minimum:1,maximum:43200}
};

export const logsAnalyticsReadTools={
  tools:[
    {name:'vercel_logs_query',writes:false,area:'logs',profiles:READ,
      description:'Bounded observability query (requests, errors, durations) for one metric over a window; rows summarized, truncation stated.',
      inputSchema:schema(queryProps,['metric']),annotations:{readOnlyHint:true}},
    {name:'vercel_logs_errors_summary',writes:false,area:'logs',profiles:READ,
      description:'Top runtime errors for a project over a window; fields the provider did not return are null and named in fieldsPresent.',
      inputSchema:schema({
        project:{type:'string',minLength:1,maxLength:128},
        limit:{type:'integer',minimum:1,maximum:50},
        windowMinutes:{type:'integer',minimum:1,maximum:10080}},['project']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_analytics_pageviews',writes:false,area:'analytics',profiles:READ,
      description:'Web Analytics page views grouped by path, referrer, country, device or another documented dimension for a window.',
      inputSchema:schema(pageviewProps,['project']),annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_logs_query(args,ctx){
      strictArgs(args,Object.keys(queryProps),'logs query');
      if(!METRIC.test(args.metric??''))
        throw new RefusalError('Metric must be a documented observability metric id (see the metric names in the Query reference, e.g. vercel.request.count)');
      if(args.filter!==undefined&&!safeText(args.filter,2048))
        throw new RefusalError('Unsafe query filter');
      if(args.aggregation!==undefined&&!safeText(args.aggregation,128))
        throw new RefusalError('Unsafe aggregation');
      if(args.groupBy!==undefined&&
        (!Array.isArray(args.groupBy)||args.groupBy.some(g=>!safeText(g,64))))
        throw new RefusalError('Unsafe groupBy dimension');
      const limit=args.limit??50;
      const window=windowOf(args,{def:60,max:10080});
      const {scope,project}=await queryScope(ctx,args);
      const body=queryBody({metric:args.metric,scope,window,limit,
        filter:args.filter,groupBy:args.groupBy,aggregation:args.aggregation});
      validateRequest('observability_query',{body});
      const page=await runQuery(ctx,body);
      const raw=rowsOf(page);
      const base={metric:args.metric,scope,
        window:{startTime:body.startTime,endTime:body.endTime,minutes:window.minutes},
        project:project?{id:project.id,name:project.name}:null};
      if(raw===null){
        return output({...base,rows:[],rowCount:0,providerRows:null,truncated:false,
          shapeNote:'Provider returned no row array; top-level keys: '+
            (page&&typeof page==='object'?Object.keys(page).slice(0,12).join(', ')||'none':'none')});
      }
      const rows=raw.slice(0,limit).map(shapeRow).filter(Boolean);
      return output({...base,rows,rowCount:rows.length,providerRows:raw.length,
        truncated:raw.length>rows.length,
        note:'Rows carry scalar values only; nested provider objects are omitted'});
    },
    async vercel_logs_errors_summary(args,ctx){
      strictArgs(args,['project','limit','windowMinutes'],'errors summary');
      const limit=args.limit??10;
      const window=windowOf(args,{def:60,max:10080});
      const {client}=await readProvider(ctx);
      const project=await resolveProject(client,args.project);
      const body=queryBody({metric:ERRORS_METRIC,scope:{projectId:project.id},
        window,limit,filter:'errorCode:*',groupBy:['errorCode']});
      validateRequest('observability_query',{body});
      const page=await runQuery(ctx,body);
      const raw=rowsOf(page);
      const base={project:{id:project.id,name:project.name},
        window:{startTime:body.startTime,endTime:body.endTime,minutes:window.minutes}};
      if(raw===null){
        return output({...base,errors:[],rowCount:0,providerRows:null,truncated:false,
          fieldsPresent:[],
          shapeNote:'Provider returned no row array; no error fields could be read'});
      }
      const errors=raw.slice(0,limit).map(shapeErrorRow);
      errors.sort((a,b)=>(b.count??-1)-(a.count??-1));
      const fieldsPresent=['message','count','firstSeen','lastSeen','exampleRequestId']
        .filter(field=>errors.some(row=>row[field]!==null));
      return output({...base,errors,rowCount:errors.length,providerRows:raw.length,
        truncated:raw.length>errors.length,fieldsPresent,
        note:'Fields the provider rows did not carry are null; fieldsPresent names what was actually supplied'});
    },
    async vercel_analytics_pageviews(args,ctx){
      strictArgs(args,Object.keys(pageviewProps),'pageviews');
      if(!safeText(args.project,128))
        throw new RefusalError('Project selector is missing or unsafe');
      const by=args.by??['requestPath'];
      if(!Array.isArray(by)||by.some(d=>!DIMENSIONS.includes(d))||
        by.filter(d=>['hour','day','week','month','year'].includes(d)).length>1)
        throw new RefusalError('Dimensions must be 1-2 documented Web Analytics dimensions with at most one time dimension');
      const limit=args.limit??25;
      const window=windowOf(args,{def:10080,max:43200});
      const {client}=await readProvider(ctx);
      const query={projectId:args.project,by,since:window.start,until:window.until,limit};
      validateRequest('web_analytics_aggregate',{query});
      const page=await client.request('web_analytics_aggregate',{query});
      if(!page||!Array.isArray(page.data))
        throw new RefusalError('Web Analytics response was not recognized');
      const measures=new Set();
      const rows=page.data.slice(0,limit).map(row=>{
        const shaped=shapeRow(row)??{};
        const out={};
        for(const dim of DIMENSIONS)if(shaped[dim]!==undefined)out[dim]=shaped[dim];
        if(shaped.timestamp!==undefined)out.timestamp=shaped.timestamp;
        for(const measure of MEASURES){
          if(typeof shaped[measure]==='number'){out[measure]=shaped[measure];measures.add(measure);}
        }
        return out;
      });
      return output({project:args.project,by,
        window:{since:new Date(window.start).toISOString(),
          until:new Date(window.until).toISOString(),minutes:window.minutes},
        rows,rowCount:rows.length,measures:[...measures],
        note:'Groups beyond the limit fold into an Others row per the contract; measures names the numeric fields the provider returned'});
    }
  }
};

/* ------------------------------ toggles ------------------------------ */
function ctxFor({db,connection,env,fetchImpl}){
  return {db,connection,env,fetchImpl,shape:compact,
    audit:x=>db.recordChange(x),replayStore:db.requestReplayStore(),
    checkSpend:declaration=>declaration.cents===0?
      {allowed:true,code:'allowed',explanation:'Turning the product off: $0'}:
      {allowed:false,code:'owner_required',explanation:'Owner purchase grant required'},
    guardProtected:targets=>checkProtected(targets,{db,connection,env}),
    guardApp:targets=>checkApp(targets,{db,connection,env})};
}
const resultMapper=result=>({
  isError:['refused_by_guard','outcome_unknown'].includes(result.status),
  content:[{type:'text',text:JSON.stringify(result)}]
});
const toggleProps={
  project:{type:'string',minLength:1,maxLength:128},
  enabled:{type:'boolean'},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',pattern:REQUEST_KEY.source}
};
function makeToggle({name,op,label}){
  const write=defineWrite({
    name,risk:{spend:true},
    async before(args,ctx){
      if(!args||typeof args!=='object'||Array.isArray(args)||
        Object.keys(args).some(k=>!Object.hasOwn(toggleProps,k))||
        typeof args.enabled!=='boolean'||
        (args.confirm!==undefined&&typeof args.confirm!=='boolean')||
        (args.dryRun!==undefined&&typeof args.dryRun!=='boolean')||
        (args.requestKey!==undefined&&
          (typeof args.requestKey!=='string'||!REQUEST_KEY.test(args.requestKey))))
        throw new RefusalError('Invalid '+label+' toggle request');
      const {client}=await readProvider(ctx);
      const project=await resolveProject(client,args.project);
      validateRequest(op,{query:{projectId:project.id},body:{value:args.enabled}});
      return {projectId:project.id,projectName:project.name,enabled:args.enabled};
    },
    async preview(_args,_ctx,before){
      return (before.enabled?'Turn '+label+' ON':'Turn '+label+' OFF')+
        ' for project '+(before.projectName??before.projectId)+
        ' ('+before.projectId+')'+
        (before.enabled?
          '; usage beyond the plan\u2019s included events is billed — see '+PRICING:
          '; collection stops; no charge follows')+
        '; this changes data collection for the project, not its deployments or traffic';
    },
    async production(){
      return {production:false,
        why:'Analytics collection settings do not change deployments or production traffic'};
    },
    async spend(_args,_ctx,before){
      return before.enabled?
        {cents:null,recurring:true,
          description:label+' usage beyond included events is billed ('+PRICING+')'}:
        {cents:0,recurring:false,description:'Turning '+label+' off'};
    },
    async targets(_args,before){
      return [{kind:'project',id:before.projectId,name:before.projectName??before.projectId}];
    },
    async apply(_args,ctx,before,requestKey){
      const provider=await writeProvider(ctx);
      await requirePreDispatch(async()=>{
        if(ctx.connection?.profile==='read_only')
          throw new TypeError('Connection authority changed');
        const current=await provider.read('projects_get',{path:{idOrName:before.projectId}});
        if(current?.id!==before.projectId)
          throw new TypeError('Target project changed after preview');
      });
      return provider.write(op,{query:{projectId:before.projectId},
        body:{value:before.enabled}},{requestKey,tool:name,shapeResult:row=>{
          if(!row||row.value!==before.enabled)
            throw new TypeError('Provider did not confirm the '+label+' state');
          return {projectId:before.projectId,enabled:row.value};
        }});
    },
    async verify(_args,ctx,before,applied){
      // The toggle contract has no separate state read; the applied
      // value was provider-confirmed in apply's shape check, and the
      // project read-back proves the target still resolves.
      const {client}=await readProvider(ctx);
      try{
        const row=await client.request('projects_get',{path:{idOrName:before.projectId}});
        return {confirmed:row?.id===before.projectId?applied.enabled===before.enabled:null,
          projectId:before.projectId,enabled:applied.enabled};
      }catch{
        return {confirmed:null,projectId:before.projectId,enabled:applied.enabled};
      }
    },
    async publicReceipt(_args,before,applied){
      return {projectId:before.projectId,enabled:applied.enabled};
    }
  });
  return {write};
}
const webAnalytics=makeToggle({name:'vercel_analytics_set_web_analytics',
  op:'web_insights_toggle',label:'Web Analytics'});
const speedInsights=makeToggle({name:'vercel_analytics_set_speed_insights',
  op:'speed_insights_toggle',label:'Speed Insights'});
export const analyticsToggleTools={
  tools:[
    {name:'vercel_analytics_set_web_analytics',writes:true,guardedWrite:true,
      area:'analytics',profiles:['full'],
      description:'Turn Web Analytics on or off for a project; turning it on is metered beyond included events, preview links pricing.',
      inputSchema:{type:'object',properties:toggleProps,required:['project','enabled'],additionalProperties:false},
      writeContract:webAnalytics.write.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
    {name:'vercel_analytics_set_speed_insights',writes:true,guardedWrite:true,
      area:'analytics',profiles:['full'],
      description:'Turn Speed Insights on or off for a project; turning it on may be billed, preview links pricing.',
      inputSchema:{type:'object',properties:toggleProps,required:['project','enabled'],additionalProperties:false},
      writeContract:speedInsights.write.writeContract,
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}}
  ],
  handlers:{
    vercel_analytics_set_web_analytics:bindGuardedWrite(webAnalytics.write,ctxFor,resultMapper),
    vercel_analytics_set_speed_insights:bindGuardedWrite(speedInsights.write,ctxFor,resultMapper)
  }
};
