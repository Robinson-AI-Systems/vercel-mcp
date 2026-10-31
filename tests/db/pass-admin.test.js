// AUD-AU (dossier §2.5, D8): pass issuance, revocation and
// one-time reveal as tools, end-to-end against real Postgres —
// the handlers over the real db layer and one-time-secret store.
// Acceptance: a read pass and a write pass issue via tools and
// verify by the db's own scope read-back; the bearer reaches the
// owner only through the reveal tool, exactly once; revocation
// refuses at the door immediately; the journal records references,
// never values.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { passAdminTools } from '../../src/tools/pass-admin.js';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery }
  from '../../test/helpers/pg-neon-adapter.js';

const url = process.env.TEST_DATABASE_URL;
const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const H = passAdminTools.handlers;
const parse = result => JSON.parse(result.content[0].text);
const connectorFor = account => ({ kind: 'connector', account, profile: 'full',
  mode: 'production', listing: 'catalog' });
let db;

beforeAll(async () => {
  if (!url || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname))
    throw new Error('Disposable local Postgres required');
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts(id, team_id, team_slug, label, scope, token_enc, token_last4) VALUES " +
    "('team_ALPHA', 'team_ALPHA', 'alpha', 'Alpha', 'team', 'cipher_FAKE_alpha', 'FAKE'), " +
    "('team_BETA', 'team_BETA', 'beta', 'Beta', 'team', 'cipher_FAKE_beta', 'FAKE')");
});
afterAll(async () => closeIsolatedSchema());

describe('AUD-AU pass tools on Postgres', () => {
  it('issues a read pass via tools; the bearer verifies by scope read-back and reveals exactly once', async () => {
    const conn = connectorFor('team_ALPHA');
    const issued = parse(await H.vercel_issue_pass(
      { areas: ['server', 'projects'], hours: 24, rateLimitPerMinute: 120, confirm: true },
      { connection: conn, db, env, registry }));
    expect(issued.status).toBe('issued');
    expect(issued.passId).toMatch(/^pass_[a-f0-9]{20}$/);
    // Previewing the reveal does not consume the secret.
    const preview = parse(await H.vercel_reveal_one_time_secret(
      { reference: issued.secretReference, account: 'team_ALPHA', dryRun: true },
      { connection: conn, db, env, registry }));
    expect(preview).toMatchObject({ status: 'preview', kind: 'rtc_pass', label: 'Read-only RTC pass' });
    const revealed = parse(await H.vercel_reveal_one_time_secret(
      { reference: issued.secretReference, account: 'team_ALPHA', confirm: true },
      { connection: conn, db, env, registry }));
    expect(revealed.status).toBe('revealed');
    const bearer = revealed.value;
    expect(bearer).toMatch(/^rtc_pass_[A-Za-z0-9_-]{43}$/);
    expect(await db.inspectRtcPass(bearer)).toMatchObject({
      status: 'ok', id: issued.passId, account: 'team_ALPHA', profile: 'read_only',
      mode: 'preview', areas: ['projects', 'server'], rateLimitPerMinute: 120 });
    const second = parse(await H.vercel_reveal_one_time_secret(
      { reference: issued.secretReference, account: 'team_ALPHA', confirm: true },
      { connection: conn, db, env, registry }));
    expect(second.status).toBe('refused_by_guard');
    // Journal: issuance by the db method's own row, the reveal by
    // reference — and the bearer appears in NO journal row.
    const log = await rawQuery('SELECT tool, summary FROM change_log ORDER BY id');
    expect(log.some(row => row.tool === 'vercel_owner_issue_read_only_pass')).toBe(true);
    const revealRows = log.filter(row => row.tool === 'vercel_reveal_one_time_secret');
    expect(revealRows).toHaveLength(1);
    expect(revealRows[0].summary).toContain(issued.secretReference);
    expect(JSON.stringify(log)).not.toContain(bearer);
  });

  it('issues a write pass via tools, and revocation refuses it at the door immediately', async () => {
    const conn = connectorFor('team_ALPHA');
    const issued = parse(await H.vercel_issue_pass(
      { writes: true, profile: 'full', mode: 'production', areas: ['server', 'deployments'],
        hours: 12, rateLimitPerMinute: 60, spendLimitCents: 2500,
        projectIds: ['prj_FAKEONE'], confirm: true },
      { connection: conn, db, env, registry }));
    expect(issued.status).toBe('issued');
    const revealed = parse(await H.vercel_reveal_one_time_secret(
      { reference: issued.secretReference, account: 'team_ALPHA', confirm: true },
      { connection: conn, db, env, registry }));
    const bearer = revealed.value;
    expect(await db.inspectRtcPass(bearer)).toMatchObject({
      status: 'ok', account: 'team_ALPHA', profile: 'full', mode: 'production',
      areas: ['deployments', 'server'], rateLimitPerMinute: 60,
      allowWrites: true, spendLimitCents: 2500, projectIds: ['prj_FAKEONE'] });
    expect((await db.authorizeRtcPass(bearer)).status).toBe('ok');
    const revoked = parse(await H.vercel_revoke_pass(
      { passId: issued.passId, confirm: true },
      { connection: conn, db, env, registry }));
    expect(revoked).toMatchObject({ status: 'revoked', confirmed: true });
    expect((await db.inspectRtcPass(bearer)).status).toBe('pass_revoked');
    expect((await db.authorizeRtcPass(bearer)).status).toBe('pass_revoked');
    const again = parse(await H.vercel_revoke_pass(
      { passId: issued.passId, confirm: true },
      { connection: conn, db, env, registry }));
    expect(again.status).toBe('refused_by_guard');
  });

  it('keeps accounts apart: a secret scoped to one account refuses reveal under another, unconsumed', async () => {
    const conn = connectorFor('team_ALPHA');
    const planted = await oneTimeSecrets({ db, env })
      .issue({ account: 'team_ALPHA', kind: 'access_token', label: 'Scoped fixture', value: 'vcp_FAKE_SCOPED_VALUE' });
    const wrong = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_BETA', confirm: true },
      { connection: conn, db, env, registry }));
    expect(wrong.status).toBe('refused_by_guard');
    const right = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_ALPHA', confirm: true },
      { connection: conn, db, env, registry }));
    expect(right).toMatchObject({ status: 'revealed', value: 'vcp_FAKE_SCOPED_VALUE' });
    const second = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_ALPHA', confirm: true },
      { connection: conn, db, env, registry }));
    expect(second.status).toBe('refused_by_guard');
  });

  it('stops a full-profile pass at the reveal kind gate through the real dispatch, leaving the secret unconsumed', async () => {
    const planted = await oneTimeSecrets({ db, env })
      .issue({ account: 'team_ALPHA', kind: 'access_token', label: 'Gate fixture', value: 'vcp_FAKE_GATE_VALUE' });
    const out = await dispatchReadOnlyTool({ registry,
      name: 'vercel_reveal_one_time_secret',
      args: { reference: planted.id, account: 'team_ALPHA', confirm: true },
      connection: { kind: 'pass', account: 'team_ALPHA', profile: 'full', mode: 'production', listing: 'catalog' },
      db, env });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).reason).toContain('delegated pass can never');
    const stillThere = parse(await H.vercel_reveal_one_time_secret(
      { reference: planted.id, account: 'team_ALPHA', dryRun: true },
      { connection: connectorFor('team_ALPHA'), db, env, registry }));
    expect(stillThere.status).toBe('preview');
  });
});
