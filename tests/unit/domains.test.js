import {describe,it,expect,vi,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {validateRequest} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async old=>({...await old(),loadToken:vi.fn()}));

const project='prj_FAKE_ONE',otherProject='prj_FAKE_OTHER',domain='example.test';
const connection={account:'acct_FAKE',mode:'preview',profile:'full',listing:'catalog'};
const production={...connection,mode:'production'};
const saved={token:'vcp_FAKE_domain',account:{
  id:'acct_FAKE',team_id:'team_FAKE',scope:'team',project_id:null}};
const projectRow={id:project,name:'demo',accountId:'team_FAKE'};
const domainRow={name:domain,verified:true,serviceType:'external',
  nameservers:['ns1.example.net','ns2.example.net'],expiresAt:1800000000000,
  createdAt:1700000000000,teamId:'team_FAKE'};
const projectDomainRow={name:domain,projectId:project,apexName:domain,
  gitBranch:null,customEnvironmentId:null,redirect:null,redirectStatusCode:null,
  verified:true,createdAt:1700000000000,updatedAt:1700000001000};
const configRow={misconfigured:false,configuredBy:'CNAME',
  recommendedCNAME:[{rank:1,value:'cname.vercel-dns.com'}],
  recommendedIPv4:[{rank:1,value:'76.76.21.21'}],acceptedChallenges:['dns-01']};
const value=result=>JSON.parse(result.content[0].text);
function fixture(){
  const fake=makeFakeVercel(),audits=[],claims=[],replay=new Map();
  fake.when('GET','/v9/projects/{idOrName}').resolves(projectRow);
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async item=>audits.push(item),
    requestReplayStore:()=>({
      claim:async claim=>{
        claims.push(claim);
        if(replay.has(claim.key))
          return {state:'completed',result:replay.get(claim.key)};
        return {state:'claimed',claimId:claim.key};
      },
      complete:async ({key,result})=>{replay.set(key,result);},
      release:async()=>true
    })
  };
  const call=(name,parameters,conn=connection)=>dispatchReadOnlyTool({
    registry,name,args:parameters,connection:conn,db,fetchImpl:fake.fetch
  });
  return {fake,db,call,audits,claims};
}
// Usage enumeration: no aliases, one team project, no project domains.
function emptyUsage(fake){
  fake.when('GET','/v4/aliases').resolves({aliases:[],pagination:{next:null}});
  fake.when('GET','/v10/projects').resolves({
    projects:[{id:project,name:'demo'}],pagination:{next:null}});
  fake.when('GET','/v9/projects/{idOrName}/domains').resolves({
    domains:[],pagination:{next:null}});
}
describe('N-1 team and project domains',()=>{
  beforeEach(()=>{vi.clearAllMocks();loadToken.mockResolvedValue(saved);});
  it('registers eleven domain tools with catalog profiles and write contracts',()=>{
    const tools=registry.tools.filter(x=>x.name.startsWith('vercel_domain_'));
    expect(tools.map(x=>x.name)).toEqual(['vercel_domain_list','vercel_domain_get',
      'vercel_domain_check_config','vercel_domain_add_to_team','vercel_domain_update',
      'vercel_domain_remove_from_team','vercel_domain_list_project_domains',
      'vercel_domain_attach_to_project','vercel_domain_update_project_domain',
      'vercel_domain_detach_from_project','vercel_domain_verify_project_domain']);
    for(const tool of tools){
      expect(tool.description.length).toBeLessThanOrEqual(160);
      expect(tool.writeContract??{production:true,targets:true,spend:false,access:false})
        .toMatchObject({production:true,targets:true,spend:false,access:false});
    }
    expect(tools.filter(x=>x.writes).map(x=>x.name)).toEqual([
      'vercel_domain_add_to_team','vercel_domain_update','vercel_domain_remove_from_team',
      'vercel_domain_attach_to_project','vercel_domain_update_project_domain',
      'vercel_domain_detach_from_project','vercel_domain_verify_project_domain']);
    expect(tools.find(x=>x.name==='vercel_domain_attach_to_project').profiles)
      .toEqual(['everyday','full']);
    expect(tools.find(x=>x.name==='vercel_domain_detach_from_project').profiles)
      .toEqual(['full']);
    expect(listMcpTools(registry,{...connection,profile:'read_only'})
      .map(x=>x.name).filter(x=>x.startsWith('vercel_domain_')))
      .toEqual(['vercel_domain_list','vercel_domain_get','vercel_domain_check_config',
        'vercel_domain_list_project_domains']);
    expect(listMcpTools(registry,{...connection,profile:'everyday'})
      .map(x=>x.name).filter(x=>x.startsWith('vercel_domain_')))
      .toEqual(['vercel_domain_list','vercel_domain_get','vercel_domain_check_config',
        'vercel_domain_list_project_domains','vercel_domain_attach_to_project',
        'vercel_domain_update_project_domain','vercel_domain_verify_project_domain']);
  });
  it('lists team domains with a bounded page and callable cursor',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains').resolves({domains:[domainRow],
      pagination:{next:'1700000001000'}});
    const result=value(await f.call('vercel_domain_list',{limit:5}));
    expect(result.domains).toEqual([{name:domain,verified:true,serviceType:'external',
      nameservers:['ns1.example.net','ns2.example.net'],
      expiresAt:1800000000000,createdAt:1700000000000}]);
    expect(result.next).toBe(1700000001000);
    expect(result.complete).toBe(false);
    expect(f.fake.calls[0].query).toMatchObject({teamId:'team_FAKE',limit:'5'});
    expect(f.fake.calls.every(x=>x.method==='GET')).toBe(true);
    f.fake.verify();
  });
  it('gets one domain with its verification record and empty usage',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}').resolves(domainRow);
    f.fake.when('GET','/v9/domains/{domain}/verification').resolves({
      txtRecord:'vercel-domain-verify=example.test,FAKE123',
      verificationDomain:'_vercel.example.test'});
    emptyUsage(f.fake);
    const result=value(await f.call('vercel_domain_get',{domain}));
    expect(result.domain).toMatchObject({name:domain,verified:true});
    expect(result.verification).toEqual({txtRecord:'vercel-domain-verify=example.test,FAKE123',
      verificationDomain:'_vercel.example.test'});
    expect(result.usedBy).toEqual({projects:[],aliases:[]});
    expect(f.fake.calls.map(x=>x.method)).toEqual(['GET','GET','GET','GET','GET']);
    f.fake.verify();
  });
  it('checks domain config and reports the exact records still needed',async()=>{
    const f=fixture();
    f.fake.when('GET','/v6/domains/{domain}/config').resolves({...configRow,
      misconfigured:true,configuredBy:null,
      recommendedCNAME:[{rank:1,value:'cname.vercel-dns.com'}]});
    const result=value(await f.call('vercel_domain_check_config',{domain}));
    expect(result).toMatchObject({domain,project:null,misconfigured:true,
      configuredBy:null,recommendedCNAME:['cname.vercel-dns.com'],
      recommendedIPv4:['76.76.21.21'],acceptedChallenges:['dns-01']});
    const scoped=value(await f.call('vercel_domain_check_config',{domain,project}));
    expect(scoped.project).toBe(project);
    expect(f.fake.calls[2].query).toMatchObject({projectIdOrName:project});
    f.fake.verify();
  });
  it('lists project domains for a verified project',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/domains').resolves({
      domains:[projectDomainRow],pagination:{next:null}});
    const result=value(await f.call('vercel_domain_list_project_domains',{project}));
    expect(result).toMatchObject({project,count:1,next:null,complete:true});
    expect(result.domains[0]).toMatchObject({name:domain,project,
      gitBranch:null,customEnvironmentId:null,redirect:null,verified:true});
    expect(f.fake.calls[0].params).toEqual({idOrName:project});
    f.fake.verify();
  });
  it('refuses foreign projects, bad domains and project-scoped team reads',async()=>{
    const f=fixture();
    expect((await f.call('vercel_domain_list_project_domains',
      {project:otherProject})).isError).toBe(true);
    expect((await f.call('vercel_domain_get',{domain:'../steal'})).isError).toBe(true);
    expect((await f.call('vercel_domain_list',{limit:200})).isError).toBe(true);
    loadToken.mockResolvedValue({token:'vcp_FAKE_project',account:{
      id:'acct_FAKE',team_id:'team_FAKE',scope:'project',project_id:project}});
    expect((await f.call('vercel_domain_list',{})).isError).toBe(true);
    expect(f.fake.calls).toHaveLength(1);
    f.fake.verify();
  });
  it('adds a team domain with preview, confirm and independent read-back',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}').rejects(404).rejects(404).rejects(404).resolves(domainRow);
    f.fake.when('POST','/v7/domains').resolves({domain:domainRow});
    const preview=value(await f.call('vercel_domain_add_to_team',
      {domain,zone:true,outsideApp:true,dryRun:true},production));
    expect(preview).toMatchObject({status:'preview',mode:'PRODUCTION'});
    expect(preview.preview).toContain(domain);
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    const applied=value(await f.call('vercel_domain_add_to_team',
      {domain,zone:true,outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',mode:'PRODUCTION',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='POST').body)
      .toEqual({name:domain,zone:true});
    // One logical claim plus one transport claim for the POST.
    expect(f.claims).toHaveLength(2);
    expect(new Set(f.claims.map(c=>c.key)).size).toBe(2);
    expect(f.audits).toHaveLength(2);
    f.fake.verify();
  });
  it('refuses adding a domain already on the team and a preview-mode add',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}').resolves(domainRow);
    expect(value(await f.call('vercel_domain_add_to_team',
      {domain,outsideApp:true,confirm:true},production)).status)
      .toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    const g=fixture();
    g.fake.when('GET','/v5/domains/{domain}').rejects(404);
    const preview=value(await g.call('vercel_domain_add_to_team',
      {domain:'new.test',outsideApp:true,dryRun:true},connection));
    expect(preview.status).toBe('refused_by_guard');
    expect(preview.reason).toMatch(/preview connection/i);
    expect(g.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    f.fake.verify();
    g.fake.verify();
  });
  it('moves a team domain out and proves absence, and updates ECH with read-back',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}').resolves(domainRow).resolves(domainRow).rejects(404);
    f.fake.when('PATCH','/v3/domains/{domain}').resolves({moved:true});
    const moved=value(await f.call('vercel_domain_update',
      {domain,destination:'team_OTHER',outsideApp:true,confirm:true},production));
    expect(moved).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='PATCH').body)
      .toEqual({op:'move-out',destination:'team_OTHER'});
    const g=fixture();
    g.fake.when('GET','/v5/domains/{domain}').resolves({...domainRow,echMode:'auto'});
    g.fake.when('PATCH','/v3/domains/{domain}').resolves({echMode:'auto'});
    const updated=value(await g.call('vercel_domain_update',
      {domain,echMode:'auto',outsideApp:true,confirm:true},production));
    expect(updated).toMatchObject({status:'applied',confirmed:true});
    expect(g.fake.calls.find(x=>x.method==='PATCH').body)
      .toEqual({op:'update',echMode:'auto'});
    g.fake.verify();
  });
  it('refuses removing a domain while aliases and a project still use it',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}').resolves(domainRow);
    f.fake.when('GET','/v4/aliases').resolves({aliases:[{alias:domain,
      projectId:project,deploymentId:'dpl_FAKE_ONE'}],pagination:{next:null}});
    f.fake.when('GET','/v10/projects').resolves({
      projects:[{id:project,name:'demo'}],pagination:{next:null}});
    f.fake.when('GET','/v9/projects/{idOrName}/domains').resolves({
      domains:[projectDomainRow],pagination:{next:null}});
    const preview=value(await f.call('vercel_domain_remove_from_team',
      {domain,outsideApp:true,dryRun:true},production));
    expect(preview.status).toBe('preview');
    expect(preview.preview).toContain('REFUSED');
    expect(preview.preview).toContain(project);
    expect(preview.preview).toContain(domain);
    const refused=value(await f.call('vercel_domain_remove_from_team',
      {domain,outsideApp:true,confirm:true},production));
    expect(refused.status).toBe('refused_by_guard');
    expect(f.fake.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
    expect(f.claims).toHaveLength(0);
    f.fake.verify();
  });
  it('removes an unused team domain with absence read-back',async()=>{
    const f=fixture();
    f.fake.when('GET','/v5/domains/{domain}').resolves(domainRow).resolves(domainRow).rejects(404);
    emptyUsage(f.fake);
    f.fake.when('DELETE','/v6/domains/{domain}').resolves({uid:'dom_FAKE_ONE'});
    const applied=value(await f.call('vercel_domain_remove_from_team',
      {domain,outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='DELETE').params).toEqual({domain});
    f.fake.verify();
  });
  it('attaches a production domain with config output in the result receipt',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}')
      .rejects(404).rejects(404).rejects(404).resolves(projectDomainRow);
    f.fake.when('POST','/v10/projects/{idOrName}/domains').resolves(projectDomainRow);
    f.fake.when('GET','/v6/domains/{domain}/config').resolves(configRow);
    const preview=value(await f.call('vercel_domain_attach_to_project',
      {project,domain,outsideApp:true,dryRun:true},production));
    expect(preview).toMatchObject({status:'preview',mode:'PRODUCTION'});
    const applied=value(await f.call('vercel_domain_attach_to_project',
      {project,domain,outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',mode:'PRODUCTION',confirmed:true});
    expect(applied.receipt.config).toMatchObject({domain,misconfigured:false,
      configuredBy:'CNAME',recommendedCNAME:['cname.vercel-dns.com']});
    expect(f.fake.calls.find(x=>x.method==='POST').body).toEqual({name:domain});
    expect(f.fake.calls.find(x=>x.method==='POST').params).toEqual({idOrName:project});
    f.fake.verify();
  });
  it('attaches a branch domain on a preview connection but refuses production there',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}')
      .rejects(404).rejects(404)
      .resolves({...projectDomainRow,gitBranch:'feature-x'});
    f.fake.when('POST','/v10/projects/{idOrName}/domains')
      .resolves({...projectDomainRow,gitBranch:'feature-x'});
    f.fake.when('GET','/v6/domains/{domain}/config').resolves(configRow);
    const branch=value(await f.call('vercel_domain_attach_to_project',
      {project,domain,gitBranch:'feature-x',outsideApp:true,confirm:true},connection));
    expect(branch).toMatchObject({status:'applied',mode:'PREVIEW',confirmed:true});
    const g=fixture();
    g.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}').rejects(404);
    const refused=value(await g.call('vercel_domain_attach_to_project',
      {project,domain,outsideApp:true,confirm:true},connection));
    expect(refused.status).toBe('refused_by_guard');
    expect(g.fake.calls.filter(x=>x.method==='POST')).toHaveLength(0);
    f.fake.verify();
    g.fake.verify();
  });
  it('updates a project domain redirect with exact body and read-back',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}')
      .resolves(projectDomainRow).resolves(projectDomainRow)
      .resolves({...projectDomainRow,redirect:'other.test',redirectStatusCode:307});
    f.fake.when('PATCH','/v9/projects/{idOrName}/domains/{domain}')
      .resolves({...projectDomainRow,redirect:'other.test',redirectStatusCode:307});
    const applied=value(await f.call('vercel_domain_update_project_domain',
      {project,domain,redirect:'other.test',redirectStatusCode:307,
        outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='PATCH').body)
      .toEqual({redirect:'other.test',redirectStatusCode:307});
    f.fake.verify();
  });
  it('detaches a project domain and reports a read-back mismatch honestly',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}')
      .resolves(projectDomainRow).resolves(projectDomainRow).rejects(404);
    f.fake.when('DELETE','/v9/projects/{idOrName}/domains/{domain}').resolves({});
    const applied=value(await f.call('vercel_domain_detach_from_project',
      {project,domain,outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    const g=fixture();
    g.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}').resolves(projectDomainRow);
    g.fake.when('DELETE','/v9/projects/{idOrName}/domains/{domain}').resolves({});
    const mismatch=value(await g.call('vercel_domain_detach_from_project',
      {project,domain,outsideApp:true,confirm:true},production));
    expect(mismatch).toMatchObject({status:'applied',confirmed:false});
    g.fake.verify();
  });
  it('verifies a project domain and reports the verified state',async()=>{
    const f=fixture();
    const unverified={...projectDomainRow,verified:false};
    f.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}')
      .resolves(unverified).resolves(unverified).resolves(projectDomainRow);
    f.fake.when('POST','/v9/projects/{idOrName}/domains/{domain}/verify')
      .resolves(projectDomainRow);
    const applied=value(await f.call('vercel_domain_verify_project_domain',
      {project,domain,outsideApp:true,confirm:true},production));
    expect(applied).toMatchObject({status:'applied',confirmed:true});
    expect(f.fake.calls.find(x=>x.method==='POST').params)
      .toEqual({idOrName:project,domain});
    f.fake.verify();
  });
  it('needs confirmation, never posts on dry run, and replays a confirmed update',async()=>{
    const f=fixture();
    const updatedRow={...projectDomainRow,redirect:'other.test',redirectStatusCode:307};
    f.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}')
      .resolves(projectDomainRow).resolves(projectDomainRow)
      .resolves(updatedRow);
    f.fake.when('PATCH','/v9/projects/{idOrName}/domains/{domain}').resolves(updatedRow);
    const args={project,domain,redirect:'other.test',redirectStatusCode:307,
      outsideApp:true,requestKey:'updateFAKE123'};
    const pending=value(await f.call('vercel_domain_update_project_domain',args,production));
    expect(pending.status).toBe('needs_confirmation');
    const preview=value(await f.call('vercel_domain_update_project_domain',
      {...args,dryRun:true},production));
    expect(preview.status).toBe('preview');
    expect(f.fake.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
    expect(f.claims).toHaveLength(0);
    const first=value(await f.call('vercel_domain_update_project_domain',
      {...args,confirm:true},production));
    expect(first).toMatchObject({status:'applied',confirmed:true});
    const patches=f.fake.calls.filter(x=>x.method==='PATCH').length;
    const second=value(await f.call('vercel_domain_update_project_domain',
      {...args,confirm:true},production));
    expect(second).toEqual(first);
    expect(f.fake.calls.filter(x=>x.method==='PATCH')).toHaveLength(patches);
    f.fake.verify();
  });
  it('refuses writes without outsideApp, on a read-only connection, or below full profile',async()=>{
    const f=fixture();
    f.fake.when('GET','/v9/projects/{idOrName}/domains/{domain}').rejects(404);
    expect(value(await f.call('vercel_domain_attach_to_project',
      {project,domain,confirm:true},production)).status).toBe('refused_by_guard');
    expect((await f.call('vercel_domain_remove_from_team',
      {domain,outsideApp:true,confirm:true},
      {...production,profile:'read_only'})).isError).toBe(true);
    expect((await f.call('vercel_domain_remove_from_team',
      {domain,outsideApp:true,confirm:true},
      {...production,profile:'everyday'})).isError).toBe(true);
    expect(f.fake.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
    f.fake.verify();
  });
  it('validates every domain write shape against the pinned OpenAPI snapshot',()=>{
    expect(()=>validateRequest('domains_add',{query:{teamId:'team_FAKE_validation'},
      body:{name:domain,zone:true}})).not.toThrow();
    expect(()=>validateRequest('domains_update',{path:{domain},
      query:{teamId:'team_FAKE_validation'},
      body:{op:'move-out',destination:'team_FAKE2'}})).not.toThrow();
    expect(()=>validateRequest('domains_update',{path:{domain},
      query:{teamId:'team_FAKE_validation'},
      body:{op:'update',zone:true,echMode:'auto'}})).not.toThrow();
    expect(()=>validateRequest('projects_domains_add',{path:{idOrName:project},
      query:{teamId:'team_FAKE_validation'},
      body:{name:domain,gitBranch:'feature-x',redirect:'other.test',
        redirectStatusCode:307}})).not.toThrow();
    expect(()=>validateRequest('projects_domains_update',{path:{idOrName:project,domain},
      query:{teamId:'team_FAKE_validation'},
      body:{redirect:'other.test',redirectStatusCode:308}})).not.toThrow();
    expect(()=>validateRequest('projects_domains_remove',{path:{idOrName:project,domain},
      query:{teamId:'team_FAKE_validation'}})).not.toThrow();
    expect(()=>validateRequest('projects_domains_verify',{path:{idOrName:project,domain},
      query:{teamId:'team_FAKE_validation'}})).not.toThrow();
    expect(()=>validateRequest('domains_add',{query:{teamId:'team_FAKE_validation'},
      body:{name:domain,unexpected:true}})).toThrow();
    expect(()=>validateRequest('projects_domains_add',{path:{idOrName:project},
      query:{teamId:'team_FAKE_validation'},
      body:{name:domain,redirectStatusCode:999}})).toThrow();
  });
});
