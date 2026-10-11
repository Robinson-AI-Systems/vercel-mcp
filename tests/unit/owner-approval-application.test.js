import {describe,it,expect,vi} from 'vitest';
import {applyApprovedOwnerAccountChange} from '../../src/vercel/owner-approvals.js';

const base={version:1,issuerAccount:'team_ALPHA',action:'default',
  targetAccount:'team_BETA',connectionRef:null,limitCents:null};
function fixture(){
  const db={
    listVercelAccounts:vi.fn(async()=>[{id:'team_ALPHA'},{id:'team_BETA'}]),
    setDefaultOwnerAccount:vi.fn(async()=>true),
    setOwnerSpendLimit:vi.fn(async()=>true),
    revokeOwnerConnection:vi.fn(async()=>true)
  };
  return {db,invoke:request=>applyApprovedOwnerAccountChange({db,request})};
}
describe('approved account-change application (not an owner authenticator)',()=>{
  it('rechecks targets and dispatches only exact verified mutations',async()=>{
    const h=fixture();
    expect(await h.invoke(base)).toMatchObject({status:'applied',confirmed:true,action:'default'});
    expect(h.db.setDefaultOwnerAccount).toHaveBeenCalledWith('team_BETA');
    expect(await h.invoke({...base,action:'spend',targetAccount:null,limitCents:1125}))
      .toMatchObject({status:'applied',confirmed:true,action:'spend'});
    expect(h.db.setOwnerSpendLimit).toHaveBeenCalledWith('team_ALPHA',1125);
    expect(await h.invoke({...base,action:'revoke',targetAccount:null,
      connectionRef:'conn_0123456789abcdef0123'}))
      .toMatchObject({status:'applied',confirmed:true,action:'revoke'});
    expect(h.db.revokeOwnerConnection).toHaveBeenCalledWith({
      account:'team_ALPHA',connectionId:'conn_0123456789abcdef0123'
    });
    expect(h.db.setDefaultOwnerAccount).toHaveBeenCalledTimes(1);
    expect(h.db.setOwnerSpendLimit).toHaveBeenCalledTimes(1);
    expect(h.db.revokeOwnerConnection).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed, foreign, missing targets and unverified DB changes',async()=>{
    const h=fixture();
    for(const payload of [null,{...base,issuerAccount:'team_OTHER'},
      {...base,targetAccount:'team_OTHER'},
      {...base,limitCents:0},{...base,action:'spend',targetAccount:null,limitCents:-1},
      {...base,action:'spend',targetAccount:null,limitCents:1.5},
      {...base,action:'revoke',targetAccount:null,connectionRef:'wrong'}]){
      const result=await h.invoke(payload);
      expect(result.confirmed).toBe(false);
    }
    expect(h.db.setDefaultOwnerAccount).not.toHaveBeenCalled();
    expect(h.db.setOwnerSpendLimit).not.toHaveBeenCalled();
    expect(h.db.revokeOwnerConnection).not.toHaveBeenCalled();
    h.db.setDefaultOwnerAccount.mockResolvedValue(false);
    expect(await h.invoke(base)).toMatchObject({status:'unverified',confirmed:false});
  });
});
