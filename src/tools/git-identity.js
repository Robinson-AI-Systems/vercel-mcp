// One provider-identity proof shared by Git discovery and paid Git imports.
// All input originates from authenticated, scoped Vercel GETs; never reflect
// raw objects or provider secrets into tool outputs or write audits.
import { RefusalError } from '../core/write.js';
export function verifyGitNamespace(rows,provider,namespaceId){
  if(!Array.isArray(rows)||rows.length>500)
    throw new RefusalError('Git namespace inventory is not verifiable');
  const matches=rows.filter(row=>row&&typeof row==='object'&&
    String(row.id)===namespaceId&&row.provider===provider);
  if(matches.length!==1||matches[0].isAccessRestricted===true||
    matches[0].isAccessRestricted==='true'||
    matches[0].requireReauth===true||matches[0].requireReauth==='true')
    throw new RefusalError('Git namespace is inaccessible or ambiguous');
  return {id:namespaceId,provider};
}

// The search endpoint's object response authenticates the provider at the root,
// not on every row. Share this proof between read discovery and paid imports.
export function verifyGitSearchAccount(response,provider,namespaceId){
  if(Array.isArray(response))return;
  const identity=response?.gitAccount;
  if(!identity||typeof identity!=='object'||Array.isArray(identity)||
    identity.provider!==provider||!Object.hasOwn(identity,'namespaceId')||
    (identity.namespaceId!==null&&
      !(typeof identity.namespaceId==='string'||
        (typeof identity.namespaceId==='number'&&Number.isSafeInteger(identity.namespaceId))))||
    (identity.namespaceId!==null&&String(identity.namespaceId)!==namespaceId))
    throw new RefusalError('Git search account identity is unverified');
}

// The pinned contract documents no fullName field on a search row: a
// row's name is the bare repository name (fields `name` and `slug`)
// inside the namespace the search was scoped to — the caller proves
// that namespace via verifyGitNamespace and the root proof above
// binds the response to it. `repo` is the requested "owner/name";
// its bare name is the identity within that namespace.
function repositoryRowMatches(row,repo,repoName){
  // A canonical fullName, if supplied, takes precedence over the slug.
  // A matching stale/attacker-controlled alias must not override it:
  // a supplied fullName that names anything else — qualified or bare —
  // is a contradiction and the row cannot match.
  if(typeof row.fullName==='string')
    return row.fullName===repo||row.fullName===repoName;
  // Documented shape: the slug carries the bare name (a legacy
  // full-path slug also identifies the repo), and the documented
  // `name` field, when present, must agree with it.
  return (row.slug===repoName||row.slug===repo)&&
    (typeof row.name!=='string'||row.name===repoName);
}

export function verifyExactGitRepository(response,{repo,provider,namespaceId}) {
  verifyGitSearchAccount(response,provider,namespaceId);
  const rows=Array.isArray(response)?response:
    Array.isArray(response?.repos)?response.repos:
    Array.isArray(response?.repositories)?response.repositories:null;
  if(!Array.isArray(rows)||rows.length>500)
    throw new RefusalError('Git repository search cannot be verified');
  const repoName=repo.slice(repo.lastIndexOf('/')+1);
  const matches=rows.filter(row=>row&&typeof row==='object'&&
    repositoryRowMatches(row,repo,repoName));
  if(matches.length!==1)
    throw new RefusalError('Git repository identity is absent or ambiguous');
  const row=matches[0];
  if((row.provider!==undefined&&row.provider!==provider)||
    (row.namespaceId!==undefined&&String(row.namespaceId)!==namespaceId)||
    row.isAccessRestricted===true||row.isAccessRestricted==='true'||
    row.requireReauth===true||row.requireReauth==='true')
    throw new RefusalError('Git repository does not match the authorized namespace');
  return {repo,provider,namespaceId};
}
