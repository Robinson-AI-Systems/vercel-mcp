import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {accessGroupTools} from '../../src/tools/access-groups.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
const account={id:'acct_1',team_id:'team_ONE',scope:'team'};
const conn={account:account.id,profile:'full',mode:'production',listing:'catalog'};
const team={id:account.team_id,slug:'demo'};
const group={accessGroupId:'ag_FAKE1',name:'contractors',membersCount:1,projectsCount:1,
  isDsyncManaged:false,createdAt:'1700000000000',updatedAt:'1700000000000'};
const membersPage={members:[{uid:'usr_DEV',username:'dev',email:'dev@example.com',teamRole:'DEVELOPER'}],
  pagination:{count:1,next:null}};
const projectsPage={projects:[{projectId:'prj_FAKE',role:'PROJECT_DEVELOPER',
  project:{name:'demo'},createdAt:'1700000000000',updatedAt:'1700000000000'}],
  pagination:{count:1,next:null}};
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
  const call=(name,args,connection=conn)=>accessGroupTools.handlers[name](
    args,{db,connection,fetchImpl:api.fetch,env:{VERCEL_ENV:'production'}});
  return {api,rows,audit,db,call};
}
const read=r=>JSON.parse(r.content[0].text);
function detailRoutes(f){
  f.api.when('GET','/v1/access-groups/{idOrName}').resolves(group);
  f.api.when('GET','/v1/access-groups/{idOrName}/members').resolves(membersPage);
  f.api.when('GET','/v1/access-groups/{idOrName}/projects').resolves(projectsPage);
}
describe('O-2 access group tools',()=>{
 beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue({token:'vcp_FAKE',account});});
 it('lists groups and composes the get from summary, members and projects',async()=>{
   const f=fixture();
   f.api.when('GET','/v1/access-groups').resolves({accessGroups:[group],pagination:{count:1,next:null}});
   const list=read(await f.call('vercel_access_group_list',{}));
   expect(list.groups[0]).toMatchObject({accessGroupId:'ag_FAKE1',membersCount:1});
   detailRoutes(f);
   const got=read(await f.call('vercel_access_group_get',{idOrName:'ag_FAKE1'}));
   expect(got.members[0]).toMatchObject({uid:'usr_DEV',teamRole:'DEVELOPER'});
   expect(got.projects[0]).toMatchObject({projectId:'prj_FAKE',role:'PROJECT_DEVELOPER'});
   f.api.verify();
 });
 it('creates a group and verifies it by name',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   f.api.when('POST','/v1/access-groups').resolves(group);
   f.api.when('GET','/v1/access-groups').resolves({accessGroups:[group],pagination:{count:1,next:null}});
   const r=read(await f.call('vercel_access_group_create',
     {name:'contractors',membersToAdd:['usr_DEV'],confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   expect(f.api.calls.find(x=>x.method==='POST').body)
     .toEqual({name:'contractors',membersToAdd:['usr_DEV']});
   f.api.verify();
 });
 it('updates membership with a fingerprint race check and read-back',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   detailRoutes(f);detailRoutes(f);
   f.api.when('POST','/v1/access-groups/{idOrName}').resolves(group);
   const twoMembers={members:[...membersPage.members,
     {uid:'usr_NEW',username:'new',email:'new@example.com',teamRole:'VIEWER'}],
     pagination:{count:2,next:null}};
   f.api.when('GET','/v1/access-groups/{idOrName}').resolves(group);
   f.api.when('GET','/v1/access-groups/{idOrName}/members').resolves(twoMembers);
   f.api.when('GET','/v1/access-groups/{idOrName}/projects').resolves(projectsPage);
   const r=read(await f.call('vercel_access_group_update',
     {idOrName:'ag_FAKE1',membersToAdd:['usr_NEW'],confirm:true}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   f.api.verify();
 });
 it('previews a delete with its members and projects, then deletes',async()=>{
   const f=fixture();
   f.api.when('GET','/v2/teams/{teamId}').resolves(team);
   detailRoutes(f);
   const preview=read(await f.call('vercel_access_group_delete',{idOrName:'ag_FAKE1'}));
   expect(preview.status).toBe('needs_confirmation');
   expect(preview.preview).toMatch(/1 member\(s\) and 1 project role\(s\)/);
   const g=fixture();
   g.api.when('GET','/v2/teams/{teamId}').resolves(team);
   detailRoutes(g);detailRoutes(g);
   g.api.when('DELETE','/v1/access-groups/{idOrName}').resolves({});
   g.api.when('GET','/v1/access-groups').resolves({accessGroups:[],pagination:{count:0,next:null}});
   expect(read(await g.call('vercel_access_group_delete',{idOrName:'ag_FAKE1',confirm:true})))
     .toMatchObject({status:'applied',confirmed:true});
   g.api.verify();
 });
 it('refuses malformed input before any provider call',async()=>{
   const f=fixture();
   for(const [name,args] of [
     ['vercel_access_group_create',{name:''}],
     ['vercel_access_group_create',{name:'x',membersToAdd:['not a uid!!']}],
     ['vercel_access_group_update',{idOrName:'ag_FAKE1'}],
     ['vercel_access_group_delete',{idOrName:''}]])
     expect(read(await f.call(name,args)).status).toBe('refused_by_guard');
   expect(f.api.calls).toHaveLength(0);
 });
});
