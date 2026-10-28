import { describe, it, expect, vi } from 'vitest';
import { sampleWrite, attachFakeOwnerPurchase, attachOwnerPurchasePolicy } from '../helpers/write-contract.js';
import { purchaseDisclosure, isOwnerConnection } from '../../src/core/write-preflight.js';

// AUD-A2 (design D-A, owner ruling OP-2): the executor half of VMCP-001.
// All fixtures are synthetic; no real account, token or purchase is involved.
describe('AUD-A2 purchase delegation — owner connections', () => {
  it('(i) completes a fixed-price paid write with confirm only; no purchase intent is created; the journal carries basis owner_word', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    const intent = {
      requestPurchaseIntent: vi.fn(async () => { throw new Error('must not be called'); }),
      getPurchaseIntent: vi.fn(async () => { throw new Error('must not be called'); }),
      consumePurchaseIntent: vi.fn(async () => { throw new Error('must not be called'); })
    };
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: 2500, spentTodayCents: 300 });
    Object.assign(f.ctx.db, intent);
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerWordFake01' }, f.ctx);
    expect(result.status).toBe('applied');
    expect(result.confirmed).toBe(true);
    expect(f.provider).toHaveLength(1);
    expect(intent.requestPurchaseIntent).not.toHaveBeenCalled();
    expect(intent.consumePurchaseIntent).not.toHaveBeenCalled();
    expect(result.delegation).toMatchObject({ basis: 'owner_word', budgetCents: 2500, quotedCents: 500, overBudget: false });
    expect(result.moneyLine).toContain('Your agent budget is $25.00 (today so far: $3.00)');
    expect(result.moneyLine).toContain('This purchase is within your budget.');
    const applied = f.audits.find(a => a.dryRun === false);
    expect(applied.delegation).toEqual({ basis: 'owner_word', budgetCents: 2500, quotedCents: 500, overBudget: false });
    expect(applied.spendCents).toBe(500);
  });
  it('(i) also completes with confirm and no explicit requestKey', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: 2500 });
    const result = await f.tool.run({ confirm: true }, f.ctx);
    expect(result.status).toBe('applied');
    expect(f.provider).toHaveLength(1);
  });
  it('(ii) an explicit owner instruction over the budget completes and journals overBudget: true', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: 100, spentTodayCents: 0 });
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerOverFake01' }, f.ctx);
    expect(result.status).toBe('applied');
    expect(f.provider).toHaveLength(1);
    expect(result.delegation).toMatchObject({ basis: 'owner_word', budgetCents: 100, quotedCents: 500, overBudget: true });
    expect(result.moneyLine).toContain('over your budget — proceeding on your instruction');
    expect(f.audits.find(a => a.dryRun === false).delegation.overBudget).toBe(true);
  });
  it('(iv) an owner connection with no budget set completes on word alone', async () => {
    const f = sampleWrite({ spend: true, cents: 1125 });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: null });
    const preview = await f.tool.run({ dryRun: true }, f.ctx);
    expect(preview.moneyLine).toContain('$11.25 USD');
    expect(preview.moneyLine).toContain('No agent budget set.');
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerNoBudget01' }, f.ctx);
    expect(result.status).toBe('applied');
    expect(result.delegation).toMatchObject({ basis: 'owner_word', budgetCents: null, quotedCents: 1125, overBudget: false });
  });
  it('previews on the owner path show the framed dollar line and journal the delegation block', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: 2500, spentTodayCents: 300 });
    const preview = await f.tool.run({ dryRun: true }, f.ctx);
    expect(preview.status).toBe('preview');
    expect(preview.moneyLine).toContain('within your budget');
    expect(f.audits[0].delegation.basis).toBe('owner_word');
    expect(f.provider).toHaveLength(0);
  });
  it('metered spend executes on the owner word with the usage disclosure and spend_cents = null', async () => {
    const f = sampleWrite({ spend: true, cents: 0 });
    f.spec.spend = async () => ({ cents: null, recurring: true, description: 'Usage-based service' });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: 2500, spentTodayCents: 0 });
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerMetered001' }, f.ctx);
    expect(result.status).toBe('applied');
    expect(f.provider).toHaveLength(1);
    expect(result.moneyLine).toContain('cost depends on usage; Vercel bills it monthly');
    expect(result.delegation).toMatchObject({ basis: 'owner_word', budgetCents: 2500, quotedCents: null, overBudget: false });
    expect(f.audits.find(a => a.dryRun === false).spendCents).toBeNull();
  });
  it('a recurring fixed price executes on the owner word with the per-period quote journaled', async () => {
    const f = sampleWrite({ spend: true, cents: 1250 });
    f.spec.spend = async () => ({ cents: 1250, recurring: true, description: 'Ongoing billed resource' });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: null });
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerRecurFake1' }, f.ctx);
    expect(result.status).toBe('applied');
    expect(result.moneyLine).toContain('$12.50 USD per billing period');
    expect(result.delegation.quotedCents).toBe(1250);
  });
  it('the V-4 Sandbox path is an instance of the owner rule, not an exception', async () => {
    const f = sampleWrite({ spend: true, cents: 0 });
    f.spec.name = 'vercel_dev_sandbox_create';
    f.spec.risk = { spend: true, ownerApprovedMetered: true };
    f.spec.spend = async () => ({ cents: null, recurring: true, description: 'Vercel Sandbox for 10 minutes (metered)' });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: null });
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerSandbox001' }, f.ctx);
    expect(result.status).toBe('applied');
    expect(f.provider).toHaveLength(1);
  });
  it('keeps the pre-dispatch price re-check on the owner path', async () => {
    const f = sampleWrite({ spend: true, cents: 475 });
    let calls = 0;
    f.spec.spend = async () => (++calls === 1 ?
      { cents: 475, recurring: false, description: 'Fixture operation' } :
      { cents: 476, recurring: false, description: 'Fixture operation' });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: null });
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerRaceFake01' }, f.ctx);
    expect(result).toMatchObject({ status: 'refused_by_guard', confirmed: false });
    expect(f.provider).toHaveLength(0);
    expect(calls).toBe(2);
  });
  it('an owner who opted into purchase_grant_required keeps the one-use grant flow verbatim', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    attachOwnerPurchasePolicy(f.ctx, { budgetCents: 2500, grantRequired: true });
    const owner = attachFakeOwnerPurchase(f.ctx, false);
    const args = { confirm: true, requestKey: 'ownerGrantFake1' };
    const pending = await f.tool.run(args, f.ctx);
    expect(pending.status).toBe('awaiting_owner_approval');
    expect(pending.delegation).toBeUndefined();
    expect(f.provider).toHaveLength(0);
    owner.status = 'approved';
    const applied = await f.tool.run(args, f.ctx);
    expect(applied.status).toBe('applied');
    expect(applied.delegation).toBeUndefined();
    expect(f.audits.find(a => a.dryRun === false).delegation).toBeUndefined();
  });
  it('refuses when the purchase policy cannot be verified on an owner connection', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    f.ctx.connection = { ...f.ctx.connection, kind: 'connector' };
    f.ctx.db = { getPurchasePolicy: async () => ({ budgetCents: 'lots', grantRequired: false }),
      getTodaySpendCents: async () => 0 };
    const result = await f.tool.run({ confirm: true, requestKey: 'ownerBadPolicy1' }, f.ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(f.provider).toHaveLength(0);
  });
});

describe('AUD-A2 purchase delegation — delegated and builder connections keep the grant', () => {
  it('(iii) a delegated (pass) connection is refused exactly as today without owner approval', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    // A writable-profile delegated fixture isolates the purchase branch;
    // real RTC passes are read_only and are refused even earlier (below).
    f.ctx.connection = { ...f.ctx.connection, kind: 'pass' };
    f.ctx.db = { getPurchasePolicy: async () => ({ budgetCents: 2500, grantRequired: false }),
      getTodaySpendCents: async () => 0 };
    const owner = attachFakeOwnerPurchase(f.ctx, false);
    const args = { confirm: true, requestKey: 'passAttemptFake1' };
    expect((await f.tool.run(args, f.ctx)).status).toBe('awaiting_owner_approval');
    expect(f.provider).toHaveLength(0);
    // The owner's budget binds the delegate: only the separately
    // authenticated owner approval releases the purchase, never the
    // delegate's own word over the budget.
    owner.status = 'approved';
    expect((await f.tool.run(args, f.ctx)).status).toBe('applied');
    expect(f.provider).toHaveLength(1);
  });
  it('an RTC pass (read_only) cannot write at all', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    f.ctx.connection = { ...f.ctx.connection, kind: 'pass', profile: 'read_only' };
    attachOwnerPurchasePolicy(f.ctx, {});
    f.ctx.connection.kind = 'pass';
    f.ctx.connection.profile = 'read_only';
    expect((await f.tool.run({ confirm: true, requestKey: 'passReadOnly001' }, f.ctx)).status)
      .toBe('refused_by_guard');
    expect(f.provider).toHaveLength(0);
  });
  it('builder/TEST identities still cannot purchase on confirm alone', async () => {
    const f = sampleWrite({ spend: true, cents: 500 });
    // No server-minted owner classification: even with a policy accessor
    // present, confirm alone buys nothing and no grant machinery is bypassed.
    f.ctx.db = { getPurchasePolicy: async () => ({ budgetCents: null, grantRequired: false }),
      getTodaySpendCents: async () => 0 };
    const result = await f.tool.run({ confirm: true, requestKey: 'builderFake0001' }, f.ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(f.provider).toHaveLength(0);
    const t = sampleWrite({ spend: true, cents: 500 });
    t.ctx.connection = { ...t.ctx.connection, kind: 'test', mode: 'preview', profile: 'everyday' };
    t.ctx.db = { getPurchasePolicy: async () => ({ budgetCents: null, grantRequired: false }),
      getTodaySpendCents: async () => 0 };
    expect((await t.tool.run({ confirm: true, requestKey: 'testIdentity001' }, t.ctx)).status)
      .toBe('refused_by_guard');
    expect(t.provider).toHaveLength(0);
  });
  it('classification comes only from the server-minted connection kind', () => {
    expect(isOwnerConnection({ kind: 'connector' })).toBe(true);
    expect(isOwnerConnection({ kind: 'pass' })).toBe(false);
    expect(isOwnerConnection({ account: 'acct_FAKE', profile: 'full' })).toBe(false);
    expect(isOwnerConnection(null)).toBe(false);
  });
  it('purchaseDisclosure frames budget, no-budget and metered lines', () => {
    const within = purchaseDisclosure({ description: 'Domain registration', cents: 1125, recurring: false, budgetCents: 2500, spentTodayCents: 300 });
    expect(within.moneyLine).toBe('Domain registration: $11.25 USD. Your agent budget is $25.00 (today so far: $3.00). This purchase is within your budget.');
    expect(within.delegation).toEqual({ basis: 'owner_word', budgetCents: 2500, quotedCents: 1125, overBudget: false });
    const none = purchaseDisclosure({ description: 'Domain registration', cents: 1125, recurring: false, budgetCents: null, spentTodayCents: 0 });
    expect(none.moneyLine).toContain('No agent budget set.');
    const metered = purchaseDisclosure({ description: 'Build usage', cents: null, recurring: true, budgetCents: 2500, spentTodayCents: 0 });
    expect(metered.moneyLine).toContain('cost depends on usage; Vercel bills it monthly');
    expect(metered.delegation.quotedCents).toBeNull();
  });
});
