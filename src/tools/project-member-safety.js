// Fully enumerated member views for access-changing project operations.
// Bound at the caller to its stored team/project; never accept caller team IDs.
// At most 5 pages of 100, with repeated-cursor/identity and incomplete-page denial.
const OPERATIONS=new Set(['projects_members_list','teams_members_list']);
export async function completeMembers(client,operationId,path){
  if(!OPERATIONS.has(operationId))throw new TypeError('Unsupported member inventory');
  const members=[],identities=new Set(),cursors=new Set();
  let until;
  for(let pageNo=0;pageNo<5;pageNo++){
    const reply=await client.request(operationId,{
      path,query:{limit:100,...(until===undefined?{}:{until})}
    });
    if(!Array.isArray(reply?.members)||reply.members.length>100||
       !reply.pagination||reply.pagination.hasMore===true)
      throw new TypeError('Cannot prove complete member inventory');
    for(const item of reply.members){
      const uid=item?.uid??item?.userId??item?.id;
      // uid and userId are alternate representations of the Vercel user UID.
      // A separate item.id may be a membership-row identifier; do not compare it.
      if(item?.uid!=null&&item?.userId!=null&&item.uid!==item.userId)
        throw new TypeError('Conflicting project or team member user IDs');
      if(typeof uid!=='string'||!uid||identities.has(uid))
        throw new TypeError('Ambiguous or duplicate member identity');
      identities.add(uid);members.push(item);
    }
    const next=reply.pagination.next;
    if(next===null){
      if(reply.pagination.hasNext===true)
        throw new TypeError('Conflicting member pagination flags');
      return members;
    }
    if(!Number.isSafeInteger(next)||next<1||
       reply.pagination.hasNext===false||cursors.has(next))
      throw new TypeError('Invalid or repeated member cursor');
    cursors.add(next);until=next;
  }
  throw new TypeError('Member inventory exceeds safe five-page bound');
}

// Project grants and revocations require an existing, confirmed team
// contributor: never invite a paid seat or treat MCP confirmation as owner auth.
export async function verifyEligibleTeamMember(client,teamId,uid){
  const members=await completeMembers(client,'teams_members_list',{teamId});
  const matches=members.filter(row=>row.uid===uid);
  if(matches.length!==1||matches[0].confirmed!==true||
    matches[0].role!=='CONTRIBUTOR')
    throw new TypeError('A confirmed team contributor UID is required');
}
