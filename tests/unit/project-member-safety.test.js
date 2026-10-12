import {describe,it,expect,vi} from 'vitest';
import {completeMembers,verifyEligibleTeamMember,verifiedUserUid} from '../../src/tools/project-member-safety.js';

const page=members=>({members,pagination:{next:null,hasNext:false}});
const client=members=>({request:vi.fn().mockResolvedValue(page(members))});

describe('D-1ar member identity aliases',()=>{
  it('rejects contradictory user IDs before an access decision',async()=>{
    const fake=client([{uid:'user_FAKE_A',userId:'user_FAKE_B',role:'CONTRIBUTOR',confirmed:true}]);
    await expect(completeMembers(fake,'teams_members_list',{teamId:'team_FAKE'}))
      .rejects.toThrow(/Conflicting/);
    await expect(verifyEligibleTeamMember(fake,'team_FAKE','user_FAKE_A'))
      .rejects.toThrow(/Conflicting/);
    expect(fake.request).toHaveBeenCalledTimes(2);
  });
  it('accepts consistent aliases and independent membership-row IDs',async()=>{
    const fake=client([{uid:'user_FAKE_A',userId:'user_FAKE_A',
      id:'membership_FAKE_1',role:'CONTRIBUTOR',confirmed:true}]);
    await expect(verifyEligibleTeamMember(fake,'team_FAKE','user_FAKE_A')).resolves.toBeUndefined();
    expect(fake.request).toHaveBeenCalledWith('teams_members_list',{
      path:{teamId:'team_FAKE'},query:{limit:100}
    });
  });
  it('rejects membership-record IDs masquerading as user identities',async()=>{
    const record={id:'membership_FAKE',role:'CONTRIBUTOR',confirmed:true};
    expect(()=>verifiedUserUid(record)).toThrow(/Unverified/);
    await expect(completeMembers(client([record]),'projects_members_list',
      {idOrName:'prj_FAKE'})).rejects.toThrow(/Unverified/);
    await expect(verifyEligibleTeamMember(client([record]),'team_FAKE',
      'membership_FAKE')).rejects.toThrow(/Unverified/);
  });
  it('accepts userId without uid and never substitutes a membership row ID',async()=>{
    const record={id:'membership_FAKE',userId:'user_FAKE_A',
      role:'CONTRIBUTOR',confirmed:true};
    expect(verifiedUserUid(record)).toBe('user_FAKE_A');
    await expect(verifyEligibleTeamMember(client([record]),'team_FAKE',
      'user_FAKE_A')).resolves.toBeUndefined();
  });
  it('rejects a role grant when later pagination has a contradictory UID alias',async()=>{
    const fake={request:vi.fn()
      .mockResolvedValueOnce({members:[{uid:'user_FAKE_OTHER'}],pagination:{next:42}})
      .mockResolvedValueOnce(page([{uid:'user_FAKE_A',userId:'user_FAKE_OTHER'}]))};
    await expect(completeMembers(fake,'projects_members_list',{idOrName:'prj_FAKE'}))
      .rejects.toThrow(/Conflicting/);
    expect(fake.request).toHaveBeenCalledTimes(2);
  });
});
