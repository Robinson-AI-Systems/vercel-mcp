// W-2 acceptance (BATCH-W §4 row W-2): a fake registry stands in for
// the area tools (they carry their own suites); on trial here is the
// composition — diagnosis rendering from the screened build-log
// summary, and the deploy workflow's planning (exact commit), single
// create step through its own pipeline, polling, stop behaviour and
// the C-8 partial report on a step refusal.
import { describe, it, expect } from 'vitest';
import { workflowDeployTools } from '../../src/tools/workflow-deploy.js';

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const err = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });
const parse = (r) => JSON.parse(r.content[0].text);
const SHA = 'a'.repeat(40);

/* ---------------- diagnosis ---------------- */

function diagnosisRegistry({ depState = 'ERROR', logs = null, checks = [] } = {}) {
  const deployments = {
    prj_SHOP: { id: 'dpl_FAIL', url: 'shop-fail.vercel.app', state: depState,
      target: null, branch: 'feature/x', commit: 'ccccccc3333', createdAt: 3000 },
    prj_BLOG: { id: 'dpl_BLOGFAIL', url: 'blog-fail.vercel.app', state: 'ERROR',
      target: null, branch: 'main', commit: 'fffffff6666', createdAt: 2000 }
  };
  const dispatchTool = async (name, args) => {
    switch (name) {
      case 'vercel_project_get': {
        const id = args.project.startsWith('prj_') ? args.project
          : { shop: 'prj_SHOP', blog: 'prj_BLOG' }[args.project];
        return id ? ok({ id, name: id === 'prj_SHOP' ? 'shop' : 'blog' })
          : err('Project not found');
      }
      case 'vercel_project_list':
        return ok({ projects: [{ id: 'prj_SHOP', name: 'shop' },
          { id: 'prj_BLOG', name: 'blog' }], count: 2, next: null, complete: true });
      case 'vercel_deploy_get': {
        const dep = deployments[args.project];
        return dep && dep.id === args.deployment ? ok(dep)
          : err('Deployment not found in this project');
      }
      case 'vercel_deploy_get_build_logs':
        return logs ? ok(logs) : err('Build events unavailable');
      case 'vercel_check_list_runs':
        return ok({ project: args.project, deployment: args.deployment,
          items: checks, returnedByProvider: checks.length, capped: false });
      default: return err(`Unexpected dispatch: ${name}`);
    }
  };
  return { dispatchTool, db: {} };
}
const diagnose = (args, ctx) =>
  workflowDeployTools.handlers.vercel_workflow_why_did_build_fail(args, ctx).then(parse);

describe('vercel_workflow_why_did_build_fail', () => {
  it('renders an install-step failure with cause, fix and no-redeploy verdict', async () => {
    const ctx = diagnosisRegistry({ logs: {
      scanned: 120, tally: { error: 3, warning: 1, command: 20, other: 96 },
      firstError: { eventIndex: 12, step: 'Install dependencies',
        note: 'Build error present' },
      returnedByProvider: 120, boundedScan: false, complete: false,
      containsRawLogText: false } });
    const out = await diagnose({ project: 'shop', deployment: 'dpl_FAIL' }, ctx);
    expect(out.verdict).toBe('build_failed');
    expect(out.firstError.step).toBe('Install dependencies');
    expect(out.likelyCause).toMatch(/install/i);
    expect(out.exactFix).toMatch(/lockfile/);
    expect(out.redeployWouldHelp).toBe(false);
  });

  it('says a redeploy may help when the log carries no error events', async () => {
    const ctx = diagnosisRegistry({ logs: {
      scanned: 40, tally: { error: 0, warning: 0, command: 15, other: 25 },
      firstError: null, returnedByProvider: 40, boundedScan: false,
      complete: false, containsRawLogText: false } });
    const out = await diagnose({ project: 'shop', deployment: 'dpl_FAIL' }, ctx);
    expect(out.verdict).toBe('build_failed');
    expect(out.firstError).toBeNull();
    expect(out.redeployWouldHelp).toBe(true);
    expect(out.likelyCause).toMatch(/no error events/i);
  });

  it('reports failed check runs as evidence', async () => {
    const ctx = diagnosisRegistry({
      logs: { scanned: 10, tally: { error: 1, warning: 0, command: 5, other: 4 },
        firstError: { eventIndex: 3, step: 'Build', note: 'x' },
        returnedByProvider: 10, boundedScan: false, complete: false,
        containsRawLogText: false },
      checks: [{ id: 'chk_1', name: 'e2e', status: 'completed', conclusion: 'failure' },
        { id: 'chk_2', name: 'lint', status: 'completed', conclusion: 'success' }] });
    const out = await diagnose({ project: 'prj_SHOP', deployment: 'dpl_FAIL' }, ctx);
    expect(out.failedChecks).toEqual(['e2e']);
    expect(out.likelyCause).toMatch(/build step/i);
  });

  it('reports a READY deployment as not failed', async () => {
    const ctx = diagnosisRegistry({ depState: 'READY' });
    const out = await diagnose({ project: 'shop', deployment: 'dpl_FAIL' }, ctx);
    expect(out.verdict).toBe('not_failed');
    expect(out.redeployWouldHelp).toBe(false);
  });

  it('finds the deployment by probing projects when project is omitted', async () => {
    const ctx = diagnosisRegistry({ logs: {
      scanned: 5, tally: { error: 1, warning: 0, command: 2, other: 2 },
      firstError: { eventIndex: 1, step: null, note: 'x' },
      returnedByProvider: 5, boundedScan: false, complete: false,
      containsRawLogText: false } });
    const out = await diagnose({ deployment: 'dpl_BLOGFAIL' }, ctx);
    expect(out.project).toBe('prj_BLOG');
    expect(out.verdict).toBe('build_failed');
  });
});

/* ---------------- deploy and wait ---------------- */

function deployFixture({ createRefuses = false, neverReady = false } = {}) {
  const calls = [];
  const state = { created: false,
    existing: [{ id: 'dpl_OLD', url: 'shop-old.vercel.app', state: 'READY',
      target: 'preview', branch: 'feature/x', commit: SHA, createdAt: 1000 }],
    fresh: { id: 'dpl_NEW', url: 'shop-new.vercel.app', state: 'BUILDING',
      target: 'preview', branch: 'feature/x', commit: SHA, createdAt: 2000 } };
  let waitCalls = 0;
  const dispatchTool = async (name, args) => {
    calls.push({ name, args });
    switch (name) {
      case 'vercel_project_get':
        return ok({ id: 'prj_SHOP', name: 'shop' });
      case 'vercel_deploy_list': {
        const rows = state.created ? [state.fresh, ...state.existing]
          : state.existing;
        return ok({ project: args.project,
          deployments: rows.filter((d) => d.branch === args.branch),
          count: rows.length, next: null, complete: true });
      }
      case 'vercel_deploy_create_from_git': {
        if (createRefuses) {
          return err(JSON.stringify({ status: 'refused_by_guard',
            confirmed: false, reason: 'Full profile required' }));
        }
        if (args.dryRun) return ok({ status: 'preview',
          preview: 'Create preview deployment of shop from exact commit',
          requestKey: args.requestKey });
        state.created = true;
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      case 'vercel_deploy_wait': {
        waitCalls += 1;
        const ready = !neverReady && waitCalls >= 2;
        return ok({ project: 'prj_SHOP', deployment: args.deployment,
          state: ready ? 'READY' : 'BUILDING', done: ready,
          successful: ready, polls: 1, waitedSeconds: 4,
          next: ready ? null : 'Call again' });
      }
      case 'vercel_deploy_get':
        return ok({ ...state.fresh, state: neverReady ? 'BUILDING' : 'READY' });
      case 'vercel_check_list_runs':
        return ok({ project: args.project, deployment: args.deployment,
          items: [{ id: 'chk_1', name: 'build', status: 'completed',
            conclusion: 'success' }],
          returnedByProvider: 1, capped: false });
      default: return err(`Unexpected dispatch: ${name}`);
    }
  };
  const audits = [], replay = new Map();
  const db = {
    recordChange: async (entry) => { audits.push(entry); },
    getTodaySpendCents: async () => 0,
    getVercelAccountSafe: async () => ({ id: 'acct_FAKE', spend_limit_cents: 100000 }),
    getPurchasePolicy: async () => ({ grantRequired: false, budgetCents: null }),
    listProtectedResources: async () => [],
    listKnownApps: async () => [],
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
  const handler = workflowDeployTools.handlers.vercel_workflow_deploy_and_wait;
  const connection = { account: 'acct_FAKE', mode: 'production', profile: 'full' };
  const call = async (args) => {
    const r = await handler(args, { db, connection, env: {}, dispatchTool });
    return { isError: r.isError === true, body: JSON.parse(r.content[0].text) };
  };
  return { calls, audits, call, state };
}

const DESC = { project: 'shop', branch: 'feature/x' };

describe('vercel_workflow_deploy_and_wait', () => {
  it('previews with the create step\u2019s own dry-run text and the resolved commit', async () => {
    const f = deployFixture();
    const { body } = await f.call({ description: DESC, dryRun: true, requestKey: 'wfd-test-0001' });
    expect(body.status).toBe('preview');
    expect(body.preview).toMatch(/Create preview deployment of shop/);
    expect(body.preview).toContain(SHA);
    expect(f.calls.filter((c) => c.name === 'vercel_deploy_create_from_git' && c.args.confirm)).toHaveLength(0);
  });

  it('creates once with the derived key, polls to READY and reports URL + checks', async () => {
    const f = deployFixture();
    const { body } = await f.call({ description: DESC, confirm: true, requestKey: 'wfd-test-0002' });
    expect(body.status).toBe('applied');
    expect(body.confirmed).toBe(true);
    expect(body.receipt.deployment).toMatchObject({ id: 'dpl_NEW', state: 'READY', url: 'shop-new.vercel.app' });
    expect(body.receipt.checks).toMatchObject({ total: 1, allPassed: true });
    const confirms = f.calls.filter((c) => c.name === 'vercel_deploy_create_from_git' && c.args.confirm === true);
    expect(confirms).toHaveLength(1);
    // The dispatch seam scopes the caller's key before the handler sees
    // it; the step key is derived from that effective key (C-1 pattern).
    expect(confirms[0].args.requestKey).toMatch(/-s1$/);
    expect(confirms[0].args.requestKey).not.toBe('wfd-test-0002');
    expect(confirms[0].args.gitSha).toBe(SHA);
    expect(confirms[0].args.target).toBe('preview');
  });

  it('passes an explicit production target through to the create step', async () => {
    const f = deployFixture();
    const { body } = await f.call({ description: { ...DESC, target: 'production' }, confirm: true, requestKey: 'wfd-test-0003' });
    expect(body.status).toBe('applied');
    const confirms = f.calls.filter((c) => c.name === 'vercel_deploy_create_from_git' && c.args.confirm === true);
    expect(confirms[0].args.target).toBe('production');
  });

  it('stops polling at the cap and returns the deploy_wait continuation', async () => {
    const f = deployFixture({ neverReady: true });
    const { body } = await f.call({ description: DESC, confirm: true, requestKey: 'wfd-test-0004' });
    expect(body.status).toBe('applied');
    expect(body.receipt.done).toBe(false);
    expect(body.receipt.deployment.state).toBe('BUILDING');
    expect(body.receipt.nextStep).toMatch(/vercel_deploy_wait/);
    expect(body.receipt.nextStep).toMatch(/do not re-run/i);
    expect(f.calls.filter((c) => c.name === 'vercel_deploy_wait').length).toBe(12);
  });

  it('stops at the create step\u2019s refusal, with its named reason journaled (C-8)', async () => {
    const f = deployFixture({ createRefuses: true });
    const { body } = await f.call({ description: DESC, confirm: true, requestKey: 'wfd-test-0005' });
    expect(body.status).toBe('applied');
    expect(body.confirmed).toBe(false);
    const after = f.audits.at(-1)?.after;
    expect(after?.stoppedAt?.reason).toBe('Full profile required');
    expect(f.calls.filter((c) => c.name === 'vercel_deploy_wait')).toHaveLength(0);
  });

  it('refuses when no sha is given and the branch has no deployment to take it from', async () => {
    const f = deployFixture();
    f.state.existing = [];
    const { isError, body } = await f.call({ description: DESC, dryRun: true, requestKey: 'wfd-test-0006' });
    expect(isError).toBe(true);
    expect(body.status).toBe('refused_by_guard');
    expect(body.reason).toMatch(/pass sha/);
  });
});
