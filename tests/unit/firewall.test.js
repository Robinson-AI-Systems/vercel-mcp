import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { loadToken } from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js', async fn => ({ ...await fn(), loadToken: vi.fn() }));

const account = 'acct_FAKE', team = 'team_FAKE';
const production = { account, mode: 'production', profile: 'full', listing: 'catalog' };
const parse = out => JSON.parse(out.content?.[0]?.text ?? '{}');
const projectRow = { id: 'prj_FAKE', name: 'demo', accountId: team };
const ruleDeny = { id: 'rule_FAKE1', name: 'Block wp-admin', description: 'legacy path',
  active: true,
  conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/wp-admin' }] }],
  action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
  valid: true, validationErrors: [] };
const crsOff = Object.fromEntries(['gen', 'java', 'lfi', 'ma', 'php', 'rce', 'rfi', 'sd', 'sf', 'sqli', 'xss']
  .map(k => [k, { active: false, action: 'log' }]));
function config(version, extra = {}) {
  return { id: 'fwc_FAKE', ownerId: team, projectKey: 'prj_FAKE', version,
    updatedAt: '2026-10-30T00:00:00.000Z', changes: [], firewallEnabled: true, botIdEnabled: false,
    rules: [structuredClone(ruleDeny)], conditions: [],
    ips: [{ id: 'ip_FAKE1', hostname: '198.51.100.9', ip: '198.51.100.9', action: 'deny' }],
    crs: structuredClone(crsOff),
    managedRules: { ai_bots: { active: false }, bot_protection: { active: true, action: 'log' },
      owasp: { active: false, action: 'deny' }, traffic_sources: { active: false },
      vercel_ruleset: { active: true, action: 'challenge' } },
    ...extra };
}
const resp = (active, draft = active) => ({ active, draft, versions: [active, config(2)] });

function harness() {
  const fake = makeFakeVercel(), audit = [];
  const db = {
    getAccountCredential: async () => ({}),
    listProtectedResources: async () => [],
    recordChange: async e => audit.push(e),
    requestReplayStore: () => ({
      claim: async ({ key }) => ({ state: 'claimed', claimId: key }),
      complete: async () => true, release: async () => true
    })
  };
  fake.when('GET', '/v9/projects/{idOrName}').resolves(projectRow);
  const call = (name, args = {}, conn = production) =>
    dispatchReadOnlyTool({ registry, name, args, connection: conn, db, fetchImpl: fake.fetch, env: {} });
  return { fake, db, audit, call };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadToken.mockResolvedValue({ token: ['vcp', 'FAKE', 'token'].join('_'),
    account: { id: account, team_id: team, scope: 'team' } });
});

describe('F-2 registration', () => {
  it('registers eleven firewall tools with catalog profiles', () => {
    const byName = n => registry.tools.find(t => t.name === n);
    for (const n of ['vercel_firewall_get', 'vercel_firewall_attack_status', 'vercel_firewall_list_events'])
      expect(byName(n)).toMatchObject({ writes: false });
    expect(byName('vercel_firewall_block_ip').profiles).toEqual(['everyday', 'full']);
    expect(byName('vercel_firewall_set_attack_mode').profiles).toEqual(['everyday', 'full']);
    expect(byName('vercel_firewall_add_rule').profiles).toEqual(['full']);
    expect(byName('vercel_firewall_restore_version').writeContract)
      .toMatchObject({ production: true, targets: true, access: false, spend: false });
  });
});

describe('F-2 reads', () => {
  it('renders the active firewall in words with version history', async () => {
    const h = harness();
    h.fake.when('GET', '/v1/security/firewall/config').resolves(resp(config(3)));
    const view = parse(await h.call('vercel_firewall_get', { project: 'prj_FAKE' }));
    expect(view.activeVersion).toBe(3);
    expect(view.rules[0].summary).toContain('Deny requests where path equals /wp-admin');
    expect(view.ipEntries[0].ip).toBe('198.51.100.9');
    expect(view.managedRules.owasp).toEqual({ active: false, action: 'deny' });
    expect(view.versions.map(v => v.isActive)).toEqual([true, false]);
    h.fake.verify();
  });

  it('summarizes attack status from the anomalies shape and admits the opaque one', async () => {
    const h = harness();
    h.fake.when('GET', '/v1/security/firewall/attack-status')
      .resolves({ anomalies: [{ affectedHostMap: { 'demo.vercel.app': { anomalyAlerts: {}, ddosAlerts: {} } } }] })
      .resolves({});
    const hot = parse(await h.call('vercel_firewall_attack_status', { project: 'prj_FAKE' }));
    expect(hot.underAttack).toBe(true);
    expect(hot.affectedHosts).toEqual(['demo.vercel.app']);
    const opaque = parse(await h.call('vercel_firewall_attack_status', { project: 'prj_FAKE' }));
    expect(opaque.underAttack).toBe(null);
  });

  it('projects event summaries to the documented fields', async () => {
    const h = harness();
    h.fake.when('GET', '/v1/security/firewall/events').resolves({
      actions: [{ action: 'deny', action_type: 'customer-action', count: 42,
        startTime: 1761000000000, endTime: 1761003600000, host: 'demo.vercel.app',
        isActive: true, public_ip: '203.0.113.9', ruleId: 'rule_FAKE1', ruleName: 'Block wp-admin',
        internalNote: 'do-not-leak' }],
      pagination: { hasMore: true, next: 'cursor_FAKE' } });
    const out = await h.call('vercel_firewall_list_events', { project: 'prj_FAKE' });
    const view = parse(out);
    expect(view.events[0]).toEqual({ action: 'deny', actionType: 'customer-action', count: 42,
      startTime: 1761000000000, endTime: 1761003600000, host: 'demo.vercel.app',
      isActive: true, publicIp: '203.0.113.9', ruleId: 'rule_FAKE1', ruleName: 'Block wp-admin' });
    expect(view.hasMore).toBe(true);
    expect(out.content[0].text).not.toContain('do-not-leak');
  });
});

describe('F-2 rules', () => {
  const newRule = { name: 'Challenge bots', conditions: [{ type: 'user_agent', op: 'sub', value: 'bot' }],
    mitigate: { action: 'challenge' } };
  const newValue = { name: 'Challenge bots', active: true,
    conditionGroup: [{ conditions: [{ type: 'user_agent', op: 'sub', value: 'bot' }] }],
    action: { mitigate: { action: 'challenge', rateLimit: null, redirect: null, actionDuration: null } } };

  it('previews in words, dispatches the exact insert body, verifies and journals the inverse', async () => {
    const h = harness();
    const after = config(4, { rules: [structuredClone(ruleDeny),
      { id: 'rule_FAKE2', ...structuredClone(newValue), valid: true, validationErrors: [] }] });
    h.fake.when('GET', '/v1/security/firewall/config')
      .resolves(resp(config(3))).resolves(resp(config(3))).resolves(resp(config(3)))
      .resolves(resp(after));
    h.fake.when('PATCH', '/v1/security/firewall/config').resolves(resp(after));
    const preview = parse(await h.call('vercel_firewall_add_rule',
      { project: 'prj_FAKE', ...newRule, dryRun: true }));
    expect(preview.status).toBe('preview');
    expect(preview.preview).toContain('Challenge requests where user agent contains bot');
    expect(preview.preview).toContain('restore_version to version 3');
    expect(h.fake.calls.filter(x => x.method === 'PATCH')).toHaveLength(0);
    const applied = parse(await h.call('vercel_firewall_add_rule',
      { project: 'prj_FAKE', ...newRule, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body)
      .toEqual({ action: 'rules.insert', id: null, value: newValue });
    expect(JSON.stringify(h.audit)).toContain('vercel_firewall_restore_version');
    h.fake.verify();
  });

  it('refuses an unknown condition type and a preview-mode connection', async () => {
    const h = harness();
    h.fake.when('GET', '/v1/security/firewall/config').resolves(resp(config(3)));
    const bad = parse(await h.call('vercel_firewall_add_rule', { project: 'prj_FAKE',
      name: 'x', conditions: [{ type: 'nope', op: 'eq', value: 'y' }],
      mitigate: { action: 'deny' }, dryRun: true }));
    expect(bad.status).toBe('refused_by_guard');
    const previewConn = parse(await h.call('vercel_firewall_add_rule',
      { project: 'prj_FAKE', ...newRule, confirm: true },
      { account, mode: 'preview', profile: 'full', listing: 'catalog' }));
    expect(previewConn.status).toBe('refused_by_guard');
  });

  it('updates a rule by merging over the current value', async () => {
    const h = harness();
    const after = config(4);
    after.rules[0].active = false;
    h.fake.when('GET', '/v1/security/firewall/config')
      .resolves(resp(config(3))).resolves(resp(config(3))).resolves(resp(after));
    h.fake.when('PATCH', '/v1/security/firewall/config').resolves(resp(after));
    const applied = parse(await h.call('vercel_firewall_update_rule',
      { project: 'prj_FAKE', ruleId: 'rule_FAKE1', active: false, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body).toEqual({
      action: 'rules.update', id: 'rule_FAKE1', value: {
        name: 'Block wp-admin', description: 'legacy path', active: false,
        conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/wp-admin' }] }],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } } } });
    const unknown = parse(await h.call('vercel_firewall_update_rule',
      { project: 'prj_FAKE', ruleId: 'rule_NOPE', active: false, dryRun: true }));
    expect(unknown.status).toBe('refused_by_guard');
    expect(unknown.reason).toContain('No firewall rule with that id');
    h.fake.verify();
  });

  it('removes a rule with the documented remove body', async () => {
    const h = harness();
    const after = config(4, { rules: [] });
    h.fake.when('GET', '/v1/security/firewall/config')
      .resolves(resp(config(3))).resolves(resp(config(3))).resolves(resp(after));
    h.fake.when('PATCH', '/v1/security/firewall/config').resolves(resp(after));
    const applied = parse(await h.call('vercel_firewall_remove_rule',
      { project: 'prj_FAKE', ruleId: 'rule_FAKE1', confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body)
      .toEqual({ action: 'rules.remove', id: 'rule_FAKE1', value: null });
    h.fake.verify();
  });
});

describe('F-2 managed rules and IP entries', () => {
  it('routes managed and CRS rule sets to their own PATCH actions', async () => {
    const h = harness();
    const afterOwasp = config(4);
    afterOwasp.managedRules.owasp = { active: true, action: 'deny' };
    const afterSqli = config(5);
    afterSqli.managedRules.owasp = { active: true, action: 'deny' };
    afterSqli.crs.sqli = { active: true, action: 'log' };
    h.fake.when('GET', '/v1/security/firewall/config')
      .resolves(resp(config(3))).resolves(resp(config(3))).resolves(resp(afterOwasp))
      .resolves(resp(afterOwasp)).resolves(resp(afterOwasp)).resolves(resp(afterSqli));
    h.fake.when('PATCH', '/v1/security/firewall/config').resolves({}).resolves({});
    const a = parse(await h.call('vercel_firewall_set_managed_rules',
      { project: 'prj_FAKE', ruleset: 'owasp', active: true, action: 'deny', confirm: true }));
    expect(a).toMatchObject({ status: 'applied', confirmed: true });
    const b = parse(await h.call('vercel_firewall_set_managed_rules',
      { project: 'prj_FAKE', ruleset: 'sqli', active: true, confirm: true }));
    expect(b).toMatchObject({ status: 'applied', confirmed: true });
    const patches = h.fake.calls.filter(x => x.method === 'PATCH');
    expect(patches[0].body).toEqual({ action: 'managedRules.update', id: 'owasp',
      value: { active: true, action: 'deny' } });
    expect(patches[1].body).toEqual({ action: 'crs.update', id: 'sqli',
      value: { active: true, action: 'log' } });
    const badAction = parse(await h.call('vercel_firewall_set_managed_rules',
      { project: 'prj_FAKE', ruleset: 'sqli', active: true, action: 'challenge', dryRun: true }));
    expect(badAction.status).toBe('refused_by_guard');
    h.fake.verify();
  });

  it('blocks and unblocks IPs with exact bodies and duplicate protection', async () => {
    const h = harness();
    const afterBlock = config(4, { ips: [
      { id: 'ip_FAKE1', hostname: '198.51.100.9', ip: '198.51.100.9', action: 'deny' },
      { id: 'ip_FAKE2', hostname: '203.0.113.5', ip: '203.0.113.5', action: 'deny' }] });
    const afterUnblock = config(5, { ips: [
      { id: 'ip_FAKE2', hostname: '203.0.113.5', ip: '203.0.113.5', action: 'deny' }] });
    h.fake.when('GET', '/v1/security/firewall/config')
      .resolves(resp(config(3))).resolves(resp(config(3))).resolves(resp(afterBlock))
      .resolves(resp(afterBlock)).resolves(resp(afterBlock)).resolves(resp(afterBlock))
      .resolves(resp(afterUnblock));
    h.fake.when('PATCH', '/v1/security/firewall/config').resolves({}).resolves({});
    const blocked = parse(await h.call('vercel_firewall_block_ip',
      { project: 'prj_FAKE', ip: '203.0.113.5', confirm: true }));
    expect(blocked).toMatchObject({ status: 'applied', confirmed: true });
    const dup = parse(await h.call('vercel_firewall_block_ip',
      { project: 'prj_FAKE', ip: '198.51.100.9', dryRun: true }));
    expect(dup.status).toBe('refused_by_guard');
    const unblocked = parse(await h.call('vercel_firewall_unblock_ip',
      { project: 'prj_FAKE', ip: '198.51.100.9', confirm: true }));
    expect(unblocked).toMatchObject({ status: 'applied', confirmed: true });
    const patches = h.fake.calls.filter(x => x.method === 'PATCH');
    expect(patches[0].body).toEqual({ action: 'ip.insert', id: null,
      value: { hostname: '203.0.113.5', ip: '203.0.113.5', action: 'deny' } });
    expect(patches[1].body).toEqual({ action: 'ip.remove', id: 'ip_FAKE1', value: null });
    h.fake.verify();
  });
});

describe('F-2 restore and attack mode', () => {
  it('restores an earlier version and refuses the active or unknown one', async () => {
    const h = harness();
    const v2 = config(2), v3 = config(3);
    const afterRestore = { active: v2, draft: v2, versions: [v3, v2] };
    h.fake.when('GET', '/v1/security/firewall/config')
      .resolves(resp(v3)).resolves(resp(v3)).resolves(afterRestore).resolves(resp(v3));
    h.fake.when('POST', '/v1/security/firewall/config/{configVersion}/activate').resolves({});
    const applied = parse(await h.call('vercel_firewall_restore_version',
      { project: 'prj_FAKE', version: 2, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    const post = h.fake.calls.find(x => x.method === 'POST');
    expect(post.path).toBe('/v1/security/firewall/config/2/activate');
    const active = parse(await h.call('vercel_firewall_restore_version',
      { project: 'prj_FAKE', version: 3, dryRun: true }));
    expect(active.status).toBe('refused_by_guard');
    h.fake.verify();
  });

  it('attack mode needs an end time, respects the 24h cap, and sends the documented body', async () => {
    const h = harness();
    h.fake.when('GET', '/v1/security/firewall/config').resolves(resp(config(3)));
    h.fake.when('POST', '/v1/security/attack-mode')
      .resolves({ attackModeEnabled: true }).resolves({ attackModeEnabled: false });
    const noEnd = parse(await h.call('vercel_firewall_set_attack_mode',
      { project: 'prj_FAKE', enabled: true, dryRun: true }));
    expect(noEnd.status).toBe('refused_by_guard');
    expect(noEnd.reason).toContain('end time');
    const tooLong = parse(await h.call('vercel_firewall_set_attack_mode',
      { project: 'prj_FAKE', enabled: true, durationMinutes: 2000, dryRun: true }));
    expect(tooLong.status).toBe('refused_by_guard');
    const before = Date.now();
    const on = parse(await h.call('vercel_firewall_set_attack_mode',
      { project: 'prj_FAKE', enabled: true, durationMinutes: 60, confirm: true }));
    expect(on).toMatchObject({ status: 'applied', confirmed: true });
    const body = h.fake.calls.find(x => x.method === 'POST').body;
    expect(body.projectId).toBe('prj_FAKE');
    expect(body.attackModeEnabled).toBe(true);
    expect(body.attackModeActiveUntil).toBeGreaterThanOrEqual(before + 59 * 60000);
    expect(body.attackModeActiveUntil).toBeLessThanOrEqual(Date.now() + 61 * 60000);
    const off = parse(await h.call('vercel_firewall_set_attack_mode',
      { project: 'prj_FAKE', enabled: false, confirm: true }));
    expect(off).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.filter(x => x.method === 'POST')[1].body)
      .toEqual({ projectId: 'prj_FAKE', attackModeEnabled: false });
    h.fake.verify();
  });
});
