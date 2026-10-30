import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {teamDirectoryMappingsTools} from '../../src/tools/team-directory-mappings.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog'};
const connected={id:account.team_id,slug:'demo',
  saml:{enforced:false,connection:{type:'OktaSAML',state:'active',status:'ok',
    connectedAt:1700000000000,syncState:'SETUP'}}};
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
  const call=(args,connection=conn)=>teamDirectoryMappingsTools.handlers
    .vercel_team_set_directory_role_mappings(
      args,{db,connection,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,call};
}
const read=r=>JSON.parse(r.content[0].text);
describe('O-1r directory role mappings write',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('sets role and access-group mappings with provider ok as honest verification',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(connected).resolves(connected);
   f.api.when('POST','/v1/teams/{teamId}/dsync-roles').resolves({ok:true});
   const mappings={'grp-eng':'DEVELOPER','grp-ops':{accessGroupId:'ag_FAKE_ops'}};
   const r=read(await f.call({mappings,confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:null,mode:'PRODUCTION'});
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','POST']);
   expect(f.api.calls[2].body).toEqual({roles:mappings});
   f.api.verify();
 });
 it('previews the who-gets-what access line before confirming',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(connected);
   const r=read(await f.call({mappings:{'grp-admins':'OWNER'}}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.preview).toMatch(/ACCESS WIDENING/);
   expect(r.preview).toMatch(/grp-admins -> team role OWNER/);
   expect(f.api.calls.filter(x=>x.method==='POST')).toHaveLength(0);
   f.api.verify();
 });
 it('refuses when no directory is connected (lockout-safe)',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves({id:account.team_id,slug:'demo'});
   const r=read(await f.call({mappings:{'grp-eng':'MEMBER'},confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(JSON.stringify(r)).toMatch(/no directory connection/);
   expect(f.api.calls.filter(x=>x.method==='POST')).toHaveLength(0);
 });
 it('refuses malformed mappings before any provider call',async()=>{
   const f=fixture();
   for(const mappings of [{'grp':'SUPERUSER'},{'grp':{accessGroupId:'nope'}},
     {'grp':['MEMBER']},{},...[]])
     expect(read(await f.call({mappings})).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });
});
