// O-5: admin security review / cost review / guided settings.
// Composition honesty is the point: a section that cannot be read reports
// not_readable, a real problem reports needs_attention with its reason,
// and member two-step status is not_readable because the member contract
// carries no such field — nothing is ever dressed up as ok.
import {describe, it, expect, vi} from 'vitest';

vi.mock('../../src/vercel/tokens.js', async (importOriginal) => {
  const original = await importOriginal();
  return {...original, loadToken: async () => ({
    token: 'vcp_FAKEtesttoken',
    account: {id: 'team_ONE', team_id: 'team_ONE', slug: 'one', scope: 'team',
      label: 'One', is_default: true}})};
});

import {adminTools} from '../../src/tools/admin.js';
import {findSettingGuide, listSettingGuides} from '../../src/data/dashboard-map.js';

const DAY = 86400000, now = Date.now();
const TEAM = {id: 'team_ONE', name: 'One Team', slug: 'one', billing: {plan: 'pro'},
  saml: {connection: {state: 'connected'}, enforced: false},
  ssoProtection: {deploymentType: 'all'}};
const MEMBERS = {members: [
  {uid: 'u1', email: 'owner@example.com', role: 'OWNER', username: 'owner', confirmed: true, createdAt: 1},
  {uid: 'u2', email: 'dev@example.com', role: 'MEMBER', username: 'dev', confirmed: true, createdAt: 2}],
  emailInviteCodes: [], pagination: {next: null}};
const TOKENS = {tokens: [
  {id: 't1', name: 'leaky', type: 'oauth2', createdAt: now - 10 * DAY, activeAt: now,
   leakedAt: now - DAY, scopes: [{type: 'team', teamId: 'team_ONE', createdAt: 1}]},
  {id: 't2', name: 'soon', type: 'oauth2', createdAt: now - 10 * DAY, activeAt: now,
   expiresAt: now + 5 * DAY, scopes: [{type: 'team', teamId: 'team_ONE', createdAt: 1}]}],
  pagination: {next: null}};
const CHARGE = JSON.stringify({
  BilledCost: 12.34, BillingCurrency: 'USD', ChargeCategory: 'Usage',
  ChargePeriodEnd: '2026-10-31', ChargePeriodStart: '2026-10-01',
  ConsumedQuantity: 1, ConsumedUnit: 'GB', EffectiveCost: 12.34,
  PricingCategory: 'Standard', PricingCurrency: 'USD', PricingQuantity: 1,
  PricingUnit: 'GB', ServiceName: 'Bandwidth', ServiceProviderName: 'Vercel',
  SkuId: 'sku', Tags: {ProjectId: 'prj_ABC', ProjectName: 'Site'}});

function makeCtx() {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const json = (v, ct = 'application/json') => new Response(JSON.stringify(v),
      {status: 200, headers: {'content-type': ct}});
    switch (u.pathname) {
      case '/v2/teams/team_ONE': return json(TEAM);
      case '/v3/teams/team_ONE/members': return json(MEMBERS);
      case '/v6/user/tokens': return json(TOKENS);
      case '/v5/domains': return json({domains: [
        {name: 'example.com', expiresAt: now + 10 * DAY, createdAt: 1}]});
      case '/v8/certs': return json({certs: [
        {id: 'cert_1', cns: ['example.com'], autoRenew: true, createdAt: 1, expiresAt: now + 90 * DAY}]});
      case '/v1/billing/charges':
        return new Response(CHARGE + '\n', {status: 200, headers: {'content-type': 'application/jsonl'}});
      case '/v1/billing/contract-commitments':
        return new Response('', {status: 200, headers: {'content-type': 'application/jsonl'}});
      case '/v1/integrations/configurations': return json({configurations: [{id: 'icfg_1'}]});
      case '/v1/webhooks': return json({webhooks: []});
      case '/v1/drains': return json({drains: [{id: 'drn_1'}]});
      case '/v9/projects/prj_ABC': return json({id: 'prj_ABC', name: 'Site', productionBranch: 'main'});
      default: return new Response(JSON.stringify({error: {code: 'not_found'}}),
        {status: 404, headers: {'content-type': 'application/json'}});
    }
  };
  return {connection: {id: 'conn_1', account: 'team_ONE', profile: 'full',
      mode: 'production', kind: 'connector'},
    env: {TOKEN_ENCRYPTION_KEY: '00'.repeat(32)}, fetchImpl,
    db: {getAccountCredential: async () => ({account: {id: 'team_ONE'}}),
      listProtectedResources: async () => [{id: 'p1'}, {id: 'p2'}]}};
}
const parse = r => JSON.parse(r.content[0].text);
const call = (name, args) => adminTools.handlers[name](args, makeCtx());
const byItem = (arr, name) => arr.find(x => x.item === name);

describe('O-5 admin composition', () => {
  it('security review: single owner flagged; two-step honestly not_readable', async () => {
    const out = parse(await call('vercel_admin_review_security', {}));
    expect(byItem(out.items, 'owners').state).toBe('needs_attention');
    expect(byItem(out.items, 'member_two_step').state).toBe('not_readable');
    expect(byItem(out.items, 'tokens').state).toBe('needs_attention');
    expect(byItem(out.items, 'saml').state).toBe('ok');
    expect(byItem(out.items, 'default_protection').state).toBe('ok');
  });

  it('cost review totals charges and prices the paid seats', async () => {
    const out = parse(await call('vercel_admin_cost_review',
      {from: '2026-10-01', to: '2026-10-31'}));
    expect(out.effectiveTotalCents).toBe(1234);
    expect(out.topServices[0]).toMatchObject({name: 'Bandwidth', effectiveCents: 1234});
    expect(out.paidSeats.monthlyCents).toBe(4000); // OWNER + MEMBER at $20
    expect(out.commitments.count).toBe(0);
  });

  it('guided settings: the map lists coverage with steps-only deletions', () => {
    const guides = listSettingGuides();
    expect(guides.length).toBeGreaterThanOrEqual(20);
    expect(guides.find(g => g.id === 'team-delete')).toMatchObject({stepsOnly: true, hasVerify: false});
    expect(guides.find(g => g.id === 'team-general')).toMatchObject({hasVerify: true});
    const branch = findSettingGuide('production branch');
    expect(branch.steps[0]).toMatchObject({n: 1});
    expect(branch.verifyWith).toMatchObject({tool: 'vercel_project_get', field: 'productionBranch'});
    expect(branch.readBack).toContain('vercel_project_get');
  });

  it('check_setting reads back through verifyWith and refuses to fake the rest', async () => {
    const team = parse(await call('vercel_admin_check_setting', {setting: 'team name'}));
    expect(team).toMatchObject({state: 'read_back', field: 'name', value: 'One Team'});
    const branch = parse(await call('vercel_admin_check_setting',
      {setting: 'production branch', projectId: 'prj_ABC'}));
    expect(branch).toMatchObject({state: 'read_back', value: 'main'});
    const spend = parse(await call('vercel_admin_check_setting', {setting: 'spend management'}));
    expect(spend.state).toBe('not_readable');
    expect(spend.guide.readBack).toContain('Dashboard-only');
    const gone = parse(await call('vercel_admin_check_setting', {setting: 'delete team'}));
    expect(gone.state).toBe('not_readable');
    expect(gone.why).toMatch(/steps-only/);
    const unknown = parse(await call('vercel_admin_check_setting', {setting: 'flux capacitor'}));
    expect(unknown.found).toBe(false);
  });
});
