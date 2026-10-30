// P-2 acceptance: the full Appliance Desk readiness row set against
// fixtures — healthy app, missing variable name (pending-input request,
// never an invented value), Node mismatch, branch drift, unverified
// domain (fixable), same preview/production database (needs you via
// compare), spend-management guided row (never read as a value).
import { describe, it, expect } from 'vitest';
import { workflowReadinessTools } from '../../src/tools/workflow-readiness.js';
import { APPLIANCE_DESK_PROFILE } from '../../src/db.js';

const P = APPLIANCE_DESK_PROFILE;
const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

function healthyRoutes(overrides = {}) {
  const envItems = [];
  for (const [target, names] of Object.entries(P.expected_env)) {
    for (const key of names) {
      envItems.push({ key, targets: [target], kind: 'encrypted' });
    }
  }
  // The app also sets the database names for preview (pointing at the
  // preview database) — the isolation row compares those.
  envItems.push({ key: 'DATABASE_URL', targets: ['preview'], kind: 'secret' });
  envItems.push({ key: 'DIRECT_URL', targets: ['preview'], kind: 'secret' });
  return {
    vercel_project_get: ok({
      id: 'prj_fixture', name: 'appliance-desk', framework: 'nextjs',
      nodeVersion: '24.x', productionBranch: 'live',
      ignoreBuildStep: 'node scripts/ignore-build.mjs' }),
    vercel_env_list: ok({ project: 'prj_fixture', items: envItems }),
    vercel_env_compare: ok({ comparisons: [
      { key: 'DATABASE_URL', status: 'different' },
      { key: 'DIRECT_URL', status: 'different' }] }),
    vercel_cron_list: ok({ project: 'prj_fixture', available: true,
      jobs: P.expected_crons.map((c) => ({ path: c.path, scheduleUtc: c.schedule })) }),
    vercel_domain_list_project_domains: ok({ domains: [
      { name: 'robinsonappliancerentals.com', verified: true }] }),
    vercel_domain_list: ok({ domains: [
      { name: 'robinsonappliancerentals.com', verified: true,
        expiresAt: 1798761600000 }] }),
    vercel_dns_list: ok({ domain: 'robinsonappliancerentals.com', records: [
      { type: 'MX', name: '', value: 'aspmx.l.google.com' },
      { type: 'TXT', name: '', value: 'v=spf1 include:_spf.google.com ~all' },
      { type: 'TXT', name: 'google._domainkey', value: 'v=DKIM1; k=rsa; p=fixture' },
      { type: 'TXT', name: 'resend._domainkey', value: 'v=DKIM1; k=rsa; p=fixture' },
      { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none;' },
      { type: 'MX', name: 'send', value: 'feedback-smtp.us-east-1.amazonses.com' }] }),
    vercel_protection_get: ok({ vercelAuthentication:
      { enabled: true, deploymentType: 'preview' } }),
    vercel_where_is_setting: ok({ found: true, steps: ['Open Team Settings → Billing → Spend Management.'] }),
    ...overrides
  };
}
function ctxFor(routes, dbOverrides = {}) {
  return {
    connection: { account: 'acct_fixture' },
    db: {
      getKnownApp: async () => ({ id: P.id, name: P.name, status: 'active',
        source: 'default', profile: structuredClone(P) }),
      listBlobStoreConnections: async () => [{ label: 'appliance-desk-photos' }],
      ...dbOverrides
    },
    dispatchTool: async (name) => {
      const r = routes[name];
      if (!r) throw new Error(`no fixture route for ${name}`);
      return r;
    }
  };
}
const run = (ctx, args = { app: 'appliance-desk' }) =>
  workflowReadinessTools.handlers.vercel_workflow_app_readiness(args, ctx)
    .then((r) => JSON.parse(r.content[0].text));
const row = (result, id) => result.rows.find((r) => r.id === id);

describe('P-2 workflow app readiness', () => {
  it('healthy app: core rows done, summary consistent', async () => {
    const r = await run(ctxFor(healthyRoutes()));
    expect(r.app).toBe('appliance-desk');
    expect(row(r, 'project').status).toBe('done');
    expect(row(r, 'framework').status).toBe('done');
    expect(row(r, 'node').status).toBe('done');
    expect(row(r, 'production-branch').status).toBe('done');
    expect(row(r, 'crons').status).toBe('done');
    expect(row(r, 'env-isolation').status).toBe('done');
    expect(row(r, 'domain-robinsonappliancerentals.com').status).toBe('done');
    expect(row(r, 'dns-robinsonappliancerentals.com').status).toBe('done');
    expect(row(r, 'stores').status).toBe('done');
    expect(row(r, 'preview-protection').status).toBe('done');
    const s = r.summary;
    expect(s.total).toBe(r.rows.length);
    expect(s.done + s.fixable + s.needsYou + s.needsDecision).toBe(s.total);
  });
  it('missing variable name -> pending-input request, no invented value', async () => {
    const routes = healthyRoutes();
    const items = JSON.parse(routes.vercel_env_list.content[0].text).items
      .filter((i) => !(i.key === 'RESEND_API_KEY' && i.targets.includes('production')));
    routes.vercel_env_list = ok({ project: 'prj_fixture', items });
    const r = await run(ctxFor(routes));
    const envRow = row(r, 'env-production');
    expect(envRow.status).toBe('needs_you');
    expect(envRow.pendingInputs.length).toBe(1);
    expect(envRow.pendingInputs[0].key).toBe('RESEND_API_KEY');
    expect(envRow.pendingInputs[0].target).toBe('production');
    expect('value' in envRow.pendingInputs[0]).toBe(false);
    expect(row(r, 'env-preview').status).toBe('done');
  });
  it('missing managed name -> connect step, never a pending input', async () => {
    const routes = healthyRoutes();
    const items = JSON.parse(routes.vercel_env_list.content[0].text).items
      .filter((i) => i.key !== 'PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN');
    routes.vercel_env_list = ok({ project: 'prj_fixture', items });
    const r = await run(ctxFor(routes));
    const envRow = row(r, 'env-preview');
    expect(envRow.status).toBe('needs_you');
    expect(envRow.pendingInputs).toBe(undefined);
    expect(envRow.steps.join(' ')).toMatch(/managed by an integration or store/);
  });
  it('node version mismatch -> needs_you with engines/dashboard steps', async () => {
    const r = await run(ctxFor(healthyRoutes({
      vercel_project_get: ok({ id: 'prj_fixture', name: 'appliance-desk',
        framework: 'nextjs', nodeVersion: '22.x', productionBranch: 'live',
        ignoreBuildStep: 'node scripts/ignore-build.mjs' }) })));
    const node = row(r, 'node');
    expect(node.status).toBe('needs_you');
    expect(node.steps[0]).toMatch(/engines/);
  });
  it('production branch not live -> guided needs_you, never a fix call', async () => {
    const r = await run(ctxFor(healthyRoutes({
      vercel_project_get: ok({ id: 'prj_fixture', name: 'appliance-desk',
        framework: 'nextjs', nodeVersion: '24.x', productionBranch: 'main',
        ignoreBuildStep: 'node scripts/ignore-build.mjs' }) })));
    const branch = row(r, 'production-branch');
    expect(branch.status).toBe('needs_you');
    expect(branch.fixCall).toBe(undefined);
    expect(branch.steps.join(' ')).toMatch(/live/);
  });
  it('spend management row is guided needs_you, never read as a value', async () => {
    const r = await run(ctxFor(healthyRoutes()));
    const spend = r.rows.find((x) => /spend/i.test(x.label));
    expect(spend).toBeTruthy();
    expect(spend.status).toBe('needs_you');
    expect(spend.detail).toMatch(/cannot read or change/);
  });
  it('preview shares the production database -> needs_you via compare', async () => {
    const r = await run(ctxFor(healthyRoutes({
      vercel_env_compare: ok({ comparisons: [
        { key: 'DATABASE_URL', status: 'same' },
        { key: 'DIRECT_URL', status: 'different' }] }) })));
    const iso = row(r, 'env-isolation');
    expect(iso.status).toBe('needs_you');
    expect(iso.detail).toMatch(/shares the production value/);
  });
  it('secret compare unverifiable -> honest needs_you, not done', async () => {
    const r = await run(ctxFor(healthyRoutes({
      vercel_env_compare: ok({ comparisons: [
        { key: 'DATABASE_URL', status: 'cannot_compare_secret' },
        { key: 'DIRECT_URL', status: 'cannot_compare_secret' }] }) })));
    expect(row(r, 'env-isolation').status).toBe('needs_you');
  });
  it('unverified domain -> fixable with the verify call and outsideApp', async () => {
    const r = await run(ctxFor(healthyRoutes({
      vercel_domain_list_project_domains: ok({ domains: [
        { name: 'robinsonappliancerentals.com', verified: false }] }) })));
    const dom = row(r, 'domain-robinsonappliancerentals.com');
    expect(dom.status).toBe('fixable');
    expect(dom.fixCall.tool).toBe('vercel_domain_verify_project_domain');
    expect(dom.fixCall.args.outsideApp).toBe(true);
  });
  it('framework mismatch -> fixable through the settings tool', async () => {
    const r = await run(ctxFor(healthyRoutes({
      vercel_project_get: ok({ id: 'prj_fixture', name: 'appliance-desk',
        framework: null, nodeVersion: '24.x', productionBranch: 'live',
        ignoreBuildStep: 'node scripts/ignore-build.mjs' }) })));
    const fw = row(r, 'framework');
    expect(fw.status).toBe('fixable');
    expect(fw.fixCall.tool).toBe('vercel_project_update_settings');
    expect(fw.fixCall.args.framework).toBe('nextjs');
  });
  it('drifted cron schedule -> needs_you naming the drift', async () => {
    const jobs = P.expected_crons.map((c) => ({ path: c.path, scheduleUtc: c.schedule }));
    jobs[0] = { ...jobs[0], scheduleUtc: '0 0 * * *' };
    const r = await run(ctxFor(healthyRoutes({
      vercel_cron_list: ok({ project: 'prj_fixture', available: true, jobs }) })));
    const crons = row(r, 'crons');
    expect(crons.status).toBe('needs_you');
    expect(crons.detail).toMatch(/Schedule differs/);
  });
  it('missing owned DNS record -> needs_you, never a fix call', async () => {
    const r = await run(ctxFor(healthyRoutes({
      vercel_dns_list: ok({ domain: 'robinsonappliancerentals.com', records: [
        { type: 'MX', name: '', value: 'aspmx.l.google.com' }] }) })));
    const dns = row(r, 'dns-robinsonappliancerentals.com');
    expect(dns.status).toBe('needs_you');
    expect(dns.fixCall).toBe(undefined);
  });
  it('inline spec works; a decision entry is needs_decision', async () => {
    const spec = structuredClone(P);
    spec.dashboard_settings = [
      { setting: 'Some future toggle', decision: 'IN-99', recommended: 'on' }];
    const r = await run(ctxFor(healthyRoutes()), { spec });
    expect(r.source).toBe('inline spec');
    expect(r.rows.find((x) => x.label === 'Some future toggle').status)
      .toBe('needs_decision');
  });
  it('exactly one of app/spec; unknown app refuses', async () => {
    await expect(run(ctxFor(healthyRoutes()), {})).rejects.toThrow(/exactly one/);
    await expect(run(ctxFor(healthyRoutes()), { app: 'nope', spec: P }))
      .rejects.toThrow(/exactly one/);
    await expect(run(ctxFor(healthyRoutes(), {
      getKnownApp: async () => null }))).rejects.toThrow(/Unknown app profile/);
  });
});
