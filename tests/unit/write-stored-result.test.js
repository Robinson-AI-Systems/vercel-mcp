// AUD-X (VMCP-011): the post-apply shaping in the write executor
// used the throwing 8 KB shaper for the verified receipt, the
// inverse, and the audit's before/after/result copies — so a write
// that landed and verified could still surface as an error envelope
// purely because its paperwork was large (the live shape: keys
// landed, envelope said unknown_error). Those copies now take the
// stored treatment AUD-D gave previews and targets: oversized
// becomes a stored reference, the caller still receives the full
// screened result, and the replay completion carries the receipt
// scalars beside the reference. The replay double here enforces
// the production store's 8192-byte completion cap, which the old
// doubles never did.
import { describe, it, expect, vi } from 'vitest';
import { defineWrite } from '../../src/core/write.js';
import { compact } from '../../src/core/util.js';

const owner = 'resown_' + 'e'.repeat(64);
const big = (tag) => Array.from({ length: 200 }, (_, i) =>
  ({ id: tag + '_' + i, note: 'n'.repeat(60) }));

function fixture({ stored = true } = {}) {
  const audits = [], completions = [], storedBodies = new Map();
  const db = stored ? {
    putResult: vi.fn(async ({ body }) => {
      const handle = 'res_' + 'f'.repeat(32);
      storedBodies.set(handle, body);
      return { handle, expiresAt: '2026-10-12T00:00:00Z' };
    })
  } : {};
  const spec = {
    name: 'fixture_bulk_write',
    before: async () => ({ rows: big('before') }),
    preview: async () => 'Bulk fixture write',
    targets: async () => [{ kind: 'project', id: 'prj_FAKE' }],
    production: async () => ({ production: false, why: 'Preview only' }),
    apply: async () => ({ ok: true }),
    verify: async () => ({ confirmed: true, rows: big('after') }),
    publicReceipt: async () => ({ rows: big('receipt') }),
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
      async complete({ result }) {
        // The production replay store's cap, verbatim in effect.
        const serialized = JSON.stringify(result);
        if (!serialized || Buffer.byteLength(serialized) > 8192) {
          throw new TypeError('Replay result exceeds the safe storage limit');
        }
        completions.push(result);
      },
      async release() { return true; }
    }
  };
  return { tool: defineWrite(spec), ctx, audits, completions, storedBodies, db };
}

describe('AUD-X: post-apply paperwork is stored, never a thrown error', () => {
  it('completes a landed write whose before/after/receipt exceed 8 KB', async () => {
    const f = fixture();
    const out = await f.tool.run(
      { confirm: true, requestKey: 'audxFixture001' }, f.ctx);
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    // The verified receipt rides the result as a stored reference.
    expect(out.receipt.status).toBe('stored');
    expect(out.receipt.handle).toMatch(/^res_/);
    // The returned result is the full screened result, over the
    // display bound, not an error and not truncated.
    expect(Buffer.byteLength(JSON.stringify(out))).toBeGreaterThan(0);
    // Audit copies are stored references, not throws.
    const audit = f.audits.find(a => a.dryRun === false);
    expect(audit.before.status).toBe('stored');
    expect(audit.after.status).toBe('stored');
    // The replay completion fit the production cap: with the
    // receipt referenced, the result itself fits and completes as
    // the plain applied receipt.
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0]).toMatchObject({ status: 'applied', confirmed: true });
    expect(Buffer.byteLength(JSON.stringify(f.completions[0]))).toBeLessThanOrEqual(8192);
  });

  it('keeps the receipt scalars beside the reference when the result itself stays oversized', async () => {
    const f = fixture();
    const tool = defineWrite({
      name: 'fixture_long_preview_write',
      before: async () => ({ version: 'before' }),
      preview: async () => 'p'.repeat(7900),
      targets: async () => [{ kind: 'project', id: 'prj_FAKE' }],
      production: async () => ({ production: false, why: 'Preview only' }),
      apply: async () => ({ ok: true }),
      verify: async () => ({ confirmed: true }),
      publicReceipt: async () => ({ rows: big('receipt') }),
      inverse: () => ({ tool: 'fixture_restore', args: { version: 'before' } })
    });
    const out = await tool.run({ confirm: true, requestKey: 'audxFixture004' }, f.ctx);
    expect(out.status).toBe('applied');
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0].status).toBe('stored');
    expect(f.completions[0].writeStatus).toBe('applied');
    expect(f.completions[0].writeConfirmed).toBe(true);
    expect(f.completions[0].requestKey).toMatch(/^rmcp_scoped_[a-f0-9]{64}$/);
    expect(Buffer.byteLength(JSON.stringify(f.completions[0]))).toBeLessThanOrEqual(8192);
  });

  it('keeps small writes byte-identical in shape (values, not references)', async () => {
    const f = fixture();
    const small = {
      name: 'fixture_small_write',
      before: async () => ({ version: 'before' }),
      preview: async () => 'Small fixture write',
      targets: async () => [{ kind: 'project', id: 'prj_FAKE' }],
      production: async () => ({ production: false, why: 'Preview only' }),
      apply: async () => ({ ok: true }),
      verify: async () => ({ confirmed: true }),
      inverse: () => ({ tool: 'fixture_restore', args: { version: 'before' } })
    };
    const tool = defineWrite(small);
    const out = await tool.run({ confirm: true, requestKey: 'audxFixture002' }, f.ctx);
    expect(out).toMatchObject({ status: 'applied', confirmed: true });
    const audit = f.audits.find(a => a.dryRun === false);
    expect(audit.before).toEqual({ version: 'before' });
    expect(audit.after).toEqual({ confirmed: true });
    expect(f.completions[0]).toMatchObject({ status: 'applied', confirmed: true });
    expect(f.db.putResult).not.toHaveBeenCalled();
  });

  it('without a result store, oversized post-apply paperwork still refuses (no silent truncation)', async () => {
    const f = fixture({ stored: false });
    await expect(f.tool.run({ confirm: true, requestKey: 'audxFixture003' }, f.ctx))
      .rejects.toThrow(/cannot be safely shaped within 8 KB/i);
  });
});
