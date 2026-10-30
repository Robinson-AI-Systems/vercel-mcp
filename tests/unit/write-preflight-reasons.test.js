// AUD-AH: the write preflight preserves a tool's own classification
// refusal. A tool throws RefusalError with a static plain-words reason it
// constructed value-free; the preflight passes that reason to the caller
// verbatim after a boundary screen. Every untyped throw keeps the generic
// sentence — arbitrary error text is unvetted (provider errors can echo
// messages, identifiers and values), and that fallback is a safety
// property, not a bug. The poisoned-message tests below are the card's
// safety proof: neither an untyped throw nor a mistyped one can smuggle
// an ID-shaped or credential-shaped string into the refusal reason.
import { describe, it, expect } from 'vitest';
import { defineWrite, RefusalError } from '../../src/core/write.js';
import { compact } from '../../src/core/util.js';

const GENERIC = 'Could not safely preview or classify the change';
// Assembled at runtime so no real-ID-shaped literal is ever committed.
const POISON_ID = 'team_' + 'A'.repeat(24);
const POISON_SECRET = 'vcp_' + 'B'.repeat(24);

function fixture(overrides = {}) {
  const spec = {
    name: 'fixture_reasoned_write',
    before: async () => ({ version: 'before' }),
    preview: async () => 'Change the fixture',
    targets: async () => [{ kind: 'project', id: 'prj_FAKE' }],
    production: async () => ({ production: false, why: 'Preview only' }),
    apply: async () => ({ version: 'after' }),
    verify: async () => ({ confirmed: true }),
    ...overrides
  };
  const ctx = {
    connection: { account: 'account_FAKE', mode: 'preview', profile: 'everyday' },
    db: {},
    now: () => 600000,
    guardProtected: async () => ({ blocked: false }),
    guardApp: async () => ({ blocked: false }),
    shape: compact,
    audit: async () => {},
    replayStore: {
      async claim() { return { state: 'claimed', claimId: 'claim_FAKE' }; },
      async complete() {},
      async release() { return true; }
    }
  };
  return { tool: defineWrite(spec), ctx };
}

describe('AUD-AH preflight refusal reasons', () => {
  it('RefusalError extends TypeError (invisible outside the preflight envelope)', () => {
    expect(new RefusalError('Named predicate failed')).toBeInstanceOf(TypeError);
    expect(new RefusalError('Named predicate failed').name).toBe('RefusalError');
  });
  it('passes a typed refusal from before() to the caller verbatim', async () => {
    const { tool, ctx } = fixture({
      before: async () => { throw new RefusalError('Fixture owner or revision cannot be classified'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe('Fixture owner or revision cannot be classified');
  });
  it('passes a typed refusal from production() to the caller verbatim', async () => {
    const { tool, ctx } = fixture({
      production: async () => { throw new RefusalError('Fixture production status is unprovable'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Fixture production status is unprovable');
  });
  it('passes a typed refusal from targets() to the caller verbatim', async () => {
    const { tool, ctx } = fixture({
      targets: async () => { throw new RefusalError('Fixture target set is incomplete'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Fixture target set is incomplete');
  });
  it('passes a typed refusal from preview() to the caller verbatim', async () => {
    const { tool, ctx } = fixture({
      preview: async () => { throw new RefusalError('Fixture change cannot be previewed safely'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Fixture change cannot be previewed safely');
  });
  it('passes a typed refusal from a spend hook verbatim', async () => {
    const { tool, ctx } = fixture({
      risk: { spend: true },
      spend: async () => { throw new RefusalError('Fixture price quote is not classifiable'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Fixture price quote is not classifiable');
  });
  it('passes a typed refusal from an access hook verbatim', async () => {
    const { tool, ctx } = fixture({
      risk: { access: true },
      access: async () => { throw new RefusalError('Fixture access change cannot be classified'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Fixture access change cannot be classified');
  });
  it('an untyped throw with a poisoned message returns ONLY the generic sentence', async () => {
    const poisoned = 'Provider exploded for ' + POISON_ID + ' with credential ' + POISON_SECRET;
    const { tool, ctx } = fixture({
      before: async () => { throw new Error(poisoned); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe(GENERIC);
    expect(JSON.stringify(result)).not.toContain(POISON_ID);
    expect(JSON.stringify(result)).not.toContain(POISON_SECRET);
  });
  it('an untyped TypeError with an innocent static message still returns the generic sentence (opt-in)', async () => {
    const { tool, ctx } = fixture({
      before: async () => { throw new TypeError('Fixture owner or revision cannot be classified'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe(GENERIC);
  });
  it('a typed refusal whose message carries an ID-shaped string falls back to the generic sentence', async () => {
    const { tool, ctx } = fixture({
      before: async () => { throw new RefusalError('Fixture store ' + POISON_ID + ' cannot be classified'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe(GENERIC);
    expect(JSON.stringify(result)).not.toContain(POISON_ID);
  });
  it('a typed refusal whose message carries a credential-shaped string falls back to the generic sentence', async () => {
    const { tool, ctx } = fixture({
      before: async () => { throw new RefusalError('Fixture credential ' + POISON_SECRET + ' refused'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe(GENERIC);
    expect(JSON.stringify(result)).not.toContain(POISON_SECRET);
  });
  it('a typed refusal with an overlong message falls back to the generic sentence', async () => {
    const { tool, ctx } = fixture({
      before: async () => { throw new RefusalError('x'.repeat(301)); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe(GENERIC);
  });
});
