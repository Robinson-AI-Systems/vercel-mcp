// E-1: project-scoped environment variable METADATA only. Secret values never leave.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';

const PROFILES=['read_only','everyday','full'];
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const BRANCH=/^[A-Za-z0-9_.\/-]{1,128}$/;
const TARGETS=new Set(['production','preview','development']);
const response=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const input=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
function assert(args,keys){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!keys.includes(k)))
    throw new TypeError('Invalid environment metadata request');
  if(args.project!==undefined&&(typeof args.project!=='string'||!PROJECT.test(args.project)))
    throw new TypeError('Invalid project selector');
  if(args.target!==undefined&&!TARGETS.has(args.target))
    throw new TypeError('Invalid target');
  if(args.gitBranch!==undefined&&(typeof args.gitBranch!=='string'||
      !BRANCH.test(args.gitBranch)))
    throw new TypeError('Invalid preview branch');
  if(args.gitBranch!==undefined&&args.target!==undefined&&args.target!=='preview')
    throw new TypeError('Git branch filters require preview target');
}
const safe=value=>typeof value==='string'&&value.length<=128&&
 !/[\x00-\x1f\x7f]/.test(value)&&!credentialLike(value)?value:null;
function countTime(v){return Number.isSafeInteger(v)&&v>=0?v:null;}
function metadata(row,project){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     typeof row.id!=='string'||!ID.test(row.id)||
     typeof row.key!=='string'||!KEY.test(row.key)||
     (row.projectId!==undefined&&row.projectId!==project))
    throw new TypeError('Environment variable identity or owner could not be verified');
  if(row.value!==undefined && typeof row.value!=='string' &&
     row.value!==null && typeof row.value!=='object')
    throw new TypeError('Malformed environment provider value envelope');
  if(row.target!==undefined&&!Array.isArray(row.target))
    throw new TypeError('Malformed environment targets');
  const target=row.target??[];
  if(target.length>32||new Set(target).size!==target.length||
    target.some(x=>typeof x!=='string'||x.length>128||
      !/^[A-Za-z0-9_-]+$/.test(x)))
    throw new TypeError('Malformed environment target inventory');
  if(row.customEnvironmentIds!==undefined&&row.customEnvironmentIds!==null&&
     !Array.isArray(row.customEnvironmentIds))
    throw new TypeError('Malformed custom environment links');
  const custom=(row.customEnvironmentIds??[]);
  if(custom.length>32||new Set(custom).size!==custom.length||
    custom.some(x=>typeof x!=='string'||!ID.test(x)))
    throw new TypeError('Malformed custom environment identities');
  const branch=row.gitBranch==null?null:safe(row.gitBranch);
  if(row.gitBranch!=null&&branch===null)throw new TypeError('Invalid returned Git branch');
  const kind=row.visibility==='secret'||row.type!=='plain'?'Secret':'Config';
  return {id:row.id,key:row.key,kind,
    targets:target,gitBranch:branch,customEnvironmentIds:custom,
    createdAt:countTime(row.createdAt),updatedAt:countTime(row.updatedAt)};
}
async function projectScope(ctx,args){
  const {client,account}=await readProvider(ctx);
  if(!account||!['team','full','project'].includes(account.scope))
    throw new TypeError('Stored project authority is missing');
  let project;
  if(account.scope==='project'){
    project=account.project_id;
    if(args.project!==undefined&&args.project!==project)
      throw new TypeError('Requested project exceeds connection scope');
  }else{
    project=args.project;
    if(!project||!PROJECT.test(project))
      throw new TypeError('Exact project identifier required');
  }
  const p=await client.request('projects_get',{path:{idOrName:project}});
  if(p?.id!==project)throw new TypeError('Project identity could not be verified');
  return {client,project};
}
async function inventory(ctx,args){
  const {client,project}=await projectScope(ctx,args);
  // Explicitly disable decrypt even for legacy encrypted variables. The raw
  // provider response is ephemeral and never directly serialized to the caller.
  const data=await client.request('project_env_list',{path:{idOrName:project},
    query:{decrypt:'false',...(args.gitBranch?{gitBranch:args.gitBranch}:{})}});
  if(!Array.isArray(data?.envs))throw new TypeError('Provider has no env inventory');
  if(data.envs.length>500)throw new TypeError('Provider env inventory exceeds safe metadata bound');
  const seenIds=new Set(),seenKeys=new Set();
  const all=data.envs.map(row=>{
    const item=metadata(row,project),tag=item.key+'|'+item.gitBranch+'|'+item.targets.join(',');
    if(seenIds.has(item.id)||seenKeys.has(tag))
      throw new TypeError('Duplicate environment metadata identity');
    seenIds.add(item.id);seenKeys.add(tag);return item;
  });
  const scoped=args.target?all.filter(row=>row.targets.includes(args.target)):all;
  return {project,items:scoped.slice(0,100),scanned:data.envs.length,
    returned:Math.min(100,scoped.length),capped:scoped.length>100,
    completeness:'unverified_provider_page',hasValues:false};
}
export const projectEnvReadTools={
  tools:[
    {name:'vercel_env_list',writes:false,area:'env',profiles:PROFILES,
      description:'List project environment key names, targets, kind and dates; no environment values.',
      inputSchema:input({project:{type:'string',maxLength:128},
        target:{type:'string',enum:['production','preview','development']},
        gitBranch:{type:'string',maxLength:128}}),
      annotations:{readOnlyHint:true}},
    {name:'vercel_env_get',writes:false,area:'env',profiles:PROFILES,
      description:'Read a project environment variable metadata record by exact ID; never its value.',
      inputSchema:input({project:{type:'string',maxLength:128},
        id:{type:'string',minLength:1,maxLength:128}},['id']),
      annotations:{readOnlyHint:true}},
    {name:'vercel_env_export_names',writes:false,area:'env',profiles:PROFILES,
      description:'Export bounded safe .env.example key placeholders for one project/target; no values.',
      inputSchema:input({project:{type:'string',maxLength:128},
        target:{type:'string',enum:['production','preview','development']},
        gitBranch:{type:'string',maxLength:128}}),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_env_list(args,ctx){
      assert(args,['project','target','gitBranch']);
      return response(await inventory(ctx,args));
    },
    async vercel_env_get(args,ctx){
      assert(args,['project','id']);
      if(typeof args.id!=='string'||!ID.test(args.id))
        throw new TypeError('Invalid environment ID');
      const {client,project}=await projectScope(ctx,args);
      const row=await client.request('project_env_get',{path:{idOrName:project,id:args.id}});
      const item=metadata(row,project);
      if(item.id!==args.id)throw new TypeError('Returned environment identity differs from request');
      return response({project,item,hasValues:false});
    },
    async vercel_env_export_names(args,ctx){
      assert(args,['project','target','gitBranch']);
      const x=await inventory(ctx,args);
      const names=[...new Set(x.items.map(row=>row.key))].sort();
      return response({project:x.project,target:args.target??null,gitBranch:args.gitBranch??null,
        example:names.map(key=>key+'=').join('\\n'),names,
        hasValues:false,complete:false,capped:x.capped,
        note:'Names only. Values are intentionally omitted; provider page completeness has not been proven.'});
    }
  }
};
