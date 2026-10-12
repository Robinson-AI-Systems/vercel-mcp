// D-1c: bounded Git integration discovery via stored credentials only.
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';
import {verifyGitNamespace} from './git-identity.js';
const PROFILES=['read_only','everyday','full'];
const PROVIDERS=['github','gitlab','bitbucket'];
const safeText=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
const objSchema=properties=>({type:'object',properties,additionalProperties:false});
function preflight(args,keys){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!keys.includes(k)))throw new TypeError('Invalid Git discovery request');
  if(!PROVIDERS.includes(args.provider))throw new TypeError('Select a supported Git provider');
}
// Never echo raw credential-bearing provider links or unbounded names.
const safeLabel=(s,max=201)=>typeof s==='string'&&s.length<=max&&
  !/[\x00-\x1f\x7f]/.test(s)&&!credentialLike(s)?s:null;
// Link projection is not a repository-identity proof. Reject a provider's
// misleading off-provider host rather than handing an agent a phishing URL.
const GIT_HOSTS=Object.freeze({github:'github.com',gitlab:'gitlab.com',bitbucket:'bitbucket.org'});
function safeRepoUrl(value,provider){
  if(typeof value!=='string'||value.length>1024||credentialLike(value))return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||
      url.search||url.hash||url.hostname!==GIT_HOSTS[provider])return null;
    return url.toString();
  }catch{return null;}
}
async function verifyNamespace(client,provider,namespaceId){
  const namespaces=await client.request('git_namespaces',{query:{provider}});
  verifyGitNamespace(namespaces,provider,namespaceId);
}

function namespaceSummary(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Malformed Git namespace');
  return {id:typeof row.id==='string'?safeLabel(row.id,128):
      Number.isSafeInteger(row.id)&&row.id>=0?row.id:null,
    name:safeLabel(row.name),slug:safeLabel(row.slug),
    provider:PROVIDERS.includes(row.provider)?row.provider:null,
    ownerType:safeLabel(row.ownerType,40),
    accessRestricted:row.isAccessRestricted===true || row.isAccessRestricted==='true',
    requiresReauthentication:row.requireReauth===true || row.requireReauth==='true'};
}
function repoSummary(row,provider){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Malformed Git repository');
  return {id:Number.isSafeInteger(row.id)&&row.id>=0?row.id:safeLabel(row.id,128),
    name:safeLabel(row.name),fullName:safeLabel(row.fullName??row.slug),
    url:safeRepoUrl(row.url??row.html_url,provider),private:typeof row.private==='boolean'?row.private:null,
    defaultBranch:safeLabel(row.defaultBranch??row.default_branch,128)};
}
const page=rows=>({count:rows.length,returned:Math.min(rows.length,100),
  capped:rows.length>100});
export const gitTools={
  tools:[
    {name:'vercel_git_list_namespaces',writes:false,profiles:PROFILES,area:'git',
      description:'List safe Git namespace metadata accessible to the stored team connection.',
      inputSchema:{...objSchema({provider:{type:'string',enum:PROVIDERS}}),required:['provider']},
      annotations:{readOnlyHint:true}},
    {name:'vercel_git_search_repos',writes:false,profiles:PROFILES,area:'git',
      description:'Search linked Git repositories in a chosen namespace using the stored Vercel connection.',
      inputSchema:{...objSchema({
        provider:{type:'string',enum:PROVIDERS},
        namespaceId:{type:'string',minLength:1,maxLength:128},
        query:{type:'string',minLength:1,maxLength:120}
      }),required:['provider','namespaceId','query']},
      annotations:{readOnlyHint:true}}
  ],
  handlers:{
    async vercel_git_list_namespaces(args,ctx){
      preflight(args,['provider']);
      const {client,account}=await readProvider(ctx);
      if(account.scope==='project')throw new TypeError('Git namespaces require a team-scoped credential');
      const raw=await client.request('git_namespaces',{query:{provider:args.provider}});
      if(!Array.isArray(raw))throw new TypeError('Unexpected Git namespace response');
      return safeText({...page(raw),namespaces:raw.slice(0,100).map(namespaceSummary)});
    },
    async vercel_git_search_repos(args,ctx){
      preflight(args,['provider','namespaceId','query']);
      if(typeof args.namespaceId!=='string'||!/^[-_a-zA-Z0-9]{1,128}$/.test(args.namespaceId)||
        typeof args.query!=='string'||args.query.trim().length<1||args.query.length>120)
        throw new TypeError('Invalid Git repository search');
      const {client,account}=await readProvider(ctx);
      if(account.scope==='project')throw new TypeError('Repository enumeration requires a team-scoped credential');
      await verifyNamespace(client,args.provider,args.namespaceId);
      const raw=await client.request('git_repos_search',{query:{
        provider:args.provider,namespaceId:args.namespaceId,query:args.query
      }});
      const list=Array.isArray(raw)?raw:Array.isArray(raw?.repositories)?raw.repositories:
        Array.isArray(raw?.repos)?raw.repos:null;
      if(!Array.isArray(list))throw new TypeError('Unexpected Git repository response');
      return safeText({...page(list),repositories:list.slice(0,100).map(row=>repoSummary(row,args.provider))});
    }
  }
};
