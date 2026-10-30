// Fully enumerated member views for access-changing project operations.
// Bound at the caller to its stored team/project; never accept caller team IDs.
// At most 5 pages of 100, with repeated-cursor/identity and incomplete-page denial.
// A membership-record id is not proof of a Vercel user UID. Every access
// decision must use the stable uid/userId aliases, never the row id.
import { RefusalError } from '../core/write.js';
export function verifiedUserUid(row){
  if(!row||typeof row!=='object'||Array.isArray(row))
    throw new RefusalError('Malformed member identity');
  if(row.uid!=null&&row.userId!=null&&row.uid!==row.userId)
    throw new RefusalError('Conflicting project or team member user IDs');
  const uid=row.uid??row.userId;
  if(typeof uid!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(uid))
    throw new RefusalError('Unverified project or team member user UID');
  return uid;
}

const OPERATIONS=new Set(['projects_members_list','teams_members_list']);
export async function completeMembers(client,operationId,path){
  if(!OPERATIONS.has(operationId))throw new RefusalError('Unsupported member inventory');
  const members=[],identities=new Set(),cursors=new Set();
  let until;
  for(let pageNo=0;pageNo<5;pageNo++){
    const reply=await client.request(operationId,{
      path,query:{limit:100,...(until===undefined?{}:{until})}
    });
    if(!Array.isArray(reply?.members)||reply.members.length>100||
       !reply.pagination||typeof reply.pagination!=='object'||
       reply.pagination.hasMore===true||reply.hasMore===true)
      throw new RefusalError('Cannot prove complete member inventory');
    // The provider's page-count field is not a substitute for real rows.
    // Refuse conflicting metadata instead of making membership/access
    // decisions on an incomplete or deceptively small page.
    if(reply.pagination.count!==undefined&&
      (!Number.isSafeInteger(reply.pagination.count)||
        reply.pagination.count!==reply.members.length))
      throw new RefusalError('Contradictory member page count');
    for(const item of reply.members){
      const uid=verifiedUserUid(item);
      if(identities.has(uid))
        throw new RefusalError('Ambiguous or duplicate member identity');
      identities.add(uid);members.push(item);
    }
    const next=reply.pagination.next;
    if(next===null){
      if(reply.pagination.hasNext===true||reply.pagination.hasMore===true||
        reply.hasMore===true)
        throw new RefusalError('Conflicting member pagination flags');
      return members;
    }
    if(!Number.isSafeInteger(next)||next<1||
       reply.pagination.hasNext===false||reply.pagination.hasMore===false||
       reply.hasMore===false||cursors.has(next))
      throw new RefusalError('Invalid or repeated member cursor');
    cursors.add(next);until=next;
  }
  throw new RefusalError('Member inventory exceeds safe five-page bound');
}

// Project grants and revocations require an existing, confirmed team
// contributor: never invite a paid seat or treat MCP confirmation as owner auth.
export async function verifyEligibleTeamMember(client,teamId,uid){
  const members=await completeMembers(client,'teams_members_list',{teamId});
  const matches=members.filter(row=>verifiedUserUid(row)===uid);
  if(matches.length!==1||matches[0].confirmed!==true||
    matches[0].role!=='CONTRIBUTOR')
    throw new RefusalError('A confirmed team contributor UID is required');
}
