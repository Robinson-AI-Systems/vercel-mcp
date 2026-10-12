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
function projectFor(args,account){
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
export const deploymentReadTools={
  tools:[
    {name:'vercel_deploy_list',writes:false,profiles:PROFILES,area:'deployments',
      description:'List up to 20 safe deployment summaries for an exact project with a continuation cursor.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        limit:{type:'integer',minimum:1,maximum:20},
        until:{type:'integer',minimum:1}}),annotations:{readOnlyHint:true}},
    {name:'vercel_deploy_get',writes:false,profiles:PROFILES,area:'deployments',
      description:'Read one deployment by ID or HTTPS hostname, independently verifying the project.',
      inputSchema:schema({project:{type:'string',maxLength:128},
        deployment:{type:'string',minLength:3,maxLength:253}},['deployment']),
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_deploy_list(args,ctx){
      validateArgs(args,['project','limit','until']);
      const limit=args.limit??20;
      if(!Number.isInteger(limit)||limit<1||limit>20||
        args.until!==undefined&&(!Number.isSafeInteger(args.until)||args.until<=0))
        throw new TypeError('Invalid deployment page');
      const {client,account}=await readProvider(ctx);
      const project=projectFor(args,account);
      const reply=await client.request('deployments_list',{
        query:{projectId:project,limit,...(args.until?{until:args.until}:{})}});
      if(!Array.isArray(reply?.deployments))
        throw new TypeError('Provider did not return deployment inventory');
      const next=cursorFor(reply,reply.deployments,limit);
      const seen=new Set();
      const deployments=reply.deployments.map(row=>{
        const safe=summary(row,project);
        if(seen.has(safe.id))throw new TypeError('Duplicate deployment identity');
        seen.add(safe.id);
        return safe;
      });
      return asText({project,deployments,count:deployments.length,
        next,complete:next===null,
        nextStep:next===null?null:'Call vercel_deploy_list with this project and until='+next});
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
