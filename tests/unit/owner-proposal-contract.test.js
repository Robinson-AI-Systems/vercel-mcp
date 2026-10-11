import {describe,it,expect,vi} from 'vitest';
import {defineWrite} from '../../src/core/write.js';
import {ownerProposal,ownerWriteContext} from '../../src/tools/owner-proposals.js';
import {checkTargets} from '../../src/tools/self-guard.js';

describe('B-8 owner request write contracts',()=>{
  it('rejects inappropriate paid/access proposals and allows account guard targets',()=>{
    const minimal={name:'fixture',approvalOnly:true,before:async()=>({}),
      preview:async()=>'',production:async()=>({production:true,why:'test'}),
      targets:async()=>[],apply:async()=>({}),verify:async()=>({confirmed:true})};
    expect(()=>defineWrite({...minimal,risk:{spend:true}})).toThrow();
    expect(checkTargets([{kind:'account',id:'team_FAKE'}],[])).toEqual({blocked:false});
    expect(checkTargets([{kind:'token',id:'server_FAKE',isServerToken:true}],[]).blocked).toBe(true);
  });
  it('requires production mode and owner proposal preflight services',async()=>{
    const spec=ownerProposal('vercel_fixture_owner','spend');
    const db={listVercelAccounts:vi.fn(async()=>[{id:'team_FAKE'}]),
      listProtectedResources:vi.fn(async()=>[]),
      recordChange:vi.fn(),requestReplayStore:()=>({claim:vi.fn(),complete:vi.fn()})};
    const connection={account:'team_FAKE',profile:'full',mode:'preview'};
    const ctx=ownerWriteContext({db,connection,env:{VERCEL_ENV:'production'}});
    expect((await spec.run({limitCents:100,confirm:true},ctx)).status).toBe('refused_by_guard');
    expect(db.recordChange).not.toHaveBeenCalled();
    connection.mode='production';
    expect((await spec.run({limitCents:100},ctx)).status).toBe('needs_confirmation');
    expect((await spec.run({limitCents:100,dryRun:true},ctx)).status).toBe('preview');
    expect(db.recordChange).toHaveBeenCalledTimes(1);
  });
  it('denies invalid amount and forged account before replay or issuance',async()=>{
    const spec=ownerProposal('vercel_fixture_owner','spend');
    const db={listVercelAccounts:vi.fn(async()=>[{id:'team_FAKE'}]),
      listProtectedResources:vi.fn(async()=>[]),recordChange:vi.fn(),
      requestReplayStore:()=>({claim:vi.fn(),complete:vi.fn()})};
    const ctx=ownerWriteContext({db,connection:{account:'team_FAKE',profile:'full',mode:'production'},
      env:{VERCEL_ENV:'production'}});
    for(const args of [{limitCents:-1,confirm:true},{limitCents:1.5,confirm:true},
      {limitCents:2147483648,confirm:true},{limitCents:'12',confirm:true},
      {limitCents:0,confirm:'yes'},{limitCents:0,account:'team_OTHER',confirm:true}]){
      expect((await spec.run(args,ctx)).status).toBe('refused_by_guard');
    }
    expect(db.recordChange).not.toHaveBeenCalled();
  });
  it('never calls an issued owner request an applied account change',async()=>{
    const spec=defineWrite({name:'fixture_owner',approvalOnly:true,
      before:async()=>({}),preview:async()=> 'Propose owner action',
      production:async()=>({production:true,why:'owner'}),targets:async()=>[{kind:'account',id:'team_FAKE'}],
      apply:async()=>({status:'awaiting_owner_approval',ownerApprovalRequired:true,
        reference:'12345678-1234-1234-1234-123456789012',expiresAt:'2026-10-11T21:00:00Z'}),
      verify:async()=>({confirmed:true})});
    const state={};
    const ctx={connection:{account:'team_FAKE',mode:'production',profile:'full'},
      audit:vi.fn(),shape:x=>x,guardProtected:async()=>({blocked:false}),
      guardApp:async()=>({blocked:false}),replayStore:{
        claim:async()=>({state:'claimed',claimId:'fixture'}),complete:async x=>{state.result=x.result;}
      }};
    const outcome=await spec.run({confirm:true},ctx);
    expect(outcome).toMatchObject({status:'awaiting_owner_approval',confirmed:false,
      ownerApprovalRequired:true,reviewAt:'/api/vercel/setup'});
    expect(state.result).toEqual(outcome);
    expect(outcome).not.toHaveProperty('applied');
  });
});
