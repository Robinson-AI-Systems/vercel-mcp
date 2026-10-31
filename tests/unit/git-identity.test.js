import {describe,it,expect} from 'vitest';
import {verifyExactGitRepository,verifyGitSearchAccount} from '../../src/tools/git-identity.js';

const request={repo:'acme/site',provider:'github',namespaceId:'ns_FAKE'};
// The documented search-repo row (pinned snapshot): the bare
// repository name in `name`/`slug` inside the namespace — there is
// no fullName field. AUD-AM remodeled these fakes from that shape
// plus the 2026-10-31 live capture (identifiers generalized).
const docRow=(over={})=>({id:4242424242,name:'site',slug:'site',namespace:'acme',
  owner:{id:'own_FAKE',name:'acme'},ownerType:'team',private:true,provider:'github',
  defaultBranch:'main',updatedAt:1793000000000,url:'https://github.com/acme/site',...over});
const bounded=repos=>({gitAccount:{provider:'github',namespaceId:'ns_FAKE'},repos});
describe('D-1au authenticated Git import identity',()=>{
  it('checks object root Git identity rather than trusting matching rows',()=>{
    const rows={repos:[docRow({namespaceId:'ns_FAKE'})]};
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
  it('accepts the documented row: bare name and slug inside the verified namespace',()=>{
    expect(verifyExactGitRepository(bounded([docRow()]),request)).toEqual(request);
    expect(verifyExactGitRepository([docRow()],request)).toEqual(request);
  });
  it('rejects a matching alias that contradicts the canonical full name',()=>{
    const repos=bounded([{fullName:'another/repository',slug:'acme/site',
      provider:'github',namespaceId:'ns_FAKE'}]);
    expect(()=>verifyExactGitRepository(repos,request)).toThrow(/absent or ambiguous/);
  });
  it('rejects a qualified canonical claim that defeats a matching bare slug',()=>{
    const repos=bounded([{fullName:'another/repository',slug:'site',name:'site',
      provider:'github',namespaceId:'ns_FAKE'}]);
    expect(()=>verifyExactGitRepository(repos,request)).toThrow(/absent or ambiguous/);
  });
  it('rejects a bare canonical claim that contradicts a full-path slug',()=>{
    const repos=bounded([{fullName:'other',slug:'acme/site',
      provider:'github',namespaceId:'ns_FAKE'}]);
    expect(()=>verifyExactGitRepository(repos,request)).toThrow(/absent or ambiguous/);
  });
  it('permits a canonical repository with a short slug',()=>{
    const repos=bounded([{fullName:'acme/site',slug:'site',
      provider:'github',namespaceId:'ns_FAKE'}]);
    expect(verifyExactGitRepository(repos,request)).toEqual(request);
  });
  it('permits a bare canonical full name matching the namespace-scoped name',()=>{
    const repos=bounded([{fullName:'site',slug:'site',name:'site',
      provider:'github',namespaceId:'ns_FAKE'}]);
    expect(verifyExactGitRepository(repos,request)).toEqual(request);
  });
  it('accepts a full-path slug only when no canonical full name exists',()=>{
    expect(verifyExactGitRepository(bounded([{slug:'acme/site'}]),request)).toEqual(request);
  });
  it('rejects a documented row whose name disagrees with its slug',()=>{
    expect(()=>verifyExactGitRepository(bounded([docRow({name:'other'})]),request))
      .toThrow(/absent or ambiguous/);
    expect(()=>verifyExactGitRepository(bounded([docRow({name:'site-2',slug:'site-2',
      url:'https://github.com/acme/site-2'})]),request)).toThrow(/absent or ambiguous/);
  });
  it('rejects duplicate or out-of-namespace canonical matches',()=>{
    expect(()=>verifyExactGitRepository(bounded([
      {fullName:'acme/site'},{fullName:'acme/site'}]),request)).toThrow(/ambiguous/);
    expect(()=>verifyExactGitRepository(bounded([{
      fullName:'acme/site',namespaceId:'other_FAKE'}]),request))
      .toThrow(/authorized namespace/);
  });
  it('rejects duplicate documented matches and restricted documented rows',()=>{
    expect(()=>verifyExactGitRepository(bounded([docRow(),docRow()]),request))
      .toThrow(/ambiguous/);
    for(const over of [{namespaceId:'other_FAKE'},{provider:'gitlab'},
      {isAccessRestricted:true},{requireReauth:true}]){
      expect(()=>verifyExactGitRepository(bounded([docRow(over)]),request))
        .toThrow(/authorized namespace/);
    }
  });
});
