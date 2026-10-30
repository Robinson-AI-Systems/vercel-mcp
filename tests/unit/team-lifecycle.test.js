import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel,vercelError} from '../../test/helpers/fake-vercel.js';
import {teamLifecycleTools} from '../../src/tools/team-lifecycle.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const seat={id:'team_SEAT',name:'Seat Team',slug:'seat-team'};
const target={id:'team_TARGET',name:'Target Team',slug:'target-team'};
const account={id:'acct_1',team_id:seat.id,scope:'full'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog'};
function fixture(accounts){
  const api=makeFakeVercel(),rows=new Map(),audit=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    listVercelAccounts:async()=>accounts??
      [{id:account.id,team_id:seat.id,scope:'full'}],
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
  const ctx=connection=>({db,connection,fetchImpl:api.fetch,
    env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,
    create:(args,connection=conn)=>teamLifecycleTools.handlers
      .vercel_team_create(args,ctx(connection)),
    remove:(args,connection=conn)=>teamLifecycleTools.handlers
      .vercel_team_delete(args,ctx(connection))};
}
const read=r=>JSON.parse(r.content[0].text);
describe('AUD-AB guarded team lifecycle writes',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('previews team creation with the plan disclosure and dispatches nothing',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams').resolves({teams:[seat],pagination:{next:null}});
   const r=read(await f.create({slug:'new-team',name:'New Team'}));
   expect(r).toMatchObject({status:'needs_confirmation',mode:'PRODUCTION'});
   expect(r.preview).toMatch(/plan terms/);
   expect(r.preview).toMatch(/payment details in the dashboard/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET']);
   const dry=read(await f.create({slug:'new-team',dryRun:true}));
   expect(dry.status).toBe('preview');
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(0);
   f.api.verify();
 });
 it('creates a team via the pinned POST and verifies it by independent GET',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams').resolves({teams:[seat],pagination:{next:null}});
   f.api.when('POST','/v1/teams').resolves({id:'team_NEW1',slug:'new-team'});
   f.api.when('GET','/v2/teams/{teamId}')
     .resolves({id:'team_NEW1',slug:'new-team',name:'New Team'});
   const r=read(await f.create({slug:'new-team',name:'New Team',confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true,mode:'PRODUCTION',
     receipt:{teamId:'team_NEW1',slug:'new-team'}});
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','POST','GET']);
   expect(f.api.calls[1].body).toEqual({slug:'new-team',name:'New Team'});
   expect(f.api.calls[1].query).not.toHaveProperty('teamId');
   f.api.verify();
 });
 it('discloses a visible duplicate slug in the preview without refusing',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams').resolves({teams:[seat,
     {id:'team_OTHER',slug:'taken-slug'}],pagination:{next:null}});
   const r=read(await f.create({slug:'taken-slug'}));
   expect(r.status).toBe('needs_confirmation');
   expect(r.preview).toMatch(/already visible on this account/);
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(0);
 });
 it('lets a team-reach seat knock: account-layer disclosure, attempt proceeds',async()=>{
   loadToken.mockResolvedValue({token:'vcp_FAKE',
     account:{...account,scope:'team'}});
   const f=fixture();
   f.api.when('POST','/v1/teams').resolves({id:'team_NEW1',slug:'new-team'});
   f.api.when('GET','/v2/teams/{teamId}').resolves({id:'team_NEW1',slug:'new-team'});
   const plan=read(await f.create({slug:'new-team'}));
   expect(plan.preview).toMatch(/account-layer act/);
   const r=read(await f.create({slug:'new-team',confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   expect(f.api.calls.map(x=>x.method)).toEqual(['POST','GET']);
   f.api.verify();
 });
 it('surfaces a provider refusal at create as an unknown outcome, never applied',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams').resolves({teams:[seat],pagination:{next:null}});
   f.api.when('POST','/v1/teams').rejects(400,vercelError(400,'bad_request'));
   const r=read(await f.create({slug:'taken-slug',confirm:true}));
   expect(r.status).toBe('outcome_unknown');
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(1);
 });
 it('refuses a project seat before any provider call',async()=>{
   const f=fixture();
   const project={...account,scope:'project',project_id:'prj_1'};
   loadToken.mockResolvedValueOnce({token:'vcp_FAKE',account:project})
     .mockResolvedValueOnce({token:'vcp_FAKE',account:project});
   expect(read(await f.create({slug:'new-team',confirm:true})).status)
     .toBe('refused_by_guard');
   expect(read(await f.remove({teamId:target.id,confirm:true})).status)
     .toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });
 it('requires a full production connection for lifecycle writes',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams').resolves({teams:[seat],pagination:{next:null}});
   for(const connection of [{...conn,profile:'everyday'},
     {...conn,mode:'preview'}]){
     expect(read(await f.create({slug:'new-team',confirm:true},connection))
       .status).toBe('refused_by_guard');
   }
   expect(f.api.calls.filter(c=>c.method==='POST')).toHaveLength(0);
 });
 it('refuses malformed create input before provider reads',async()=>{
   const f=fixture();
   for(const args of [{slug:'Bad Slug'},{slug:'ok-slug',name:'password=<redacted>'},
     {name:'No Slug'},{slug:'ok-slug',teamId:'team_OTHER'},
     {slug:'a'.repeat(49)},{slug:'../escape'}])
     expect(read(await f.create(args)).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });

 it('previews team deletion with the permanence disclosure and dispatches nothing',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(target);
   f.api.when('GET','/v2/user').resolves({defaultTeamId:seat.id});
   const r=read(await f.remove({teamId:target.id}));
   expect(r).toMatchObject({status:'needs_confirmation',mode:'PRODUCTION'});
   expect(r.preview).toMatch(/PERMANENTLY/);
   expect(f.api.calls.map(x=>x.method)).toEqual(['GET','GET']);
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
   f.api.verify();
 });
 it('deletes a team via the pinned DELETE and verifies it by a 404 read-back',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}')
     .resolves(target).resolves(target).rejects(404,vercelError(404));
   f.api.when('GET','/v2/user').resolves({defaultTeamId:seat.id});
   f.api.when('DELETE','/v1/teams/{teamId}').resolves({id:target.id});
   const r=read(await f.remove({teamId:target.id,confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true,mode:'PRODUCTION',
     receipt:{teamId:target.id,newDefaultTeamIdError:null}});
   const del=f.api.calls.find(c=>c.method==='DELETE');
   expect(del.params.teamId).toBe(target.id);
   expect(del.body).toEqual({});
   expect(del.query).not.toHaveProperty('teamId');
   expect(f.api.calls.map(x=>x.method))
     .toEqual(['GET','GET','GET','DELETE','GET']);
   f.api.verify();
 });
 it('refuses deletion while any enrollment is seated on the target',async()=>{
   const f=fixture([{id:account.id,team_id:seat.id,scope:'full'},
     {id:'acct_9',team_id:target.id,scope:'team'}]);
   f.api.when('GET','/v2/teams/{teamId}').resolves(target);
   f.api.when('GET','/v2/user').resolves({defaultTeamId:seat.id});
   const r=read(await f.remove({teamId:target.id,confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(r.reason).toMatch(/enrolled account\(s\) are seated on this team/);
   expect(r.reason).toMatch(/vercel_remove_account/);
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('refuses deletion of the seat\'s own team by the same derived guard',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(seat);
   f.api.when('GET','/v2/user').resolves({defaultTeamId:seat.id});
   const r=read(await f.remove({teamId:seat.id,confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(r.reason).toMatch(/enrolled account\(s\) are seated/);
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('re-checks the enrollment guard at apply time',async()=>{
   let calls=0;
   const f=fixture();
   f.db.listVercelAccounts=async()=>(++calls===1?
     [{id:account.id,team_id:seat.id,scope:'full'}]:
     [{id:account.id,team_id:seat.id,scope:'full'},
       {id:'acct_9',team_id:target.id,scope:'team'}]);
   f.api.when('GET','/v2/teams/{teamId}').resolves(target).resolves(target);
   f.api.when('GET','/v2/user').resolves({defaultTeamId:seat.id});
   const r=read(await f.remove({teamId:target.id,confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('refuses an unknown or invisible target before any DELETE',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').rejects(404,vercelError(404));
   const r=read(await f.remove({teamId:target.id,confirm:true}));
   expect(r.status).toBe('refused_by_guard');
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('discloses the default team and passes the replacement default through',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}')
     .resolves(target).resolves(target).resolves(target)
     .rejects(404,vercelError(404));
   f.api.when('GET','/v2/user').resolves({defaultTeamId:target.id});
   f.api.when('DELETE','/v1/teams/{teamId}')
     .resolves({id:target.id,newDefaultTeamIdError:true});
   const plan=read(await f.remove({teamId:target.id,
     newDefaultTeamId:seat.id}));
   expect(plan.preview).toMatch(/account default team/);
   expect(plan.preview).toMatch(/team_SEAT becomes the default instead/);
   const r=read(await f.remove({teamId:target.id,
     newDefaultTeamId:seat.id,confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{teamId:target.id,newDefaultTeamIdError:true}});
   const del=f.api.calls.find(c=>c.method==='DELETE');
   expect(del.query).toEqual({newDefaultTeamId:seat.id});
   f.api.verify();
 });
 it('surfaces a provider billing refusal at delete as an unknown outcome',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(target).resolves(target);
   f.api.when('GET','/v2/user').resolves({defaultTeamId:seat.id});
   f.api.when('DELETE','/v1/teams/{teamId}')
     .rejects(402,vercelError(402,'payment_required'));
   const r=read(await f.remove({teamId:target.id,confirm:true}));
   expect(r.status).toBe('outcome_unknown');
   expect(f.api.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
 });
 it('refuses malformed delete input before provider reads',async()=>{
   const f=fixture();
   for(const args of [{teamId:'bad id!'},{teamId:target.id,
     newDefaultTeamId:target.id},{newDefaultTeamId:seat.id},
     {teamId:target.id,slug:'target-team'}])
     expect(read(await f.remove(args)).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });
});
