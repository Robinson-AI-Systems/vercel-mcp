// P-3 acceptance, setup half (BATCH-P §P5 + design P-3 tests): a fake
// registry stands in for the area tools (they carry their own suites);
// the workflow's own logic is what is on trial — planning from read-back
// state, one combined preview, steps dispatched in order through the
// registry, idempotency, the production classification, value-less names
// reported as pending-input requests, and the draft profile row.
import { describe, it, expect } from 'vitest';
import { workflowProjectSetupTools } from '../../src/tools/workflow-project-setup.js';

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const err = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

function fakeRegistry(failOn = null) {
  const state = { projects: new Map(), env: [], domains: [],
    environments: [], protection: { vercelAuthentication:
      { enabled: false, deploymentType: 'all' } }, calls: [] };
  const dispatchTool = async (name, args) => {
    state.calls.push({ name, args });
    if (name === failOn && args.confirm === true) {
      return err('Provider refused: domain is already in use');
    }
    switch (name) {
      case 'vercel_project_get': {
        const p = state.projects.get(args.project) ??
          [...state.projects.values()].find((x) => x.name === args.project);
        return p ? ok({ id: p.id, name: p.name, framework: p.framework ?? null })
          : err('Project not found');
      }
      case 'vercel_project_create': {
        if (args.dryRun) return ok({ status: 'preview',
          preview: `Create project ${args.name}`, requestKey: args.requestKey });
        const p = { id: 'prj_FAKE123', name: args.name, framework: args.framework };
        state.projects.set(p.id, p);
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      case 'vercel_env_list':
        return ok({ project: args.project, items: state.env });
      case 'vercel_env_set': {
        if (args.dryRun) return ok({ status: 'preview',
          preview: `Create variable ${args.key}`, requestKey: args.requestKey });
        state.env.push({ key: args.key, targets: args.targets });
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      case 'vercel_domain_list_project_domains':
        return ok({ domains: state.domains.map((name) => ({ name })) });
      case 'vercel_domain_attach_to_project': {
        if (args.dryRun) return ok({ status: 'preview',
          preview: `Attach ${args.domain}`, requestKey: args.requestKey });
        state.domains.push(args.domain);
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      case 'vercel_environment_list':
        return ok({ project: args.project, items: state.environments });
      case 'vercel_environment_create': {
        if (args.dryRun) return ok({ status: 'preview',
          preview: `Create environment ${args.slug}`, requestKey: args.requestKey });
        state.environments.push({ id: 'env_FAKE', slug: args.slug });
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      case 'vercel_protection_get': return ok(state.protection);
      case 'vercel_protection_set_vercel_auth': {
        if (args.dryRun) return ok({ status: 'preview',
          preview: 'Set Vercel Authentication', requestKey: args.requestKey });
        state.protection.vercelAuthentication.enabled = args.enabled;
        return ok({ status: 'applied', confirmed: true, requestKey: args.requestKey });
      }
      default: return err(`Unexpected dispatch: ${name}`);
    }
  };
  return { state, dispatchTool };
}

function fixture(mode = 'production', failOn = null) {
  const { state, dispatchTool } = fakeRegistry(failOn);
  const audits = [], replay = new Map(), profiles = new Map();
  const db = {
    recordChange: async (entry) => { audits.push(entry); },
    getTodaySpendCents: async () => 0,
    getVercelAccountSafe: async () => ({ id: 'acct_FAKE', spend_limit_cents: 100000 }),
    getPurchasePolicy: async () => ({ grantRequired: false, budgetCents: null }),
    listProtectedResources: async () => [],
    listKnownApps: async () => [],
    listBlobStoreConnections: async () => [],
    upsertKnownApp: async (row) => { profiles.set(row.id, row); return row; },
    getKnownApp: async (_account, id) => profiles.get(id) ?? null,
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
  const connection = { account: 'acct_FAKE', mode, profile: 'full' };
  const handler = workflowProjectSetupTools.handlers.vercel_workflow_project_setup;
  const call = async (args) => {
    const r = await handler(args, { db, connection, env: {}, dispatchTool });
    return { isError: r.isError === true, body: JSON.parse(r.content[0].text) };
  };
  return { state, audits, profiles, call };
}

const DESCRIPTION = {
  name: 'shop-api', framework: 'nextjs', nodeVersion: '24',
  env: [{ key: 'SESSION_SECRET', targets: ['production', 'preview'], generate: true },
    { key: 'DATABASE_URL', targets: ['production'] }],
  domains: ['shop.example.com'],
  protection: { vercelAuth: true },
  customEnvironments: [{ name: 'staging', branch: 'staging' }],
  crons: [{ path: '/api/jobs/nightly', schedule: '0 3 * * *' }]
};

describe('P-3 vercel_workflow_project_setup', () => {
  it('previews one combined plan and applies nothing on dryRun', async () => {
    const f = fixture();
    const r = await f.call({ description: DESCRIPTION, dryRun: true, requestKey: 'wfsetup-test-0001' });
    expect(r.body.status).toBe('preview');
    expect(r.body.preview).toContain('Create project shop-api');
    expect(r.body.preview).toContain('Attach domain shop.example.com');
    expect(r.body.preview).toContain('DATABASE_URL');
    expect(r.body.preview).toContain('Guided: Node version 24');
    expect(f.state.projects.size).toBe(0);
    expect(f.profiles.size).toBe(0);
  });

  it('applies the steps in order, then stores the draft profile', async () => {
    const f = fixture();
    const r = await f.call({ description: DESCRIPTION, confirm: true, requestKey: 'wfsetup-test-0001' });
    expect(r.isError).toBe(false);
    expect(r.body.status).toBe('applied');
    expect(r.body.receipt.project).toBe('shop-api');
    expect(r.body.receipt.projectId).toBe('prj_FAKE123');
    expect(r.body.receipt.stoppedAt).toBeNull();
    expect(r.body.receipt.draftProfile).toEqual({ id: 'shop-api', status: 'draft' });
    expect(r.body.receipt.appNeeds).toContain('# What shop-api needs from Vercel');
    // The generated variable was dispatched; the value-less one was not.
    const envSets = f.state.calls.filter((c) => c.name === 'vercel_env_set' &&
      c.args.confirm === true);
    expect(envSets.map((c) => c.args.key)).toEqual(['SESSION_SECRET']);
    expect(f.state.env).toEqual([{ key: 'SESSION_SECRET',
      targets: ['production', 'preview'] }]);
    expect(r.body.receipt.valuesNeeded.map((v) => v.key)).toEqual(['DATABASE_URL']);
    expect(r.body.receipt.valuesNeeded[0].followUp.tool).toBe('vercel_env_set');
    // Draft row: account-scoped, status + source draft.
    const row = f.profiles.get('shop-api');
    expect(row).toMatchObject({ status: 'draft', source: 'draft',
      account: 'acct_FAKE' });
    expect(row.profile.expected_env.production).toEqual(
      expect.arrayContaining(['SESSION_SECRET', 'DATABASE_URL']));
    expect(row.profile.expected_crons).toEqual(
      [{ path: '/api/jobs/nightly', schedule: '0 3 * * *' }]);
    expect(f.state.domains).toEqual(['shop.example.com']);
    expect(f.state.environments.map((e) => e.slug)).toEqual(['staging']);
    expect(f.state.protection.vercelAuthentication.enabled).toBe(true);
  });

  it('is idempotent: a second run creates nothing new', async () => {
    const f = fixture();
    await f.call({ description: DESCRIPTION, confirm: true, requestKey: 'wfsetup-test-0001' });
    const createsBefore = f.state.calls.filter((c) =>
      c.args.confirm === true).length;
    const r = await f.call({ description: DESCRIPTION, confirm: true,
      requestKey: 'wfsetup-test-0002' });
    expect(r.body.status).toBe('applied');
    expect(r.body.preview).toContain('Nothing to do');
    const createsAfter = f.state.calls.filter((c) =>
      c.args.confirm === true).length;
    expect(createsAfter).toBe(createsBefore);
    expect(f.state.projects.size).toBe(1);
  });

  it('refuses production parts on a preview connection', async () => {
    const f = fixture('preview');
    const r = await f.call({ description: DESCRIPTION, confirm: true, requestKey: 'wfsetup-test-0001' });
    expect(r.isError).toBe(true);
    expect(f.state.projects.size).toBe(0);
  });

  it('stops at the first failing step and reports what was done', async () => {
    const f = fixture('production', 'vercel_domain_attach_to_project');
    const r = await f.call({ description: { name: 'shop-api',
        framework: 'nextjs', domains: ['shop.example.com'] },
      confirm: true, requestKey: 'wfsetup-test-0003' });
    expect(r.body.status).toBe('applied');
    expect(r.body.confirmed).toBe(false);
    // The project step landed before the domain step refused.
    expect(f.state.projects.size).toBe(1);
    // The partial report is journaled on the workflow's own change-log
    // row: what was done, where it stopped, and the undo pointers.
    const row = f.audits.find((a) => a.tool === 'vercel_workflow_project_setup' &&
      a.dryRun === false);
    expect(row.after.appliedSteps).toBe(1);
    expect(row.after.stoppedAt.tool).toBe('vercel_domain_attach_to_project');
    expect(row.after.stoppedAt.reason).toContain('already in use');
    expect(row.inverse.steps.map((s) => s.tool)).toEqual(['vercel_project_create']);
    // No draft profile is saved for a stopped setup.
    expect(f.profiles.size).toBe(0);
  });

  it('refuses a malformed description before any step runs', async () => {
    const f = fixture();
    const r = await f.call({ description: { name: 'shop-api',
        domains: ['bad_domain!'] },
      confirm: true, requestKey: 'wfsetup-test-0004' });
    expect(r.isError).toBe(true);
    expect(f.state.projects.size).toBe(0);
    expect(f.state.calls.filter((c) => c.args.confirm === true)).toEqual([]);
  });
});
