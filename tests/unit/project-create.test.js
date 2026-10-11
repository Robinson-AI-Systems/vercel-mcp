import {describe,it,expect,vi,beforeEach} from 'vitest';
import {randomBytes} from 'node:crypto';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE',mode:'preview',profile:'everyday',listing:'catalog'};
const token={token:'vcp_FAKE_project',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
function fixture(){
  const state=new Map(),audit=[];
  const db={
    getAccountCredential:async()=>({}),
    listProtectedResources:async()=>[],
    recordChange:async row=>audit.push(row),
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(state.has(key))return state.get(key);
        state.set(key,{state:'pending'});
        return {state:'claimed',claimId:'claim_FAKE'};
      },
      complete:async({key,result})=>state.set(key,{state:'completed',result})
    })
  };
  const fake=makeFakeVercel();
  const call=(args,c=connection)=>dispatchReadOnlyTool({registry,
    name:'vercel_project_create',args,db,connection:c,fetchImpl:fake.fetch});
  return {db,fake,audit,state,call};
}
const parse=r=>JSON.parse(r.content[0].text);
describe('D-1f guarded project creation',()=>{
  beforeEach(()=>loadToken.mockResolvedValue(token));
  it('advertises only to write-capable profiles and denies direct read-only/owner spoofing',async()=>{
    const f=fixture();
    expect(listMcpTools(registry,{profile:'everyday',listing:'catalog'}).map(t=>t.name))
      .toContain('vercel_project_create');
    expect(listMcpTools(registry,{profile:'read_only',listing:'catalog'}).map(t=>t.name))
      .not.toContain('vercel_project_create');
    expect((await f.call({name:'demo-site',confirm:true},{...connection,profile:'read_only'})).isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
  });
  it('does not mutate for dry-run or without explicit confirmation',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    expect(parse(await f.call({name:'demo-site',dryRun:true})).status).toBe('preview');
    expect(parse(await f.call({name:'demo-site'})).status).toBe('needs_confirmation');
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    expect(f.fake.calls).toHaveLength(2);
    expect(f.audit).toHaveLength(1);
  });
  it('creates once with server scope, independent verified read-back, and safe replay',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}')
      .rejects(404).resolves({id:'prj_FAKE_NEW',name:'demo-site'});
    f.fake.when('POST','/v11/projects')
      .resolves({id:'prj_FAKE_NEW',name:'demo-site',token:'should-never-expose'});
    const args={name:'demo-site',framework:'nextjs',confirm:true,requestKey:'projectFAKE01'};
    const result=parse(await f.call(args));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(JSON.stringify(result)).not.toContain('should-never-expose');
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','POST','GET']);
    expect(f.fake.calls[1].query).toEqual({teamId:'team_FAKE'});
    expect(f.fake.calls[1].body).toEqual({name:'demo-site',framework:'nextjs'});
    expect(f.state.size).toBe(2);
    expect(f.audit).toHaveLength(1);
    f.fake.verify();
  });
  it('rejects protected names, malformed inputs, project-only credentials and existing projects',async()=>{
    const f=fixture();
    const bad=[{name:'vercel-mcp',confirm:true},{name:'../demo',confirm:true},
      {name:'demo-site',teamId:'other',confirm:true},{name:'demo-site',confirm:'yes'},
      {name:'demo-site',framework:'unknown'}];
    for(const args of bad){const r=await f.call(args);expect(r.isError || parse(r).status==='refused_by_guard').toBe(true);}
    expect(f.fake.calls).toHaveLength(0);
    loadToken.mockResolvedValue({...token,account:{...token.account,scope:'project',project_id:'prj_FAKE_OLD'}});
    expect(parse(await f.call({name:'demo-site',confirm:true})).status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
    loadToken.mockResolvedValue(token);
    f.fake.when('GET','/v9/projects/{idOrName}').resolves({id:'prj_FAKE_EXISTS',name:'demo-site'});
    expect(parse(await f.call({name:'demo-site',confirm:true})).status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(1);
  });
});
