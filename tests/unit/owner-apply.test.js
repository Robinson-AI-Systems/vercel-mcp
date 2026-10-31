// AUD-AS: vercel_apply_owner_approval — envelope apply on the owner's
// connection (dossier §2.4). Unit level: the kind gate at the real
// dispatch boundary, argument discipline (the passphrase is never a
// tool argument), inspect/needs-confirmation/apply routing and the
// purchase family's ceiling rule, over an in-memory envelope store.
// All four families end-to-end against real Postgres live in
// tests/db/owner-apply.test.js.
import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { ownerApplyTools } from '../../src/tools/owner-apply.js';
import { requestOwnerAccountChange } from '../../src/vercel/owner-approvals.js';

const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const connector = { kind: 'connector', account: 'team_FAKE', profile: 'full', mode: 'production', listing: 'catalog' };
const handler = ownerApplyTools.handlers.vercel_apply_owner_approval;
const parse = result => JSON.parse(result.content[0].text);

function fixture() {
  const secrets = new Map(), intents = new Map(), changes = [];
  let spendLimit = 0;
  const db = {
    listVercelAccounts: vi.fn(async () => [{ id: 'team_FAKE' }]),
    async insertOneTimeSecret(row) {
      secrets.set(row.id, { ...row, vercel_account: row.account, expires_at: row.expiresAt, viewed_at: null });
    },
    async consumeOneTimeSecret({ id, account }) {
      const row = secrets.get(id);
      if (!row || row.vercel_account !== account || row.viewed_at ||
        new Date(row.expires_at).getTime() <= Date.now()) return null;
      row.viewed_at = new Date(); return row;
    },
    async getOwnerApprovalRequest({ account, reference }) {
      const row = secrets.get(reference);
      return row && row.kind === 'owner_account_change' && row.vercel_account === account &&
        !row.viewed_at && new Date(row.expires_at).getTime() > Date.now() ? row : null;
    },
    async getRtcPassRequest() { return null; },
    async getProductionEnableRequest() { return null; },
    async getPurchaseIntent({ account, reference }) {
      const row = intents.get(reference);
      return row && row.vercel_account === account ? { ...row } : null;
    },
    async approvePurchaseIntent({ account, reference, ceilingCents, acknowledgeUnbounded = false }) {
      const row = intents.get(reference);
      if (!row || row.vercel_account !== account || row.status !== 'pending') return false;
      row.status = 'approved'; row.ceiling_cents = ceilingCents;
      row.allow_unbounded_metered = acknowledgeUnbounded; row.approved_at = new Date();
      return true;
    },
    async setOwnerSpendLimit(account, cents) { spendLimit = cents; return true; },
    async recordChange(entry) { changes.push(entry); return changes.length; },
    requestReplayStore: () => ({ claim: vi.fn(), complete: vi.fn() })
  };
  return { db, intents, changes, spendLimit: () => spendLimit };
}
async function issueSpend(f, cents = 1125) {
  const issued = await requestOwnerAccountChange({
    db: f.db, env, connection: { account: 'team_FAKE', profile: 'full', mode: 'production' },
    args: { action: 'spend', limitCents: cents, confirm: true }
  });
  expect(issued.status).toBe('awaiting_owner_approval');
  return issued.reference;
}

describe('AUD-AS vercel_apply_owner_approval', () => {
  it('refuses a pass-kind connection at the handler, through the real dispatch boundary', async () => {
    const f = fixture();
    const reference = await issueSpend(f);
    // A write-capable pass may carry the full profile, so it passes
    // profile visibility and reaches the handler — kind is the gate.
    const fullPass = await dispatchReadOnlyTool({
      registry, name: 'vercel_apply_owner_approval',
      args: { reference, confirm: true },
      connection: { kind: 'pass', account: 'team_FAKE', profile: 'full', mode: 'production', listing: 'catalog' },
      db: f.db, env
    });
    expect(fullPass.isError).toBe(true);
    const payload = JSON.parse(fullPass.content[0].text);
    expect(payload.status).toBe('refused_by_guard');
    expect(payload.reason).toContain('delegated pass can never apply');
    // A narrower pass never even reaches the handler.
    const everydayPass = await dispatchReadOnlyTool({
      registry, name: 'vercel_apply_owner_approval',
      args: { reference, confirm: true },
      connection: { kind: 'pass', account: 'team_FAKE', profile: 'everyday', mode: 'preview', listing: 'catalog' },
      db: f.db, env
    });
    expect(everydayPass.isError).toBe(true);
    expect(everydayPass.content[0].text).toContain('Tool unavailable');
    // Neither attempt consumed the envelope: the owner's own
    // connection can still inspect it.
    const stillThere = await handler({ reference, dryRun: true }, { connection: connector, db: f.db, env, registry });
    expect(parse(stillThere).status).toBe('preview');
  });

  it('inspects without consuming, then applies exactly once; a replay refuses', async () => {
    const f = fixture();
    const reference = await issueSpend(f);
    const dry = await handler({ reference, dryRun: true }, { connection: connector, db: f.db, env, registry });
    expect(parse(dry)).toMatchObject({ status: 'preview', confirmed: false,
      family: 'owner_account_change', summary: 'Set team_FAKE daily spend limit to $11.25' });
    const bare = await handler({ reference }, { connection: connector, db: f.db, env, registry });
    expect(parse(bare).status).toBe('needs_confirmation');
    expect(f.spendLimit()).toBe(0);
    const applied = await handler({ reference, confirm: true }, { connection: connector, db: f.db, env, registry });
    expect(parse(applied)).toMatchObject({ status: 'applied', confirmed: true,
      family: 'owner_account_change', action: 'spend' });
    expect(f.spendLimit()).toBe(1125);
    const replay = await handler({ reference, confirm: true }, { connection: connector, db: f.db, env, registry });
    expect(parse(replay).status).toBe('refused_by_guard');
    expect(f.spendLimit()).toBe(1125);
  });

  it('rejects malformed arguments — above all a passphrase-shaped one (gate 2.6)', async () => {
    const f = fixture();
    const reference = await issueSpend(f);
    for (const args of [
      { reference, confirm: true, passphrase: 'fixture' },
      { reference, confirm: 'yes' },
      { reference: 'not-a-reference', confirm: true },
      { confirm: true },
      { reference, dryRun: true, account: 'team_OTHER' },
      null, 'x', []
    ]) {
      const out = await handler(args, { connection: connector, db: f.db, env, registry });
      expect(parse(out).status).toBe('refused_by_guard');
    }
    expect(f.spendLimit()).toBe(0);
  });

  it('refuses on a preview deployment and for an unknown reference', async () => {
    const f = fixture();
    const reference = await issueSpend(f);
    const preview = await handler({ reference, confirm: true },
      { connection: connector, db: f.db, env: { ...env, VERCEL_ENV: 'preview' }, registry });
    expect(parse(preview).reason).toContain('production server');
    const unknown = await handler({ reference: '12345678-1234-1234-1234-123456789012', confirm: true },
      { connection: connector, db: f.db, env, registry });
    expect(parse(unknown).status).toBe('refused_by_guard');
    expect(f.spendLimit()).toBe(0);
  });

  it('applies a fixed-price purchase intent at exactly its quoted total', async () => {
    const f = fixture();
    const reference = '22345678-1234-1234-1234-123456789012';
    f.intents.set(reference, { id: reference, vercel_account: 'team_FAKE',
      operation: 'vercel_project_create', price_cents: 2000, pricing_source: 'provider_quote',
      ceiling_cents: null, allow_unbounded_metered: false, status: 'pending',
      expires_at: new Date(Date.now() + 600000) });
    const dry = await handler({ reference, dryRun: true }, { connection: connector, db: f.db, env, registry });
    expect(parse(dry)).toMatchObject({ status: 'preview', family: 'purchase_intent' });
    expect(parse(dry).summary).toContain('Quoted total: $20.00');
    const applied = await handler({ reference, confirm: true }, { connection: connector, db: f.db, env, registry });
    expect(parse(applied)).toMatchObject({ status: 'applied', confirmed: true,
      family: 'purchase_intent', ceilingCents: 2000, acknowledgeUnbounded: false });
    const replay = await handler({ reference, confirm: true }, { connection: connector, db: f.db, env, registry });
    expect(parse(replay).status).toBe('refused_by_guard');
  });
});
