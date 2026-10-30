// W-1 acceptance (BATCH-W §4 row W-1): the workflow reads compose the
// area tools through a fake registry (the area tools carry their own
// suites); on trial here is the composition logic — section honesty
// (not_readable is never dressed as ok), profile-judged variables,
// release-status anchoring, find's classification and bounded search.
import { describe, it, expect } from 'vitest';
import { workflowReadTools } from '../../src/tools/workflow-reads.js';

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const err = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });
const parse = (r) => JSON.parse(r.content[0].text);
const DAY = 86400000;

function baseState() {
  return {
    projects: [
      { id: 'prj_SHOP', name: 'shop', framework: 'nextjs',
        git: { type: 'github', repo: 'acme/shop', productionBranch: 'main' } },
      { id: 'prj_BLOG', name: 'blog', framework: null, git: null }
    ],
    deployments: {
      prj_SHOP: [
        { id: 'dpl_LIVE', url: 'shop-live.vercel.app', state: 'READY',
          target: 'production', branch: 'main', commit: 'aaaaaaa1111',
          createdAt: 2000 },
        { id: 'dpl_OLD', url: 'shop-old.vercel.app', state: 'READY',
          target: 'production', branch: 'main', commit: 'bbbbbbb2222',
          createdAt: 1000 },
        { id: 'dpl_FAIL', url: 'shop-fail.vercel.app', state: 'ERROR',
          target: 'preview', branch: 'feature/x', commit: 'ccccccc3333',
          createdAt: 3000 },
        { id: 'dpl_PREV', url: 'shop-prev.vercel.app', state: 'READY',
          target: 'preview', branch: 'feature/x', commit: 'ddddddd4444',
          createdAt: 2500 },
        { id: 'dpl_WAIT', url: 'shop-wait.vercel.app', state: 'READY',
          target: 'preview', branch: 'main', commit: 'eeeeeee5555',
          createdAt: 4000 }
      ],
      prj_BLOG: [
        { id: 'dpl_BLOG1', url: 'blog-prev.vercel.app', state: 'READY',
          target: 'preview', branch: 'bloggy', commit: 'fffffff6666',
          createdAt: 1500 }
      ]
    },
    env: {
      prj_SHOP: [
        { key: 'DATABASE_URL', targets: ['production', 'preview'], kind: 'Secret' },
        { key: 'OTHER', targets: ['production'], kind: 'Config' },
        { key: 'STRIPE_KEY', targets: ['preview'], kind: 'Secret' }
      ],
      prj_BLOG: [{ key: 'STRIPE_KEY', targets: ['production'], kind: 'Secret' }]
    },
    errors: [{ errorCode: 'FUNCTION_INVOCATION_FAILED', message: 'Boom',
      count: 42, firstSeen: 100, lastSeen: 200 }],
    domains: [{ name: 'shop.example.com', verified: true, gitBranch: null }],
    certs: [{ id: 'cert_1', cns: ['shop.example.com'], autoRenew: true,
      createdAt: Date.now() - 100 * DAY, expiresAt: Date.now() + 200 * DAY }],
    crons: [{ path: '/api/cron/a', schedule: '0 0 * * *' },
      { path: '/api/cron/b', schedule: '0 6 * * *' }],
    protection: { vercelAuthentication: { enabled: true, deploymentType: 'all' },
      passwordProtection: { enabled: false } },
    rolling: { config: { enabled: true }, active: null },
    teamDomains: { 'shop.example.com': { name: 'shop.example.com', verified: true } }
  };
}

function fakeRegistry(state, failOn = []) {
  const dispatchTool = async (name, args) => {
    if (failOn.includes(name)) return err(`${name} is unavailable`);
    switch (name) {
      case 'vercel_project_get': {
        const p = state.projects.find((x) =>
          x.id === args.project || x.name === args.project);
        return p ? ok({ ...p, productionUrl: 'shop.example.com' }) : err('Project not found');
      }
      case 'vercel_project_list': {
        const page = args.until ? 2 : 1;
        const slice = page === 1 ? state.projects.slice(0, 1) : state.projects.slice(1);
        return ok({ projects: slice, count: slice.length,
          next: page === 1 && state.projects.length > 1 ? 111 : null,
          complete: page !== 1 || state.projects.length <= 1 });
      }
      case 'vercel_deploy_list': {
        let rows = state.deployments[args.project] ?? [];
        if (args.target) rows = rows.filter((d) => d.target === args.target);
        if (args.state) rows = rows.filter((d) => d.state === args.state);
        if (args.branch) rows = rows.filter((d) => d.branch === args.branch);
        if (args.sha) rows = rows.filter((d) => d.commit.startsWith(args.sha));
        const limit = args.limit ?? 20;
        return ok({ project: args.project, deployments: rows.slice(0, limit),
          count: Math.min(rows.length, limit), next: null, complete: true });
      }
      case 'vercel_deploy_get': {
        for (const [pid, rows] of Object.entries(state.deployments)) {
          const hit = rows.find((d) => d.id === args.deployment ||
            d.url === args.deployment);
          if (hit && pid === args.project) return ok(hit);
        }
        return err('Deployment not found in this project');
      }
      case 'vercel_logs_errors_summary':
        return ok({ project: { id: args.project }, errors: state.errors,
          rowCount: state.errors.length, providerRows: state.errors.length,
          fieldsPresent: ['message', 'count'] });
      case 'vercel_domain_list_project_domains':
        return ok({ project: args.project, domains: state.domains,
          count: state.domains.length, next: null, complete: true });
      case 'vercel_cert_list':
        return ok({ certificates: state.certs, shown: state.certs.length });
      case 'vercel_env_list':
        return ok({ project: args.project, items: state.env[args.project] ?? [],
          capped: false });
      case 'vercel_cron_list':
        return ok({ project: args.project, available: true,
          count: state.crons.length, jobs: state.crons });
      case 'vercel_protection_get':
        return ok({ project: { id: args.project }, ...state.protection });
      case 'vercel_rolling_get':
        return ok({ project: args.project, ...state.rolling });
      case 'vercel_domain_get': {
        const d = state.teamDomains[args.domain];
        return d ? ok(d) : err('Domain not found');
      }
      default: return err(`Unexpected dispatch: ${name}`);
    }
  };
  return dispatchTool;
}

function ctxFor(state, { failOn = [], profiles = [] } = {}) {
  return { connection: { account: 'team_FAKE' },
    db: { listKnownApps: async () => profiles },
    dispatchTool: fakeRegistry(state, failOn) };
}
const health = (args, ctx) =>
  workflowReadTools.handlers.vercel_workflow_project_health(args, ctx).then(parse);
const status = (args, ctx) =>
  workflowReadTools.handlers.vercel_workflow_release_status(args, ctx).then(parse);
const find = (args, ctx) =>
  workflowReadTools.handlers.vercel_workflow_find(args, ctx).then(parse);

const SHOP_PROFILE = { id: 'shop-row', status: 'active', profile: {
  id: 'shop-app', name: 'Shop', projects: ['shop'],
  expected_env: { production: ['DATABASE_URL', 'STRIPE_KEY'],
    preview: ['DATABASE_URL'] } } };

describe('vercel_workflow_project_health', () => {
  it('composes every section and judges variables against the profile', async () => {
    const out = await health({ project: 'shop' },
      ctxFor(baseState(), { profiles: [SHOP_PROFILE] }));
    expect(out.project).toMatchObject({ id: 'prj_SHOP', name: 'shop', app: 'shop-app' });
    expect(out.sections.live).toMatchObject({ status: 'ok' });
    expect(out.sections.live.deployment.id).toBe('dpl_LIVE');
    expect(out.sections.failedBuilds).toMatchObject({ status: 'needs_attention', count: 1 });
    expect(out.sections.topErrors.status).toBe('needs_attention');
    expect(out.sections.domains.status).toBe('ok');
    expect(out.sections.variables.status).toBe('needs_attention');
    expect(out.sections.variables.missing).toEqual({ production: ['STRIPE_KEY'] });
    expect(out.sections.crons).toMatchObject({ status: 'ok', count: 2 });
    expect(out.sections.protection.status).toBe('ok');
    expect(out.summary).toEqual({ ok: 4, needsAttention: 3, notReadable: 0 });
  });

  it('reports an empty project honestly, without throwing', async () => {
    const state = baseState();
    const out = await health({ project: 'blog' }, ctxFor(state));
    expect(out.sections.live.status).toBe('needs_attention');
    expect(out.sections.live.detail).toMatch(/no production deployments/i);
    expect(out.sections.failedBuilds).toMatchObject({ status: 'ok', count: 0 });
    expect(out.sections.topErrors.status).toBe('needs_attention'); // team errors fixture is project-agnostic in the fake; blog still composes
    expect(out.sections.domains).toMatchObject({ status: 'ok' });
    expect(out.sections.variables.status).toBe('ok');
    expect(out.sections.variables.note).toMatch(/inventory only/i);
  });

  it('marks failed inner reads not_readable, never ok', async () => {
    const out = await health({ project: 'shop' },
      ctxFor(baseState(), { failOn: ['vercel_deploy_list', 'vercel_cron_list'] }));
    expect(out.sections.live.status).toBe('not_readable');
    expect(out.sections.failedBuilds.status).toBe('not_readable');
    expect(out.sections.crons.status).toBe('not_readable');
    expect(out.summary.notReadable).toBe(3);
    expect(out.sections.protection.status).toBe('ok');
  });

  it('flags a certificate expiring soon', async () => {
    const state = baseState();
    state.certs = [{ id: 'cert_2', cns: ['shop.example.com'], autoRenew: false,
      createdAt: Date.now() - 80 * DAY, expiresAt: Date.now() + 11 * DAY }];
    const out = await health({ project: 'shop' }, ctxFor(state));
    expect(out.sections.domains.status).toBe('needs_attention');
    expect(out.sections.domains.domains[0].issues.join(' '))
      .toMatch(/certificate expires in \d+ day\(s\)/);
  });

  it('treats a shapeless error summary as not_readable', async () => {
    const state = baseState();
    const dispatchTool = fakeRegistry(state);
    const ctx = { connection: { account: 'team_FAKE' }, db: {},
      dispatchTool: async (name, args) => name === 'vercel_logs_errors_summary'
        ? ok({ errors: [], providerRows: null, shapeNote: 'Provider returned no row array' })
        : dispatchTool(name, args) };
    const out = await health({ project: 'shop' }, ctx);
    expect(out.sections.topErrors.status).toBe('not_readable');
  });

  it('refuses a missing project argument', async () => {
    await expect(workflowReadTools.handlers.vercel_workflow_project_health(
      {}, ctxFor(baseState()))).rejects.toThrow(/exactly one project/i);
  });
});

describe('vercel_workflow_release_status', () => {
  it('anchors on the live deployment and lists newer branch builds as waiting', async () => {
    const out = await status({ project: 'shop' }, ctxFor(baseState()));
    expect(out.productionBranch).toBe('main');
    expect(out.live.id).toBe('dpl_LIVE');
    expect(out.waitingOnBranch).toHaveLength(1);
    expect(out.waitingOnBranch[0]).toMatchObject({ id: 'dpl_WAIT', readyToPromote: true });
    expect(out.readyPreviews.map((d) => d.id)).toEqual(['dpl_PREV', 'dpl_WAIT']);
    expect(out.rollingRelease.active).toBeNull();
    expect(out.notReadable).toEqual([]);
  });

  it('reports no live deployment without inventing one', async () => {
    const out = await status({ project: 'blog' }, ctxFor(baseState()));
    expect(out.live).toBeNull();
    expect(out.liveNote).toMatch(/No READY production deployment/);
    expect(out.productionBranch).toBeNull();
    expect(out.waitingNote).toMatch(/production branch is unknown/);
  });
});

describe('vercel_workflow_find', () => {
  it('resolves a project by name', async () => {
    const out = await find({ query: 'shop' }, ctxFor(baseState()));
    expect(out).toMatchObject({ kind: 'project', found: true });
    expect(out.match.project.id).toBe('prj_SHOP');
  });

  it('finds a deployment in the second project page', async () => {
    const out = await find({ query: 'dpl_BLOG1' }, ctxFor(baseState()));
    expect(out).toMatchObject({ kind: 'deployment', found: true });
    expect(out.match.project.id).toBe('prj_BLOG');
    expect(out.searched.projects).toBe(2);
    expect(out.searched.complete).toBe(true);
    const first = await find({ query: 'dpl_LIVE' }, ctxFor(baseState()));
    expect(first.match.deployment.id).toBe('dpl_LIVE');
    expect(first.searched.projects).toBe(1);
  });

  it('resolves a domain and a URL by its hostname', async () => {
    const byName = await find({ query: 'shop.example.com' }, ctxFor(baseState()));
    expect(byName).toMatchObject({ kind: 'domain', found: true });
    const byUrl = await find({ query: 'https://shop.example.com/pricing' },
      ctxFor(baseState()));
    expect(byUrl).toMatchObject({ kind: 'domain', found: true });
  });

  it('resolves a commit SHA and a branch', async () => {
    const bySha = await find({ query: 'ccccccc' }, ctxFor(baseState()));
    expect(bySha).toMatchObject({ kind: 'commit', found: true });
    expect(bySha.match.deployments[0].id).toBe('dpl_FAIL');
    const byBranch = await find({ query: 'feature/x' }, ctxFor(baseState()));
    expect(byBranch).toMatchObject({ kind: 'branch', found: true });
    expect(byBranch.match.project.id).toBe('prj_SHOP');
  });

  it('finds an env key in every project that has it', async () => {
    const out = await find({ query: 'STRIPE_KEY' }, ctxFor(baseState()));
    expect(out).toMatchObject({ kind: 'env_key', found: true });
    expect(out.match.variables.map((v) => v.project.id).sort())
      .toEqual(['prj_BLOG', 'prj_SHOP']);
  });

  it('reports a clean miss with what was searched', async () => {
    const out = await find({ query: 'no-such-thing' }, ctxFor(baseState()));
    expect(out.found).toBe(false);
    expect(out.match).toBeNull();
    expect(out.searched.complete).toBe(true);
  });

  it('stops at the page cap and says the search was incomplete', async () => {
    const state = baseState();
    const dispatchTool = fakeRegistry(state);
    const ctx = { connection: { account: 'team_FAKE' }, db: {},
      dispatchTool: async (name, args) => {
        if (name === 'vercel_project_list') {
          return ok({ projects: [{ id: 'prj_LOOP', name: 'loop' }],
            count: 1, next: (args.until ?? 0) + 1, complete: false });
        }
        if (name === 'vercel_deploy_get') return err('not here');
        return dispatchTool(name, args);
      } };
    const out = await find({ query: 'dpl_MISSING' }, ctx);
    expect(out.found).toBe(false);
    expect(out.searched.projects).toBe(10);
    expect(out.searched.complete).toBe(false);
    expect(out.nextStep).toMatch(/vercel_deploy_get/);
  });
});
