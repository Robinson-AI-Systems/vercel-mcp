import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {teamProfileWriteTools} from '../../src/tools/team-profile-write.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog'};
const old={id:account.team_id,name:'Old Team',slug:'old-team',description:'Public text'};
function fixture(){
  const api=makeFakeVercel(),rows=new Map(),audit=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
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
  const call=(args,connection=conn)=>teamProfileWriteTools.handlers.vercel_team_update_profile(
    args,{db,connection,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,call};
}
const read=r=>JSON.parse(r.content[0].text);
describe('O-1 guarded owner team profile mutation',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('changes team name and description via exact owner-only PATCH and independent GET',async()=>{
   const f=fixture(),next={...old,name:'New Team',description:'Updated team overview'};
   f.api.when('GET','/v2/teams/{teamId}').resolves(old).resolves(old).resolves(next);
   f.api.when('PATCH','/v2/teams/{teamId}').resolves(next);
   const r=read(await f.call({name:next.name,description:next.description,confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true,mode:'PRODUCTION'});
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','PATCH','GET']);
   expect(f.api.calls[2].body).toEqual({name:next.name,description:next.description});
   expect(f.api.calls[2].params.teamId).toBe(account.team_id);
   expect(f.api.calls[2].query).not.toHaveProperty('teamId');
   expect(f.rows.size).toBe(2);
   f.api.verify();
 });
 it('previews a team slug change with production warning but dispatches no PATCH',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old);
   const result=read(await f.call({slug:'new-team'}));
   expect(result).toMatchObject({status:'needs_confirmation',mode:'PRODUCTION'});
   expect(result.preview).toMatch(/six per week/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET']);
 });
 it('refuses stale provider state without a PATCH',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}')
     .resolves(old).resolves({...old,description:'Changed elsewhere'});
   const r=read(await f.call({description:'Updated public text',confirm:true,
     requestKey:'ownerTeamUpdateTest0001'}));
   expect(r.status).toBe('refused_by_guard');
   expect(f.api.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
   expect(f.rows.size).toBe(0);
 });
 it('refuses rotated team credentials before any mutation',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old);
   loadToken.mockResolvedValueOnce({token:'vcp_FAKE',account})
     .mockResolvedValueOnce({token:'vcp_FAKE',account:{...account,team_id:'team_OTHER'}});
   const r=read(await f.call({name:'New Team',confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(f.api.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
 });
 it('requires a full production connection, not a preview or project credential',async()=>{
   for(const connection of [
     {...conn,mode:'preview'},{...conn,profile:'everyday'},{...conn,profile:'read_only'}
   ]){
     const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old);
     const r=read(await f.call({name:'New Team',confirm:true},connection));
     expect(r.status).toBe('refused_by_guard');
     expect(f.api.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
   }
   const f=fixture();
   loadToken.mockResolvedValueOnce({token:'vcp_FAKE',account:{...account,scope:'project',project_id:'prj_ONE'}});
   expect(read(await f.call({name:'New Team',confirm:true})).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });
 it('blocks protected teams and rejects caller team IDs, secrets and malformed values',async()=>{
   const f=fixture();
   for(const args of [
     {teamId:'team_OTHER',name:'New Team'},{name:'vcp_FAKE_secret_unsafe'},
     {slug:'../other'},{description:'password=abc123'},
     {name:'not public\nvalue'},{previewDeploymentSuffix:'https://other.example'}
   ])expect(read(await f.call(args)).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
   f.api.when('GET','/v2/teams/{teamId}').resolves(old);
   f.db.listProtectedResources=async()=>[{kind:'account',match:account.team_id,note:'Owner protected'}];
   expect(read(await f.call({name:'New Team',confirm:true})).status).toBe('refused_by_guard');
   expect(f.api.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
 });
});
