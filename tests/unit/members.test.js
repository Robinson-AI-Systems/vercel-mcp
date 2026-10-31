import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {memberTools,seatPrice,SECURITY_SEAT_DISCLOSURE} from '../../src/tools/members.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog',kind:'connector'};
const team={id:account.team_id,slug:'demo'};
const member=(uid,role,email)=>({uid,role,email:email??uid+'@example.com',
  username:uid,confirmed:true,createdAt:1700000000000,projects:[]});
const rosterOf=(members,invites=[])=>({members,emailInviteCodes:invites,
  pagination:{count:members.length,next:null,prev:null}});
function fixture(){
  const api=makeFakeVercel(),rows=new Map(),audit=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    getPurchasePolicy:async()=>({grantRequired:false,budgetCents:null}),
    getTodaySpendCents:async()=>0,
    recordChange:async row=>audit.push(row),
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(rows.has(key))return rows.get(key);
        rows.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};
      },
      complete:async({key,result})=>rows.set(key,{state:'completed',result}),
      release:async({key})=>rows.delete(key)
    })
  };
  const call=(name,args,connection=conn)=>memberTools.handlers[name](
    args,{db,connection,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,call};
}
const read=r=>JSON.parse(r.content[0].text);
describe('O-2 member tools',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('lists members and invites with two-step honestly null',async()=>{
   const f=fixture();
   f.api.when('GET','/v3/teams/{teamId}/members').resolves(rosterOf(
     [member('usr_OWNER1','OWNER'),member('usr_DEV','DEVELOPER')],
     [{id:'inv_FAKE1',email:'new@example.com',role:'VIEWER',createdAt:1700000000000,isDSyncUser:false}]));
   const r=read(await f.call('vercel_member_list',{}));
   expect(r.members).toHaveLength(2);
   expect(r.members[0]).toMatchObject({uid:'usr_OWNER1',role:'OWNER',twoStepLogin:null});
   expect(r.invites[0]).toMatchObject({id:'inv_FAKE1',role:'VIEWER'});
   f.api.verify();
 });
 it('prices seats from the recorded Pro pricing',()=>{
   expect(seatPrice('DEVELOPER')).toEqual({cents:2000,known:true});
   expect(seatPrice('VIEWER')).toEqual({cents:0,known:true});
   expect(seatPrice('SECURITY')).toEqual({cents:null,known:false});
 });
 it('invites with the documented ARRAY body and the seat price in the preview',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   const preview=read(await f.call('vercel_member_invite',{email:'dev@example.com',role:'DEVELOPER'}));
   expect(preview.status).toBe('needs_confirmation');
   expect(preview.preview).toMatch(/\$20\/month paid deploying seat/);
   expect(preview.preview).toMatch(/dev@example\.com/);
   const g=fixture();
   g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   g.api.when('POST','/v2/teams/{teamId}/members')
     .resolves({email:'dev@example.com',role:'DEVELOPER',uid:'usr_NEW',username:'dev'});
   g.api.when('GET','/v3/teams/{teamId}/members').resolves(rosterOf(
     [member('usr_OWNER1','OWNER'),member('usr_NEW','DEVELOPER','dev@example.com')]));
   expect(read(await g.call('vercel_member_invite',
     {email:'dev@example.com',role:'DEVELOPER',confirm:true})))
     .toMatchObject({status:'applied',confirmed:true});
   expect(g.api.calls.find(x=>x.method==='POST').body)
     .toEqual([{email:'dev@example.com',role:'DEVELOPER'}]);
   g.api.verify();
 });
 it('marks SECURITY invites with the exact AUD-AJ disclosure and VIEWER invites free',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   const sec=read(await f.call('vercel_member_invite',{email:'sec@example.com',role:'SECURITY'}));
   expect(sec.preview).toContain(SECURITY_SEAT_DISCLOSURE);
   expect(sec.preview).not.toMatch(/price: unknown/i);
   const g=fixture();g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   const view=read(await g.call('vercel_member_invite',{email:'v@example.com',role:'VIEWER'}));
   expect(view.preview).toMatch(/free role, no seat charge/);
 });
 it('gates a confirmed SECURITY invite on the unpriced-seat acknowledgement (AUD-AJ)',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   const refused=read(await f.call('vercel_member_invite',
     {email:'sec@example.com',role:'SECURITY',confirm:true}));
   expect(refused.status).toBe('refused_by_guard');
   expect(refused.reason).toContain(SECURITY_SEAT_DISCLOSURE);
   expect(refused.reason).toContain('acknowledgeUnpricedSeat');
   expect(f.api.calls.filter(x=>x.method==='POST')).toHaveLength(0);
   const g=fixture();
   g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   g.api.when('POST','/v2/teams/{teamId}/members')
     .resolves({email:'sec@example.com',role:'SECURITY',uid:'usr_SEC',username:'sec'});
   g.api.when('GET','/v3/teams/{teamId}/members').resolves(rosterOf(
     [member('usr_OWNER1','OWNER'),member('usr_SEC','SECURITY','sec@example.com')]));
   const applied=read(await g.call('vercel_member_invite',
     {email:'sec@example.com',role:'SECURITY',confirm:true,
       acknowledgeUnpricedSeat:true,requestKey:'secInviteAck_01'}));
   expect(applied).toMatchObject({status:'applied',confirmed:true});
 });
 it('gates a role change INTO SECURITY on the acknowledgement (AUD-AJ)',async()=>{
   const before=rosterOf([member('usr_OWNER1','OWNER'),member('usr_DEV','VIEWER')]);
   const after=rosterOf([member('usr_OWNER1','OWNER'),member('usr_DEV','SECURITY')]);
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   f.api.when('GET','/v3/teams/{teamId}/members').resolves(before);
   f.api.when('GET','/v2/user').resolves({user:{id:'usr_OWNER1'}});
   const refused=read(await f.call('vercel_member_update_role',
     {uid:'usr_DEV',role:'SECURITY',confirm:true}));
   expect(refused.status).toBe('refused_by_guard');
   expect(refused.reason).toContain('acknowledgeUnpricedSeat');
   expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
   const g=fixture();
   g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   g.api.when('GET','/v3/teams/{teamId}/members')
     .resolves(before).resolves(before).resolves(before).resolves(after);
   g.api.when('GET','/v2/user').resolves({user:{id:'usr_OWNER1'}});
   g.api.when('PATCH','/v1/teams/{teamId}/members/{uid}').resolves({id:account.team_id});
   const applied=read(await g.call('vercel_member_update_role',
     {uid:'usr_DEV',role:'SECURITY',confirm:true,acknowledgeUnpricedSeat:true}));
   expect(applied).toMatchObject({status:'applied',confirmed:true});
   expect(g.api.calls.find(x=>x.method==='PATCH').body).toEqual({role:'SECURITY'});
 });
 it('refuses demoting the last Owner and changing your own role',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   f.api.when('GET','/v3/teams/{teamId}/members').resolves(rosterOf(
     [member('usr_OWNER1','OWNER'),member('usr_DEV','DEVELOPER')]));
   f.api.when('GET','/v2/user').resolves({user:{id:'usr_DEV'}});
   expect(read(await f.call('vercel_member_update_role',
     {uid:'usr_OWNER1',role:'MEMBER',confirm:true})).status).toBe('refused_by_guard');
   const g=fixture();
   g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   g.api.when('GET','/v3/teams/{teamId}/members').resolves(rosterOf(
     [member('usr_OWNER1','OWNER'),member('usr_DEV','DEVELOPER')]));
   g.api.when('GET','/v2/user').resolves({user:{id:'usr_DEV'}});
   expect(read(await g.call('vercel_member_update_role',
     {uid:'usr_DEV',role:'VIEWER',confirm:true})).status).toBe('refused_by_guard');
   expect(g.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
 });
 it('changes a role with roster race check and read-back verification',async()=>{
   const f=fixture();const before=rosterOf(
     [member('usr_OWNER1','OWNER'),member('usr_DEV','VIEWER')]);
   const after=rosterOf([member('usr_OWNER1','OWNER'),member('usr_DEV','DEVELOPER')]);
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   // $ writes run before() at preview and again at execution time.
   f.api.when('GET','/v3/teams/{teamId}/members')
     .resolves(before).resolves(before).resolves(before).resolves(after);
   f.api.when('GET','/v2/user').resolves({user:{id:'usr_OWNER1'}});
   f.api.when('PATCH','/v1/teams/{teamId}/members/{uid}').resolves({id:account.team_id});
   const r=read(await f.call('vercel_member_update_role',
     {uid:'usr_DEV',role:'DEVELOPER',confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   expect(f.api.calls.find(x=>x.method==='PATCH').body).toEqual({role:'DEVELOPER'});
   f.api.verify();
 });
 it('removes a member but never the last Owner or yourself',async()=>{
   const f=fixture();const before=rosterOf(
     [member('usr_OWNER1','OWNER'),member('usr_DEV','DEVELOPER')]);
   const after=rosterOf([member('usr_OWNER1','OWNER')]);
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   f.api.when('GET','/v3/teams/{teamId}/members').resolves(before).resolves(before).resolves(after);
   f.api.when('GET','/v2/user').resolves({user:{id:'usr_OWNER1'}});
   f.api.when('DELETE','/v1/teams/{teamId}/members/{uid}').resolves({});
   expect(read(await f.call('vercel_member_remove',{uid:'usr_DEV',confirm:true})))
     .toMatchObject({status:'applied',confirmed:true});
   const g=fixture();
   g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   g.api.when('GET','/v3/teams/{teamId}/members').resolves(before);
   g.api.when('GET','/v2/user').resolves({user:{id:'usr_DEV'}});
   expect(read(await g.call('vercel_member_remove',{uid:'usr_OWNER1',confirm:true})).status)
     .toBe('refused_by_guard');
   expect(g.api.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
   f.api.verify();
 });
 it('revokes a pending invite and refuses unknown invites',async()=>{
   const f=fixture();const before=rosterOf([member('usr_OWNER1','OWNER')],
     [{id:'inv_FAKE1',email:'new@example.com',role:'VIEWER',createdAt:1,isDSyncUser:false}]);
   const after=rosterOf([member('usr_OWNER1','OWNER')]);
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   f.api.when('GET','/v3/teams/{teamId}/members').resolves(before).resolves(after);
   f.api.when('DELETE','/v1/teams/{teamId}/invites/{inviteId}').resolves({});
   expect(read(await f.call('vercel_member_revoke_invite',{inviteId:'inv_FAKE1',confirm:true})))
     .toMatchObject({status:'applied',confirmed:true});
   const g=fixture();
   g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   g.api.when('GET','/v3/teams/{teamId}/members').resolves(before);
   expect(read(await g.call('vercel_member_revoke_invite',{inviteId:'inv_NOPE',confirm:true})).status)
     .toBe('refused_by_guard');
   f.api.verify();
 });
});
