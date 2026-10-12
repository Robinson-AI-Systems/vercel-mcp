import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {teamDefaultProtectionTools} from '../../src/tools/team-default-protection.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog'};
const old={id:account.team_id};
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
  const call=(args,connection=conn)=>teamDefaultProtectionTools.handlers.vercel_team_set_default_protection(
    args,{db,connection,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,call};
}
const read=r=>JSON.parse(r.content[0].text);
describe('O-1 guarded owner team profile mutation',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('sets standard preview protection with independent GET readback',async()=>{
   const f=fixture(),next={...old,defaultDeploymentProtection:{ssoProtection:{deploymentType:'preview'}}};
   f.api.when('GET','/v2/teams/{teamId}').resolves(old).resolves(old).resolves(next);
   f.api.when('PATCH','/v2/teams/{teamId}').resolves(next);
   expect(read(await f.call({ssoProtection:{deploymentType:'preview'},confirm:true})))
     .toMatchObject({status:'applied',confirmed:true});
   expect(f.api.calls[2].body).toEqual({defaultDeploymentProtection:{ssoProtection:{deploymentType:'preview'}}});
   f.api.verify();
 });
 it('previews removal and broader-to-preview changes as access widening',async()=>{
   for(const value of [null,{deploymentType:'preview'}]){
     const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves({...old,
       defaultDeploymentProtection:{ssoProtection:{deploymentType:'all'}}});
     const r=read(await f.call({ssoProtection:value}));
     expect(r.status).toBe('needs_confirmation');expect(r.preview).toMatch(/ACCESS WIDENING/);
     expect(f.api.calls).toHaveLength(1);
   }
 });
 it('refuses paid modes, password inputs, foreign teams and conflicting password state',async()=>{
   const f=fixture();for(const args of [{ssoProtection:{deploymentType:'all'}},
     {ssoProtection:{deploymentType:'preview',extra:1}},
     {ssoProtection:null,passwordProtection:{password:'vcp_FAKE'}},
     {ssoProtection:null,teamId:'team_OTHER'}])
     expect(read(await f.call(args)).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
   f.api.when('GET','/v2/teams/{teamId}').resolves({...old,
     defaultDeploymentProtection:{passwordProtection:{deploymentType:'all'}}});
   expect(read(await f.call({ssoProtection:{deploymentType:'preview'},confirm:true})).status).toBe('refused_by_guard');
   expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
 });
 it('refuses stale defaults before PATCH',async()=>{
   const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old)
     .resolves({...old,defaultDeploymentProtection:{ssoProtection:{deploymentType:'all'}}});
   expect(read(await f.call({ssoProtection:{deploymentType:'preview'},confirm:true})).status).toBe('refused_by_guard');
   expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
 });
 it('denies project accounts, preview and readonly connections',async()=>{
   for(const c of [{...conn,mode:'preview'},{...conn,profile:'read_only'}]){
     const f=fixture();f.api.when('GET','/v2/teams/{teamId}').resolves(old);
     expect(read(await f.call({ssoProtection:{deploymentType:'preview'},confirm:true},c)).status).toBe('refused_by_guard');
   }
   loadToken.mockResolvedValueOnce({token:'vcp_FAKE',account:{...account,scope:'project'}});
   const f=fixture();expect(read(await f.call({ssoProtection:{deploymentType:'preview'},confirm:true})).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });
});
