import { describe, it, expect } from 'vitest';
import { workflowInsightsTools } from '../../src/tools/workflow-insights.js';

const cost = workflowInsightsTools.handlers.vercel_workflow_cost_check;
const audit = workflowInsightsTools.handlers.vercel_workflow_security_audit;
const parse = (r) => JSON.parse(r.content[0].text);

const charge = (over = {}) => ({ service: 'Build', category: 'Usage',
  project: 'Site', effectiveCents: 1000, billedCents: 1000, ...over });

function fakeRegistry(state) {
  const registry = { async dispatchTool(name, _args) {
    const T = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
    if (state.failOn?.includes(name)) throw new Error(`${name} unavailable`);
    switch (name) {
    case 'vercel_project_get':
      return T({ id: 'prj_1', name: 'Site' });
    case 'vercel_billing_summary':
      return T({ from: '2026-10-01', to: '2026-10-30', lines: 4,
        effectiveTotalCents: state.total ?? 4200, billedTotalCents: 4200,
        creditLinesCents: 0,
        byService: [{ name: 'Build', effectiveCents: 2500 }],
        byProject: [{ name: 'Site', effectiveCents: 4200 }],
        against: { monthlyTargetCents: 5000, proMonthlyCreditCents: 2000 } });
    case 'vercel_billing_list_charges':
      return T({ charges: state.charges ?? [], truncated: false });
    case 'vercel_drain_list':
      return T({ drains: state.drains ?? [], shown: (state.drains ?? []).length });
    case 'vercel_deploy_list':
      return T({ deployments: state.deployments ?? [], next: null,
        complete: true });
    case 'vercel_protection_get':
      return T(state.protection);
    case 'vercel_protection_list_bypass':
      return T({ project: { id: 'prj_1', name: 'Site' },
        bypassSecrets: state.bypass ?? [], count: (state.bypass ?? []).length,
        capped: false });
    case 'vercel_firewall_get':
      return T(state.firewall);
    case 'vercel_env_list':
      return T({ project: 'prj_1', items: state.env ?? [], capped: false });
    case 'vercel_project_list_members':
      return T({ project: 'prj_1', count: 2, complete: true,
        members: [{ id: 'u1', role: 'OWNER' }, { id: 'u2', role: 'MEMBER' }] });
    case 'vercel_member_list':
      return T({ teamId: 'team_1', truncated: false, invites: [{}],
        members: [{ uid: 'u1', role: 'OWNER' }, { uid: 'u2', role: 'MEMBER' },
          { uid: 'u3', role: 'MEMBER' }] });
    default: throw new Error(`unexpected ${name}`);
    } } };
  return registry;
}

const ctxFor = (registry, profiles = []) => ({
  connection: { account: 'acct' },
  db: { listKnownApps: async () => profiles },
  dispatchTool: (n, a) => registry.dispatchTool(n, a) });

describe('workflow cost_check (W-6)', () => {
  it('reports totals against the billing target and counts builds', async () => {
    const state = { charges: [charge(), charge({ service: 'Log Drains',
        effectiveCents: 1700 })],
      deployments: [
        { id: 'd1', branch: 'main', createdAt: Date.UTC(2026, 9, 29, 12) },
        { id: 'd2', branch: 'main', createdAt: Date.UTC(2026, 9, 29, 13) },
        { id: 'd3', branch: 'feat', createdAt: Date.UTC(2026, 9, 30, 9) }],
      drains: [{ id: 'drn_1' }] };
    const out = parse(await cost({ project: 'prj_1' },
      ctxFor(fakeRegistry(state))));
    expect(out.totals.effectiveCents).toBe(4200);
    expect(out.target).toMatchObject({ cents: 5000, source: 'billing setting',
      over: false });
    expect(out.builds.total).toBe(3);
    expect(out.builds.byBranch).toEqual({ main: 2, feat: 1 });
    expect(out.builds.byDay['2026-10-29']).toBe(2);
    expect(out.drivers.byService[0]).toEqual({ name: 'Log Drains', cents: 1700 });
    // W6-C1: the drain suggestion exists because a drain charge exists.
    expect(out.suggestions.some((s) => s.because.includes('Log drain')))
      .toBe(true);
  });

  it('prefers the covering profile cost target when the project is profiled', async () => {
    const state = { charges: [] };
    const profiles = [{ status: 'active', profile: { id: 'app1',
      name: 'App One', projects: ['Site'], cost_target_cents: 3000 } }];
    const out = parse(await cost({ project: 'prj_1' },
      ctxFor(fakeRegistry(state), profiles)));
    expect(out.target).toMatchObject({ cents: 3000, over: true,
      overByCents: 1200 });
    expect(out.target.source).toContain('App One');
  });

  it('emits no drain or sandbox suggestion when those charges are absent', async () => {
    const state = { charges: [charge()] };
    const out = parse(await cost({}, ctxFor(fakeRegistry(state))));
    expect(out.suggestions.some((s) => /drain/i.test(s.because))).toBe(false);
    expect(out.suggestions.some((s) => /sandbox/i.test(s.because)))
      .toBe(false);
    expect(out.builds).toBeNull();
  });
});

describe('workflow security_audit (W-6)', () => {
  const baseState = () => ({
    protection: { vercelAuthentication: { enabled: true,
        deploymentType: 'all' },
      passwordProtection: { enabled: false, deploymentType: null },
      trustedIps: null },
    bypass: [], firewall: { firewallEnabled: true, activeVersion: 3,
      rules: [{}, {}], managedRules: { owasp: { active: true } } },
    env: [{ id: 'e1', key: 'API_SECRET', kind: 'Secret', targets: ['production'] }] });

  it('reports ok across the board on a healthy project', async () => {
    const out = parse(await audit({ project: 'prj_1' },
      ctxFor(fakeRegistry(baseState()))));
    expect(out.overall).toBe('ok');
    expect(out.sections.access.facts.teamMembers.roles)
      .toEqual({ OWNER: 1, MEMBER: 2 });
  });

  it('flags an old bypass secret, a public secret-looking name and preview-only auth', async () => {
    const state = baseState();
    state.bypass = [{ note: 'ci access',
      createdAt: new Date(Date.now() - 120 * 86400000).toISOString() }];
    state.env.push({ id: 'e2', key: 'NEXT_PUBLIC_STRIPE_SECRET',
      kind: 'Config', targets: ['production'] });
    state.protection.vercelAuthentication = { enabled: true,
      deploymentType: 'preview' };
    const out = parse(await audit({ project: 'prj_1' },
      ctxFor(fakeRegistry(state))));
    expect(out.overall).toBe('needs_attention');
    expect(out.sections.bypass.status).toBe('needs_attention');
    expect(out.sections.bypass.reasons[0]).toContain('120 days old');
    expect(out.sections.variables.status).toBe('needs_attention');
    expect(out.sections.variables.reasons[0])
      .toContain('NEXT_PUBLIC_STRIPE_SECRET');
    expect(out.sections.protection.status).toBe('needs_attention');
    expect(out.sections.protection.reasons[0]).toContain('not production');
  });

  it('keeps auditing when one area cannot be read', async () => {
    const state = baseState();
    state.failOn = ['vercel_firewall_get'];
    const out = parse(await audit({ project: 'prj_1' },
      ctxFor(fakeRegistry(state))));
    expect(out.sections.firewall.status).toBe('not_readable');
    expect(out.sections.protection.status).toBe('ok');
    expect(out.overall).toBe('partially_readable');
  });
});
