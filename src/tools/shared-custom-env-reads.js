// E-2 read-only provider metadata, never variable values.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';
const profiles=['read_only','everyday','full'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const ENV=/^env_[A-Za-z0-9_-]{3,124}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TARGETS=new Set(['production','preview','development']);
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const output=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function argsOk(args,allowed){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!allowed.includes(k))||
    args.project!==undefined&&!ID.test(args.project)||
    args.next!==undefined&&(!Number.isSafeInteger(args.next)||args.next<1))
    throw new TypeError('Invalid selected environment request');
}
const date=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const safe=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max&&
  !credentialLike(v)&&!/[\x00-\x1f\x7f]/.test(v)?v:null;
async function scoped(ctx,project,teamOnly=false){
  const {client,account}=await readProvider(ctx);
  if(teamOnly&&!['team','full'].includes(account.scope))
    throw new TypeError('Team scope is required');
  if(project){
    if(account.scope==='project'&&account.project_id!==project)
      throw new TypeError('Project outside selected connection');
    const row=await client.request('projects_get',{path:{idOrName:project}});
    if(row?.id!==project||row.accountId!=null&&row.accountId!==account.team_id)
      throw new TypeError('Provider project identity is unverified');
  }
  return {client,account};
}
function shared(raw,team){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    !ENV.test(raw.id??'')||!KEY.test(raw.key??'')||
    raw.ownerId!=null&&raw.ownerId!==team)
    throw new TypeError('Shared variable identity could not be verified');
  const links=typeof raw.projectId==='string'?[raw.projectId]:
    raw.projectId??raw.projectIds??[];
  if(!Array.isArray(links)||links.length>50||
    links.some(x=>!ID.test(x))||new Set(links).size!==links.length)
    throw new TypeError('Unsafe shared variable project links');
  const target=typeof raw.target==='string'?[raw.target]:raw.target??[];
  if(!Array.isArray(target)||target.length>16||
    target.some(x=>!TARGETS.has(x))||new Set(target).size!==target.length)
    throw new TypeError('Unsafe shared variable target metadata');
  return {id:raw.id,key:raw.key,kind:raw.visibility==='secret'||
    raw.type!=='plain'?'Secret':'Config',
    projects:links,target,updatedAt:date(raw.updatedAt)};
}
function cursor(page){
  const v=page?.pagination?.next;
  if(v===undefined)return {next:null,verified:false};
  if(v===null)return {next:null,verified:true};
  const n=typeof v==='string'&&/^[1-9][0-9]{0,15}$/.test(v)?Number(v):v;
  if(!Number.isSafeInteger(n)||n<=0)throw new TypeError('Unknown provider cursor');
  return {next:n,verified:true};
}
function custom(raw,project){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    raw.projectId!=null&&raw.projectId!==project||
    !ENV.test(raw.id??'')||!SLUG.test(raw.slug??'')||
    !['production','preview','development'].includes(raw.type))
    throw new TypeError('Invalid custom environment identity');
  let matcher=null;
  if(raw.branchMatcher!=null){
    const m=raw.branchMatcher;
    if(!m||typeof m!=='object'||Array.isArray(m)||
      !['equals','startsWith','endsWith'].includes(m.type)||
      typeof m.pattern!=='string'||m.pattern.length>128||
      !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(m.pattern)||
      m.pattern.includes('..')||credentialLike(m.pattern))
      throw new TypeError('Invalid custom environment branch pattern');
    matcher={type:m.type,pattern:m.pattern};
  }
  if(raw.domains!==undefined&&(!Array.isArray(raw.domains)||raw.domains.length>100))
    throw new TypeError('Unsafe custom environment domain inventory');
  return {id:raw.id,slug:raw.slug,type:raw.type,
    description:safe(raw.description,200),
    branchMatcher:matcher,createdAt:date(raw.createdAt),
    updatedAt:date(raw.updatedAt),domainCount:raw.domains?.length??null};
}
export const sharedCustomEnvReadTools={
  tools:[
    {name:'vercel_shared_env_list',writes:false,profiles,area:'env',
      description:'Bounded selected-team shared variable names and links, never values.',
      inputSchema:schema({project:{type:'string',pattern:ID.source},
        next:{type:'integer',minimum:1}}),annotations:{readOnlyHint:true}},
    {name:'vercel_environment_list',writes:false,profiles,area:'env',
      description:'Project-bound custom environments, safe branch metadata and domain counts.',
      inputSchema:schema({project:{type:'string',pattern:ID.source}},['project']),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_shared_env_list(args,ctx){
      argsOk(args,['project','next']);
      const {client,account}=await scoped(ctx,args.project,true);
      const page=await client.request('shared_env_list',{query:{
        ...(args.project?{projectId:args.project}:{}),
        ...(args.next?{next:args.next}:{})}});
      if(!Array.isArray(page?.data)||page.data.length>100)
        throw new TypeError('Shared variable provider page is unavailable');
      const seen=new Set(),data=page.data.map(raw=>{
        const row=shared(raw,account.team_id);
        if(seen.has(row.id)||args.project&&!row.projects.includes(args.project))
          throw new TypeError('Duplicate or out-of-scope shared variable');
        seen.add(row.id);return row;
      }),p=cursor(page),capped=data.length>20;
      return output({selectedTeam:true,project:args.project??null,
        items:data.slice(0,20),shown:Math.min(20,data.length),
        next:capped?null:p.next,complete:!capped&&p.verified&&p.next===null,
        capped,hasValues:false,hasDigests:false,
        note:'Names and links only; page completeness unverified when capped'});
    },
    async vercel_environment_list(args,ctx){
      argsOk(args,['project']);
      if(!args.project)throw new TypeError('Exact project required');
      const {client}=await scoped(ctx,args.project);
      const page=await client.request('custom_environments_list',
        {path:{idOrName:args.project}});
      const data=Array.isArray(page)?page:page?.environments;
      if(!Array.isArray(data)||data.length>100)
        throw new TypeError('Custom environment provider page unavailable');
      const ids=new Set(),slugs=new Set();
      const rows=data.map(raw=>{
        const row=custom(raw,args.project);
        if(ids.has(row.id)||slugs.has(row.slug))
          throw new TypeError('Duplicate custom environment');
        ids.add(row.id);slugs.add(row.slug);return row;
      });
      return output({project:args.project,items:rows.slice(0,20),
        shown:Math.min(20,rows.length),capped:rows.length>20,
        complete:false,hasValues:false,hasDigests:false,
        note:'Bounded view; provider completeness unverified'});
    }
  }
};
