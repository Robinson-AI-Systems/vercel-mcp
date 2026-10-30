// D-4: canonical, deliberately bounded release/alias identity proofs.
import {readProvider} from '../vercel/provider.js';
import { RefusalError } from '../core/write.js';
import {credentialLike} from '../core/util.js';
import {projectFor,scopedDeployment} from './deployments.js';
export const PROJECT=/^prj_[A-Za-z0-9_-]{3,124}$/;
export const DEPLOY=/^dpl_[A-Za-z0-9_-]{3,124}$/;
export const ALIAS=/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
export const ALIASID=/^[A-Za-z0-9_-]{3,128}$/;
const RUN_STATES=new Set(['READY']);
export const schema=(properties,required=[])=>({
  type:'object',properties,required,additionalProperties:false
});
export const respond=value=>({
  content:[{type:'text',text:JSON.stringify(value)}]
});
export function exactArgs(a,keys){
  if(!a||typeof a!=='object'||Array.isArray(a)||
    Object.keys(a).some(key=>!keys.includes(key)))
    throw new RefusalError('Unsupported production release selector');
}
export function safeAlias(value){
  if(typeof value!=='string'||value.length>253||!ALIAS.test(value)||
    value.includes('..')||credentialLike(value))throw new RefusalError('Unsafe alias domain');
  return value;
}
export function safeDeployment(value){
  if(!DEPLOY.test(value??''))throw new TypeError('An exact deployment ID is required');
  return value;
}
export async function projectContext(args,ctx){
  const {client,account}=await readProvider(ctx);
  const project=projectFor(args,account);
  if(!PROJECT.test(project??''))throw new RefusalError('Exact project ID required');
  const raw=await client.request('projects_get',{path:{idOrName:project}});
  if(raw?.id!==project||raw?.accountId!==account.team_id||
    account.scope==='project'&&account.project_id!==project)
    throw new RefusalError('Cannot prove selected project and team ownership');
  // P-1: the project name rides along so write targets can name the
  // project for the profile guard (profiles key on names; IDs are
  // setup-page data).
  return {client,account,project,
    projectName:typeof raw.name==='string'?raw.name:null};
}
export function releaseAliases(reply,project){
  const rows=reply?.aliases??reply?.data??(Array.isArray(reply)?reply:null);
  if(!Array.isArray(rows)||rows.length>100)
    throw new RefusalError('Production alias inventory missing or too large');
  const pagination=reply?.pagination;
  const complete=Boolean(pagination&&pagination.next===null&&
    pagination.hasNext!==true&&pagination.hasMore!==true);
  if(!complete)throw new RefusalError('Production aliases are not fully enumerated');
  const seen=new Set();
  const result=rows.map(r=>{
    const domain=safeAlias(r?.alias??r?.domain??r?.name);
    if(r?.projectId!==project||seen.has(domain))
      throw new RefusalError('Alias has unknown owner or duplicate mapping');
    seen.add(domain);
    const deployment=r?.deploymentId??r?.deployment?.id??r?.deployment?.uid;
    if(!DEPLOY.test(deployment??''))
      throw new RefusalError('Alias lacks exact serving deployment');
    return {domain,deployment,id:ALIASID.test(r?.uid??r?.id??'')?
      r.uid??r.id:null};
  });
  return result;
}
export async function ownedAliases(ctx,project){
  const reply=await ctx.client.request('release_aliases_list',
    {query:{projectId:project,limit:100}});
  return releaseAliases(reply,project);
}
export function currentDeployment(aliases){
  if(aliases.length===0)
    throw new RefusalError('No production domain routing proven');
  const ids=new Set(aliases.map(x=>x.deployment));
  if(ids.size!==1)
    throw new RefusalError('Production aliases have inconsistent serving revisions');
  return aliases[0].deployment;
}
export async function targetDeployment(ctx,project,deployment){
  const info=await scopedDeployment({project,deployment},ctx);
  if(info.project!==project||info.account.team_id!==ctx.account?.team_id&&
    ctx.account?.team_id!==undefined)
    throw new RefusalError('Deployment no longer belongs to connected team');
  if(info.verified.state!=='READY'||info.verified.target!=='production')
    throw new RefusalError('Only READY production builds may be promoted or restored');
  const raw=await info.client.request('deployments_get',
    {path:{idOrUrl:deployment}});
  if((raw?.uid??raw?.id)!==deployment||raw.projectId!==project||
    raw.target!=='production'||!RUN_STATES.has(raw.readyState??raw.state))
    throw new RefusalError('Target deployment metadata changed');
  return {id:deployment,createdAt:info.verified.createdAt,
    servedAt:Number.isSafeInteger(raw.aliasAssigned)?raw.aliasAssigned:
      Number.isSafeInteger(raw.promotedAt)?raw.promotedAt:null,
    commit:info.verified.commit};
}
export function sameRoute(a,b){
  return a.project===b.project&&a.current===b.current&&a.target===b.target&&
    a.teamId===b.teamId&&a.mode===b.mode&&
    JSON.stringify(a.aliases)===JSON.stringify(b.aliases);
}
