import { describe, it, expect } from 'vitest';
import { defineWrite } from '../../src/core/write.js';
import { sampleWrite, runWriteContract, writeRequestKey } from '../../tests/helpers/write-contract.js';

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
    const applied=await f.tool.run({confirm:true},f.ctx);
    expect(applied.confirmed).toBe(true);
    expect(f.audits[1]).toMatchObject({dryRun:false,spendCents:475});
    expect(f.provider).toHaveLength(1);
  });
  it('hashes only meaningful args and supports explicit caller keys', () => {
    const ctx = { account: 'fixture', mode: 'preview' };
    const a = writeRequestKey('fixture_update', { name: 'a', confirm: true }, ctx, 600000);
    expect(a).toBe(writeRequestKey('fixture_update', { name: 'a', dryRun: true }, ctx, 600000));
    expect(a).not.toBe(writeRequestKey('fixture_update', { name: 'b' }, ctx, 600000));
    const override = writeRequestKey('fixture_update', { requestKey: 'owner_key_123' }, ctx, 600000);
    expect(override).toMatch(/^rmcp_scoped_[a-f0-9]{64}$/);
    expect(override).toBe(writeRequestKey('fixture_update', { requestKey: 'owner_key_123' }, ctx, 600000));
    expect(override).not.toBe(writeRequestKey('fixture_update', { requestKey: 'owner_key_123' }, { ...ctx, account: 'another' }, 600000));
    expect(override).not.toBe(writeRequestKey('another_tool', { requestKey: 'owner_key_123' }, ctx, 600000));
    expect(() => writeRequestKey('fixture_update', { requestKey: '..' }, ctx)).toThrow();
  });
});
