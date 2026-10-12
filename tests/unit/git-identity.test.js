import {describe,it,expect} from 'vitest';
import {verifyExactGitRepository} from '../../src/tools/git-identity.js';

const request={repo:'acme/site',provider:'github',namespaceId:'ns_FAKE'};
describe('D-1au authenticated Git import identity',()=>{
  it('rejects a matching alias that contradicts the canonical full name',()=>{
    const repos={repos:[{fullName:'another/repository',slug:'acme/site',
      provider:'github',namespaceId:'ns_FAKE'}]};
    expect(()=>verifyExactGitRepository(repos,request)).toThrow(/absent or ambiguous/);
  });
  it('permits a canonical repository with a short slug',()=>{
    const repos={repos:[{fullName:'acme/site',slug:'site',
      provider:'github',namespaceId:'ns_FAKE'}]};
    expect(verifyExactGitRepository(repos,request)).toEqual(request);
  });
  it('accepts a full-path slug only when no canonical full name exists',()=>{
    expect(verifyExactGitRepository({repos:[{slug:'acme/site'}]},request)).toEqual(request);
  });
  it('rejects duplicate or out-of-namespace canonical matches',()=>{
    expect(()=>verifyExactGitRepository({repos:[
      {fullName:'acme/site'},{fullName:'acme/site'}]},request)).toThrow(/ambiguous/);
    expect(()=>verifyExactGitRepository({repos:[{
      fullName:'acme/site',namespaceId:'other_FAKE'}]},request))
      .toThrow(/authorized namespace/);
  });
});
