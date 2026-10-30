import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {teamRetentionTools} from '../../src/tools/team-retention.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog'};
const DAY=86400000;
function deployment(ageDays,target,readyState='READY'){
  return {uid:'dpl_FAKE'+ageDays+(target||'x'),created:Date.now()-ageDays*DAY,
    createdAt:Date.now()-ageDays*DAY,creator:{uid:'usr_FAKE'},inspectorUrl:'https://example.invalid',
    name:'demo',projectId:'prj_FAKE',readyState,type:'LAMBDAS',url:'demo.example.invalid',target};
}
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
  const call=(args,connection=conn)=>teamRetentionTools.handlers.vercel_team_set_deployment_retention(
    args,{db,connection,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,call};
}
const read=r=>JSON.parse(r.content[0].text);
describe('O-1r deployment retention write',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('lengthens a window without a removal count and verifies days readback',async()=>{
   const f=fixture();
   const before={id:account.team_id,slug:'demo',defaultExpirationSettings:{expirationDays:30}};
   const after={id:account.team_id,slug:'demo',defaultExpirationSettings:{expirationDays:365}};
   f.api.when('GET','/v2/teams/{teamId}').resolves(before).resolves(before).resolves(after);
   f.api.when('PATCH','/v2/teams/{teamId}').resolves(after);
   expect(read(await f.call({expiration:'1y',confirm:true})))
     .toMatchObject({status:'applied',confirmed:true,mode:'PRODUCTION'});
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET','PATCH','GET']);
   expect(f.api.calls[2].body).toEqual({defaultExpirationSettings:{expiration:'1y'}});
   f.api.verify();
 });
 it('counts removals before shortening production, honoring deploymentsToKeep',async()=>{
   const f=fixture();
   const before={id:account.team_id,slug:'demo',
     defaultExpirationSettings:{expirationDaysProduction:365,deploymentsToKeep:1}};
   f.api.when('GET','/v2/teams/{teamId}').resolves(before);
   f.api.when('GET','/v7/deployments').resolves({
     deployments:[deployment(500,'production'),deployment(400,'production'),
       deployment(10,'production'),deployment(400,null)],
     pagination:{count:4,next:null,prev:null}});
   const r=read(await f.call({expirationProduction:'1m'}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.preview).toMatch(/DESTRUCTIVE: about 2 existing production deployments/);
   expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
   f.api.verify();
 });
 it('applies a shortening only after confirmation and verifies the new days',async()=>{
   const f=fixture();
   const before={id:account.team_id,slug:'demo',defaultExpirationSettings:{expirationDays:365}};
   const after={id:account.team_id,slug:'demo',defaultExpirationSettings:{expirationDays:7}};
   f.api.when('GET','/v2/teams/{teamId}').resolves(before).resolves(before).resolves(after);
   f.api.when('GET','/v7/deployments').resolves({
     deployments:[deployment(100,null)],pagination:{count:1,next:null,prev:null}});
   f.api.when('PATCH','/v2/teams/{teamId}').resolves(after);
   expect(read(await f.call({expiration:'1w',confirm:true})))
     .toMatchObject({status:'applied',confirmed:true});
   expect(f.api.calls.find(x=>x.method==='PATCH').body)
     .toEqual({defaultExpirationSettings:{expiration:'1w'}});
   f.api.verify();
 });
 it('refuses a shortening when deployment history cannot be read',async()=>{
   const f=fixture();
   const before={id:account.team_id,slug:'demo',defaultExpirationSettings:{expirationDays:365}};
   f.api.when('GET','/v2/teams/{teamId}').resolves(before);
   f.api.when('GET','/v7/deployments').rejects(503);
   expect(read(await f.call({expiration:'1w',confirm:true})).status).toBe('refused_by_guard');
   expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
 });
 it('refuses invalid enums, no-change requests and caller team identity',async()=>{
   const f=fixture();
   const before={id:account.team_id,slug:'demo',defaultExpirationSettings:{expirationDays:30}};
   f.api.when('GET','/v2/teams/{teamId}').resolves(before);
   expect(read(await f.call({expirationCanceled:'3y',confirm:true})).status).toBe('refused_by_guard');
   expect(read(await f.call({expiration:'1m',confirm:true})).status).toBe('refused_by_guard');
   expect(read(await f.call({teamId:'team_OTHER',expiration:'1y'})).status).toBe('refused_by_guard');
   expect(f.api.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
 });
});
