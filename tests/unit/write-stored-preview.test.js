// AUD-D (design D-D, VMCP-008): write previews and target lists that shape
// safely but exceed the 8 KB inline bound are stored and referenced by
// handle instead of refusing the change. Unshapable previews keep the
// original refusal, and without a result store the oversized case keeps
// the original refusal too — nothing is truncated, no cap is raised.
import { describe, it, expect, vi } from 'vitest';
import { defineWrite } from '../../src/core/write.js';
import { compact } from '../../src/core/util.js';

const owner = 'resown_' + 'c'.repeat(64);
const bigPreview = () => ({
  action: 'Update the fixture in bulk',
  rows: Array.from({ length: 200 }, (_, i) => ({ id: 'row_' + i, note: 'n'.repeat(60) }))
});
const bigTargets = () => Array.from({ length: 200 }, (_, i) =>
  ({ kind: 'project', id: 'prj_FAKE_' + i, detail: 'd'.repeat(40) }));

function fixture({ preview = bigPreview, targets = () => [{ kind: 'project', id: 'prj_FAKE' }], stored = true } = {}) {
  const map = new Map();
  const audits = [];
  const provider = [];
  const db = stored ? {
    putResult: vi.fn(async ({ account, owner: o, body, summary }) => {
      const handle = 'res_' + 'd'.repeat(32);
      map.set(handle, { account, owner: o, body, summary });
      return { handle, expiresAt: '2026-10-12T00:00:00Z' };
    }),
    getResult: vi.fn(async ({ account, owner: o, handle }) => {
      const row = map.get(handle);
      return row?.owner === o && row.account === account ? row : null;
    })
  } : {};
  const spec = {
    name: 'fixture_bulk_update',
    before: async () => ({ version: 'before' }),
    preview,
    targets,
    production: async () => ({ production: false, why: 'Preview only' }),
    apply: async () => { provider.push('applied'); return { version: 'after' }; },
    verify: async () => ({ confirmed: true }),
    inverse: () => ({ tool: 'fixture_restore', args: { version: 'before' } })
  };
  const ctx = {
    connection: { account: 'account_FAKE', mode: 'preview', profile: 'everyday',
      ...(stored ? { resultOwner: owner } : {}) },
    db,
    now: () => 600000,
    guardProtected: async () => ({ blocked: false }),
    guardApp: async () => ({ blocked: false }),
    shape: compact,
    audit: async entry => { audits.push(entry); },
    replayStore: {
      async claim() { return { state: 'claimed', claimId: 'claim_FAKE' }; },
      async complete() {},
      async release() { return true; }
    }
  };
  return { tool: defineWrite(spec), ctx, audits, provider, db, map };
}

describe('AUD-D stored write previews (VMCP-008)', () => {
  it('completes a dry-run preview whose shaped preview exceeds 8 KB with a stored reference', async () => {
    const { tool, ctx, db } = fixture();
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('preview');
    expect(result.preview.status).toBe('stored');
    expect(result.preview.handle).toMatch(/^res_[a-f0-9]{32}$/);
    expect(result.preview.count).toBe(200);
    expect(result.preview.preview).toContain('Update the fixture in bulk');
    expect(db.putResult).toHaveBeenCalledTimes(1);
    const storedBody = db.putResult.mock.calls[0][0].body;
    expect(storedBody.rows).toHaveLength(200);
  });
  it('lets a confirmed write with an oversized preview proceed to apply', async () => {
    const { tool, ctx, provider, audits } = fixture();
    const result = await tool.run({ confirm: true }, ctx);
    expect(result.status).toBe('applied');
    expect(result.confirmed).toBe(true);
    expect(result.preview.status).toBe('stored');
    expect(provider).toEqual(['applied']);
    expect(audits.at(-1).summary.status).toBe('stored');
  });
  it('stores an oversized target list by reference in the audit row', async () => {
    const { tool, ctx, audits } = fixture({ targets: bigTargets, preview: async () => 'Small preview' });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('preview');
    expect(audits[0].targets.status).toBe('stored');
    expect(audits[0].targets.handle).toMatch(/^res_[a-f0-9]{32}$/);
    expect(audits[0].targets.count).toBe(200);
  });
  it('still refuses when the preview cannot be shaped safely (cyclic value)', async () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const { tool, ctx, provider } = fixture({ preview: async () => cyclic });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Could not safely preview or classify the change');
    expect(provider).toEqual([]);
  });
  it('still refuses when the preview function itself throws (the secret-screening error path)', async () => {
    const { tool, ctx } = fixture({
      preview: async () => { throw new TypeError('Credential-shaped preview value refused'); }
    });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Could not safely preview or classify the change');
  });
  it('keeps the original refusal for an oversized preview when no result store is available', async () => {
    const { tool, ctx } = fixture({ stored: false });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toBe('Could not safely preview or classify the change');
  });
  it('returns a small preview inline, exactly as before, with nothing stored', async () => {
    const { tool, ctx, db } = fixture({ preview: async () => 'Change fixture to updated' });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('preview');
    expect(result.preview).toBe('Change fixture to updated');
    expect(db.putResult).not.toHaveBeenCalled();
  });
});
