// One provider-identity proof shared by Git discovery and paid Git imports.
// All input originates from authenticated, scoped Vercel GETs; never reflect
// raw objects or provider secrets into tool outputs or write audits.
export function verifyGitNamespace(rows,provider,namespaceId){
  if(!Array.isArray(rows)||rows.length>500)
    throw new TypeError('Git namespace inventory is not verifiable');
  const matches=rows.filter(row=>row&&typeof row==='object'&&
    String(row.id)===namespaceId&&row.provider===provider);
  if(matches.length!==1||matches[0].isAccessRestricted===true||
    matches[0].isAccessRestricted==='true'||
    matches[0].requireReauth===true||matches[0].requireReauth==='true')
    throw new TypeError('Git namespace is inaccessible or ambiguous');
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
    throw new TypeError('Git search account identity is unverified');
}

export function verifyExactGitRepository(response,{repo,provider,namespaceId}) {
  verifyGitSearchAccount(response,provider,namespaceId);
  const rows=Array.isArray(response)?response:
    Array.isArray(response?.repos)?response.repos:
    Array.isArray(response?.repositories)?response.repositories:null;
  if(!Array.isArray(rows)||rows.length>500)
    throw new TypeError('Git repository search cannot be verified');
  const matches=rows.filter(row=>row&&typeof row==='object'&&
    // A canonical fullName, if supplied, takes precedence over the slug.
    // A matching stale/attacker-controlled alias must not override it.
    (typeof row.fullName==='string'?row.fullName===repo:row.slug===repo));
  if(matches.length!==1)
    throw new TypeError('Git repository identity is absent or ambiguous');
  const row=matches[0];
  if((row.provider!==undefined&&row.provider!==provider)||
    (row.namespaceId!==undefined&&String(row.namespaceId)!==namespaceId)||
    row.isAccessRestricted===true||row.isAccessRestricted==='true'||
    row.requireReauth===true||row.requireReauth==='true')
    throw new TypeError('Git repository does not match the authorized namespace');
  return {repo,provider,namespaceId};
}
