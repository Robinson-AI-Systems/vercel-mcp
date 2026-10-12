// D-1a: small, explicitly selected project metadata only; no provider writes.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';
const PROFILES=['read_only','everyday','full'];
const schema=properties=>({type:'object',properties,additionalProperties:false});
const asText=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
function checkArgs(args,allowed){
  if(!args || typeof args!=='object' || Array.isArray(args) ||
    Object.keys(args).some(key=>!allowed.includes(key)))
    throw new TypeError('Invalid project read arguments');
}
// A returned cursor must be callable with the public integer input schema.
// Never silently claim end-of-list when the provider's cursor is malformed.
function pageCursor(reply,rows,limit){
  if(!Array.isArray(rows)||rows.length>limit||!reply?.pagination)
    throw new TypeError('Project list page is incomplete or oversized');
  const next=reply.pagination.next;
  if(next===null){
    if(reply.pagination.hasNext===true||reply.pagination.hasMore===true)
      throw new TypeError('Conflicting list pagination flags');
    return null;
  }
  if(reply.pagination.hasNext===false||reply.pagination.hasMore===false)
    throw new TypeError('Conflicting list continuation');
  const numeric=typeof next==='string'&&/^[1-9][0-9]{0,15}$/.test(next)?Number(next):next;
  if(!Number.isSafeInteger(numeric)||numeric<1)
    throw new TypeError('Provider returned an unusable pagination cursor');
  return numeric;
}
const safeMemberText=(value,max=320)=>typeof value==='string'&&value.length<=max&&
  !/[\x00-\x1f\x7f]/.test(value)&&!credentialLike(value)?value:null;
// Project list fields share the same strict projection as detailed reads.
// Provider-returned aliases may be arbitrary URLs; never reflect credentials,
// query strings, fragments or control characters in a read result.
const safeProjectText=(value,max=256)=>typeof value==='string'&&value.length<=max&&
  !/[\x00-\x1f\x7f]/.test(value)&&
  !credentialLike(value)?value:null;
function safeHostname(value){
  if(typeof value!=='string'||credentialLike(value)||value.length>253||/[/?#@:\s\\]/.test(value)||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value))return null;
  return value;
}
// A missing or conflicting pause flag is unknown, never 'not paused'.
// The project APIs can supply status and boolean fields independently.
function verifiedPaused(row){
  const status=row?.pauseStatus?.status;
  const flag=typeof row?.paused==='boolean'?row.paused:null;
  if(status!==undefined&&status!==null){
    if(status!=='PAUSED'&&status!=='UNPAUSED')return null;
    const paused=status==='PAUSED';
    return flag!==null&&flag!==paused?null:paused;
  }
  return flag;
}
export function projectSummary(row){
  if(!row || typeof row!=='object' || Array.isArray(row))throw new TypeError('Invalid project response');
  const alias=row.productionUrl??row.alias?.[0]?.alias??row.alias?.[0];
  return {
    id:safeProjectText(row.id,128),name:safeProjectText(row.name,128),
    framework:safeProjectText(row.framework,100),productionUrl:safeHostname(alias),
    gitRepo:safeProjectText(row.link?.repo,201),
    productionBranch:safeProjectText(row.link?.productionBranch,128),
    paused:verifiedPaused(row),
    nodeVersion:safeProjectText(row.nodeVersion,32)
  };
}
// Full project detail exposes only explicitly selected, bounded metadata. Do not
// reflect arbitrary provider objects or URLs that can contain a credential.
const textField=safeProjectText;
const projectVersion=row=>({
  id:textField(row?.id,128),state:textField(row?.readyState??row?.state,40),
  createdAt:Number.isSafeInteger(row?.createdAt)?row.createdAt:null,
  target:row?.target==='production'?'production':null
});
const resourceView=raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const keys=['buildMachineType','buildMachine','buildCommand','maxConcurrentBuilds',
    'functionDefaultMemoryType','functionDefaultTimeout','fluid',
    'defaultRegions','elasticConcurrencyEnabled'];
  const view={};
  for(const key of keys){
    const value=raw[key];
    if(typeof value==='boolean'||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)||
      (typeof value==='string'&&textField(value,100)!==null))view[key]=value;
    else if(key==='defaultRegions'&&Array.isArray(value))
      view[key]=value.slice(0,12).filter(x=>textField(x,50)!==null);
  }
  return view;
};
export const projectsTools={
  tools:[
    {name:'vercel_project_list',writes:false,profiles:PROFILES,area:'projects',
      description:'List project summaries from the authenticated team, with a bounded page and next cursor.',
      inputSchema:schema({limit:{type:'integer',minimum:1,maximum:100},until:{type:'integer',minimum:1}}),
      annotations:{readOnlyHint:true}},
    {name:'vercel_project_get',writes:false,profiles:PROFILES,area:'projects',
      description:'Read safe project settings, Git linkage, build commands and production status by ID or name.',
      inputSchema:{...schema({project:{type:'string',minLength:1,maxLength:128}}),required:['project']},
      annotations:{readOnlyHint:true}},
    {name:'vercel_project_list_members',writes:false,profiles:PROFILES,area:'projects',
      description:'List project members and roles in an authenticated, project-scoped page without secrets.',
      inputSchema:{...schema({project:{type:'string',minLength:1,maxLength:128},
        limit:{type:'integer',minimum:1,maximum:100},until:{type:'integer',minimum:1}}),
        required:['project']},annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_project_list(args,ctx){
      checkArgs(args,['limit','until']);
      if(args.until!==undefined && (!Number.isSafeInteger(args.until) || args.until<1))
        throw new TypeError('Invalid project pagination cursor');
      if(args.limit!==undefined && (!Number.isInteger(args.limit)||args.limit<1||args.limit>100))
        throw new TypeError('Invalid project limit');
      const {client,account}=await readProvider(ctx);
      if(account.scope==='project'){
        if(args.until!==undefined)throw new TypeError('A project-scoped connection has no team cursor');
        const project=await client.request('projects_get',{path:{idOrName:account.project_id}});
        if(project.id!==account.project_id)throw new TypeError('Scoped project did not match');
        return asText({projects:[projectSummary(project)],count:1,next:null});
      }
      const reply=await client.request('projects_list',{query:{limit:args.limit??20,...(args.until?{until:args.until}:{})}});
      const next=pageCursor(reply,reply?.projects,args.limit??20);
      return asText({projects:reply.projects.map(projectSummary),count:reply.projects.length,
        next,complete:next===null,
        nextStep:next!==null?'Call vercel_project_list with until='+next+' to continue':null});
    },
    async vercel_project_list_members(args,ctx){
      checkArgs(args,['project','limit','until']);
      if(typeof args.project!=='string'||!idPattern.test(args.project)||
        (args.limit!==undefined && (!Number.isInteger(args.limit)||args.limit<1||args.limit>100))||
        (args.until!==undefined && (!Number.isSafeInteger(args.until)||args.until<1)))
        throw new TypeError('Invalid project member query');
      const {client,account}=await readProvider(ctx);
      if(account.scope==='project' && args.project!==account.project_id)
        throw new TypeError('Project members not available to this connection');
      const reply=await client.request('projects_members_list',{
        path:{idOrName:args.project},
        query:{limit:args.limit??20,...(args.until?{until:args.until}:{})}});
      const next=pageCursor(reply,reply?.members,args.limit??20);
      if(reply.members.some(m=>!m||typeof m!=='object'||Array.isArray(m)))
        throw new TypeError('Malformed member record');
      return asText({
        project:args.project,count:reply.members.length,
        members:reply.members.map(m=>({
          id:safeMemberText(m.uid??m.userId??m.id,128),
          email:safeMemberText(m.email),
          name:safeMemberText(m.name,256),role:safeMemberText(m.role,64),
          createdAt:Number.isSafeInteger(m.createdAt)?m.createdAt:null
        })),next,complete:next===null,
        nextStep:next!==null?'Call vercel_project_list_members with this project and until='+next:null
      });
    },
    async vercel_project_get(args,ctx){
      checkArgs(args,['project']);
      if(typeof args.project!=='string' || !idPattern.test(args.project))
        throw new TypeError('Invalid project identifier');
      const {client,account}=await readProvider(ctx);
      if(account.scope==='project' && args.project!==account.project_id)
        throw new TypeError('This connection is restricted to a different project');
      const row=await client.request('projects_get',{path:{idOrName:args.project}});
      if(!row || typeof row.id!=='string' ||
        (account.scope==='project' && row.id!==account.project_id))
        throw new TypeError('Requested project not available in this connection');
      return asText({...projectSummary(row),
        buildCommand:textField(row.buildCommand),installCommand:textField(row.installCommand),
        devCommand:textField(row.devCommand),outputDirectory:textField(row.outputDirectory),
        rootDirectory:textField(row.rootDirectory),
        lastProductionAt:Number.isSafeInteger(row.latestProductionDeployments?.[0]?.createdAt)?
          row.latestProductionDeployments[0].createdAt:null,
        domainsCount:Array.isArray(row.domains)?row.domains.length:null,
        cronsCount:Array.isArray(row.crons?.definitions)?row.crons.definitions.length:null,
        ignoreBuildStep:textField(row.commandForIgnoringBuildStep),
        // The Vercel SDK/project body may omit these fields; null is unknown.
        hasDeployments:typeof row.hasDeployments==='boolean'?row.hasDeployments:null,
        pauseState:verifiedPaused(row)===null?null:verifiedPaused(row)?'PAUSED':'UNPAUSED',
        git:row.link&&typeof row.link==='object'?{
          type:textField(row.link.type,40),
          repo:textField(row.link.repo,201),
          productionBranch:textField(row.link.productionBranch,128)
        }:null,
        resourceConfig:resourceView(row.resourceConfig),
        latestProduction: Array.isArray(row.latestProductionDeployments)?
          row.latestProductionDeployments.slice(0,5).map(projectVersion):null});
    }
  }
};
