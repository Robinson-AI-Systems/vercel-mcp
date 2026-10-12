import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {gitTools} from '../../src/tools/git.js';
import {dispatchReadOnlyTool} from '../../src/core/mcp-server.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {makeVercelClient} from '../../src/vercel/client.js';
import {validateRequest,normalizeNullableDeclarations} from '../../src/vercel/openapi-validation.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const conn={account:'acct_TEAM',profile:'read_only',listing:'catalog',mode:'preview'};
const db={getAccountCredential:async()=>({})};
const registry=mergeNamespaces([gitTools]);
const call=(name,args,fake,connection=conn)=>dispatchReadOnlyTool({
  registry,name,args,connection,db,fetchImpl:fake.fetch});
const parse=x=>JSON.parse(x.content[0].text);
describe('D-1c scoped Git namespace/repository discovery',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    loadToken.mockResolvedValue({token:'vcp_FAKE_git_read',
      account:{id:'acct_TEAM',team_id:'team_FAKE',scope:'team',project_id:null}});
  });
  it('sends token-scoped namespace GET without an unsupported teamId',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v1/integrations/git-namespaces').resolves([
      {id:'org_123',provider:'github',name:'Acme',token:'never-output',
        isAccessRestricted:true}]);
    const result=parse(await call('vercel_git_list_namespaces',{provider:'github'},fake));
    expect(result.namespaces).toEqual([{id:'org_123',name:'Acme',slug:null,
      provider:'github',ownerType:null,accessRestricted:true,requiresReauthentication:false}]);
    expect(JSON.stringify(result)).not.toContain('never-output');
    expect(fake.calls[0].query).toEqual({provider:'github'});
    expect(fake.calls[0].headers.authorization).toBe('Bearer [hidden]');
    expect(loadToken).toHaveBeenCalledWith(expect.objectContaining({accountId:'acct_TEAM'}));
  });
  it('never returns credential-shaped names, IDs, provider labels or Git URLs',async()=>{
    const namespaces=makeFakeVercel();
    namespaces.when('GET','/v1/integrations/git-namespaces').resolves([{
      id:'vcp_FAKE_namespace',name:'github_pat_FAKE_name',slug:'vcp_FAKE_slug',
      provider:'github',ownerType:'xoxb_FAKE_owner'}]);
    const ns=parse(await call('vercel_git_list_namespaces',{provider:'github'},namespaces));
    expect(ns.namespaces[0]).toMatchObject({id:null,name:null,slug:null,
      provider:'github',ownerType:null});
    expect(JSON.stringify(ns)).not.toMatch(/vcp_FAKE|github_pat_FAKE|xoxb_FAKE/);
    namespaces.verify();

    const repos=makeFakeVercel();
    repos.when('GET','/v1/integrations/git-namespaces').resolves([{
      id:'ns_FAKE',provider:'github',name:'public'}]);
    repos.when('GET','/v1/integrations/search-repo').resolves({repos:[{
      id:'vcp_FAKE_repo',name:'vcp_FAKE_name',fullName:'github_pat_FAKE_repo',
      defaultBranch:'vcp_FAKE_branch',url:'https://example.com/vcp_FAKE_secret',private:true
    }]});
    const found=parse(await call('vercel_git_search_repos',{
      provider:'github',namespaceId:'ns_FAKE',query:'public'},repos));
    expect(found.repositories[0]).toMatchObject({id:null,name:null,fullName:null,
      defaultBranch:null,url:null,private:true});
    expect(JSON.stringify(found)).not.toMatch(/vcp_FAKE|github_pat_FAKE/);
    repos.verify();
  });
  it('searches namespace repos and injects the stored teamId only',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v1/integrations/git-namespaces').resolves([{id:'1234',provider:'github',name:'Acme'}]);
    fake.when('GET','/v1/integrations/search-repo').resolves({repos:[
      {id:99,name:'web',private:true,defaultBranch:'main',accessToken:'secret'}]});
    expect(validateRequest('git_repos_search',{query:{teamId:'team_FAKE',provider:'github',namespaceId:'1234',query:'web'}})).toBe(true);
    const result=parse(await call('vercel_git_search_repos',{
      provider:'github',namespaceId:'1234',query:'web'},fake));
    expect(result.repositories).toEqual([{id:99,name:'web',fullName:null,url:null,
      private:true,defaultBranch:'main'}]);
    expect(fake.calls[0].query).toEqual({provider:'github'});
    expect(fake.calls[1].query).toMatchObject({
      teamId:'team_FAKE',provider:'github',namespaceId:'1234',query:'web'});
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('rejects inaccessible, ambiguous and absent namespaces before searching',async()=>{
    for(const rows of [[],[{id:'ns_FAKE',provider:'github',isAccessRestricted:true}],
      [{id:'ns_FAKE',provider:'github',requireReauth:true}],
      [{id:'ns_FAKE',provider:'gitlab'}],
      [{id:'ns_FAKE',provider:'github'},{id:'ns_FAKE',provider:'github'}]]){
      const fake=makeFakeVercel();
      fake.when('GET','/v1/integrations/git-namespaces').resolves(rows);
      const result=await call('vercel_git_search_repos',{
        provider:'github',namespaceId:'ns_FAKE',query:'demo'},fake);
      expect(result.isError).toBe(true);
      expect(fake.calls.map(x=>x.path)).toEqual(['/v1/integrations/git-namespaces']);
    }
  });
  it('refuses duplicated namespaced identities before repository enumeration',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v1/integrations/git-namespaces').resolves([
      {id:'ns_FAKE',provider:'github'},{id:'ns_FAKE',provider:'github'}]);
    const result=await call('vercel_git_search_repos',{
      provider:'github',namespaceId:'ns_FAKE',query:'demo'},fake);
    expect(result.isError).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });
  it('returns only bounded public Git metadata and refuses credential-bearing URLs',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v1/integrations/git-namespaces')
      .resolves([{id:'ns_FAKE',provider:'github',name:'Acme'}]);
    fake.when('GET','/v1/integrations/search-repo').resolves({repos:[
      {id:12,name:'web',fullName:'acme/web',url:'https://github.com/acme/web',private:true,token:'hidden'},
      {id:13,name:'api',url:'https://github.com/acme/api?access_token=hidden',private:false},
      {id:14,name:'unsafe',url:'https://user:pass@github.com/acme/api',private:false}
    ]});
    const result=parse(await call('vercel_git_search_repos',{
      provider:'github',namespaceId:'ns_FAKE',query:'web'},fake));
    expect(result.repositories.map(r=>r.url))
      .toEqual(['https://github.com/acme/web',null,null]);
    expect(JSON.stringify(result)).not.toMatch(/access_token|token|hidden|user:pass/);
    expect(fake.calls).toHaveLength(2);
  });
  it('excludes off-provider or lookalike repository hosts while preserving canonical links',async()=>{
    for(const [provider,expectedHost] of [
      ['github','github.com'],['gitlab','gitlab.com'],['bitbucket','bitbucket.org']]){
      const fake=makeFakeVercel();
      fake.when('GET','/v1/integrations/git-namespaces')
        .resolves([{id:'ns_FAKE',provider}]);
      fake.when('GET','/v1/integrations/search-repo').resolves({repos:[
        {id:1,url:'https://'+expectedHost+'/acme/site'},
        {id:2,url:'https://'+expectedHost+'.attacker.test/acme/site'},
        {id:3,url:'https://example.test/acme/site'},
        {id:4,url:'https://'+expectedHost+'@attacker.test/acme/site'}
      ]});
      const result=parse(await call('vercel_git_search_repos',{
        provider,namespaceId:'ns_FAKE',query:'site'},fake));
      expect(result.repositories.map(x=>x.url)).toEqual([
        'https://'+expectedHost+'/acme/site',null,null,null]);
      expect(fake.calls.every(x=>x.method==='GET')).toBe(true);
      fake.verify();
    }
  });
  it('refuses project-scoped Git account enumeration, cross-team and forged args',async()=>{
    const fake=makeFakeVercel();
    const invalid=[
      ['vercel_git_list_namespaces',{provider:'invalid'}],
      ['vercel_git_list_namespaces',{provider:'github',token:'FAKE'}],
      ['vercel_git_search_repos',{provider:'github',namespaceId:'../escape',query:'x'}],
      ['vercel_git_search_repos',{provider:'github',namespaceId:'123',query:' '}],
      ['vercel_git_search_repos',{provider:'github',namespaceId:'123',query:'x',teamId:'other'}]
    ];
    for(const [name,args] of invalid)expect((await call(name,args,fake)).isError).toBe(true);
    loadToken.mockResolvedValue({token:'vcp_FAKE_project',account:{id:'acct_TEAM',
      team_id:'team_FAKE',scope:'project',project_id:'prj_ONLY'}});
    expect((await call('vercel_git_list_namespaces',{provider:'github'},fake)).isError).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
  it('normalizes broken untyped nullable metadata without dropping schema constraints',()=>{
    expect(normalizeNullableDeclarations({properties:{id:{nullable:true,enum:['safe']},
      typed:{type:'string',nullable:true,maxLength:4}}})).toEqual({properties:{
      id:{enum:['safe']},typed:{type:'string',nullable:true,maxLength:4}}});
    // Duplicated oneOf alternatives and query-string coercion must not
    // reject the pinned union-of-string-or-number namespace selector.
    expect(normalizeNullableDeclarations({oneOf:[{type:'string'},{type:'number'},
      {type:'string'},{type:'number'}]})).toEqual({oneOf:[{type:'string'},{type:'number'}]});
  });
  it('allows only allowlisted token-scoped operation to omit the team selector',async()=>{
    expect(validateRequest('git_namespaces',{query:{provider:'github'}})).toBe(true);
    const fake=makeFakeVercel();
    const client=makeVercelClient({token:'vcp_FAKE',account:{
      id:'acct_TEAM',team_id:'team_FAKE'},fetchImpl:fake.fetch,replayStore:null});
    await expect(client.request('git_namespaces',{query:{provider:'github',teamId:'team_FAKE'}}))
      .rejects.toMatchObject({code:'team_scope_mismatch'});
    expect(fake.calls).toHaveLength(0);
  });
});
