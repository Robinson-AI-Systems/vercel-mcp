// X-1: vercel_undo_change against a fake change log and a fake
// registry. The step fakes journal their own change rows the way the
// real tools' executors do, so the undo's step-row lookup and its
// own inverse pointer are exercised end to end.
import { describe, expect, it } from 'vitest';
import { undoTools } from '../../src/tools/undo.js';

const ACCOUNT = 'acct_undo';
let nextId = 100;

function makeWorld(rows) {
  const journal = [];
  const dispatched = [];
  const db = {
    async getChangeForUndo({ id }) {
      const row = rows.find((r) => r.id === id) ?? null;
      if (!row) return null;
      const undo = journal.find((j) => j.tool === 'vercel_undo_change' &&
        j.dry_run === false && j.after?.undoes === id);
      return { ...row, alreadyUndoneBy: undo?.id ?? null };
    },
    async listRecentChanges({ tool, limit }) {
      return journal.filter((j) => j.tool === tool)
        .slice(-(limit ?? 5)).reverse()
        .map((j) => ({ id: j.id, at: j.at, dry_run: j.dry_run, tool: j.tool }));
    },
    async recordChange(entry) {
      const row = { id: nextId++, at: new Date().toISOString(),
        tool: entry.tool, dry_run: entry.dryRun === true,
        after: entry.after ?? null, inverse: entry.inverse ?? null };
      journal.push(row);
      return row.id;
    },
    requestReplayStore() {
      return { async claim() { return { state: 'claimed', claimId: 'c1' }; },
        async complete() { return {}; } };
    },
    async getVercelAccountSafe() { return null; },
    async getTodaySpendCents() { return 0; },
    async getPurchasePolicy() { return null; },
    async listProtectedResources() { return []; },
    async listKnownApps() { return []; }
  };
  const stepOk = (tool, preview) => async (args) => {
    dispatched.push({ tool, args });
    if (args.dryRun) {
      return { isError: false, content: [{ type: 'text',
        text: JSON.stringify({ status: 'preview', confirmed: false, preview }) }] };
    }
    const row = { id: nextId++, at: new Date().toISOString(), tool,
      dry_run: false, after: { confirmed: true }, inverse: null };
    journal.push(row);
    return { isError: false, content: [{ type: 'text',
      text: JSON.stringify({ status: 'applied', confirmed: true }) }] };
  };
  const steps = {
    vercel_project_pause: stepOk('vercel_project_pause', 'Pause project app'),
    vercel_project_unpause: stepOk('vercel_project_unpause', 'Unpause project app'),
    vercel_deploy_rollback: stepOk('vercel_deploy_rollback', 'Roll back production'),
    vercel_dns_create_record: stepOk('vercel_dns_create_record', 'Create DNS record'),
    vercel_env_delete: stepOk('vercel_env_delete', 'Delete variable')
  };
  const dispatchTool = async (name, args) => {
    if (name === 'vercel_undo_change') {
      return undoTools.handlers.vercel_undo_change(args,
        { db, connection, env: {}, fetchImpl: null, dispatchTool });
    }
    const step = steps[name];
    if (!step) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(
        { status: 'refused_by_guard', confirmed: false,
          reason: `No fake step registered for ${name}` }) }] };
    }
    return step(args);
  };
  const connection = { account: ACCOUNT, profile: 'everyday', mode: 'production' };
  const ctx = { db, connection, env: {}, fetchImpl: null, dispatchTool };
  return { db, journal, dispatched, ctx, dispatchTool, connection };
}

const call = async (world, args) => {
  const r = await undoTools.handlers.vercel_undo_change(args, world.ctx);
  return JSON.parse(r.content[0].text);
};
const KEY = 'undokey0001';

describe('vercel_undo_change (X-1)', () => {
  it('undoes a pause by dispatching the recorded unpause inverse', async () => {
    const world = makeWorld([{ id: 41, tool: 'vercel_project_pause',
      production: false, dry_run: false,
      inverse: { tool: 'vercel_project_unpause', project: 'prj_1' } }]);
    const dry = await call(world, { description: { change_id: 41 },
      dryRun: true, requestKey: KEY });
    expect(dry.status).toBe('preview');
    expect(dry.preview).toContain('Unpause project app');
    const done = await call(world, { description: { change_id: 41 },
      confirm: true, requestKey: KEY });
    expect(done.status).toBe('applied');
    expect(done.receipt.undoes).toBe(41);
    expect(done.receipt.via).toBe('vercel_project_unpause');
    expect(typeof done.receipt.stepChangeId).toBe('number');
    const step = world.dispatched.find((d) => d.tool === 'vercel_project_unpause' &&
      d.args.confirm === true);
    expect(step.args.project).toBe('prj_1');
    // The undo's own journaled inverse points at the step's row (X1-C3).
    const undoRow = world.journal.find((j) => j.tool === 'vercel_undo_change');
    expect(undoRow.inverse).toEqual({ tool: 'vercel_undo_change',
      change_id: done.receipt.stepChangeId });
  });

  it('undoes a promote by dispatching rollback with the recorded pair', async () => {
    const world = makeWorld([{ id: 42, tool: 'vercel_deploy_promote',
      production: true, dry_run: false,
      inverse: { tool: 'vercel_deploy_rollback', project: 'prj_1',
        deployment: 'dpl_old', expectedCurrent: 'dpl_new', outsideApp: true } }]);
    const done = await call(world, { description: { change_id: 42 },
      confirm: true, requestKey: KEY });
    expect(done.status).toBe('applied');
    const step = world.dispatched.find((d) => d.tool === 'vercel_deploy_rollback' &&
      d.args.confirm === true);
    expect(step.args).toMatchObject({ deployment: 'dpl_old',
      expectedCurrent: 'dpl_new', outsideApp: true });
  });

  it('expands a stored DNS image through the adapter (recordValue to value)', async () => {
    const world = makeWorld([{ id: 43, tool: 'vercel_dns_delete_record',
      production: false, dry_run: false,
      inverse: { tool: 'vercel_dns_create_record', outsideApp: true,
        domain: 'example.com',
        record: { type: 'MX', name: '', recordValue: 'mail.example.com',
          mxPriority: 10 } } }]);
    const done = await call(world, { description: { change_id: 43 },
      confirm: true, requestKey: KEY });
    expect(done.status).toBe('applied');
    const step = world.dispatched.find((d) => d.tool === 'vercel_dns_create_record' &&
      d.args.confirm === true);
    expect(step.args.value).toBe('mail.example.com');
    expect(step.args.type).toBe('MX');
    expect(step.args.record).toBeUndefined();
    expect(step.args.recordValue).toBeUndefined();
  });

  it('refuses a deletion row naming the re-create route', async () => {
    const world = makeWorld([{ id: 44, tool: 'vercel_project_delete',
      production: true, dry_run: false, inverse: null }]);
    const r = await call(world, { description: { change_id: 44 },
      confirm: true, requestKey: KEY });
    expect(r.status).toBe('refused_by_guard');
    expect(r.reason).toContain('Re-create');
  });

  it('refuses a purchase row as not undoable', async () => {
    const world = makeWorld([{ id: 45, tool: 'vercel_registrar_buy',
      production: false, dry_run: false, inverse: null }]);
    const r = await call(world, { description: { change_id: 45 },
      confirm: true, requestKey: KEY });
    expect(r.status).toBe('refused_by_guard');
    expect(r.reason).toContain('not undoable');
  });

  it('refuses a descriptive inverse carrying its stored sentence', async () => {
    const world = makeWorld([{ id: 46, tool: 'vercel_env_set',
      production: false, dry_run: false,
      inverse: { undo: 'Set API_KEY again from the setup page: a changed value cannot be restored' } }]);
    const r = await call(world, { description: { change_id: 46 },
      confirm: true, requestKey: KEY });
    expect(r.status).toBe('refused_by_guard');
    expect(r.reason).toContain('a changed value cannot be restored');
  });

  it('refuses a workflow steps-pointer row naming the step rows', async () => {
    const world = makeWorld([{ id: 47, tool: 'vercel_workflow_ship_to_production',
      production: true, dry_run: false,
      inverse: { steps: [{ step: 1, tool: 'vercel_deploy_promote' }] } }]);
    const r = await call(world, { description: { change_id: 47 },
      confirm: true, requestKey: KEY });
    expect(r.status).toBe('refused_by_guard');
    expect(r.reason).toContain('step');
  });

  it('refuses an already-undone row, a preview row and an unknown id', async () => {
    const world = makeWorld([
      { id: 48, tool: 'vercel_project_pause', production: false,
        dry_run: false, inverse: { tool: 'vercel_project_unpause', project: 'prj_1' } },
      { id: 49, tool: 'vercel_project_pause', production: false,
        dry_run: true, inverse: { tool: 'vercel_project_unpause', project: 'prj_1' } }]);
    const first = await call(world, { description: { change_id: 48 },
      confirm: true, requestKey: KEY });
    expect(first.status).toBe('applied');
    const again = await call(world, { description: { change_id: 48 },
      confirm: true, requestKey: 'undokey0002' });
    expect(again.status).toBe('refused_by_guard');
    expect(again.reason).toContain('already undone');
    const previewRow = await call(world, { description: { change_id: 49 },
      confirm: true, requestKey: 'undokey0003' });
    expect(previewRow.status).toBe('refused_by_guard');
    expect(previewRow.reason).toContain('preview');
    const missing = await call(world, { description: { change_id: 999 },
      confirm: true, requestKey: 'undokey0004' });
    expect(missing.status).toBe('refused_by_guard');
    expect(missing.reason).toContain('No change 999');
  });

  it('undo of an undo follows the step-row pointer back to the opposite', async () => {
    const world = makeWorld([{ id: 50, tool: 'vercel_project_pause',
      production: false, dry_run: false,
      inverse: { tool: 'vercel_project_unpause', project: 'prj_1' } }]);
    const undone = await call(world, { description: { change_id: 50 },
      confirm: true, requestKey: KEY });
    expect(undone.status).toBe('applied');
    const undoRow = world.journal.find((j) => j.tool === 'vercel_undo_change');
    // Give the step row (the unpause) the inverse a real unpause
    // journals: pause again.
    const stepRow = world.journal.find((j) => j.id === undone.receipt.stepChangeId);
    stepRow.inverse = { tool: 'vercel_project_pause', project: 'prj_1' };
    world.db.getChangeForUndo = async ({ id }) => {
      const row = id === undoRow.id
        ? { id: undoRow.id, tool: 'vercel_undo_change', production: false,
            dry_run: false, inverse: undoRow.inverse }
        : id === stepRow.id
          ? { id: stepRow.id, tool: 'vercel_project_unpause',
              production: false, dry_run: false, inverse: stepRow.inverse }
          : null;
      return row ? { ...row, alreadyUndoneBy: null } : null;
    };
    const redone = await call(world, { description: { change_id: undoRow.id },
      confirm: true, requestKey: 'undokey0005' });
    expect(redone.status).toBe('applied');
    expect(world.dispatched.some((d) => d.tool === 'vercel_project_pause' &&
      d.args.confirm === true)).toBe(true);
  });

  it('refuses a production undo on a preview connection', async () => {
    const world = makeWorld([{ id: 51, tool: 'vercel_deploy_promote',
      production: true, dry_run: false,
      inverse: { tool: 'vercel_deploy_rollback', project: 'prj_1',
        deployment: 'dpl_old', expectedCurrent: 'dpl_new', outsideApp: true } }]);
    world.ctx.connection = { account: ACCOUNT, profile: 'full', mode: 'preview' };
    const r = await call(world, { description: { change_id: 51 },
      confirm: true, requestKey: KEY });
    expect(r.status).toBe('refused_by_guard');
    expect(r.reason.toLowerCase()).toContain('production');
    expect(world.dispatched.some((d) => d.args.confirm === true)).toBe(false);
  });
});
