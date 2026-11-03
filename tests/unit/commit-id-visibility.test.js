import {describe,it,expect} from 'vitest';
import {compact,isCommitId,credentialLike} from '../../src/core/util.js';
// A full Git commit ID is plain hex and looks like a long hex secret to the credential filter.
// Production deployment reads showed a null commit because of that; it must stay visible, and only there.
const sha='0123456789abcdef0123456789abcdef01234567';
describe('commit IDs stay visible without weakening secret hiding',()=>{
  it('recognizes the filter problem this exemption exists for',()=>{
    expect(credentialLike(sha)).toBe(true);
    expect(isCommitId(sha)).toBe(true);
    expect(isCommitId('not-a-sha')).toBe(false);
    expect(isCommitId('abc')).toBe(false);
  });
  it('keeps a bare-hex commit under a commit field, nested too',()=>{
    expect(compact({commit:sha,deployments:[{githubCommitSha:sha,commitSha:sha}]})).toEqual({
      commit:sha,deployments:[{githubCommitSha:sha,commitSha:sha}]});
  });
  it('still hides the same value under any other field and hides non-hex values under a commit field',()=>{
    expect(compact({note:sha,label:sha,list:[sha]})).toEqual({note:'[hidden]',label:'[hidden]',list:['[hidden]']});
    expect(compact({commit:'Abcdefghijklmnopqrstuvwxyz012345'})).toEqual({commit:'[hidden]'});
    expect(compact({commit:'vcp_FAKE_token_value_0123456789'})).toEqual({commit:'[hidden]'});
    expect(compact({token:sha})).toEqual({token:'[hidden]'});
  });
});
