import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {oneTimeSecrets} from '../../src/core/one-time-secrets.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
vi.mock('../../src/core/one-time-secrets.js',()=>({oneTimeSecrets:vi.fn()}));
const account={token:'vcp_FAKE_transfer',account:{id:'acct_FAKE',team_id:'team_FAKE',scope:'team'}};
const conn={account:'acct_FAKE',mode:'production',profile:'full',listing:'catalog'};
const project={id:'prj_FAKE_DEMO',name:'demo-site'};
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),replay=new Map(),audit=[],vault=[];
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async entry=>audit.push(entry),
    requestReplayStore:()=>({
      claim:async({key})=>replay.has(key)?{state:'completed',result:replay.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>{replay.set(key,result);},
      release:async({key,claimId})=>{if(key===claimId)replay.delete(key);}
    })
  };
  oneTimeSecrets.mockReturnValue({issue:async args=>{
    vault.push(args);
    return {id:'123e4567-e89b-12d3-a456-426614174000',
      expiresAt:'2026-10-12T02:00:00.000Z'};
  }});
  const call=(args,c=conn)=>dispatchReadOnlyTool({
    registry,name:'vercel_project_transfer',args,connection:c,db,fetchImpl:fake.fetch
  });
  return {fake,replay,audit,vault,call};
}
describe('D-1o guarded transfer request',()=>{
  beforeEach(()=>{loadToken.mockResolvedValue(account);oneTimeSecrets.mockReset();});
  it('exposes owner-only non-readonly access-changing secret-out contract',()=>{
    const entry=registry.tools.find(x=>x.name==='vercel_project_transfer');
    expect(entry.writeContract).toMatchObject({production:true,targets:true,
      access:true,secretOut:true,spend:false});
    expect(entry.annotations.destructiveHint).toBe(true);
    expect(listMcpTools(registry,{...conn,profile:'read_only'})
      .some(t=>t.name==='vercel_project_transfer')).toBe(false);
  });
  it('returns opaque owner-vault handle, never provider code, after scoped POST',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}').resolves(project).resolves(project);
    f.fake.when('POST','/projects/{idOrName}/transfer-request')
      .resolves({code:'claim_FAKE_NEVER_DISPLAY'});
    const args={project:project.id,expectedName:project.name,confirm:true,
      requestKey:'transferFAKE01'};
    const result=parse(await f.call(args));
    expect(result).toMatchObject({status:'applied',confirmed:null});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','POST']);
    expect(f.fake.calls[2].query.teamId).toBe('team_FAKE');
    expect(f.fake.calls[2].body).toEqual({});
    expect(f.vault).toEqual([{account:'acct_FAKE',kind:'project_transfer',
      label:'demo-site',value:'claim_FAKE_NEVER_DISPLAY'}]);
    expect(JSON.stringify(result)).not.toContain('claim_FAKE_NEVER_DISPLAY');
    expect(JSON.stringify(f.audit)).not.toContain('claim_FAKE_NEVER_DISPLAY');
    expect(JSON.stringify([...f.replay])).not.toContain('claim_FAKE_NEVER_DISPLAY');
    expect(f.replay.size).toBe(2);
    f.fake.verify();
  });
  it('never POSTs for dry-run, no confirmation, wrong name or preview mode',async()=>{
    for(const scenario of ['dryRun','noConfirm','wrongName','preview']){
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}').resolves(project);
      const args={project:project.id,expectedName:scenario==='wrongName'?'other':project.name,
        ...(scenario==='dryRun'?{dryRun:true}:
          scenario==='noConfirm'||scenario==='wrongName'?{}:{confirm:true})};
      const c=scenario==='preview'?{...conn,mode:'preview'}:conn;
      const response=parse(await f.call(args,c));
      expect(response.status).toBe(scenario==='wrongName'||scenario==='preview'?
        'refused_by_guard':scenario==='dryRun'?'preview':'needs_confirmation');
      expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
      expect(f.vault).toHaveLength(0);
      f.fake.verify();
    }
  });
  it('fails closed on forged scope and incorrect account and never performs provider I/O',async()=>{
    const f=fixture();
    for(const args of [
      {project:'../escape',expectedName:'demo-site',confirm:true},
      {project:project.id,expectedName:'demo-site',teamId:'other'},
      {project:project.id,expectedName:'demo-site',confirm:'yes'}
    ]){
      const x=await f.call(args);
      expect(x.isError||parse(x).status==='refused_by_guard').toBe(true);
    }
    expect(f.fake.calls).toHaveLength(0);
    loadToken.mockResolvedValue({...account,account:{...account.account,
      scope:'project',project_id:project.id}});
    expect(parse(await f.call({project:project.id,expectedName:'demo-site',confirm:true}))
      .status).toBe('refused_by_guard');
    expect(f.fake.calls).toHaveLength(0);
  });
  it('refuses late rename or replacement before a transfer claim can be issued',async()=>{
    for(const late of [{...project,name:'another-site'}, {...project,id:'prj_OTHER'}]){
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}')
        .resolves(project).resolves(late);
      const result=parse(await f.call({project:project.id,
        expectedName:project.name,confirm:true,requestKey:'transferLateFAKE01'}));
      expect(result.status).toBe('refused_by_guard');
      expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET']);
      expect(f.vault).toHaveLength(0);
      f.fake.verify();
    }
  });
  it('refuses transfer when the stored token loses team scope or moves teams',async()=>{
    for(const changed of [
      {...account.account,scope:'project',project_id:project.id},
      {...account.account,team_id:'team_OTHER'},
      {...account.account,id:'acct_OTHER'}
    ]){
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}').resolves(project);
      loadToken.mockResolvedValueOnce(account).mockResolvedValueOnce({
        ...account,account:changed});
      const result=parse(await f.call({project:project.id,
        expectedName:project.name,confirm:true,requestKey:'transferScopeFAKE01'}));
      expect(result.status).toBe('refused_by_guard');
      expect(f.fake.calls.map(x=>x.method)).toEqual(['GET']);
      expect(f.vault).toHaveLength(0);
      expect(f.fake.calls.some(x=>x.method==='POST')).toBe(false);
    }
  });
  it('never exposes unsealed code if vault fails or Vercel supplies malformed code',async()=>{
    for(const failure of ['vault','code']){
      const f=fixture();
      f.fake.when('GET','/v9/projects/{idOrName}').resolves(project).resolves(project);
      f.fake.when('POST','/projects/{idOrName}/transfer-request')
        .resolves({code:failure==='code'?null:'claim_FAKE_NO_DISCLOSURE'});
      if(failure==='vault')oneTimeSecrets.mockReturnValue({
        issue:async()=>{throw new Error('Vault failure');}
      });
      const result=parse(await f.call({project:project.id,
        expectedName:project.name,confirm:true,requestKey:failure+'TransferFAKE'}));
      expect(result.status).toBe('outcome_unknown');
      expect(JSON.stringify(result)).not.toContain('claim_FAKE_NO_DISCLOSURE');
      expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(1);
      f.fake.verify();
    }
  });
});
