import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {teamSecurityWriteTools} from '../../src/tools/team-security-write.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog'};
const old={id:account.team_id,hideIpAddresses:false,strictShareableLinks:{enabled:false}};
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
  const call=(args,connection=conn)=>teamSecurityWriteTools.handlers.vercel_team_update_security(
    args,{db,connection,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,call};
}
const read=r=>JSON.parse(r.content[0].text);
describe('O-1 guarded owner team profile mutation',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('tightens privacy and owner-only links with independently verified GET',async()=>{
   const f=fixture(),next={...old,hideIpAddresses:true,strictShareableLinks:{enabled:true}};
   f.api.when('GET','/v2/teams/{teamId}').resolves(old).resolves(old).resolves(next);
   f.api.when('PATCH','/v2/teams/{teamId}').resolves(next);
   expect(read(await f.call({hideIpAddresses:true,strictShareableLinks:{enabled:true},confirm:true})))
     .toMatchObject({status:'applied',confirmed:true,mode:'PRODUCTION'});
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','PATCH','GET']);
   expect(f.api.calls[2].body).toEqual({hideIpAddresses:true,strictShareableLinks:{enabled:true}});
   expect(f.api.calls[2].params.teamId).toBe(account.team_id);f.api.verify();
 });
 it('warns who gains access when protections are loosened',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves({...old,hideIpAddresses:true});
   const r=read(await f.call({hideIpAddresses:false}));
   expect(r.status).toBe('needs_confirmation');expect(r.preview).toMatch(/ACCESS WIDENING/);
   expect(f.api.calls).toHaveLength(1);
 });
 it('refuses SAML, auto-join, malformed policy and caller identity',async()=>{
   const f=fixture();
   for(const args of [{saml:{enforced:true}},{emailDomain:'example.com'},
     {teamId:'team_OTHER',hideIpAddresses:true},{sensitiveEnvironmentVariablePolicy:'default'},
     {strictShareableLinks:{enabled:true,extra:true}},{hideIpAddresses:1}])
     expect(read(await f.call(args)).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });
 it('refuses stale settings and team rotation before mutation',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old)
     .resolves({...old,hideIpAddresses:true});
   expect(read(await f.call({hideIpAddresses:true,confirm:true})).status).toBe('refused_by_guard');
   expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
   const g=fixture();g.api.when('GET','/v2/teams/{teamId}').resolves(old);
   loadToken.mockResolvedValueOnce({token:'vcp_FAKE',account})
     .mockResolvedValueOnce({token:'vcp_FAKE',account:{...account,team_id:'team_OTHER'}});
   expect(read(await g.call({hideIpAddresses:true,confirm:true})).status).toBe('refused_by_guard');
   expect(g.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
 });
 it('refuses preview, narrow profiles and protected accounts',async()=>{
   for(const c of [{...conn,mode:'preview'},{...conn,profile:'everyday'},{...conn,profile:'read_only'}]){
     const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old);
     expect(read(await f.call({hideIpAddresses:true,confirm:true},c)).status).toBe('refused_by_guard');
     expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
   }
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old);
   f.db.listProtectedResources=async()=>[{kind:'account',match:account.team_id,note:'Owner protected'}];
   expect(read(await f.call({hideIpAddresses:true,confirm:true})).status).toBe('refused_by_guard');
 });
 it('does not confirm an accepted PATCH without independent field readback',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old).resolves(old).resolves(old);
   f.api.when('PATCH','/v2/teams/{teamId}').resolves({...old,hideIpAddresses:true});
   expect(read(await f.call({hideIpAddresses:true,confirm:true})).confirmed).toBe(false);
 });
});
