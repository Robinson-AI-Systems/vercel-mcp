// AUD-AU: vercel_issue_pass / vercel_revoke_pass /
// vercel_reveal_one_time_secret (dossier §2.5, D8). Unit level: the
// kind gate at the real dispatch boundary, the setup forms'
// validations carried verbatim, issuance read-back verification,
// revoke preview/apply, reveal single-consumption and journaling,
// and the result-delivery carve-out that returns a revealed value
// once — for this tool only. End-to-end against real Postgres
// lives in tests/db/pass-admin.test.js.
import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { passAdminTools } from '../../src/tools/pass-admin.js';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
import { shapeStoredMcpResult } from '../../src/vercel/result-delivery.js';

const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const connector = { kind: 'connector', account: 'team_FAKE', profile: 'full', mode: 'production', listing: 'catalog' };
const H = passAdminTools.handlers;
const parse = result => JSON.parse(result.content[0].text);

function fixture() {
  const secrets = new Map(), passes = new Map(), changes = [];
  const db = {
    listVercelAccounts: vi.fn(async () => [{ id: 'team_FAKE' }, { id: 'team_OTHER' }]),
    issueReadOnlyRtcPass: vi.fn(async scope => {
      const token = 'rtc_pass_' + randomBytes(32).toString('base64url');
      const id = 'pass_' + randomBytes(10).toString('hex');
      passes.set(token, { id, revoked: false, scope: { status: 'ok', id,
        account: scope.account, profile: 'read_only', mode: scope.mode,
        areas: scope.areas, rateLimitPerMinute: scope.rateLimitPerMinute } });
      return { token, id, expiresAt: new Date(Date.now() + scope.hours * 3600000).toISOString() };
    }),
    issueWriteRtcPass: vi.fn(async scope => {
      const token = 'rtc_pass_' + randomBytes(32).toString('base64url');
      const id = 'pass_' + randomBytes(10).toString('hex');
      passes.set(token, { id, revoked: false, scope: { status: 'ok', id,
        account: scope.account, profile: scope.profile, mode: scope.mode,
        areas: scope.areas, rateLimitPerMinute: scope.rateLimitPerMinute,
        allowWrites: true, spendLimitCents: scope.spendLimitCents,
        projectIds: scope.projectIds } });
      return { token, id, expiresAt: new Date(Date.now() + scope.hours * 3600000).toISOString() };
    }),
    inspectRtcPass: vi.fn(async token => {
      const row = passes.get(token);
      if (!row) return { status: 'permission' };
      if (row.revoked) return { status: 'pass_revoked' };
      return { ...row.scope };
    }),
    revokeRtcPass: vi.fn(async ({ account, id }) => {
      for (const row of passes.values()) {
        if (row.id === id && row.scope.account === account && !row.revoked) {
          row.revoked = true; return true;
        }
      }
      return false;
    }),
    listRtcPasses: vi.fn(async account => [...passes.values()]
      .filter(row => row.scope.account === account)
      .map(row => ({ pass_id: row.id, mode: row.scope.mode, areas: row.scope.areas,
        rate_limit_per_minute: row.scope.rateLimitPerMinute,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        revoked_at: row.revoked ? new Date().toISOString() : null,
        created_at: new Date().toISOString() }))),
    async insertOneTimeSecret(row) {
      secrets.set(row.id, { ...row, vercel_account: row.account,
        expires_at: row.expiresAt, viewed_at: null });
    },
    consumeOneTimeSecret: vi.fn(async ({ id, account }) => {
      const row = secrets.get(id);
      if (!row || row.vercel_account !== account || row.viewed_at ||
        new Date(row.expires_at).getTime() <= Date.now()) return null;
      secrets.delete(id); return row;
    }),
    async getOneTimeSecret({ id, account }) {
      const row = secrets.get(id);
      if (!row || row.vercel_account !== account || row.viewed_at ||
        new Date(row.expires_at).getTime() <= Date.now()) return null;
      return { id: row.id, vercel_account: row.vercel_account, kind: row.kind,
        label: row.label, expires_at: row.expires_at };
    },
    async recordChange(entry) { changes.push(entry); return changes.length; }
  };
  return { db, secrets, passes, changes };
}

const readArgs = { areas: ['server', 'projects'], hours: 24, rateLimitPerMinute: 120 };
const writeArgs = { writes: true, profile: 'everyday', mode: 'preview',
  areas: ['server', 'deployments'], hours: 24, rateLimitPerMinute: 120,
  spendLimitCents: 2550, projectIds: ['prj_FAKEONE'] };

describe('AUD-AU pass administration tools', () => {
  it('refuses a pass-kind connection at the handler for all three tools, through the real dispatch boundary', async () => {
    const f = fixture();
    const planted = await oneTimeSecrets({ db: f.db, env })
      .issue({ account: 'team_FAKE', kind: 'access_token', label: 'Fixture', value: 'vcp_FAKEVALUE1234567890' });
    const fullPass = { kind: 'pass', account: 'team_FAKE', profile: 'full', mode: 'production', listing: 'catalog' };
    for (const [name, args] of [
      ['vercel_issue_pass', { ...readArgs, confirm: true }],
      ['vercel_revoke_pass', { passId: 'pass_' + 'a'.repeat(20), confirm: true }],
      ['vercel_reveal_one_time_secret', { reference: planted.id, account: 'team_FAKE', confirm: true }]
    ]) {
      const out = await dispatchReadOnlyTool({ registry, name, args,
        connection: fullPass, db: f.db, env });
      expect(out.isError).toBe(true);
      const payload = JSON.parse(out.content[0].text);
      expect(payload.status).toBe('refused_by_guard');
      expect(payload.reason).toContain('delegated pass can never');
      const narrow = await dispatchReadOnlyTool({ registry, name, args,
        connection: { kind: 'pass', account: 'team_FAKE', profile: 'everyday', mode: 'preview', listing: 'catalog' },
        db: f.db, env });
      expect(narrow.isError).toBe(true);
      expect(narrow.content[0].text).toContain('Tool unavailable');
    }
    // Nothing was issued, revoked or consumed by the attempts.
    expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();
    expect(f.db.issueWriteRtcPass).not.toHaveBeenCalled();
    expect(f.db.consumeOneTimeSecret).not.toHaveBeenCalled();
    expect(f.secrets.has(planted.id)).toBe(true);
  });

  it('rejects malformed arguments — above all a passphrase-shaped one (gate 2.6)', async () => {
    const f = fixture();
    for (const args of [
      { ...readArgs, confirm: true, passphrase: 'fixture' },
      { ...readArgs, confirm: 'yes' },
      { ...readArgs, hours: '24', confirm: true },
      { ...readArgs, areas: 'server', confirm: true },
      null, 'x', []
    ]) expect(parse(await H.vercel_issue_pass(args,
      { connection: connector, db: f.db, env, registry })).status).toBe('refused_by_guard');
    for (const args of [
      { passId: 'pass_' + 'a'.repeat(20), confirm: true, passphrase: 'fixture' },
      { confirm: true }, { passId: 42, confirm: true }
    ]) expect(parse(await H.vercel_revoke_pass(args,
      { connection: connector, db: f.db, env, registry })).status).toBe('refused_by_guard');
    for (const args of [
      { reference: 'not-a-reference', confirm: true },
      { reference: '12345678-1234-1234-1234-123456789012', confirm: true, passphrase: 'fixture' },
      { confirm: true }
    ]) expect(parse(await H.vercel_reveal_one_time_secret(args,
      { connection: connector, db: f.db, env, registry })).status).toBe('refused_by_guard');
    expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();
  });

  it('carries the read form validations verbatim: lifetime, rate, areas, TEST rule, mode', async () => {
    const f = fixture();
    for (const args of [
      { ...readArgs, hours: 721, confirm: true },
      { ...readArgs, hours: 0, confirm: true },
      { ...readArgs, rateLimitPerMinute: 601, confirm: true },
      { ...readArgs, rateLimitPerMinute: 0, confirm: true },
      { ...readArgs, areas: ['unknown_area'], confirm: true },
      { ...readArgs, areas: ['server', 'server'], confirm: true },
      { areas: Array.from({ length: 13 }, (_, i) => 'area' + i), confirm: true },
      { ...readArgs, mode: 'production', confirm: true },
      { mode: 'test', areas: ['projects'], confirm: true },
      { mode: 'test', areas: ['server', 'projects'], confirm: true },
      { ...readArgs, profile: 'full', confirm: true },
      { ...readArgs, spendLimitCents: 100, confirm: true },
      { ...readArgs, projectIds: ['prj_FAKEONE'], confirm: true }
    ]) {
      const out = parse(await H.vercel_issue_pass(args,
        { connection: connector, db: f.db, env, registry }));
      expect(out.status).toBe('refused_by_guard');
    }
    expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();
    // TEST with exactly the server area is the one legal TEST shape.
    const test = parse(await H.vercel_issue_pass(
      { mode: 'test', areas: ['server'], confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(test.status).toBe('issued');
    expect(test.mode).toBe('test');
  });

  it('carries the write form validations verbatim: profile, mode, ceiling, project restriction', async () => {
    const f = fixture();
    for (const args of [
      { ...writeArgs, profile: 'read_only', confirm: true },
      { ...writeArgs, mode: 'test', confirm: true },
      { ...writeArgs, spendLimitCents: -1, confirm: true },
      { ...writeArgs, spendLimitCents: 2147483648, confirm: true },
      { ...writeArgs, projectIds: ['bad id!'], confirm: true },
      { ...writeArgs, projectIds: ['prj_FAKEONE', 'prj_FAKEONE'], confirm: true },
      { ...writeArgs, projectIds: Array.from({ length: 51 }, (_, i) => 'prj_X' + i), confirm: true },
      { writes: true, profile: 'everyday', mode: 'preview', confirm: true },
      { ...writeArgs, hours: 721, confirm: true }
    ]) {
      const out = parse(await H.vercel_issue_pass(args,
        { connection: connector, db: f.db, env, registry }));
      expect(out.status).toBe('refused_by_guard');
    }
    expect(f.db.issueWriteRtcPass).not.toHaveBeenCalled();
  });

  it('issues a read pass end-to-end: preview does not issue; confirm delivers only a one-time reference', async () => {
    const f = fixture();
    const dry = parse(await H.vercel_issue_pass({ ...readArgs, dryRun: true },
      { connection: connector, db: f.db, env, registry }));
    expect(dry.status).toBe('preview');
    expect(dry.summary).toContain('read-only preview pass');
    const bare = parse(await H.vercel_issue_pass(readArgs,
      { connection: connector, db: f.db, env, registry }));
    expect(bare.status).toBe('needs_confirmation');
    expect(f.db.issueReadOnlyRtcPass).not.toHaveBeenCalled();
    const out = await H.vercel_issue_pass({ ...readArgs, confirm: true },
      { connection: connector, db: f.db, env, registry });
    const issued = parse(out);
    expect(issued.status).toBe('issued');
    expect(issued.profile).toBe('read_only');
    expect(issued.areas).toEqual(['projects', 'server']);
    expect(issued.secretReference).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.db.issueReadOnlyRtcPass).toHaveBeenCalledExactlyOnceWith({
      account: 'team_FAKE', hours: 24, areas: ['projects', 'server'],
      mode: 'preview', rateLimitPerMinute: 120 });
    // The bearer exists only inside the one-time secret.
    const row = f.secrets.get(issued.secretReference);
    expect(row.kind).toBe('rtc_pass');
    expect(row.label).toBe('Read-only RTC pass');
    expect(out.content[0].text).not.toContain('rtc_pass_');
    const revealed = await oneTimeSecrets({ db: f.db, env })
      .reveal({ id: issued.secretReference, account: 'team_FAKE' });
    expect(revealed.value).toMatch(/^rtc_pass_[A-Za-z0-9_-]{43}$/);
    expect((await f.db.inspectRtcPass(revealed.value)).status).toBe('ok');
  });

  it('issues a write pass with its ceiling and project restriction, verified by read-back', async () => {
    const f = fixture();
    const issued = parse(await H.vercel_issue_pass({ ...writeArgs, confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(issued.status).toBe('issued');
    expect(issued).toMatchObject({ profile: 'everyday', mode: 'preview',
      spendLimitCents: 2550, projectIds: ['prj_FAKEONE'] });
    expect(f.db.issueWriteRtcPass).toHaveBeenCalledExactlyOnceWith({
      account: 'team_FAKE', profile: 'everyday', hours: 24,
      areas: ['deployments', 'server'], mode: 'preview', spendLimitCents: 2550,
      projectIds: ['prj_FAKEONE'], rateLimitPerMinute: 120 });
    const row = f.secrets.get(issued.secretReference);
    expect(row.label).toBe('Write-capable RTC pass');
  });

  it('revokes the pass when the scope read-back does not verify', async () => {
    const f = fixture();
    f.db.inspectRtcPass.mockImplementation(async () => ({ status: 'permission' }));
    const out = parse(await H.vercel_issue_pass({ ...readArgs, confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toContain('the pass was revoked');
    expect(f.db.revokeRtcPass).toHaveBeenCalledOnce();
    expect(f.secrets.size).toBe(0);
  });

  it('revokes by exact reference: preview describes, confirm revokes, a second revoke refuses', async () => {
    const f = fixture();
    const issued = parse(await H.vercel_issue_pass({ ...readArgs, confirm: true },
      { connection: connector, db: f.db, env, registry }));
    const dry = parse(await H.vercel_revoke_pass({ passId: issued.passId, dryRun: true },
      { connection: connector, db: f.db, env, registry }));
    expect(dry.status).toBe('preview');
    expect(dry.pass.passId).toBe(issued.passId);
    expect(dry.summary).toContain('refuses at the door');
    const done = parse(await H.vercel_revoke_pass({ passId: issued.passId, confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(done).toMatchObject({ status: 'revoked', confirmed: true });
    expect(done.note).toBe('The selected RTC pass was revoked.');
    const again = parse(await H.vercel_revoke_pass({ passId: issued.passId, confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(again.status).toBe('refused_by_guard');
    expect(again.reason).toBe('Pass missing, already revoked or belongs to another account');
    const unknown = parse(await H.vercel_revoke_pass(
      { passId: 'pass_' + 'b'.repeat(20), confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(unknown.reason).toBe('Pass missing, already revoked or belongs to another account');
    const malformed = parse(await H.vercel_revoke_pass(
      { passId: 'pass_SHORT', confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(malformed.reason).toBe('Pass missing, already revoked or belongs to another account');
  });

  it('reveals exactly once: preview never consumes, the journal carries the reference and never the value', async () => {
    const f = fixture();
    const value = 'vcp_FAKEVALUE1234567890';
    const planted = await oneTimeSecrets({ db: f.db, env })
      .issue({ account: 'team_FAKE', kind: 'access_token', label: 'Fixture token', value });
    const dry = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_FAKE', dryRun: true },
      { connection: connector, db: f.db, env, registry }));
    expect(dry).toMatchObject({ status: 'preview', kind: 'access_token', label: 'Fixture token' });
    expect(f.db.consumeOneTimeSecret).not.toHaveBeenCalled();
    const wrongAccount = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_OTHER', confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(wrongAccount.status).toBe('refused_by_guard');
    expect(wrongAccount.reason).toBe('Expired, already viewed, or incorrect account');
    const revealed = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_FAKE', confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(revealed).toMatchObject({ status: 'revealed', confirmed: true, value });
    expect(revealed.note).toBe('Copy this value now. It cannot be viewed again.');
    const second = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_FAKE', confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(second.status).toBe('refused_by_guard');
    expect(f.changes).toHaveLength(1);
    expect(f.changes[0].tool).toBe('vercel_reveal_one_time_secret');
    expect(f.changes[0].summary).toContain(planted.id);
    expect(JSON.stringify(f.changes)).not.toContain(value);
  });

  it('reveals a server / global secret only without an account (the form default)', async () => {
    const f = fixture();
    const planted = await oneTimeSecrets({ db: f.db, env })
      .issue({ account: null, kind: 'bypass_secret', label: 'Global fixture', value: 'fake-bypass-value-1234' });
    const scoped = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_FAKE', confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(scoped.status).toBe('refused_by_guard');
    const revealed = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(revealed).toMatchObject({ status: 'revealed', account: null, value: 'fake-bypass-value-1234' });
    const unknownAccount = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_NOPE', confirm: true },
      { connection: connector, db: f.db, env, registry }));
    expect(unknownAccount.reason).toBe('Choose a connected account');
  });

  it('refuses all three tools on a preview deployment', async () => {
    const f = fixture();
    const previewEnv = { ...env, VERCEL_ENV: 'preview' };
    for (const [handler, args] of [
      [H.vercel_issue_pass, { ...readArgs, confirm: true }],
      [H.vercel_revoke_pass, { passId: 'pass_' + 'a'.repeat(20), confirm: true }],
      [H.vercel_reveal_one_time_secret, { reference: '12345678-1234-1234-1234-123456789012', confirm: true }]
    ]) {
      const out = parse(await handler(args, { connection: connector, db: f.db, env: previewEnv, registry }));
      expect(out.status).toBe('refused_by_guard');
      expect(out.reason).toContain('production server');
    }
  });
});

describe('AUD-AU reveal delivery (D8 carve-out)', () => {
  const bearer = 'rtc_pass_' + randomBytes(32).toString('base64url');
  const revealResponse = { isError: false, content: [{ type: 'text',
    text: JSON.stringify({ status: 'revealed', confirmed: true, kind: 'rtc_pass',
      label: 'Read-only RTC pass', account: 'team_FAKE', value: bearer,
      note: 'Copy this value now. It cannot be viewed again.' }) }] };

  it('returns the revealed value in the reveal result — preview and production presentations', async () => {
    const preview = await shapeStoredMcpResult(revealResponse,
      { connection: { mode: 'preview' }, tool: 'vercel_reveal_one_time_secret' });
    expect(JSON.parse(preview.content[0].text).value).toBe(bearer);
    const production = await shapeStoredMcpResult(revealResponse,
      { connection: { mode: 'production' }, tool: 'vercel_reveal_one_time_secret' });
    const outer = JSON.parse(production.content[0].text);
    expect(outer.mode).toBe('PRODUCTION');
    expect(outer.result.value).toBe(bearer);
  });

  it('redacts the same value under any other tool name, and any non-revealed payload under the reveal name', async () => {
    const other = await shapeStoredMcpResult(revealResponse,
      { connection: { mode: 'preview' }, tool: 'vercel_recent_changes' });
    expect(other.content[0].text).not.toContain(bearer);
    const issuedShape = { isError: false, content: [{ type: 'text',
      text: JSON.stringify({ status: 'issued', confirmed: true, note: 'bearer ' + bearer }) }] };
    const shaped = await shapeStoredMcpResult(issuedShape,
      { connection: { mode: 'preview' }, tool: 'vercel_reveal_one_time_secret' });
    expect(shaped.content[0].text).not.toContain(bearer);
    const refusal = { isError: true, content: [{ type: 'text',
      text: JSON.stringify({ status: 'refused_by_guard', confirmed: false,
        reason: 'Expired, already viewed, or incorrect account' }) }] };
    const shapedRefusal = await shapeStoredMcpResult(refusal,
      { connection: { mode: 'preview' }, tool: 'vercel_reveal_one_time_secret' });
    expect(JSON.parse(shapedRefusal.content[0].text).status).toBe('refused_by_guard');
  });
});
