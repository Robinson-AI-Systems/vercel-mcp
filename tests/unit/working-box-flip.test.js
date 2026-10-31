// AUD-I S4 — the working-box flip tool. In-ceiling flips are
// instant and journaled (AUD-BB, the AUD-AQ handler shape), the
// credential untouched; the flip takes effect on the NEXT call
// (A-10); beyond-ceiling asks answer by naming the rung that owns
// them, never a bare refusal.
import { describe, it, expect } from 'vitest';
import { serverTools } from '../../src/tools/server.js';
import { observabilityTools } from '../../src/tools/observability.js';

function harness({ mode = 'preview', productionEnabled = true } = {}) {
  const calls = [];
  const journal = [];
  const db = {
    listVercelAccounts: async () => [{ id: 'team_FAKE', production_enabled: productionEnabled }],
    setOwnConnectionMode: async (args) => { calls.push(args); return { from: mode, to: args.mode }; },
    recordChange: async (entry) => { journal.push(entry); }
  };
  const connection = { account: 'team_FAKE', mode, connectionId: 'conn_0123456789abcdef01' };
  return { db, connection, calls, journal };
}
const run = (args, ctx, env = { VERCEL_ENV: 'production' }) =>
  serverTools.handlers.vercel_set_working_box(args, { ...ctx, env });
const parse = out => JSON.parse(out.content[0].text);

describe('AUD-I S4: vercel_set_working_box', () => {
  it('narrows to preview instantly, effective next call', async () => {
    const ctx = harness({ mode: 'production' });
    const value = parse(await run({ mode: 'preview', confirm: true }, ctx));
    expect(value).toMatchObject({ flipped: true, from: 'production', to: 'preview', effective: 'next call' });
    expect(value.note).toContain('finishes under production');
    expect(ctx.calls).toEqual([{ account: 'team_FAKE', connectionId: 'conn_0123456789abcdef01', mode: 'preview' }]);
  });

  it('widens to production instantly when the ceiling allows', async () => {
    const ctx = harness({ mode: 'preview', productionEnabled: true });
    const value = parse(await run({ mode: 'production', confirm: true }, ctx));
    expect(value.flipped).toBe(true);
    expect(value.to).toBe('production');
  });

  it('names the owner switch rung when production is switched off', async () => {
    const ctx = harness({ mode: 'preview', productionEnabled: false });
    const value = parse(await run({ mode: 'production', confirm: true }, ctx));
    expect(value.flipped).toBe(false);
    expect(value.refused).toBe('production_switch_off');
    expect(value.rung).toContain('vercel_enable_production');
    expect(ctx.calls).toHaveLength(0);
  });

  it('names the deployment rung on a preview deployment', async () => {
    const ctx = harness({ mode: 'preview', productionEnabled: true });
    const value = parse(await run({ mode: 'production', confirm: true }, ctx, { VERCEL_ENV: 'preview' }));
    expect(value.refused).toBe('preview_deployment');
    expect(ctx.calls).toHaveLength(0);
  });

  it('is a no-op in the mode it already works in', async () => {
    const ctx = harness({ mode: 'preview' });
    const value = parse(await run({ mode: 'preview', confirm: true }, ctx));
    expect(value.flipped).toBe(false);
    expect(ctx.calls).toHaveLength(0);
  });

  it('plans on dryRun without mutating, and refuses without confirm', async () => {
    const ctx = harness({ mode: 'preview', productionEnabled: true });
    const plan = parse(await run({ mode: 'production', dryRun: true }, ctx));
    expect(plan.status).toBe('planned');
    expect(plan.to).toBe('production');
    expect(ctx.calls).toHaveLength(0);
    const refused = await run({ mode: 'production' }, ctx);
    expect(refused.isError).toBe(true);
    expect(parse(refused).status).toBe('refused_by_guard');
    expect(ctx.calls).toHaveLength(0);
  });

  it('rejects malformed asks', async () => {
    const ctx = harness();
    expect((await run({ mode: 'account' }, ctx)).isError).toBe(true);
    expect((await run({}, ctx)).isError).toBe(true);
    expect((await run({ mode: 'preview', bogus: 1 }, ctx)).isError).toBe(true);
  });
});

describe('AUD-BB: the working-box flip journals like the read-only flip', () => {
  it('narrowing to preview lands exactly one journal row with the flip fields', async () => {
    const ctx = harness({ mode: 'production' });
    const value = parse(await run({ mode: 'preview', confirm: true }, ctx));
    expect(value.flipped).toBe(true);
    expect(ctx.journal).toHaveLength(1);
    expect(ctx.journal[0]).toMatchObject({ account: 'team_FAKE', mode: 'production',
      tool: 'vercel_set_working_box', dryRun: false, production: true });
    expect(ctx.journal[0].summary).toContain('production to preview');
  });

  it('widening to production lands exactly one journal row the other way', async () => {
    const ctx = harness({ mode: 'preview', productionEnabled: true });
    const value = parse(await run({ mode: 'production', confirm: true }, ctx));
    expect(value.flipped).toBe(true);
    expect(ctx.journal).toHaveLength(1);
    expect(ctx.journal[0]).toMatchObject({ account: 'team_FAKE', mode: 'preview',
      tool: 'vercel_set_working_box', dryRun: false, production: false });
    expect(ctx.journal[0].summary).toContain('preview to production');
  });

  it('a no-op lands no journal row', async () => {
    const ctx = harness({ mode: 'preview' });
    const value = parse(await run({ mode: 'preview', confirm: true }, ctx));
    expect(value.flipped).toBe(false);
    expect(ctx.journal).toHaveLength(0);
  });

  it('plans and guard refusals land no journal row', async () => {
    const ctx = harness({ mode: 'preview', productionEnabled: true });
    parse(await run({ mode: 'production', dryRun: true }, ctx));
    const refused = await run({ mode: 'production' }, ctx);
    expect(refused.isError).toBe(true);
    expect(ctx.journal).toHaveLength(0);
  });

  it('an unavailable connection claims no flip and journals nothing', async () => {
    const ctx = harness({ mode: 'preview', productionEnabled: true });
    ctx.db.setOwnConnectionMode = async () => null;
    const out = await run({ mode: 'production', confirm: true }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Connection unavailable');
    expect(ctx.journal).toHaveLength(0);
  });

  it('the flip stands even if journaling fails', async () => {
    const ctx = harness({ mode: 'production' });
    ctx.db.recordChange = async () => { throw new Error('journal down'); };
    const value = parse(await run({ mode: 'preview', confirm: true }, ctx));
    expect(value.flipped).toBe(true);
  });

  it('the journal row reads back through vercel_recent_changes', async () => {
    // An in-memory change log behind the REAL db seams the two
    // handlers use: recordChange writes, listRecentChanges reads
    // with the production filter semantics (account, tool, dry-run
    // rows hidden unless previews are requested).
    const rows = [];
    const db = {
      listVercelAccounts: async () => [{ id: 'team_FAKE', production_enabled: true }],
      setOwnConnectionMode: async (args) => ({ from: 'production', to: args.mode }),
      recordChange: async (entry) => { rows.push({
        id: rows.length + 1, at: new Date().toISOString(), vercel_account: entry.account,
        tool: entry.tool, project_id: null, mode: entry.mode, summary: entry.summary,
        dry_run: entry.dryRun, production: entry.production, spend_cents: null }); },
      listRecentChanges: async ({ account, tool = null, includePreviews = false, limit = 20 }) =>
        rows.filter(row => row.vercel_account === account &&
            (tool === null || row.tool === tool) && (includePreviews || row.dry_run === false))
          .sort((a, b) => b.id - a.id).slice(0, limit)
    };
    const connection = { account: 'team_FAKE', mode: 'production',
      connectionId: 'conn_0123456789abcdef01' };
    const value = parse(await run({ mode: 'preview', confirm: true }, { db, connection }));
    expect(value.flipped).toBe(true);
    const read = parse(await observabilityTools.handlers.vercel_recent_changes(
      { tool: 'vercel_set_working_box' }, { connection, db }));
    expect(read.count).toBe(1);
    expect(read.changes[0]).toMatchObject({ tool: 'vercel_set_working_box', mode: 'production',
      dryRun: false, production: true });
    expect(read.changes[0].summary).toContain('production to preview');
  });
});
