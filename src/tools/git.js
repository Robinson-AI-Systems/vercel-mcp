// D-1c: bounded Git integration discovery via stored credentials only.
import {readProvider} from '../vercel/provider.js';
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
  !/[\x00-\x1f\x7f]/.test(s)?s:null;
function safeRepoUrl(value){
  if(typeof value!=='string'||value.length>1024)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||
      url.search||url.hash||!url.hostname||url.hostname==='localhost')return null;
    return url.toString();
  }catch{return null;}
}
async function verifyNamespace(client,provider,namespaceId){
  const namespaces=await client.request('git_namespaces',{query:{provider}});
  if(!Array.isArray(namespaces)||namespaces.length>500)
    throw new TypeError('Cannot verify Git namespace identity');
  const matches=namespaces.filter(row=>String(row?.id)===namespaceId&&row.provider===provider);
  if(matches.length!==1||matches[0].isAccessRestricted===true||
    matches[0].isAccessRestricted==='true'||
    matches[0].requireReauth===true||matches[0].requireReauth==='true')
    throw new TypeError('Git namespace is not available through this credential');
}
function namespaceSummary(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Malformed Git namespace');
  return {id:row.id??null,name:safeLabel(row.name),slug:safeLabel(row.slug),
    provider:row.provider??null,ownerType:row.ownerType??null,
    accessRestricted:row.isAccessRestricted===true || row.isAccessRestricted==='true',
    requiresReauthentication:row.requireReauth===true || row.requireReauth==='true'};
}
function repoSummary(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new TypeError('Malformed Git repository');
  return {id:Number.isSafeInteger(row.id)||typeof row.id==='string'&&row.id.length<=128?row.id:null,
    name:safeLabel(row.name),fullName:safeLabel(row.fullName??row.slug),
    url:safeRepoUrl(row.url??row.html_url),private:typeof row.private==='boolean'?row.private:null,
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
      return safeText({...page(list),repositories:list.slice(0,100).map(repoSummary)});
    }
  }
};
