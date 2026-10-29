// AUD-Y (VMCP-011, second layer): the audit writer caps the whole
// record at 8 KB in aggregate (before + after + result + inverse +
// summary, as it serializes them). AUD-X gave each field the stored
// treatment past the per-field bound, but a batch whose fields are
// each ~3 KB still sums past the record cap — and the writer's
// throw lands after the provider write has succeeded (live repro:
// env_set_many and env_delete_many with 10 keys at 250 chars; the
// writes landed, the envelopes errored). The executor now fits the
// audit entry before writing it: largest fields become stored
// references until the entry fits. The audit double below enforces
// the production writer's aggregate rule verbatim.
import { describe, it, expect, vi } from 'vitest';
import { defineWrite } from '../../src/core/write.js';
import { compact } from '../../src/core/util.js';

const owner = 'resown_' + 'a'.repeat(64);
const chunk = (tag, n = 55) => Array.from({ length: n }, (_, i) =>
  ({ id: tag + '_' + i, note: 'n'.repeat(45) })); // ~3 KB per field

function measure(entry) {
  const before = JSON.stringify({ snapshot: entry.before ?? null, targets: entry.targets ?? [] });
  const after = JSON.stringify(entry.after ?? null);
  const result = JSON.stringify(entry.result ?? null);
  const inverse = JSON.stringify(entry.inverse ?? null);
  const summary = String(entry.summary) + (entry.moneyLine ? ' | ' + String(entry.moneyLine) : '');
  return Buffer.byteLength(before + after + result + inverse + summary);
}

function fixture({ stored = true } = {}) {
  const audits = [], completions = [];
  const db = stored ? {
    putResult: vi.fn(async () => ({ handle: 'res_' + 'b'.repeat(32), expiresAt: '2026-10-12T00:00:00Z' }))
  } : {};
  const spec = {
    name: 'fixture_audit_fit',
    before: async () => ({ rows: chunk('before') }),
    preview: async () => 'Batch of ' + 'k'.repeat(600),
    targets: async () => chunk('target', 30),
    production: async () => ({ production: false, why: 'Preview only' }),
    apply: async () => ({ ok: true }),
    verify: async () => ({ confirmed: true, rows: chunk('after') }),
    publicReceipt: async () => ({ rows: chunk('receipt', 30) }),
    inverse: () => ({ tool: 'fixture_restore', args: { rows: chunk('inv', 10) } })
  };
  const ctx = {
    connection: { account: 'account_FAKE', mode: 'preview', profile: 'everyday',
      ...(stored ? { resultOwner: owner } : {}) },
    db,
    now: () => 600000,
    guardProtected: async () => ({ blocked: false }),
    guardApp: async () => ({ blocked: false }),
    shape: compact,
    audit: async entry => {
      // The production audit writer's aggregate cap, verbatim in effect.
      if (measure(entry) > 8192) throw new TypeError('Audit record exceeds safe 8 KB limit');
      audits.push(entry);
    },
    replayStore: {
      async claim() { return { state: 'claimed', claimId: 'claim_FAKE' }; },
      async complete({ result }) {
        const serialized = JSON.stringify(result);
        if (!serialized || Buffer.byteLength(serialized) > 8192) {
          throw new TypeError('Replay result exceeds the safe storage limit');
        }
        completions.push(result);
      },
      async release() { return true; }
    }
  };
  return { tool: defineWrite(spec), ctx, audits, completions, db };
}

describe('AUD-Y: the audit entry is fitted, never a post-apply throw', () => {
  it('completes a write whose audit fields each fit but sum past the record cap', async () => {
    const f = fixture();
    const out = await f.tool.run({ confirm: true, requestKey: 'audyFixture001' }, f.ctx);
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    const audit = f.audits.find(a => a.dryRun === false);
    expect(audit).toBeDefined();
    expect(measure(audit)).toBeLessThanOrEqual(8192);
    // The largest fields were replaced by stored references; the
    // summary headline was not.
    const referenced = ['before', 'after', 'result']
      .filter(k => audit[k]?.status === 'stored');
    expect(referenced.length).toBeGreaterThanOrEqual(2);
    expect(typeof audit.summary).toBe('string');
    expect(f.completions).toHaveLength(1);
  });

  it('leaves a small write’s audit entry untouched (values, no store calls)', async () => {
    const f = fixture();
    const small = defineWrite({
      name: 'fixture_audit_small',
      before: async () => ({ version: 'before' }),
      preview: async () => 'Small write',
      targets: async () => [{ kind: 'project', id: 'prj_FAKE' }],
      production: async () => ({ production: false, why: 'Preview only' }),
      apply: async () => ({ ok: true }),
      verify: async () => ({ confirmed: true }),
      inverse: () => ({ tool: 'fixture_restore', args: { version: 'before' } })
    });
    const out = await small.run({ confirm: true, requestKey: 'audyFixture002' }, f.ctx);
    expect(out.status).toBe('applied');
    const audit = f.audits.find(a => a.dryRun === false);
    expect(audit.before).toEqual({ version: 'before' });
    expect(audit.after).toEqual({ confirmed: true });
    expect(f.db.putResult).not.toHaveBeenCalled();
  });

  it('without a result store, an unfittable entry still refuses (no silent truncation)', async () => {
    const f = fixture({ stored: false });
    await expect(f.tool.run({ confirm: true, requestKey: 'audyFixture003' }, f.ctx))
      .rejects.toThrow(/cannot be safely shaped within 8 KB|Audit record exceeds/i);
  });
});
