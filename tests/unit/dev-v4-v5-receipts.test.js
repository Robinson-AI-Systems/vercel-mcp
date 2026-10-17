import {describe,it,expect} from 'vitest';
import {defineWrite} from '../../src/core/write.js';

function fixture({secretAction=false}={}){
  const seen=[];
  const write=defineWrite({
    name:'verified_receipt_fixture',secretOut:secretAction,oneTimeDelivery:secretAction,
    oneTimeWhen:a=>a.action==='prepare',
    async before(a){return {id:'sbx_testing',action:a.action};},
    async preview(){return 'One explicit safe test action';},
    async production(){return {production:false,why:'Preview fixture'};},
    async targets(){return [{kind:'project',id:'prj_fixture'}];},
    async apply(a){return a.action==='prepare'?
      {ownerRevealRef:'11111111-2222-3333-4444-555555555555',
        expiresAt:new Date(Date.now()+300000).toISOString()}:
      {session:'sbx_testing',status:200};},
    async verify(){return {confirmed:true,session:'sbx_testing',status:200};},
    async publicReceipt(a,_b,_r,v){return a.action==='prepare'?null:
      {session:v.session,status:v.status};}
  });
  const ctx={
    connection:{account:'acct_fixture',mode:'preview',profile:'full'},
    shape:x=>x,audit:async x=>{seen.push(x);},
    guardProtected:async()=>({blocked:false}),guardApp:async()=>({blocked:false}),
    replayStore:{
      claim:async()=>({state:'claimed',claimId:'claim_fixture'}),
      complete:async()=>{}
    }
  };
  return {write,ctx,seen};
}
describe('V-4/V-5 generic guarded write result contracts',()=>{
  it('returns only a verified allowlisted receipt without provider response leakage',async()=>{
    const {write,ctx}=fixture();
    const result=await write.run({action:'send',confirm:true,requestKey:'fixture_request_key'},ctx);
    expect(result).toMatchObject({status:'applied',confirmed:true,
      receipt:{session:'sbx_testing',status:200}});
    expect(result.providerResult).toBeUndefined();
    expect(result.receipt.ownerRevealRef).toBeUndefined();
  });
  it('requires one-time secret reveal only on the prepare action',async()=>{
    const {write,ctx}=fixture({secretAction:true});
    const prepared=await write.run({action:'prepare',confirm:true,requestKey:'prepare_request_key'},ctx);
    expect(prepared).toMatchObject({status:'applied',confirmed:true,
      revealAt:'/api/vercel/setup'});
    expect(prepared.ownerRevealRef).toMatch(/^[0-9a-f-]{36}$/i);
    const sent=await write.run({action:'send',confirm:true,requestKey:'send_request_key'},ctx);
    expect(sent).toMatchObject({status:'applied',confirmed:true,
      receipt:{session:'sbx_testing',status:200}});
    expect(sent.ownerRevealRef).toBeUndefined();
  });
});
