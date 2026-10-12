import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE',mode:'production',profile:'full',listing:'catalog'};
const token={token:'vcp_FAKE_member',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
const name='prj_FAKE_TEAM',uid='user_FAKE_STAFF',admin='user_FAKE_ADMIN';
const staff={uid,role:'PROJECT_VIEWER'},leader={uid:admin,role:'ADMIN'};
const payload={project:name,uid,confirm:true,requestKey:'removeFAKEstaff01'};
function fixture(){
  const fake=makeFakeVercel(),rows=new Map(),audits=[];
  const db={getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async x=>audits.push(x),
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(rows.has(key))return rows.get(key);
        rows.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};
      },
      complete:async({key,result})=>rows.set(key,{state:'completed',result})
    })
  };
  const call=(args,c=connection,env={})=>dispatchReadOnlyTool({
    registry,name:'vercel_project_remove_member',args,db,connection:c,env,fetchImpl:fake.fetch});
  return {fake,db,call,rows,audits};
}
const parse=r=>JSON.parse(r.content[0].text);
function reads(f,after=[leader]){
  f.fake.when('GET','/v3/teams/{teamId}/members').resolves({
    members:[{uid,role:'CONTRIBUTOR',confirmed:true}],
    pagination:{next:null,hasNext:false}
  });
  f.fake.when('GET','/v2/user').resolves({user:{id:'user_FAKE_OWNER'}});
  f.fake.when('GET','/v9/projects/{idOrName}').resolves({id:name,name:'demo'});
  f.fake.when('GET','/v1/projects/{idOrName}/members')
    .resolves({members:[staff,leader],pagination:{next:null}})
    .resolves({members:[staff,leader],pagination:{next:null}})
    .resolves({members:[staff,leader],pagination:{next:null}})
    .resolves({members:after,pagination:{next:null}});
}
describe('D-1i guarded project member removal',()=>{
  beforeEach(()=>loadToken.mockResolvedValue(token));
  it('restricts discovery, direct invocation and production access',async()=>{
    const f=fixture();reads(f);
    expect(listMcpTools(registry,{profile:'full'}).map(t=>t.name)).toContain('vercel_project_remove_member');
    expect(listMcpTools(registry,{profile:'everyday'}).map(t=>t.name)).not.toContain('vercel_project_remove_member');
    expect((await f.call(payload,{...connection,profile:'read_only'})).isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
    expect(parse(await f.call(payload,{...connection,mode:'preview'})).status).toBe('refused_by_guard');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('keeps dry runs and missing confirm non-mutating, then deletes once with GET verification',async()=>{
    const f=fixture();reads(f);
    expect(parse(await f.call({...payload,confirm:undefined,dryRun:true})).status).toBe('preview');
    expect(parse(await f.call({...payload,confirm:undefined})).status).toBe('needs_confirmation');
    f.fake.when('DELETE','/v1/projects/{idOrName}/members/{uid}').resolves(undefined,204);
    const result=parse(await f.call(payload));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    const calls=f.fake.calls.filter(x=>x.method==='DELETE');
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({idOrName:name,uid});
    expect(calls[0].query.teamId).toBe('team_FAKE');
    expect(f.rows.size).toBe(2);
    const retried=parse(await f.call(payload));
    expect(retried).toEqual(result);
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    f.fake.verify();
  });
  it('never removes an admin, owner, final member or the server principal',async()=>{
    for(const members of [[leader,staff],[staff]]){
      const f=fixture();
      f.fake.when('GET','/v2/user').resolves({user:{id:'user_FAKE_OWNER'}});
      f.fake.when('GET','/v9/projects/{idOrName}').resolves({id:name,name:'demo'});
      f.fake.when('GET','/v1/projects/{idOrName}/members').resolves({members,pagination:{next:null}});
      const r=await f.call({...payload,uid:members[0].uid});
      expect(parse(r).status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    }
    const f=fixture();reads(f);
    f.fake.when('GET','/v2/user').resolves({user:{id:uid}});
    expect(parse(await f.call(payload)).status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
    const u=fixture();reads(u);
    u.fake.when('GET','/v2/user').resolves({user:{}});
    expect(parse(await u.call(payload)).status).toBe('refused_by_guard');
    expect(u.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
  it('revokes a verified contributor across complete multi-page inventories',async()=>{
    const f=fixture();
    f.fake.when('GET','/v2/user').resolves({user:{id:'user_FAKE_OWNER'}});
    f.fake.when('GET','/v9/projects/{idOrName}').resolves({id:name,name:'demo'});
    f.fake.when('GET','/v1/projects/{idOrName}/members')
      .resolves({members:[leader],pagination:{next:1700000000000}})
      .resolves({members:[staff],pagination:{next:null}})
      .resolves({members:[leader],pagination:{next:null}});
    f.fake.when('GET','/v3/teams/{teamId}/members')
      .resolves({members:[{uid:'user_FAKE_OTHER',role:'CONTRIBUTOR',confirmed:true}],pagination:{next:1700000001000}})
      .resolves({members:[{uid,role:'CONTRIBUTOR',confirmed:true}],pagination:{next:null}});
    f.fake.when('DELETE','/v1/projects/{idOrName}/members/{uid}').resolves(undefined,204);
    const data=parse(await f.call(payload));
    expect(data).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    expect(f.fake.calls.filter(x=>x.path==='/v3/teams/team_FAKE/members'&&x.query.until==='1700000001000')).toHaveLength(1);
    f.fake.verify();
  });
  it('refuses removing a team owner, unconfirmed or missing contributor before DELETE',async()=>{
    for(const page of [
      {members:[{uid,role:'OWNER',confirmed:true}],pagination:{next:null}},
      {members:[{uid,role:'CONTRIBUTOR',confirmed:false}],pagination:{next:null}},
      {members:[{uid:'wrong_FAKE',role:'CONTRIBUTOR',confirmed:true}],pagination:{next:null}},
      {members:[{uid,role:'CONTRIBUTOR',confirmed:true}],pagination:{next:42}},
      {members:[]}
    ]){
      const f=fixture();reads(f);
      f.fake.when('GET','/v3/teams/{teamId}/members').resolves(page);
      const result=parse(await f.call(payload));
      expect(result.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
      expect(f.fake.calls.at(-1).params.teamId).toBe('team_FAKE');
    }
  });
  it('reports read-back mismatch, not a fabricated confirmed deletion',async()=>{
    const f=fixture();reads(f,[leader,staff]);
    f.fake.when('DELETE','/v1/projects/{idOrName}/members/{uid}').resolves({id:name});
    expect(parse(await f.call(payload))).toMatchObject({status:'applied',confirmed:false});
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
  });
  it('rejects ambiguous paginated membership or forged identity without calling DELETE',async()=>{
    const f=fixture();
    f.fake.when('GET','/v2/user').resolves({user:{id:'user_FAKE_OWNER'}});
    f.fake.when('GET','/v9/projects/{idOrName}').resolves({id:name,name:'demo'});
    f.fake.when('GET','/v1/projects/{idOrName}/members')
      .resolves({members:[staff,leader],pagination:{next:42}});
    expect(parse(await f.call(payload)).status).toBe('refused_by_guard');
    for(const bad of [{...payload,teamId:'forged'},{...payload,uid:'../../evil'}])
      expect(parse(await f.call(bad)).status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
});
