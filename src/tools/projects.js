// D-1a: small, explicitly selected project metadata only; no provider writes.
import {readProvider} from '../vercel/provider.js';
const PROFILES=['read_only','everyday','full'];
const schema=properties=>({type:'object',properties,additionalProperties:false});
const asText=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
function checkArgs(args,allowed){
  if(!args || typeof args!=='object' || Array.isArray(args) ||
    Object.keys(args).some(key=>!allowed.includes(key)))
    throw new TypeError('Invalid project read arguments');
}
export function projectSummary(row){
  if(!row || typeof row!=='object' || Array.isArray(row))throw new TypeError('Invalid project response');
  return {
    id:row.id,name:row.name,framework:row.framework??null,
    productionUrl:row.productionUrl??row.alias?.[0]??null,
    gitRepo:row.link?.repo??null,productionBranch:row.link?.productionBranch??null,
    paused:row.pauseStatus?.status==='PAUSED' || row.paused===true,
    nodeVersion:row.nodeVersion??null
  };
}
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
      if(!Array.isArray(reply?.projects))throw new TypeError('Invalid projects page');
      return asText({projects:reply.projects.map(projectSummary),count:reply.projects.length,
        next:reply.pagination?.next??null,
        nextStep:reply.pagination?.next!=null?'Call vercel_project_list again with until set to the next numeric cursor':null});
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
      if(!Array.isArray(reply?.members))throw new TypeError('Invalid project member response');
      return asText({
        project:args.project,count:reply.members.length,
        members:reply.members.map(m=>({
          id:m.uid??m.userId??m.id??null,email:m.email??null,
          name:m.name??null,role:m.role??null,createdAt:m.createdAt??null
        })),next:reply.pagination?.next??null
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
        buildCommand:row.buildCommand??null,installCommand:row.installCommand??null,
        devCommand:row.devCommand??null,outputDirectory:row.outputDirectory??null,
        rootDirectory:row.rootDirectory??null,
        lastProductionAt:row.latestProductionDeployments?.[0]?.createdAt??null,
        domainsCount:Array.isArray(row.domains)?row.domains.length:null,
        cronsCount:Array.isArray(row.crons)?row.crons.length:null});
    }
  }
};
