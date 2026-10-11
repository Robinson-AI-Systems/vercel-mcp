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
  it('searches namespace repos and injects the stored teamId only',async()=>{
    const fake=makeFakeVercel();
    fake.when('GET','/v1/integrations/search-repo').resolves({repos:[
      {id:99,name:'web',private:true,defaultBranch:'main',accessToken:'secret'}]});
    expect(validateRequest('git_repos_search',{query:{teamId:'team_FAKE',provider:'github',namespaceId:'1234',query:'web'}})).toBe(true);
    const result=parse(await call('vercel_git_search_repos',{
      provider:'github',namespaceId:'1234',query:'web'},fake));
    expect(result.repositories).toEqual([{id:99,name:'web',fullName:null,url:null,
      private:true,defaultBranch:'main'}]);
    expect(fake.calls[0].query).toMatchObject({
      teamId:'team_FAKE',provider:'github',namespaceId:'1234',query:'web'});
    expect(JSON.stringify(result)).not.toContain('secret');
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
