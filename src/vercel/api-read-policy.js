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
  'getFlagSettings','listFlagSegments','getFlagSegment']);
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
  if(['listFlags','listFlagsV2','listFlagVersions'].includes(row.op))query.limit??=20;
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
function shape(reply,project,teamId){
  if(Array.isArray(reply))return {items:reply.slice(0,20).map(x=>projection(x,project,teamId)),
    capped:reply.length>20,completeness:'unverified_provider_page'};
  if(!plain(reply))throw new TypeError('Unrecognized documented read response');
  const base=projection(reply,project,teamId);
  for(const field of ['flags','segments','versions','items','data'])if(Array.isArray(reply[field]))
    base[field]=reply[field].slice(0,20).map(x=>projection(x,project,teamId));
  const lists=Object.values(reply).filter(Array.isArray);
  return {...base,capped:lists.some(x=>x.length>20),completeness:'unverified_provider_page',
    note:'Audited metadata fields only; values, targeting rules, identities and arbitrary provider output withheld'};
}
export async function apiRead(args,ctx){
  const {row,params}=inputs(args);
  validateRequest('api:'+row.op,{...params,query:{...params.query,teamId:'team_FAKE_validation'}});
  const {client,account}=await readProvider(ctx);
  const project=projectFor({project:params.path.projectIdOrName},account);
  if(params.path.projectIdOrName!==project)throw new TypeError('Exact project ID is required');
  const current=await client.request('projects_get',{path:{idOrName:project}});
  if(current?.id!==project||current.accountId!==undefined&&current.accountId!==account.team_id)
    throw new TypeError('Project identity and selected team could not be verified');
  const reply=await client.request('api:'+row.op,params,{timeoutMs:5000});
  return shape(reply,project,account.team_id);
}
