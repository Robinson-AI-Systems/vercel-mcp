// First audited universal read family. Unknown resource contracts fail closed.
// New families must prove identity, safe outputs and pinned transport in tests.
import {validateRequest} from './openapi-validation.js';
import {apiOperation} from './openapi-index.js';
import {secretOperation} from './secret-operations.js';
import {handBuiltReads} from './hand-built-map.js';
import {credentialLike} from '../core/util.js';
import {readProvider} from './provider.js';
import {projectFor} from '../tools/deployments.js';
const ALLOWED=new Set(['listFlags','listFlagsV2','getFlag','listFlagVersions',
  'getFlagSettings','listFlagSegments','getFlagSegment','listTeamFlagsV2','getDeploymentFeatureFlags']);
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function inputs(args){
  if(!plain(args)||Object.keys(args).some(k=>!['op','params'].includes(k)))
    throw new TypeError('Invalid documented read request');
  const row=apiOperation(args.op);
  if(!['GET','HEAD'].includes(row.method))throw new TypeError('API read cannot mutate');
  if(secretOperation(row))throw new TypeError('Credential operation refused; use a secret-safe hand-built workflow');
  if(handBuiltReads[row.op])throw new TypeError('Use '+handBuiltReads[row.op]+' for the curated read contract');
  if(!ALLOWED.has(row.op))throw new TypeError('Documented operation needs an audited scope and output policy before execution');
  const params=args.params;
  if(!plain(params)||Object.keys(params).some(k=>!['path','query'].includes(k))||
    !plain(params.path)||params.query!==undefined&&!plain(params.query))
    throw new TypeError('Only documented path and query parameters are accepted');
  for(const value of Object.values(params.path))if(typeof value!=='string'||!IDENT.test(value)||credentialLike(value))
    throw new TypeError('Unsafe resource identifier');
  const query={...params.query};
  if(Object.hasOwn(query,'teamId')||Object.hasOwn(query,'slug'))throw new TypeError('Team authority comes from the stored account');
  function inspect(value,depth=0){
    if(depth>3)throw new TypeError('Query is too deeply nested');
    if(typeof value==='string'&&(value.length>256||credentialLike(value)||/[\x00-\x1f\x7f]/.test(value)))
      throw new TypeError('Unsafe query text');
    if(Array.isArray(value)){if(value.length>20)throw new TypeError('Too many query values');value.forEach(x=>inspect(x,depth+1));}
    else if(value!==null&&typeof value==='object')throw new TypeError('Query objects are not supported');
  }
  Object.values(query).forEach(v=>inspect(v));
  if(query.limit!==undefined&&(!Number.isInteger(query.limit)||query.limit<1||query.limit>20))
    throw new TypeError('Universal read page limit must be 1 through 20');
  if(row.op==='listTeamFlagsV2'){
    if(Object.keys(params.path).length)throw new TypeError('Team flag inventory has no project path override');
    query.limit??=5;
    if(!Number.isInteger(query.limit)||query.limit>5)
      throw new TypeError('Team-wide flag pages are limited to five independently verified projects');
  }else if(['listFlags','listFlagsV2','listFlagVersions'].includes(row.op))query.limit??=20;
  return {row,params:{path:{...params.path},query}};
}
const FIELDS=['id','key','slug','name','description','state','type','status','createdAt','updatedAt',
  'projectId','teamId','version','enabled'];
function scalar(value){
  if(typeof value==='string')return value.length<=256&&!/[\x00-\x1f\x7f]/.test(value)&&!credentialLike(value)?value:null;
  return typeof value==='boolean'||Number.isSafeInteger(value)?value:null;
}
function projection(value,project,teamId){
  if(!plain(value))throw new TypeError('Invalid documented resource metadata');
  if(value.projectId!==undefined&&value.projectId!==project||value.teamId!==undefined&&value.teamId!==teamId)
    throw new TypeError('Provider returned an out-of-scope resource');
  return Object.fromEntries(FIELDS.filter(k=>Object.hasOwn(value,k)).map(k=>[k,scalar(value[k])]));
}
// A Vercel flag list exposes an opaque continuation; never reflect arbitrary
// pagination objects, and never infer completeness from a missing cursor.
const PAGED=new Set(['listFlags','listFlagsV2','listFlagVersions','listTeamFlagsV2']);
function page(reply,op){
  if(!PAGED.has(op)||!Object.hasOwn(reply,'pagination'))return {};
  const pagination=reply.pagination;
  if(!plain(pagination))throw new TypeError('Malformed provider flag pagination');
  const next=pagination.next;
  if(next!==null&&next!==undefined&&(typeof next!=='string'||next.length<1||
    next.length>256||/[\x00-\x1f\x7f]/.test(next)||credentialLike(next)))
    throw new TypeError('Unsafe provider pagination cursor');
  return {pagination:{next:typeof next==='string'?next:null,
    completeness:'provider_cursor_only'}};
}
function shape(reply,project,teamId,op){
  if(Array.isArray(reply))return {items:reply.slice(0,20).map(x=>projection(x,project,teamId)),
    capped:reply.length>20,completeness:'unverified_provider_page'};
  if(!plain(reply))throw new TypeError('Unrecognized documented read response');
  const base=projection(reply,project,teamId);
  for(const field of ['flags','segments','versions','items','data'])if(Array.isArray(reply[field]))
    base[field]=reply[field].slice(0,20).map(x=>projection(x,project,teamId));
  const lists=Object.values(reply).filter(Array.isArray);
  return {...base,...page(reply,op),capped:lists.some(x=>x.length>20),completeness:'unverified_provider_page',
    note:'Audited metadata fields only; values, targeting rules, identities and arbitrary provider output withheld'};
}
// Team-wide flags can only be shown to an authenticated team/full connection.
// Individually verify every referenced project with an independent project GET.
// A team permission alone must not make fabricated provider project IDs safe.
async function teamFlagPage(reply,client,account){
  if(!plain(reply)||!Array.isArray(reply.data)||reply.data.length>5||
    !plain(reply.pagination))throw new TypeError('Unrecognized bounded team flag page');
  const ids=new Set();
  for(const row of reply.data){
    if(!plain(row)||typeof row.projectId!=='string'||!IDENT.test(row.projectId)||
      row.teamId!==undefined&&row.teamId!==account.team_id)
      throw new TypeError('Provider team flag project identity is unverified');
    ids.add(row.projectId);
  }
  // At most five distinct project proofs; avoid unbounded API fanout.
  const proofs=await Promise.all([...ids].map(id=>client.request('projects_get',
    {path:{idOrName:id}},{timeoutMs:5000})));
  for(const [i,id] of [...ids].entries()){
    if(proofs[i]?.id!==id||proofs[i]?.accountId!==account.team_id)
      throw new TypeError('Team flag references an unverified or foreign project');
  }
  return {data:reply.data.map(row=>projection(row,row.projectId,account.team_id)),
    ...page(reply,'listTeamFlagsV2'),capped:false,completeness:'unverified_provider_page',
    note:'Team-scoped provider flag metadata only; all returned projects separately verified; targeting and values withheld'};
}
// Deployment flag values and targeting are never returned. Correlate the
// deployment status only after separately verifying a project-key connection,
// exact deployment identity and the provider's project assignment.
async function deploymentFlags(params,client,account){
  if(account.scope!=='project')throw new TypeError('Deployment flags require an exact project connection');
  const project=projectFor({},account);
  const deployment=params.path.deploymentId;
  if(typeof deployment!=='string'||!/^dpl_[A-Za-z0-9_-]{3,120}$/.test(deployment))
    throw new TypeError('Select an exact deployment ID');
  const current=await client.request('deployments_get',
    {path:{idOrUrl:deployment}},{timeoutMs:5000});
  if(!plain(current)||(current.uid!==undefined&&current.uid!==deployment)||
    (current.id!==undefined&&current.id!==deployment)||
    current.uid===undefined&&current.id===undefined||
    current.projectId!==undefined&&current.projectId!==project||
    current.project?.id!==undefined&&current.project.id!==project||
    current.projectId===undefined&&current.project?.id===undefined)
    throw new TypeError('Deployment and selected project identity could not be verified');
  const reply=await client.request('api:getDeploymentFeatureFlags',params,{timeoutMs:5000});
  if(!plain(reply)||!Array.isArray(reply.flags)||reply.flags.length>100||
    !plain(reply.status)||reply.status.deploymentId!==deployment||
    reply.status.projectId!==project)
    throw new TypeError('Deployment flag status identity or bound is unverified');
  return {projectId:project,deploymentId:deployment,observedFlags:reply.flags.length,
    reportedFlagCount:Number.isSafeInteger(reply.status.flagCount)&&reply.status.flagCount>=0?
      reply.status.flagCount:null,
    completeness:'unverified_provider_page',
    note:'Metadata counts only; deployment flag values, variations and targeting withheld'};
}
export async function apiRead(args,ctx){
  const {row,params}=inputs(args);
  validateRequest('api:'+row.op,{...params,
    // Indexed team inventory uses a path teamId, always supplied by the server.
    path:row.op==='listTeamFlagsV2'?{teamId:'team_FAKE_validation'}:params.path,
    query:row.op==='listTeamFlagsV2'?params.query:
      {...params.query,teamId:'team_FAKE_validation'}});
  const {client,account}=await readProvider(ctx);
  if(row.op==='getDeploymentFeatureFlags')return deploymentFlags(params,client,account);
  if(row.op==='listTeamFlagsV2'){
    if(!['team','full'].includes(account.scope))
      throw new TypeError('Team flag inventory requires an owner-reviewed team connection');
    const reply=await client.request('api:'+row.op,{path:{teamId:account.team_id},query:params.query},{timeoutMs:5000});
    return teamFlagPage(reply,client,account);
  }
  const project=projectFor({project:params.path.projectIdOrName},account);
  if(params.path.projectIdOrName!==project)throw new TypeError('Exact project ID is required');
  const current=await client.request('projects_get',{path:{idOrName:project}});
  if(current?.id!==project||current.accountId!==undefined&&current.accountId!==account.team_id)
    throw new TypeError('Project identity and selected team could not be verified');
  const reply=await client.request('api:'+row.op,params,{timeoutMs:5000});
  return shape(reply,project,account.team_id,row.op);
}
