// W-3 acceptance (BATCH-W §4 row W-3): a fake registry + fake fetch
// stand in for the area tools and the network (they carry their own
// suites); on trial here is the composition — ship's W4 gates proven
// in before(), the single release step through its own pipeline, the
// recorded previous deployment, rollback target selection by the
// tool's own dry-run, the profile caution in the preview, alias
// read-back verification and the honest errors-continuing report.
import { describe, it, expect } from 'vitest';
import { workflowReleaseTools } from '../../src/tools/workflow-release.js';

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const err = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

function fixture({ depState = 'READY', checks = [{ id: 'c1', name: 'build', status: 'completed', conclusion: 'success' }],
  smokeStatus = 200, eligible = ['dpl_GOOD'], errorsAfter = [], promoteRefuses = false,
  profiles = [] } = {}) {
  const calls = [];
  const state = { live: 'dpl_LIVE' };
  const deployments = [
    { id: 'dpl_NEW', url: 'shop-new.vercel.app', state: depState, target: 'preview', branch: 'feature/x', commit: 'e'.repeat(40), createdAt: 4000 },
    { id: 'dpl_LIVE', url: 'shop.example.com', state: 'READY', target: 'production', branch: 'main', commit: 'a'.repeat(40), createdAt: 3000 },
    { id: 'dpl_GOOD', url: 'shop-good.vercel.app', state: 'READY', target: 'production', branch: 'main', commit: 'b'.repeat(40), createdAt: 2000 },
    { id: 'dpl_NEVER', url: 'shop-never.vercel.app', state: 'READY', target: 'production', branch: 'main', commit: 'c'.repeat(40), createdAt: 2500 }
  ];
  const dispatchTool = async (name, args) => {
    calls.push({ name, args });
    switch (name) {
      case 'vercel_project_get':
        return ok({ id: 'prj_SHOP', name: 'shop' });
      case 'vercel_alias_list':
        return ok({ project: 'prj_SHOP', complete: true, capped: false,
          aliases: [{ domain: 'shop.example.com', deployment: state.live, id: 'alias_1' }] });
      case 'vercel_deploy_get': {
        const dep = deployments.find((d) => d.id === args.deployment);
        return dep ? ok(dep) : err('Deployment not found');
      }
      case 'vercel_deploy_list':
        return ok({ project: 'prj_SHOP', complete: true,
          deployments: deployments.filter((d) =>
            (args.target ? (d.target === args.target || (args.target === 'production' && d.target === 'production')) : true) &&
            (args.state ? d.state === args.state : true)),
          count: deployments.length, next: null });
      case 'vercel_check_list_runs':
        return ok({ project: 'prj_SHOP', deployment: args.deployment, items: checks, returnedByProvider: checks.length, capped: false });
      case 'vercel_deploy_promote': {
        if (promoteRefuses) return err(JSON.stringify({ status: 'refused_by_guard', confirmed: false, reason: 'Current production routing changed since owner preview' }));
        if (args.dryRun) return ok({ status: 'preview', preview: `PROMOTE production prj_SHOP from ${args.expectedCurrent} to ${args.deployment}`, requestKey: args.requestKey });
        state.live = args.deployment;
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      case 'vercel_deploy_rollback': {
        if (!eligible.includes(args.deployment)) {
          return err(JSON.stringify({ status: 'refused_by_guard', confirmed: false, reason: 'Rollback target was not a prior serving production build' }));
        }
        if (args.dryRun) return ok({ status: 'preview', preview: `ROLL BACK production prj_SHOP from ${args.expectedCurrent} to ${args.deployment}`, requestKey: args.requestKey });
        state.live = args.deployment;
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      case 'vercel_logs_errors_summary':
        return ok({ project: { id: 'prj_SHOP' }, errors: errorsAfter, rowCount: errorsAfter.length, providerRows: errorsAfter.length, fieldsPresent: ['errorCode', 'lastSeen'] });
      default: return err(`Unexpected dispatch: ${name}`);
    }
  };
  const fetchImpl = async (url) => ({ status: smokeStatus, url });
  const audits = [], replay = new Map();
  const db = {
    recordChange: async (entry) => { audits.push(entry); },
    getTodaySpendCents: async () => 0,
    getVercelAccountSafe: async () => ({ id: 'acct_FAKE', spend_limit_cents: 100000 }),
    getPurchasePolicy: async () => ({ grantRequired: false, budgetCents: null }),
    listProtectedResources: async () => [],
    listKnownApps: async () => profiles,
    listBlobStoreConnections: async () => [],
    requestReplayStore: () => ({
      claim: async ({ key }) => {
        if (replay.has(key)) return replay.get(key);
        replay.set(key, { state: 'pending' });
        return { state: 'claimed', claimId: 'c1' };
      },
      complete: async ({ key, result }) => { replay.set(key, { state: 'completed', result }); },
      release: async ({ key }) => { replay.delete(key); }
    })
  };
  const connection = { account: 'acct_FAKE', mode: 'production', profile: 'full' };
  const call = async (tool, args) => {
    const r = await workflowReleaseTools.handlers[tool](args,
      { db, connection, env: {}, dispatchTool, fetchImpl });
    return { isError: r.isError === true, body: JSON.parse(r.content[0].text) };
  };
  return { calls, audits, call, state };
}

const SHIP = 'vercel_workflow_ship_to_production';
const ROLL = 'vercel_workflow_emergency_rollback';
const SHOP_PROFILE = { id: 'shop-row', status: 'active', profile: {
  id: 'shop-app', name: 'Shop', projects: ['shop'],
  rollback_caution: 'Friday deploys have bitten us twice; check the queue drains.' } };

describe('vercel_workflow_ship_to_production', () => {
  it('previews with gates proven and the previous live deployment recorded', async () => {
    const f = fixture();
    const { body } = await f.call(SHIP, { description: { project: 'shop', deployment: 'dpl_NEW' }, dryRun: true, requestKey: 'wfs-test-0001' });
    expect(body.status).toBe('preview');
    expect(body.preview).toMatch(/replacing live dpl_LIVE/);
    expect(body.preview).toMatch(/all 1 concluded success/);
    expect(body.preview).toMatch(/\/ → 200/);
    expect(body.preview).toMatch(/roll back to it with vercel_workflow_emergency_rollback/);
  });

  it('refuses a candidate that is not READY', async () => {
    const f = fixture({ depState: 'BUILDING' });
    const { isError, body } = await f.call(SHIP, { description: { project: 'shop', deployment: 'dpl_NEW' }, dryRun: true, requestKey: 'wfs-test-0002' });
    expect(isError).toBe(true);
    expect(body.reason).toMatch(/not READY/);
  });

  it('refuses when a check failed, naming it', async () => {
    const f = fixture({ checks: [{ id: 'c1', name: 'e2e', status: 'completed', conclusion: 'failure' }] });
    const { body } = await f.call(SHIP, { description: { project: 'shop', deployment: 'dpl_NEW' }, dryRun: true, requestKey: 'wfs-test-0003' });
    expect(body.status).toBe('refused_by_guard');
    expect(body.reason).toMatch(/e2e \(failure\)/);
  });

  it('refuses when the smoke test fails, naming the path and status', async () => {
    const f = fixture({ smokeStatus: 500 });
    const { body } = await f.call(SHIP, { description: { project: 'shop', deployment: 'dpl_NEW', paths: ['/', '/health'] }, dryRun: true, requestKey: 'wfs-test-0004' });
    expect(body.status).toBe('refused_by_guard');
    expect(body.reason).toMatch(/Smoke test failed: \/ returned 500, \/health returned 500/);
  });

  it('ships: promotes once with expectedCurrent and the derived key', async () => {
    const f = fixture();
    const { body } = await f.call(SHIP, { description: { project: 'shop', deployment: 'dpl_NEW' }, confirm: true, requestKey: 'wfs-test-0005' });
    expect(body.status).toBe('applied');
    expect(body.confirmed).toBe(true);
    expect(body.receipt).toMatchObject({ shipped: 'dpl_NEW', previousLive: 'dpl_LIVE' });
    const promotes = f.calls.filter((c) => c.name === 'vercel_deploy_promote' && c.args.confirm === true);
    expect(promotes).toHaveLength(1);
    expect(promotes[0].args.expectedCurrent).toBe('dpl_LIVE');
    expect(promotes[0].args.requestKey).toMatch(/-s1$/);
    expect(f.state.live).toBe('dpl_NEW');
  });

  it('stops with the promote step\u2019s named reason when it refuses', async () => {
    const f = fixture({ promoteRefuses: true });
    const { body } = await f.call(SHIP, { description: { project: 'shop', deployment: 'dpl_NEW' }, confirm: true, requestKey: 'wfs-test-0006' });
    expect(body.status).toBe('applied');
    expect(body.confirmed).toBe(false);
    expect(f.audits.at(-1)?.after?.stoppedAt?.reason).toMatch(/Current production routing changed/);
  });
});

describe('vercel_workflow_emergency_rollback', () => {
  it('shows the profile caution in the preview and skips ineligible newer candidates', async () => {
    const f = fixture({ profiles: [SHOP_PROFILE] });
    const { body } = await f.call(ROLL, { description: { project: 'shop' }, dryRun: true, requestKey: 'wfr-test-0001' });
    expect(body.status).toBe('preview');
    expect(body.preview).toMatch(/App caution: Friday deploys have bitten us twice/);
    expect(body.preview).toMatch(/from dpl_LIVE to dpl_GOOD/);
    expect(body.preview).toMatch(/Newer candidates were not eligible: dpl_NEVER/);
  });

  it('rolls back, verifies by alias read-back and reports no continuing errors', async () => {
    const f = fixture({ profiles: [SHOP_PROFILE] });
    const { body } = await f.call(ROLL, { description: { project: 'shop' }, confirm: true, requestKey: 'wfr-test-0002' });
    expect(body.status).toBe('applied');
    expect(body.confirmed).toBe(true);
    expect(body.receipt).toMatchObject({ from: 'dpl_LIVE', rolledBackTo: 'dpl_GOOD', aliasesVerified: true, errorsContinue: false });
    expect(f.state.live).toBe('dpl_GOOD');
  });

  it('reports honestly when errors continue after the rollback', async () => {
    const f = fixture({ errorsAfter: [{ errorCode: 'FUNCTION_INVOCATION_FAILED', message: 'Boom', count: 3, firstSeen: Date.now() - 60000, lastSeen: Date.now() + 60000 }] });
    const { body } = await f.call(ROLL, { description: { project: 'shop' }, confirm: true, requestKey: 'wfr-test-0003' });
    expect(body.receipt.errorsContinue).toBe(true);
    expect(body.receipt.recentErrorCodes).toEqual(['FUNCTION_INVOCATION_FAILED']);
    expect(body.receipt.note).toMatch(/still occurring/);
  });

  it('refuses when no candidate is eligible, with the tool\u2019s reasons', async () => {
    const f = fixture({ eligible: [] });
    const { isError, body } = await f.call(ROLL, { description: { project: 'shop' }, dryRun: true, requestKey: 'wfr-test-0004' });
    expect(isError).toBe(true);
    expect(body.reason).toMatch(/No eligible rollback target/);
    expect(body.reason).toMatch(/not a prior serving production build/);
  });
});
