import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE',mode:'production',profile:'full',listing:'catalog'};
const token={token:'vcp_FAKE_member',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
const name='prj_FAKE_TEAM',uid='user_FAKE_STAFF',role='PROJECT_VIEWER';
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
  const call=(args,c=connection,tool='vercel_project_add_member')=>
    dispatchReadOnlyTool({registry,name:tool,args,db,connection:c,fetchImpl:fake.fetch});
  return {fake,rows,audits,call,db};
}
const parse=r=>JSON.parse(r.content[0].text);
function reads(fake,after){
  fake.when('GET','/v9/projects/{idOrName}').resolves({id:name,name:'demo'});
  fake.when('GET','/v1/projects/{idOrName}/members')
    .resolves({members:[],pagination:{next:null}})
    .resolves({members:[],pagination:{next:null}})
    .resolves({members:[],pagination:{next:null}})
    .resolves(after??{members:[{uid,role}],pagination:{next:null}});
}
describe('D-1h project access grants',()=>{
  beforeEach(()=>loadToken.mockResolvedValue(token));
  it('advertises only for full profile and requires production connection',async()=>{
    const f=fixture();reads(f.fake);
    expect(listMcpTools(registry,{profile:'full',listing:'catalog'}).map(t=>t.name))
      .toContain('vercel_project_add_member');
    expect(listMcpTools(registry,{profile:'everyday'}).map(t=>t.name))
      .not.toContain('vercel_project_add_member');
    expect((await f.call({project:name,uid,role,confirm:true},{...connection,profile:'read_only'})).isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
    expect(parse(await f.call({project:name,uid,role,confirm:true},{...connection,mode:'preview'})).status)
      .toBe('refused_by_guard');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('previews without granting a role, then confirms exact POST and independent read-back',async()=>{
    const f=fixture();reads(f.fake);
    expect(parse(await f.call({project:name,uid,role,dryRun:true})).status).toBe('preview');
    expect(parse(await f.call({project:name,uid,role})).status).toBe('needs_confirmation');
    f.fake.when('POST','/v1/projects/{idOrName}/members').resolves({id:name});
    const r=parse(await f.call({project:name,uid,role,confirm:true,requestKey:'roleGrantFAKE01'}));
    expect(r).toMatchObject({status:'applied',confirmed:true,mode:'PRODUCTION'});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(1);
    expect(f.fake.calls.find(x=>x.method==='POST').body).toEqual({uid,role});
    expect(f.fake.calls.find(x=>x.method==='POST').query.teamId).toBe('team_FAKE');
    expect(f.rows.size).toBe(2);
    expect(f.audits.length).toBe(2);
    f.fake.verify();
  });
  it('refuses already-assigned users and incomplete membership pagination',async()=>{
    for(const page of [
      {members:[{uid,role:'PROJECT_DEVELOPER'}],pagination:{next:null}},
      {members:[],pagination:{next:42}}
    ]){
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}').resolves({id:name,name:'demo'});
      f.fake.when('GET','/v1/projects/{idOrName}/members').resolves(page);
      const r=parse(await f.call({project:name,uid,role,confirm:true}));
      expect(r.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    }
  });
  it('denies account/project override and project-only tokens without mutating',async()=>{
    const f=fixture();
    for(const args of [{project:name,uid,role,teamId:'forged',confirm:true},
      {project:'../fake',uid,role,confirm:true},{project:name,uid,role:'OWNER',confirm:true}]){
      expect(parse(await f.call(args)).status).toBe('refused_by_guard');
    }
    loadToken.mockResolvedValue({...token,account:{...token.account,scope:'project',project_id:name}});
    expect(parse(await f.call({project:name,uid,role,confirm:true})).status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
  });
  it('declares access widening and dispatches through the same meta gate',async()=>{
    const tool=registry.tools.find(x=>x.name==='vercel_project_add_member');
    expect(tool.writeContract).toMatchObject({production:true,targets:true,access:true,spend:false});
    const f=fixture();reads(f.fake);
    const result=await f.call({name:'vercel_project_add_member',
      args:{project:name,uid,role}},connection,'vercel_call');
    expect(parse(result).status).toBe('needs_confirmation');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
});
