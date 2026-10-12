import { describe, it, expect } from 'vitest';
import { defineWrite, purchaseFingerprint } from '../../src/core/write.js';
import { sampleWrite, runWriteContract, writeRequestKey, attachFakeOwnerPurchase } from '../../tests/helpers/write-contract.js';

runWriteContract('generic B-1 sample');

describe('B-1 contract hardening', () => {
  it('requires operation-specific target, production, preview and read-back declarations', () => {
    expect(() => defineWrite({ name: 'unsafe', apply: async () => {} })).toThrow(/before/);
    const f = sampleWrite();
    expect(f.tool.writeContract.production).toBe(true);
    expect(f.tool.writeContract.targets).toBe(true);
  });
  it('denies writes if any mandatory safety service is missing', async () => {
    const f = sampleWrite();
    delete f.ctx.guardProtected;
    expect((await f.tool.run({ confirm: true }, f.ctx)).status).toBe('refused_by_guard');
    expect(f.provider).toHaveLength(0);
  });
  it('never retries a provider error or a pending request', async () => {
    const f = sampleWrite();
    f.spec.apply = async () => { throw new Error('provider write uncertain'); };
    expect((await f.tool.run({ confirm: true }, f.ctx)).status).toBe('outcome_unknown');
    expect((await f.tool.run({ confirm: true }, f.ctx)).status).toBe('outcome_unknown');
    expect(f.provider).toHaveLength(0);
  });
  it('records provider-quoted cents only after a confirmed operation, never on preview',async()=>{
    const f=sampleWrite({spend:true,cents:475,spendLimitCents:1200});
    const preview=await f.tool.run({dryRun:true},f.ctx);
    expect(preview.status).toBe('preview');
    expect(f.audits[0]).toMatchObject({dryRun:true,spendCents:475});
    attachFakeOwnerPurchase(f.ctx);
    const applied=await f.tool.run({confirm:true,requestKey:'fixturePaidFAKE01'},f.ctx);
    expect(applied.confirmed).toBe(true);
    expect(f.audits[1]).toMatchObject({dryRun:false,spendCents:475});
    expect(f.provider).toHaveLength(1);
  });
  it('binds owner purchase identity to account, meaningful args, description and exact quote',()=>{
    const a={account:'acct_FAKE',mode:'production',profile:'full'};
    const quote={cents:2000,recurring:false,description:'Vercel provider quote'};
    const digest=args=>purchaseFingerprint('vercel_domain_buy',args,a,quote);
    expect(digest({domain:'example.test',confirm:true,requestKey:'buyRequestABC01'}))
      .toBe(digest({domain:'example.test',dryRun:true}));
    expect(digest({domain:'example.test'})).not.toBe(digest({domain:'other.test'}));
    expect(digest({domain:'example.test'})).not.toBe(
      purchaseFingerprint('vercel_domain_buy',{domain:'example.test'},
        {...a,account:'other_FAKE'},quote));
    expect(digest({domain:'example.test'})).not.toBe(
      purchaseFingerprint('vercel_domain_buy',{domain:'example.test'},a,
        {...quote,cents:2100}));
  });
  it('never serves a prior completed write for a different payload sharing the same caller key',async()=>{
    const f=sampleWrite(),requestKey='sharedIntentFake01';
    const first=await f.tool.run({name:'first',requestKey,confirm:true},f.ctx);
    const second=await f.tool.run({name:'second',requestKey,confirm:true},f.ctx);
    expect(first.confirmed).toBe(true);
    expect(second.confirmed).toBe(true);
    expect(first.requestKey).not.toBe(second.requestKey);
    expect(f.provider).toEqual(['first','second']);
    expect((await f.tool.run({name:'second',requestKey,confirm:true},f.ctx))
      .requestKey).toBe(second.requestKey);
    expect(f.provider).toHaveLength(2);
  });
  it('denies dispatch when durable replay claiming throws',async()=>{
    const f=sampleWrite();
    f.ctx.replayStore.claim=async()=>{throw new Error('database unavailable')};
    const result=await f.tool.run({confirm:true,requestKey:'claimFailureFake1'},f.ctx);
    expect(result).toMatchObject({status:'refused_by_guard',confirmed:false});
    expect(f.provider).toHaveLength(0);
  });
  it('cannot reuse a consumed owner charge for changed arguments under one caller label',async()=>{
    const f=sampleWrite({spend:true,cents:201});
    attachFakeOwnerPurchase(f.ctx);
    const key='samePurchaseFake1';
    expect((await f.tool.run({name:'first',confirm:true,requestKey:key},f.ctx)).status)
      .toBe('applied');
    expect((await f.tool.run({name:'second',confirm:true,requestKey:key},f.ctx)).status)
      .toBe('refused_by_guard');
    expect(f.provider).toEqual(['first']);
  });
  it('hashes only meaningful args and supports explicit caller keys', () => {
    const ctx = { account: 'fixture', mode: 'preview' };
    const a = writeRequestKey('fixture_update', { name: 'a', confirm: true }, ctx, 600000);
    expect(a).toBe(writeRequestKey('fixture_update', { name: 'a', dryRun: true }, ctx, 600000));
    expect(a).not.toBe(writeRequestKey('fixture_update', { name: 'b' }, ctx, 600000));
    const override = writeRequestKey('fixture_update', { requestKey: 'owner_key_123' }, ctx, 600000);
    expect(override).toMatch(/^rmcp_scoped_[a-f0-9]{64}$/);
    expect(override).toBe(writeRequestKey('fixture_update', { requestKey: 'owner_key_123' }, ctx, 600000));
    expect(override).not.toBe(writeRequestKey('fixture_update', { requestKey:'owner_key_123',name:'other' },ctx,600000));
    expect(override).not.toBe(writeRequestKey('fixture_update', { requestKey: 'owner_key_123' }, { ...ctx, account: 'another' }, 600000));
    expect(override).not.toBe(writeRequestKey('another_tool', { requestKey: 'owner_key_123' }, ctx, 600000));
    expect(() => writeRequestKey('fixture_update', { requestKey: '..' }, ctx)).toThrow();
  });
});
