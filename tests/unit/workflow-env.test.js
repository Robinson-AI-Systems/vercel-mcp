import { describe, it, expect } from 'vitest';
import { workflowEnvTools } from '../../src/tools/workflow-env.js';

const syncHandler = workflowEnvTools.handlers.vercel_workflow_env_sync;
const rotateHandler = workflowEnvTools.handlers.vercel_workflow_rotate_secret;
const parse = (r) => JSON.parse(r.content[0].text);

function fakeDb(profiles = []) {
  const rows = [];
  const replay = new Map();
  return { rows,
    async recordChange(e) { rows.push(e); return rows.length; },
    requestReplayStore: () => ({
      claim: async ({ key }) => {
        if (replay.has(key)) return replay.get(key);
        replay.set(key, { state: 'pending' });
        return { state: 'claimed', claimId: 'c1' };
      },
      complete: async ({ key, result }) => {
        replay.set(key, { state: 'completed', result }); },
      release: async ({ key }) => { replay.delete(key); }
    }),
    async getTodaySpendCents() { return 0; },
    async getVercelAccountSafe() { return null; },
    async getPurchasePolicy() { return null; },
    async listProtectedResources() { return []; },
    async listKnownApps() { return profiles; },
    async listBlobStoreConnections() { return []; } };
}

const item = (over = {}) => ({ id: 'env_1', key: 'KEY_A', kind: 'Config',
  targets: ['preview'], gitBranch: null, customEnvironmentIds: [],
  createdAt: 100, updatedAt: 500, ...over });

// state: env rows per project id; the registry filters by target like
// the real env_list, applies copy/set effects, and records dispatches.
function fakeRegistry(state) {
  const dispatched = [];
  const writeFake = (name, effect) => async (args) => {
    dispatched.push({ name, args });
    if (args.dryRun === true) {
      return { content: [{ type: 'text', text: JSON.stringify({
        status: 'preview', preview: `${name} preview` }) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(effect(args)) }] };
  };
  const registry = { async dispatchTool(name, args) {
    const T = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
    switch (name) {
    case 'vercel_project_get':
      return T({ id: args.project, name: 'Site' });
    case 'vercel_env_list': {
      const all = state.env[args.project] ?? [];
      const items = args.target
        ? all.filter((i) => i.targets.includes(args.target)) : all;
      return T({ project: args.project, items,
        capped: state.capped === true, returned: items.length });
    }
    case 'vercel_alias_list':
      return T({ aliases: [{ domain: 'site.example.com',
        deployment: 'dpl_live', id: 'als_1' }],
        shown: 1, capped: false, complete: true });
    case 'vercel_deploy_get':
      return T({ id: 'dpl_live', projectId: 'prj_1',
        url: 'site.example.com', state: 'READY', target: 'production',
        branch: 'main', commit: 'a'.repeat(40), createdAt: 1000 });
    case 'vercel_env_copy':
      return writeFake(name, () => {
        const dst = args.destinationProject ?? args.project;
        (state.env[dst] ??= []).push(item({ id: `env_new_${args.destinationKey}`,
          key: args.destinationKey, kind: 'Config',
          targets: [args.destinationTarget],
          gitBranch: args.destinationGitBranch ?? null, updatedAt: 900 }));
        return { status: 'applied', confirmed: true };
      })(args);
    case 'vercel_env_set':
      return writeFake(name, () => {
        const row = (state.env[args.project] ?? [])
          .find((i) => i.id === args.id);
        if (row) row.updatedAt += 1000;
        state.setArgs = args;
        return { status: 'applied', confirmed: true };
      })(args);
    case 'vercel_deploy_redeploy':
      return writeFake(name, () => ({ status: 'applied', confirmed: true }))(args);
    default: throw new Error(`unexpected ${name}`);
    } } };
  return { registry, dispatched };
}

function ctxFor(db, registry) {
  return { db, connection: { account: 'acct', mode: 'production',
      profile: 'full' },
    env: {}, fetchImpl: async () => { throw new Error('no fetch'); },
    dispatchTool: (n, a) => registry.dispatchTool(n, a) };
}
const syncArgs = (over = {}) => ({ description:
  { project: 'prj_1', sourceTarget: 'preview', destinationTarget: 'production',
    outsideApp: true, ...over },
  requestKey: 'wf-sync-key-00001' });
const rotateArgs = (over = {}) => ({ description:
  { project: 'prj_1', key: 'API_SECRET', outsideApp: true, ...over },
  requestKey: 'wf-rotate-key-001' });

describe('workflow env_sync (W-5)', () => {
  const syncState = () => ({ capped: false, env: { prj_1: [
    item({ id: 'env_a', key: 'ALPHA', targets: ['preview'] }),
    item({ id: 'env_b', key: 'BETA', kind: 'Secret', targets: ['preview'] }),
    item({ id: 'env_c', key: 'GAMMA', targets: ['preview', 'production'] }),
    item({ id: 'env_d', key: 'DELTA', targets: ['preview', 'production'] }),
    item({ id: 'env_p', key: 'ALPHA', targets: ['production'], updatedAt: 700 })
  ] } });
  // NB: DELTA's source row targets production too, so it is reported
  // not-syncable; ALPHA exists at production already via env_p.

  it('copies only the movable missing names and reports the rest', async () => {
    const db = fakeDb(); const state = syncState();
    // EPSILON is Config, preview-only at source, absent at destination.
    state.env.prj_1.push(item({ id: 'env_e', key: 'EPSILON',
      targets: ['preview'] }));
    const { registry, dispatched } = fakeRegistry(state);
    const dry = parse(await syncHandler({ ...syncArgs(), dryRun: true },
      ctxFor(db, registry)));
    expect(dry.status).toBe('preview');
    expect(dry.preview).toContain('Secret-kind sources are never copied');
    expect(dry.preview).toContain('BETA');
    const out = parse(await syncHandler({ ...syncArgs(), confirm: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(out.receipt.copied).toEqual(['EPSILON']);
    expect(out.receipt.consistent).toEqual(['ALPHA', 'DELTA', 'GAMMA']);
    expect(out.receipt.secretSources).toEqual(['BETA']);
    expect(out.receipt.notSyncable).toEqual([]);
    const copy = dispatched.find((d) => d.name === 'vercel_env_copy' &&
      d.args.confirm === true);
    expect(copy.args).toMatchObject({ sourceId: 'env_e', sourceKey: 'EPSILON',
      sourceUpdatedAt: 500, sourceTarget: 'preview',
      destinationTarget: 'production' });
    expect(copy.args.requestKey).toMatch(/-s1$/);
  });

  it('reports a production-targeted Config row as not-syncable cross-project', async () => {
    const db = fakeDb(); const state = syncState();
    state.env.prj_2 = [];
    const { registry, dispatched } = fakeRegistry(state);
    const out = parse(await syncHandler(
      { ...syncArgs({ destinationProject: 'prj_2' }), confirm: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('applied');
    expect(out.receipt.notSyncable.map((x) => x.key))
      .toEqual(['DELTA', 'GAMMA']);
    expect(out.receipt.secretSources).toEqual(['BETA']);
    const copies = dispatched.filter((d) => d.name === 'vercel_env_copy' &&
      d.args.confirm === true);
    expect(copies.map((d) => d.args.sourceKey)).toEqual(['ALPHA']);
    expect(copies[0].args.destinationProject).toBe('prj_2');
  });

  it('refuses to plan from a capped inventory without named keys', async () => {
    const db = fakeDb(); const state = syncState();
    state.capped = true;
    const { registry } = fakeRegistry(state);
    const out = parse(await syncHandler({ ...syncArgs(), dryRun: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toContain('capped at 100 rows');
  });

  it('refuses a named key that is absent at the source', async () => {
    const db = fakeDb(); const state = syncState();
    const { registry } = fakeRegistry(state);
    const out = parse(await syncHandler(
      { ...syncArgs({ keys: ['NOPE'] }), dryRun: true }, ctxFor(db, registry)));
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toContain('NOPE');
  });
});

describe('workflow rotate_secret (W-5)', () => {
  const rotateState = () => ({ capped: false, env: { prj_1: [
    item({ id: 'env_s', key: 'API_SECRET', kind: 'Secret',
      targets: ['production', 'preview'], updatedAt: 500 })
  ] }, setArgs: null });

  it('rotates with a generated value and redeploys the live deployment', async () => {
    const db = fakeDb(); const state = rotateState();
    const { registry, dispatched } = fakeRegistry(state);
    const out = parse(await rotateHandler({ ...rotateArgs(), confirm: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(out.receipt.rotated).toBe(true);
    expect(out.receipt.redeployed).toBe('dpl_live');
    expect(state.setArgs).toMatchObject({ mode: 'update', kind: 'Secret',
      id: 'env_s', expectedUpdatedAt: 500,
      generate: { bytes: 32, encoding: 'hex' } });
    expect(state.setArgs.value).toBeUndefined();
    // The result carries no value and no generate arg-block; the word
    // "generated" in the preview text is the honest description.
    expect(JSON.stringify(out)).not.toContain('"value":');
    expect(JSON.stringify(out)).not.toContain('"generate":');
    const rd = dispatched.find((d) => d.name === 'vercel_deploy_redeploy' &&
      d.args.confirm === true);
    expect(rd.args).toMatchObject({ deployment: 'dpl_live',
      expectedState: 'READY', expectedTarget: 'production' });
    expect(rd.args.requestKey).toMatch(/-s2$/);
  });

  it('refuses a Config variable, a VERCEL_* name and a managed key', async () => {
    const db = fakeDb(); const state = rotateState();
    state.env.prj_1.push(item({ id: 'env_c2', key: 'PLAIN_CFG',
      kind: 'Config', targets: ['production'] }));
    const { registry } = fakeRegistry(state);
    const cfg = parse(await rotateHandler(
      { ...rotateArgs({ key: 'PLAIN_CFG' }), dryRun: true },
      ctxFor(db, registry)));
    expect(cfg.status).toBe('refused_by_guard');
    expect(cfg.reason).toContain('Config variable');
    const v = parse(await rotateHandler(
      { ...rotateArgs({ key: 'VERCEL_TOKEN' }), dryRun: true },
      ctxFor(db, registry)));
    expect(v.status).toBe('refused_by_guard');
    expect(v.reason).toContain('managed by Vercel itself');
    const profiles = [{ status: 'active', profile: { id: 'app1',
      name: 'App One', projects: ['Site'], managed_env: ['API_SECRET'] } }];
    const managed = parse(await rotateHandler(
      { ...rotateArgs(), dryRun: true }, ctxFor(fakeDb(profiles), registry)));
    expect(managed.status).toBe('refused_by_guard');
    expect(managed.reason).toContain('managed by App One');
  });

  it('refuses to pick between rows when targets are not named', async () => {
    const db = fakeDb(); const state = rotateState();
    state.env.prj_1.push(item({ id: 'env_s2', key: 'API_SECRET',
      kind: 'Secret', targets: ['preview'], updatedAt: 600 }));
    const { registry } = fakeRegistry(state);
    const out = parse(await rotateHandler({ ...rotateArgs(), dryRun: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toContain('name the targets to rotate');
  });
});
