import {describe,it,expect} from 'vitest';
import {verifyExactGitRepository,verifyGitSearchAccount} from '../../src/tools/git-identity.js';

const request={repo:'acme/site',provider:'github',namespaceId:'ns_FAKE'};
describe('D-1au authenticated Git import identity',()=>{
  it('checks object root Git identity rather than trusting matching rows',()=>{
    const rows={repos:[{fullName:'acme/site',provider:'github',namespaceId:'ns_FAKE'}]};
    expect(()=>verifyExactGitRepository(rows,request)).toThrow(/account identity/);
    for(const bad of [
      {provider:'gitlab',namespaceId:'ns_FAKE'},
      {provider:'github',namespaceId:'another'},
      {provider:'github',namespaceId:{}}
    ]){
      expect(()=>verifyGitSearchAccount({...rows,gitAccount:bad},
        'github','ns_FAKE')).toThrow(/account identity/);
    }
  });
  it('rejects a matching alias that contradicts the canonical full name',()=>{
    const repos={gitAccount:{provider:'github',namespaceId:'ns_FAKE'},repos:[{fullName:'another/repository',slug:'acme/site',
      provider:'github',namespaceId:'ns_FAKE'}]};
    expect(()=>verifyExactGitRepository(repos,request)).toThrow(/absent or ambiguous/);
  });
  it('permits a canonical repository with a short slug',()=>{
    const repos={gitAccount:{provider:'github',namespaceId:'ns_FAKE'},repos:[{fullName:'acme/site',slug:'site',
      provider:'github',namespaceId:'ns_FAKE'}]};
    expect(verifyExactGitRepository(repos,request)).toEqual(request);
  });
  it('accepts a full-path slug only when no canonical full name exists',()=>{
    expect(verifyExactGitRepository({gitAccount:{provider:'github',namespaceId:'ns_FAKE'},repos:[{slug:'acme/site'}]},request)).toEqual(request);
  });
  it('rejects duplicate or out-of-namespace canonical matches',()=>{
    expect(()=>verifyExactGitRepository({gitAccount:{provider:'github',namespaceId:'ns_FAKE'},repos:[
      {fullName:'acme/site'},{fullName:'acme/site'}]},request)).toThrow(/ambiguous/);
    expect(()=>verifyExactGitRepository({gitAccount:{provider:'github',namespaceId:'ns_FAKE'},repos:[{
      fullName:'acme/site',namespaceId:'other_FAKE'}]},request))
      .toThrow(/authorized namespace/);
  });
});
