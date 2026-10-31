// AUD-AQ — read-only as an end-user switch (sign-in cleanup dossier
// §3, the dossier's AUD-AO card renumbered). The switch is a property
// of one connection, flipped by its own user through
// vercel_set_read_only, and enforced at three layers — listing,
// dispatch, write preflight — tested here through the REAL registry
// and the REAL MCP boundary (the AUD-Z lesson: a hand-rolled owner
// list hid a live omission in AUD-I S4). RTC passes keep
// profile 'read_only' as a pass scope and are untouched: the door
// mints pass connections without a readOnly field, so every gate
// below is inert for them by construction.
import { describe, it, expect } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { listMcpTools, dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { serverTools } from '../../src/tools/server.js';
import { defineWrite } from '../../src/core/write.js';
import { compact } from '../../src/core/util.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';
import { randomToken } from '../../src/core/oauth.js';

const parse = out => JSON.parse(out.content[0].text);
const names = (connection) => listMcpTools(registry, connection).map(t => t.name);

/* ---------- the flip handler (modeled on working-box-flip) ---------- */

function harness({ readOnly = false } = {}) {
  const calls = [];
  const journal = [];
  const db = {
    setOwnConnectionReadOnly: async (args) => {
      calls.push(args);
      return { from: readOnly, to: args.readOnly };
    },
    recordChange: async (entry) => { journal.push(entry); }
  };
  const connection = { account: 'team_FAKE', mode: 'preview', profile: 'full',
    readOnly, connectionId: 'conn_0123456789abcdef01' };
  return { db, connection, calls, journal };
}
const flip = (args, ctx) => serverTools.handlers.vercel_set_read_only(args, ctx);

describe('AUD-AQ: vercel_set_read_only', () => {
  it('flips the switch on, keyed by the caller\'s own connection id, and journals it', async () => {
    const ctx = harness({ readOnly: false });
    const value = parse(await flip({ readOnly: true, confirm: true }, ctx));
    expect(value).toMatchObject({ flipped: true, from: false, to: true, effective: 'next call' });
    expect(value.note).toContain('your next call runs with it on');
    expect(ctx.calls).toEqual([{ account: 'team_FAKE',
      connectionId: 'conn_0123456789abcdef01', readOnly: true }]);
    expect(ctx.journal).toHaveLength(1);
    expect(ctx.journal[0]).toMatchObject({ account: 'team_FAKE', tool: 'vercel_set_read_only',
      dryRun: false, production: false });
    expect(ctx.journal[0].summary).toContain('off to on');
  });

  it('flips the switch off again, journaled the other way', async () => {
    const ctx = harness({ readOnly: true });
    const value = parse(await flip({ readOnly: false, confirm: true }, ctx));
    expect(value).toMatchObject({ flipped: true, from: true, to: false });
    expect(ctx.journal[0].summary).toContain('on to off');
  });

  it('is a no-op in the state it already is in', async () => {
    const ctx = harness({ readOnly: true });
    const value = parse(await flip({ readOnly: true, confirm: true }, ctx));
    expect(value.flipped).toBe(false);
    expect(value.readOnly).toBe(true);
    expect(ctx.calls).toHaveLength(0);
    expect(ctx.journal).toHaveLength(0);
  });

  it('plans on dryRun without mutating, and refuses without confirm', async () => {
    const ctx = harness({ readOnly: false });
    const plan = parse(await flip({ readOnly: true, dryRun: true }, ctx));
    expect(plan.status).toBe('planned');
    expect(plan.to).toBe(true);
    expect(ctx.calls).toHaveLength(0);
    const refused = await flip({ readOnly: true }, ctx);
    expect(refused.isError).toBe(true);
    expect(parse(refused).status).toBe('refused_by_guard');
    expect(ctx.calls).toHaveLength(0);
  });

  it('rejects malformed asks', async () => {
    const ctx = harness();
    expect((await flip({}, ctx)).isError).toBe(true);
    expect((await flip({ readOnly: 'yes' }, ctx)).isError).toBe(true);
    expect((await flip({ readOnly: true, bogus: 1 }, ctx)).isError).toBe(true);
    expect((await flip({ readOnly: true, confirm: 'yes' }, ctx)).isError).toBe(true);
  });

  it('reports an unavailable connection instead of claiming a flip', async () => {
    const ctx = harness();
    ctx.db.setOwnConnectionReadOnly = async () => null;
    const out = await flip({ readOnly: true, confirm: true }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Connection unavailable');
    expect(ctx.journal).toHaveLength(0);
  });

  it('the flip stands even if journaling fails', async () => {
    const ctx = harness();
    ctx.db.recordChange = async () => { throw new Error('journal down'); };
    const value = parse(await flip({ readOnly: true, confirm: true }, ctx));
    expect(value.flipped).toBe(true);
  });
});

/* ---------- gates 1 + 2 through the real MCP boundary ---------- */

const FULL_ON = { profile: 'full', listing: 'catalog', account: 'team_FAKE',
  mode: 'preview', readOnly: true, connectionId: 'conn_0123456789abcdef01' };

describe('AUD-AQ: listing gate (gate 1)', () => {
  it('a switch-on connection lists reads, whoami and the switch itself — not writes', () => {
    const listed = names(FULL_ON);
    expect(listed).toContain('vercel_whoami');
    expect(listed).toContain('vercel_set_read_only');
    expect(listed).toContain('vercel_project_list');
    expect(listed).not.toContain('vercel_project_create');
    expect(listed).not.toContain('vercel_env_set');
    // The other posture flip is a write too: it closes with the rest.
    expect(listed).not.toContain('vercel_set_working_box');
  });

  it('the switch stays listed under front_door and compact while on (the way back)', () => {
    for (const listing of ['front_door', 'compact']) {
      const listed = names({ ...FULL_ON, listing });
      expect(listed).toContain('vercel_set_read_only');
      expect(listed).toContain('vercel_whoami');
    }
  });

  it('with the switch off, listing is the ordinary full listing', () => {
    const listed = names({ ...FULL_ON, readOnly: false });
    expect(listed).toContain('vercel_set_read_only');
    expect(listed).toContain('vercel_project_create');
    expect(listed).toHaveLength(241);
  });
});

describe('AUD-AQ: dispatch gate (gate 2)', () => {
  it('refuses a write by name for a switch-on connection', async () => {
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_project_create',
      args: {}, connection: FULL_ON, db: {}, env: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Tool unavailable for this connection');
  });

  it('refuses the working-box flip by name too — only the switch stays open', async () => {
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_set_working_box',
      args: { mode: 'preview', confirm: true }, connection: FULL_ON, db: {}, env: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Tool unavailable for this connection');
  });

  it('lets the switch itself through to its handler', async () => {
    const db = { setOwnConnectionReadOnly: async () => { throw new Error('must not be called'); } };
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_set_read_only',
      args: { readOnly: true, confirm: true }, connection: FULL_ON, db, env: {} });
    expect(result.isError).not.toBe(true);
    expect(parse(result)).toMatchObject({ flipped: false, readOnly: true });
  });

  it('reads still dispatch, and whoami reports the switch with its remedy', async () => {
    const row = { id: 'team_FAKE', team_slug: 'test-team', label: 'Test Team',
      scope: 'team', project_name: null, production_enabled: true,
      token_last4: 'DPGA', token_expires_at: null, token_no_expiry: true,
      spend_limit_cents: 0, purchase_budget_cents: null, purchase_grant_required: false,
      token_probe: { source: 'token', declaredBox: 'account', scopeVerified: false } };
    const db = { listVercelAccounts: async () => [row], getTodaySpendCents: async () => 0 };
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_whoami',
      args: {}, connection: FULL_ON, db, env: {} });
    expect(result.isError).not.toBe(true);
    const value = parse(result);
    expect(value.readOnly).toBe(true);
    expect(value.workingBoxChanges.readOnlySwitch).toContain('vercel_set_read_only');
    expect(value.workingBoxChanges.readOnlySwitch).toContain('on');
  });

  it('with the switch off, dispatch is the ordinary full dispatch', async () => {
    const db = { setOwnConnectionMode: async () => { throw new Error('must not be called'); } };
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_set_working_box',
      args: { mode: 'preview', confirm: true },
      connection: { ...FULL_ON, readOnly: false }, db, env: {} });
    expect(result.isError).not.toBe(true);
    expect(parse(result)).toMatchObject({ flipped: false, mode: 'preview' });
  });
});

/* ---------- grandfathered profiles and passes ---------- */

describe('AUD-AQ: grandfathering and pass non-interference', () => {
  it('a grandfathered read_only-profile connection is unchanged and cannot reach the switch', async () => {
    const plain = names({ profile: 'read_only', listing: 'catalog' });
    const flagged = names({ profile: 'read_only', listing: 'catalog', readOnly: true });
    expect(flagged).toEqual(plain);
    expect(plain).not.toContain('vercel_set_read_only');
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_set_read_only',
      args: { readOnly: false, confirm: true },
      connection: { profile: 'read_only', listing: 'catalog', account: 'team_FAKE', mode: 'preview' },
      db: {}, env: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Tool unavailable for this connection');
  });

  it('pass connections carry no switch: a read-only pass lists exactly the pass shape', () => {
    const passNames = names({ kind: 'pass', profile: 'read_only', listing: 'compact' });
    expect(passNames).toEqual(names({ profile: 'read_only', listing: 'compact' }));
    expect(passNames).not.toContain('vercel_set_read_only');
  });

  it('a write-capable pass still lists its writes (the switch gates only its own flag)', () => {
    const listed = names({ kind: 'pass', profile: 'everyday', listing: 'catalog',
      passAllowWrites: true, passSpendLimitCents: 0 });
    expect(listed).toContain('vercel_env_set');
  });
});

/* ---------- gate 3: write preflight ---------- */

function preflightFixture(connection) {
  let beforeCalled = false;
  const tool = defineWrite({
    name: 'fixture_switch_write',
    before: async () => { beforeCalled = true; return { version: 'before' }; },
    preview: async () => 'Change the fixture',
    targets: async () => [{ kind: 'project', id: 'prj_FAKE' }],
    production: async () => ({ production: false, why: 'Preview only' }),
    apply: async () => ({ version: 'after' }),
    verify: async () => ({ confirmed: true })
  });
  const ctx = {
    connection, db: {}, now: () => 600000,
    guardProtected: async () => ({ blocked: false }),
    guardApp: async () => ({ blocked: false }),
    shape: compact, audit: async () => {},
    replayStore: {
      async claim() { return { state: 'claimed', claimId: 'claim_FAKE' }; },
      async complete() {}, async release() { return true; }
    }
  };
  return { tool, ctx, beforeCalled: () => beforeCalled };
}

describe('AUD-AQ: preflight gate (gate 3)', () => {
  it('refuses a switch-on connection with the named reason before before() runs', async () => {
    const { tool, ctx, beforeCalled } = preflightFixture(
      { account: 'account_FAKE', mode: 'preview', profile: 'full', readOnly: true });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).toBe('refused_by_guard');
    expect(result.reason).toContain('read-only switch is on');
    expect(result.reason).toContain('vercel_set_read_only');
    expect(beforeCalled()).toBe(false);
  });

  it('a switch-off connection passes the gate and reaches before()', async () => {
    const { tool, ctx, beforeCalled } = preflightFixture(
      { account: 'account_FAKE', mode: 'preview', profile: 'full', readOnly: false });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).not.toBe('refused_by_guard');
    expect(beforeCalled()).toBe(true);
  });

  it('a write-capable pass (no switch field) is not refused by the switch gate', async () => {
    const { tool, ctx, beforeCalled } = preflightFixture(
      { account: 'account_FAKE', mode: 'preview', profile: 'everyday', kind: 'pass',
        passAllowWrites: true, passSpendLimitCents: 0 });
    const result = await tool.run({ dryRun: true }, ctx);
    expect(result.status).not.toBe('refused_by_guard');
    expect(beforeCalled()).toBe(true);
  });
});

/* ---------- the auth context carries the flag ---------- */

describe('AUD-AQ: requireMcpToken context', () => {
  it('exposes readOnly from the token row, flippable through the fake db', async () => {
    const db = createFakeDb();
    const token = randomToken();
    await db.createAccessToken({ accessToken: token, refreshToken: randomToken(),
      clientId: 'client_fixture', vercelAccount: 'team_FAKE',
      mode: 'preview', profile: 'full', listing: 'front_door' });
    const env = { PUBLIC_BASE_URL: 'https://vercel-mcp.example.test', VERCEL_ENV: 'preview' };
    const attempt = async () => {
      const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        send(value) { this.body = value; return this; } };
      return requireMcpToken({ headers: { authorization: 'Bearer ' + token } }, res, db, env);
    };
    const before = await attempt();
    expect(before.readOnly).toBe(false);
    const flipResult = await db.setOwnConnectionReadOnly({
      account: 'team_FAKE', connectionId: before.connectionId, readOnly: true });
    expect(flipResult).toEqual({ from: false, to: true });
    const after = await attempt();
    expect(after.readOnly).toBe(true);
    expect(after.connectionId).toBe(before.connectionId);
  });
});
