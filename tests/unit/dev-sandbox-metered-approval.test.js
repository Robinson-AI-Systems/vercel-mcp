import {describe,it,expect} from 'vitest';
import {defineWrite} from '../../src/core/write.js';
function fixture({allowed=false,operation='vercel_dev_sandbox_create'}={}){
  const history=[],receipt={status:allowed?'approved':'pending',
    reference:'11111111-1111-4111-8111-111111111111',
    expiresAt:new Date(Date.now()+180000).toISOString()};
  const db={
    requestPurchaseIntent:async binding=>{history.push(['request',binding]);return receipt;},
    getPurchaseIntent:async()=>({status:'approved',ceiling_cents:300,
      allow_unbounded_metered:allowed,approved_at:new Date(),expires_at:receipt.expiresAt}),
    consumePurchaseIntent:async()=>{history.push(['consumed']);return true;}
  };
  const ctx={connection:{account:'acct_mock',mode:'preview',profile:'everyday'},
    db,shape:x=>x,audit:async()=>{},
    guardProtected:async()=>({blocked:false}),guardApp:async()=>({blocked:false}),
    replayStore:{claim:async()=>({state:'claimed',claimId:'fixture'}),
      complete:async()=>{},release:async()=>{}}
  };
  const spec={name:operation,risk:{spend:true,ownerApprovedMetered:true},
    before:async()=>({project:'prj_fixture'}),
    preview:async()=> 'One finite, isolated sandbox with individually approved metered fees',
    production:async()=>({production:false,why:'No live deployment'}),
    targets:async()=>[{kind:'project',id:'prj_fixture'}],
    spend:async()=>({cents:null,recurring:true,description:'Variable compute for 10 minutes'}),
    apply:async()=>{history.push(['apply']);return {id:'sbx_fake'};},
    verify:async()=>({confirmed:true})
  };
  return {write:defineWrite(spec),ctx,history};
}
describe('owner-only variable Sandbox purchase authority',()=>{
  it('never dispatches when owner has not separately approved',async()=>{
    const {write,ctx,history}=fixture();
    const result=await write.run({confirm:true,requestKey:'metered_mock_req'},ctx);
    expect(result).toMatchObject({status:'awaiting_owner_approval',ownerApprovalRequired:true});
    expect(history.filter(x=>x[0]==='apply')).toHaveLength(0);
    expect(history.filter(x=>x[0]==='consumed')).toHaveLength(0);
  });
  it('allows one finite Sandbox only after durable owner acknowledgment and consumption',async()=>{
    const {write,ctx,history}=fixture({allowed:true});
    const result=await write.run({confirm:true,requestKey:'metered_mock_req'},ctx);
    expect(result).toMatchObject({status:'applied',confirmed:true});
    expect(history.map(x=>x[0])).toContain('consumed');
    expect(history.map(x=>x[0])).toContain('apply');
    expect(history.findIndex(x=>x[0]==='consumed'))
      .toBeLessThan(history.findIndex(x=>x[0]==='apply'));
  });
  it('never extends this meter exception to another operation',async()=>{
    const {write,ctx,history}=fixture({allowed:true,operation:'vercel_project_create'});
    const result=await write.run({confirm:true,requestKey:'metered_mock_req'},ctx);
    expect(result).toMatchObject({status:'refused_by_guard'});
    expect(history).toHaveLength(0);
  });
});
