// AUD-I S3 — the declared box beside the probed one. The declared
// box is the record of what the user chose at their door; the probed
// box is what enrollment verified. Divergence is named in plain
// words (never papered over), the account layer's consequence is
// stated (A-12), and flips are sorted into instant vs step (A-10).
import { describe, it, expect } from 'vitest';
import { declaredBoxOf, probedBoxOf, boxReport, accountLayerText, flipReport }
  from '../../src/vercel/box.js';
import { serverTools } from '../../src/tools/server.js';

describe('AUD-I S3: box reporting', () => {
  it('prefers the stored declaration from the install door', () => {
    const row = { scope: 'team', token_probe: { source: 'integration', declaredBox: 'team' } };
    expect(declaredBoxOf(row)).toBe('team');
    expect(probedBoxOf(row)).toBe('team');
    expect(boxReport(row).divergence).toBe(null);
  });

  it('renders a personal seat honestly from the probe record', () => {
    const row = { scope: 'team', token_probe: { source: 'integration', accountKind: 'personal', declaredBox: 'personal' } };
    const report = boxReport(row);
    expect(report.declaredBox).toBe('personal');
    expect(report.probedBox).toBe('personal');
    expect(report.accountKind).toBe('personal');
    expect(accountLayerText(report)).toContain('not part of this seat');
  });

  it('names the Full Account token that reads back as one team', () => {
    // The owner's god-mode seat: declared account-wide, probed one
    // team because the account owns one team. Nothing is missing.
    const row = { scope: 'team', token_probe: { scopeVerified: false } };
    // A token seat with scope team declares team, so simulate the
    // stored account declaration explicitly:
    const declared = { scope: 'team', token_probe: { declaredBox: 'account', scopeVerified: false } };
    expect(boxReport(row).divergence).toBe(null);
    const report = boxReport(declared);
    expect(report.declaredBox).toBe('account');
    expect(report.probedBox).toBe('team');
    expect(report.divergence).toContain('nothing you asked for is missing');
  });

  it('derives the Door-2 declaration from a full-scope token seat', () => {
    const report = boxReport({ scope: 'full', token_probe: {} });
    expect(report.declaredBox).toBe('account');
    expect(report.probedBox).toBe('account');
    expect(accountLayerText(report)).toContain('are part of this seat');
    expect(flipReport(report).withinCeiling).toContain('instant');
  });

  it('sorts Door-1 widening into a dashboard step, token widening into re-enrollment', () => {
    const install = boxReport({ scope: 'team', token_probe: { source: 'integration', declaredBox: 'team' } });
    expect(flipReport(install).beyondCeiling).toContain('Manage Access');
    const token = boxReport({ scope: 'team', token_probe: {} });
    expect(flipReport(token).beyondCeiling).toContain('broader credential');
  });

  it('tolerates a stringified probe record', () => {
    const report = boxReport({ scope: 'team', token_probe: '{"accountKind":"personal","declaredBox":"personal"}' });
    expect(report.probedBox).toBe('personal');
  });
});

describe('AUD-I S3: whoami carries the box', () => {
  it('reports declared/probed, the account layer and flip picture additively', async () => {
    const row = { id: 'team_FAKE', team_slug: 'test-team', label: 'Test Team',
      scope: 'team', project_name: null, production_enabled: true,
      token_last4: 'DPGA', token_expires_at: null, token_no_expiry: true,
      spend_limit_cents: 0, purchase_budget_cents: null, purchase_grant_required: false,
      token_probe: { source: 'integration', declaredBox: 'account', scopeVerified: false } };
    const db = { listVercelAccounts: async () => [row], getTodaySpendCents: async () => 0 };
    const connection = { account: 'team_FAKE', mode: 'live', profile: 'full', listing: 'front_door' };
    const out = await serverTools.handlers.vercel_whoami({}, { connection, db });
    const value = JSON.parse(out.content[0].text);
    expect(value.box.declaredBox).toBe('account');
    expect(value.box.probedBox).toBe('team');
    expect(value.box.divergence).toContain('nothing you asked for is missing');
    expect(value.accountLayer).toContain('not part of this seat');
    expect(value.workingBoxChanges.withinCeiling).toContain('instant');
    // The pre-S3 fields are untouched.
    expect(value.account.lastFour).toBe('DPGA');
    expect(value.expiryPosture).toBeDefined();
  });
});
