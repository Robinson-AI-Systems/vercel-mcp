import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE',mode:'preview',profile:'everyday',listing:'catalog'};
const token={token:'vcp_FAKE_project',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
function fixture(limit=0){
  const state=new Map(),audit=[];
  // For legacy success scenarios a positive fixture value means an independent
  // OWNER APPROVED simulated ledger. The configured daily spend limit is NOT an authorization.
  const approval={status:limit>0?'approved':'pending'};
  const purchaseRef='12345678-1234-1234-1234-123456789abc';
  const db={
    getAccountCredential:async()=>({}),
    listProtectedResources:async()=>[],
    recordChange:async row=>audit.push(row),
    getVercelAccountSafe:async id=>({id,spend_limit_cents:limit}),
    getTodaySpendCents:async()=>0,
    requestPurchaseIntent:async()=>({reference:purchaseRef,status:approval.status,
      expiresAt:new Date(Date.now()+600000).toISOString()}),
    getPurchaseIntent:async()=>({status:approval.status,
      price_cents:null,ceiling_cents:Number.MAX_SAFE_INTEGER,
      approved_at:new Date(),expires_at:new Date(Date.now()+600000),
      consumed_at:approval.status==='consumed'?new Date():null}),
    consumePurchaseIntent:async()=>{if(approval.status!=='approved')return false;
      approval.status='consumed';return true;},
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(state.has(key))return state.get(key);
        state.set(key,{state:'pending'});
        return {state:'claimed',claimId:'claim_FAKE'};
      },
      release:async({key})=>{state.delete(key);},
      complete:async({key,result})=>state.set(key,{state:'completed',result})
    })
  };
  const fake=makeFakeVercel();
  const call=(args,c=connection)=>dispatchReadOnlyTool({registry,
    name:'vercel_project_create',
    args:args?.gitRepository&&args.requestKey===undefined?{...args,requestKey:'fixtureGitRequest01'}:args,
    db,connection:c,fetchImpl:fake.fetch});
  return {db,fake,audit,state,approval,call};
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
      .rejects(404).rejects(404).resolves({id:'prj_FAKE_NEW',name:'demo-site',framework:'nextjs'});
    f.fake.when('POST','/v11/projects')
      .resolves({id:'prj_FAKE_NEW',name:'demo-site',token:'should-never-expose'});
    const args={name:'demo-site',framework:'nextjs',confirm:true,requestKey:'projectFAKE01'};
    const result=parse(await f.call(args));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(JSON.stringify(result)).not.toContain('should-never-expose');
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','POST','GET']);
    expect(f.fake.calls[2].query).toEqual({teamId:'team_FAKE'});
    expect(f.fake.calls[2].body).toEqual({name:'demo-site',framework:'nextjs'});
    expect(f.state.size).toBe(2);
    expect(f.audit).toHaveLength(1);
    f.fake.verify();
  });
  it('creates grouped nonspending build configuration and independently verifies every value',async()=>{
    const f=fixture();
    const body={name:'demo-site',framework:'remix',buildCommand:'npm run build:site',
      installCommand:'npm ci --ignore-scripts',devCommand:'npm run dev:site',
      commandForIgnoringBuildStep:'git diff --quiet HEAD~1',
      rootDirectory:'apps/site',outputDirectory:'dist/site'};
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404).rejects(404)
      .resolves({id:'prj_FAKE_NEW',...body});
    f.fake.when('POST','/v11/projects').resolves({id:'prj_FAKE_NEW',name:body.name});
    const result=parse(await f.call({...body,confirm:true}));
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','POST','GET']);
    expect(f.fake.calls[2].body).toEqual(body);
    expect(JSON.stringify(result)).not.toContain(body.buildCommand);
    expect(JSON.stringify(f.audit)).not.toContain(body.installCommand);
    f.fake.verify();
  });
  it('rejects dangerous paths and command control characters before I/O',async()=>{
    const f=fixture();
    for(const path of ['../root','/etc','dir//child','dir'+String.fromCharCode(92)+'child']){
      const r=await f.call({name:'demo-site',rootDirectory:path,confirm:true});
      expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
    }
    const r=await f.call({name:'demo-site',
      buildCommand:'build'+String.fromCharCode(10)+'unsafe',confirm:true});
    expect(r.isError||parse(r).status==='refused_by_guard').toBe(true);
    expect(f.fake.calls).toHaveLength(0);
  });
  it('rejects protected names, malformed inputs, project-only credentials and existing projects',async()=>{
    const f=fixture();
    const bad=[{name:'../demo',confirm:true},
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
  it('does not mutate when project read-back disagrees with the created identity',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404).rejects(404)
      .resolves({id:'prj_FAKE_OTHER',name:'unexpected'});
    f.fake.when('POST','/v11/projects').resolves({id:'prj_FAKE_NEW',name:'demo-site'});
    const result=parse(await f.call({name:'demo-site',confirm:true,requestKey:'differentFAKE01'}));
    expect(result).toMatchObject({status:'applied',confirmed:false});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','POST','GET']);
  });
  it('reports unknown read-back without retrying POST or falsely confirming',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404).rejects(404).rejects(503);
    f.fake.when('POST','/v11/projects').resolves({id:'prj_FAKE_NEW',name:'demo-site'});
    const result=parse(await f.call({name:'demo-site',confirm:true,requestKey:'unknownFAKE01'}));
    expect(result).toMatchObject({status:'applied',confirmed:null});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it('routes through meta vercel_call and still denies unauthorized profiles before provider I/O',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const viaCall=(profile)=>dispatchReadOnlyTool({registry,name:'vercel_call',
      args:{name:'vercel_project_create',args:{name:'meta-project',confirm:false}},
      db:f.db,connection:{...connection,profile},fetchImpl:f.fake.fetch});
    const denied=await viaCall('read_only');
    expect(denied.isError).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
    const allowed=parse(await viaCall('everyday'));
    expect(allowed.status).toBe('needs_confirmation');
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
  });
  it('refuses unknown write outcome and never retries a failed POST automatically',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404).rejects(404);
    f.fake.when('POST','/v11/projects').rejects(503);
    const result=parse(await f.call({name:'demo-site',confirm:true,requestKey:'failureFAKE01'}));
    expect(result.status).toBe('outcome_unknown');
    expect(result.confirmed).toBeNull();
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it('uses the real tool contract with declared guards and declares cost risk for conditional Git import but not access escalation',()=>{
    const tool=registry.tools.find(x=>x.name==='vercel_project_create');
    expect(tool.writeContract).toMatchObject({production:true,targets:true,
      spend:true,access:false,secretOut:false,secretIn:false});
    expect(tool.guardedWrite).toBe(true);
  });

  it('advertises nonnullable 256-character configuration on project creation',()=>{
    const props=registry.tools.find(x=>x.name==='vercel_project_create').inputSchema.properties;
    for(const key of ['buildCommand','installCommand','devCommand',
      'commandForIgnoringBuildStep','rootDirectory','outputDirectory']){
      expect(props[key]).toEqual({type:'string',minLength:1,maxLength:256});
    }
  });
  it('rejects reset null and 257 characters without I/O, accepts 256 with verified creation',async()=>{
    for(const key of ['buildCommand','installCommand','devCommand',
      'commandForIgnoringBuildStep','rootDirectory','outputDirectory']){
      const f=fixture();
      for(const value of [null,'a'.repeat(257)]){
        const res=await f.call({name:'demo-site',[key]:value,confirm:true});
        expect(res.isError||parse(res).status==='refused_by_guard').toBe(true);
      }
      expect(f.fake.calls).toHaveLength(0);
      const value='a'.repeat(256);
      f.fake.when('GET','/v9/projects/{idOrName}').rejects(404).rejects(404)
        .resolves({id:'prj_FAKE_NEW',name:'demo-site',[key]:value});
      f.fake.when('POST','/v11/projects')
        .resolves({id:'prj_FAKE_NEW',name:'demo-site'});
      const result=parse(await f.call({name:'demo-site',[key]:value,confirm:true}));
      expect(result).toMatchObject({status:'applied',confirmed:true});
      expect(f.fake.calls[2].body).toEqual({name:'demo-site',[key]:value});
      f.fake.verify();
    }
  });

  it('verifies Git namespace and repository identity but refuses an unbounded metered import',async()=>{
    const f=fixture(20000);
    const linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github',name:'Acme'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},
        repos:[{id:42,fullName:'acme/site',private:true}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const result=parse(await f.call({name:'demo-site',gitRepository:linked,
      confirm:true,requestKey:'gitCreationFAKE01'},
      {...connection,mode:'production',profile:'full'}));
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toMatch(/provider-enforceable/i);
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','GET']);
    expect(f.fake.calls[1].query).toEqual({provider:'github',namespaceId:'org_123',
      query:'site',teamId:'team_FAKE'});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.audit).toHaveLength(0);
    f.fake.verify();
  });
  it('refuses Git creation under $0 owner limit and without production/full authority',async()=>{
    for(const scenario of ['zeroBudget','preview','everyday']){
      const f=fixture(scenario==='zeroBudget'?0:20000);
      f.fake.when('GET','/v1/integrations/git-namespaces').resolves([
        {id:'org_123',provider:'github'}]);
      f.fake.when('GET','/v1/integrations/search-repo')
        .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'acme/site'}]});
      f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
      const c={...connection,profile:scenario==='everyday'?'everyday':'full',
        mode:scenario==='preview'?'preview':'production'};
      const res=parse(await f.call({name:'demo-site',gitRepository:{
        type:'github',repo:'acme/site',namespaceId:'org_123'},confirm:true},c));
      expect(res.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    }
  });
  it('rejects unknown and restricted Git namespaces, missing exact repo, and forged names',async()=>{
    for(const issue of ['restricted','missingNamespace','wrongRepo']){
      const f=fixture(20000);
      f.fake.when('GET','/v1/integrations/git-namespaces')
        .resolves(issue==='missingNamespace'?[]:
          [{id:'org_123',provider:'github',isAccessRestricted:issue==='restricted'}]);
      if(issue==='wrongRepo'){
        f.fake.when('GET','/v1/integrations/search-repo')
          .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'unrelated/site'}]});
      }
      const res=parse(await f.call({name:'demo-site',
        gitRepository:{type:'github',repo:'acme/site',namespaceId:'org_123'},
        confirm:true},{...connection,mode:'production',profile:'full'}));
      expect(res.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
      f.fake.verify();
    }
    const bad=fixture();
    for(const gitRepository of [
      {type:'github',repo:'../sneak',namespaceId:'org_123'},
      {type:'github',repo:'acme/site',namespaceId:'../escape'},
      {type:'github',repo:'acme/site',namespaceId:'org_123',token:'secret'},
      {type:'unknown',repo:'acme/site',namespaceId:'org_123'}
    ]){
      const res=await bad.call({name:'demo-site',gitRepository,confirm:true});
      expect(res.isError||parse(res).status==='refused_by_guard').toBe(true);
    }
    expect(bad.fake.calls).toHaveLength(0);
  });
  it('refuses ambiguous or foreign-namespace repositories before any paid import POST',async()=>{
    const linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    const scenarios=[
      {namespaces:[{id:'org_123',provider:'github'},{id:'org_123',provider:'github'}],repos:[{fullName:'acme/site'}]},
      {namespaces:[{id:'org_123',provider:'github',requireReauth:'true'}],repos:[{fullName:'acme/site'}]},
      {namespaces:[{id:'org_123',provider:'github'}],repos:[{fullName:'acme/site'},{slug:'acme/site'}]},
      {namespaces:[{id:'org_123',provider:'github'}],repos:[{fullName:'acme/site',provider:'gitlab'}]},
      {namespaces:[{id:'org_123',provider:'github'}],repos:[{fullName:'acme/site',namespaceId:'org_OTHER'}]},
      {namespaces:[{id:'org_123',provider:'github'}],repos:[{fullName:'acme/site',isAccessRestricted:true}]}
    ];
    for(const item of scenarios){
      const f=fixture(20000);
      f.fake.when('GET','/v1/integrations/git-namespaces').resolves(item.namespaces);
      f.fake.when('GET','/v1/integrations/search-repo').resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:item.repos});
      const result=parse(await f.call({name:'demo-site',gitRepository:linked,
        confirm:true},{...connection,mode:'production',profile:'full'}));
      expect(result.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
      expect(f.audit).toHaveLength(0);
    }
  });
  it('never dispatches a metered POST if its separately approved grant is revoked at consumption',async()=>{
    const f=fixture(20000),linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.db.consumePurchaseIntent=async()=>false;
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const res=parse(await f.call({name:'demo-site',gitRepository:linked,
      confirm:true,requestKey:'budgetRaceFAKE01'}, {...connection,mode:'production',profile:'full'}));
    expect(res.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
  });
  it('rechecks the consumed owner grant AFTER the final project lookup before metered POST',async()=>{
    const f=fixture(20000),linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.db.getPurchaseIntent=async()=>({status:f.approval.status==='consumed'?'revoked':'approved',
      ceiling_cents:Number.MAX_SAFE_INTEGER,approved_at:new Date(),
      expires_at:new Date(Date.now()+600000),consumed_at:new Date()});
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const res=parse(await f.call({name:'demo-site',gitRepository:linked,confirm:true,
      requestKey:'lateBudgetRaceFAKE01'}, {...connection,mode:'production',profile:'full'}));
    expect(res.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('never authorizes paid imports solely from a positive daily spending limit',async()=>{
    const f=fixture(0),gitRepository={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.db.getVercelAccountSafe=async id=>({id,spend_limit_cents:999999999});
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const pending=parse(await f.call({name:'demo-site',gitRepository,confirm:true,
      requestKey:'positiveBudgetNoOwner'}, {...connection,mode:'production',profile:'full'}));
    expect(pending.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.approval.status).toBe('pending');
  });
  it('does not advance to an execution-time credential without bounded cost evidence',async()=>{
    const f=fixture(20000),gitRepository={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},
        repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const result=parse(await f.call({name:'demo-site',gitRepository,
      confirm:true,requestKey:'bindOnceGitFAKE01'},
      {...connection,mode:'production',profile:'full'}));
    expect(result.status).toBe('refused_by_guard');
    expect(loadToken).toHaveBeenCalledTimes(1);
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
  });
  it('refuses a concurrently claimed name using the POST credential',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}')
      .rejects(404).resolves({id:'prj_OTHER',name:'demo-site'});
    const res=parse(await f.call({name:'demo-site',confirm:true,
      requestKey:'nameRaceFAKE01'}));
    expect(res).toMatchObject({status:'refused_by_guard',confirmed:false});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET']);
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.audit).toHaveLength(0);
  });
  it('refuses paid Git import after a different actor claims the name',async()=>{
    const f=fixture(20000),gitRepository={
      type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},
        repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}')
      .rejects(404).resolves({id:'prj_OTHER',name:'demo-site'});
    const res=parse(await f.call({name:'demo-site',gitRepository,confirm:true,
      requestKey:'gitNameRaceFAKE01'},
      {...connection,mode:'production',profile:'full'}));
    expect(res).toMatchObject({status:'refused_by_guard',confirmed:false});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    expect(f.audit).toHaveLength(0);
  });
  it('refuses a mismatched root account before any metered Git import',async()=>{
    const linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    for(const gitAccount of [
      {provider:'gitlab',namespaceId:'org_123'},
      {provider:'github',namespaceId:'another'},
      {provider:'github',namespaceId:{}},
      {provider:'github'},
      null
    ]){
      const f=fixture(20000);
      f.fake.when('GET','/v1/integrations/git-namespaces')
        .resolves([{id:'org_123',provider:'github'}]);
      f.fake.when('GET','/v1/integrations/search-repo')
        .resolves({gitAccount,repos:[{fullName:'acme/site'}]});
      const res=parse(await f.call({name:'demo-site',gitRepository:linked,
        confirm:true},{...connection,mode:'production',profile:'full'}));
      expect(res.status).toBe('refused_by_guard');
      expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
      expect(f.audit).toHaveLength(0);
    }
  });
  it('refuses a changed root account at the bound-credential execution check',async()=>{
    const f=fixture(20000),linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},
        repos:[{fullName:'acme/site'}]})
      .resolves({gitAccount:{provider:'gitlab',namespaceId:'org_123'},
        repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const res=parse(await f.call({name:'demo-site',gitRepository:linked,
      confirm:true,requestKey:'rootIdentityRace01'},
      {...connection,mode:'production',profile:'full'}));
    expect(res.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('refuses Git import when repository access is revoked after preflight',async()=>{
    const f=fixture(20000),linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'acme/site'}]})
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'acme/site',requireReauth:true}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const res=parse(await f.call({name:'demo-site',gitRepository:linked,
      confirm:true,requestKey:'gitRaceFAKE01'},
      {...connection,mode:'production',profile:'full'}));
    expect(res).toMatchObject({status:'refused_by_guard',confirmed:false});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.fake.calls.filter(x=>x.path==='/v1/integrations/search-repo')).toHaveLength(1);
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('refuses Git import if its namespace becomes restricted before execution',async()=>{
    const f=fixture(20000),linked={type:'github',repo:'acme/site',namespaceId:'org_123'};
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}])
      .resolves([{id:'org_123',provider:'github',isAccessRestricted:true}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const res=parse(await f.call({name:'demo-site',gitRepository:linked,
      confirm:true,requestKey:'namespaceRaceFAKE01'},
      {...connection,mode:'production',profile:'full'}));
    expect(res).toMatchObject({status:'refused_by_guard',confirmed:false});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    expect(f.fake.calls.filter(x=>x.path==='/v1/integrations/git-namespaces')).toHaveLength(1);
  });
  it('does not describe an unbounded Git import as completed provider work',async()=>{
    const f=fixture(20000);
    f.fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'org_123',provider:'github'}]);
    f.fake.when('GET','/v1/integrations/search-repo')
      .resolves({gitAccount:{provider:'github',namespaceId:'org_123'},
        repos:[{fullName:'acme/site'}]});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404);
    const res=parse(await f.call({name:'demo-site',gitRepository:{
      type:'github',repo:'acme/site',namespaceId:'org_123'},confirm:true},
      {...connection,mode:'production',profile:'full'}));
    expect(res).toMatchObject({status:'refused_by_guard',confirmed:false});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    f.fake.verify();
  });
});
    f.fake.when('GET','/v9/projects/{idOrName}').rejects(404).rejects(404)
      .resolves({id:'prj_FAKE_NEW',name:'demo-site'});
    f.fake.when('POST','/v11/projects')
      .resolves({id:'prj_FAKE_NEW',name:'demo-site'});
    const res=parse(await f.call({name:'demo-site',gitRepository:{
      type:'github',repo:'acme/site',namespaceId:'org_123'},confirm:true},
      {...connection,mode:'production',profile:'full'}));
    expect(res).toMatchObject({status:'applied',confirmed:false});
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(1);
    f.fake.verify();
  });
});
