// A project-only role can be assigned to an existing confirmed team
// contributor, never used as a back door to invite a paid team seat.
export async function verifyEligibleTeamMember(client,teamId,uid){
  const page=await client.request('teams_members_list',{
    path:{teamId},query:{limit:100}
  });
  if(!Array.isArray(page?.members)||page.members.length>100||
    !page.pagination||
    (page.pagination.next!=null&&page.pagination.hasNext!==false)||
    page.pagination.hasNext===true)
    throw new TypeError('Cannot prove complete team membership; project grant refused');
  const matches=page.members.filter(row=>row?.uid===uid);
  if(matches.length!==1||matches[0].confirmed!==true||matches[0].role!=='CONTRIBUTOR')
    throw new TypeError('A confirmed team contributor UID is required');
}
