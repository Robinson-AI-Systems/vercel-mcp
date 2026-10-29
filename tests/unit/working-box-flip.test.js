// AUD-I S4 — the working-box flip tool. In-ceiling flips are
// instant and journaled (the write path), the credential untouched;
// the flip takes effect on the NEXT call (A-10); beyond-ceiling asks
// answer by naming the rung that owns them, never a bare refusal.
import { describe, it, expect } from 'vitest';
import { serverTools } from '../../src/tools/server.js';

function harness({ mode = 'preview', productionEnabled = true } = {}) {
  const calls = [];
  const db = {
    listVercelAccounts: async () => [{ id: 'team_FAKE', production_enabled: productionEnabled }],
    setOwnConnectionMode: async (args) => { calls.push(args); return { from: mode, to: args.mode }; }
  };
  const connection = { account: 'team_FAKE', mode, connectionId: 'conn_0123456789abcdef01' };
  return { db, connection, calls };
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
