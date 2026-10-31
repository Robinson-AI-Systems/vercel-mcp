// AUD-AS: vercel_apply_owner_approval against real Postgres — each of
// the four envelope families goes proposal (tool) → inspect (tool,
// non-consuming) → apply (tool) → journaled application, and a
// replayed reference refuses. The purchase family's proposal is the
// intent ledger row the write path itself creates
// (db.requestPurchaseIntent is the exact call src/core/write.js
// makes); its apply is fully via the tool.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { registry } from '../../src/tools/index.js';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery }
  from '../../test/helpers/pg-neon-adapter.js';

let db;
const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const apply = registry.handlers.vercel_apply_owner_approval;
const parse = result => JSON.parse(result.content[0].text);
const connectorFor = (account, mode = 'production') =>
  ({ kind: 'connector', account, profile: 'full', mode, listing: 'catalog' });
const call = (account, args, mode) =>
  apply(args, { connection: connectorFor(account, mode), db, env, registry });

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname))
    throw new Error('Disposable localhost PostgreSQL required');
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts (id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES " +
    "('team_ALPHA','team_ALPHA','alpha','Alpha','team','cipher_FAKE_a','1234')," +
    "('team_BETA','team_BETA','beta','Beta','team','cipher_FAKE_b','5678')");
  // team_GAMMA starts with production explicitly OFF: since AUD-BD a
  // fresh account row is born with the switch ON, so the disabled
  // precondition the production-enable leg exercises is stated in the
  // fixture, not inherited from the old schema default.
  await rawQuery("INSERT INTO vercel_accounts (id,team_id,team_slug,label,scope,token_enc,token_last4,production_enabled,production_enable_strictness) VALUES " +
    "('team_GAMMA','team_GAMMA','gamma','Gamma','team','cipher_FAKE_g','9012',false,'passphrase')");
});
afterAll(async () => closeIsolatedSchema());

describe('AUD-AS envelope apply on the owner connection (real Postgres)', () => {
  it('owner account change: propose via tool, inspect, apply, journal — replay refuses', async () => {
    const proposed = parse(await registry.handlers.vercel_set_spend_limit(
      { limitCents: 2500, confirm: true },
      { connection: connectorFor('team_ALPHA'), db, env }));
    expect(proposed.status).toBe('awaiting_owner_approval');
    const reference = proposed.reference;

    // Another account's connection cannot even inspect it, and the
    // attempt does not consume it.
    expect(parse(await call('team_BETA', { reference, confirm: true })).status).toBe('refused_by_guard');

    const dry = parse(await call('team_ALPHA', { reference, dryRun: true }));
    expect(dry).toMatchObject({ status: 'preview', family: 'owner_account_change',
      summary: 'Set team_ALPHA daily spend limit to $25.00' });
    const applied = parse(await call('team_ALPHA', { reference, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true,
      family: 'owner_account_change', action: 'spend' });
    expect((await rawQuery("SELECT spend_limit_cents FROM vercel_accounts WHERE id='team_ALPHA'"))[0]
      .spend_limit_cents).toBe(2500);
    // Two journal rows carry the tool name: the proposal's write-path
    // audit and the db method's own application audit. The family's
    // journaling is the application row, exactly one.
    const logs = await rawQuery("SELECT tool FROM change_log WHERE tool='vercel_set_spend_limit' AND vercel_account='team_ALPHA' AND summary='Owner changed the daily spend limit'");
    expect(logs).toHaveLength(1);
    expect(parse(await call('team_ALPHA', { reference, confirm: true })).status).toBe('refused_by_guard');
  });

  it('purchase intent: fixed price approved at its quoted total; metered Sandbox only as an unbounded acknowledgment', async () => {
    const fixed = await db.requestPurchaseIntent({ account: 'team_ALPHA',
      operation: 'vercel_project_create', requestKey: 'rmcp_apply_' + 'a'.repeat(64),
      fingerprint: 'b'.repeat(64), priceCents: 2000, pricingSource: 'provider_quote' });
    expect(fixed.status).toBe('pending');
    const dry = parse(await call('team_ALPHA', { reference: fixed.reference, dryRun: true }));
    expect(dry).toMatchObject({ status: 'preview', family: 'purchase_intent' });
    expect(dry.summary).toContain('Quoted total: $20.00');
    const applied = parse(await call('team_ALPHA', { reference: fixed.reference, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true,
      family: 'purchase_intent', ceilingCents: 2000, acknowledgeUnbounded: false });
    const stored = await db.getPurchaseIntent({ account: 'team_ALPHA', reference: fixed.reference });
    expect(stored).toMatchObject({ status: 'approved', allow_unbounded_metered: false });
    expect(Number(stored.ceiling_cents)).toBe(2000);
    const logs = await rawQuery("SELECT tool FROM change_log WHERE tool='vercel_owner_approve_purchase' AND vercel_account='team_ALPHA'");
    expect(logs).toHaveLength(1);
    expect(parse(await call('team_ALPHA', { reference: fixed.reference, confirm: true })).status)
      .toBe('refused_by_guard');

    const metered = await db.requestPurchaseIntent({ account: 'team_ALPHA',
      operation: 'vercel_dev_sandbox_create', requestKey: 'rmcp_apply_' + 'c'.repeat(64),
      fingerprint: 'd'.repeat(64), priceCents: null, pricingSource: 'metered' });
    const dryMetered = parse(await call('team_ALPHA', { reference: metered.reference, dryRun: true }));
    expect(dryMetered.summary).toContain('explicitly accepts non-guaranteed variable charges');
    const appliedMetered = parse(await call('team_ALPHA', { reference: metered.reference, confirm: true }));
    expect(appliedMetered).toMatchObject({ status: 'applied', confirmed: true, acknowledgeUnbounded: true });
    expect((await db.getPurchaseIntent({ account: 'team_ALPHA', reference: metered.reference }))
      .allow_unbounded_metered).toBe(true);
  });

  it('pass requests: read and write passes issue via the tool, bearer only as a one-time secret', async () => {
    const proposed = parse(await registry.handlers.vercel_create_pass(
      { mode: 'preview', hours: 2, areas: ['server'], confirm: true },
      { connection: connectorFor('team_ALPHA'), db, env, registry }));
    expect(proposed.status).toBe('awaiting_owner_approval');
    const dry = parse(await call('team_ALPHA', { reference: proposed.reference, dryRun: true }));
    expect(dry).toMatchObject({ status: 'preview', family: 'rtc_pass_request' });
    expect(dry.summary).toContain('Read-only preview pass; 2 hours');
    const applied = parse(await call('team_ALPHA', { reference: proposed.reference, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true, family: 'rtc_pass_request' });
    expect(applied.secretReference).toMatch(/^[0-9a-f-]{36}$/);
    const revealed = await oneTimeSecrets({ db, env }).reveal({ id: applied.secretReference, account: 'team_ALPHA' });
    expect(revealed.kind).toBe('rtc_pass');
    // The bearer itself never appears in the tool result.
    expect(JSON.stringify(applied)).not.toContain(revealed.value);
    const verified = await db.inspectRtcPass(revealed.value);
    expect(verified).toMatchObject({ status: 'ok', id: applied.passId, account: 'team_ALPHA',
      profile: 'read_only', mode: 'preview', areas: ['server'] });
    const logs = await rawQuery("SELECT tool FROM change_log WHERE tool='vercel_owner_issue_read_only_pass' AND vercel_account='team_ALPHA'");
    expect(logs).toHaveLength(1);
    expect(parse(await call('team_ALPHA', { reference: proposed.reference, confirm: true })).status)
      .toBe('refused_by_guard');

    const proposedWrite = parse(await registry.handlers.vercel_create_pass(
      { writes: true, profile: 'everyday', mode: 'preview', hours: 3, areas: ['server'],
        spendLimitCents: 500, confirm: true },
      { connection: connectorFor('team_ALPHA'), db, env, registry }));
    expect(proposedWrite.status).toBe('awaiting_owner_approval');
    const appliedWrite = parse(await call('team_ALPHA', { reference: proposedWrite.reference, confirm: true }));
    expect(appliedWrite).toMatchObject({ status: 'applied', confirmed: true, family: 'rtc_pass_request' });
    const revealedWrite = await oneTimeSecrets({ db, env })
      .reveal({ id: appliedWrite.secretReference, account: 'team_ALPHA' });
    const verifiedWrite = await db.inspectRtcPass(revealedWrite.value);
    expect(verifiedWrite).toMatchObject({ status: 'ok', profile: 'everyday',
      allowWrites: true, spendLimitCents: 500 });
  });

  it('production enable: a passphrase-strictness receipt applies via the tool and enables the team', async () => {
    const proposed = parse(await registry.handlers.vercel_enable_production(
      { confirm: true },
      { connection: connectorFor('team_GAMMA', 'preview'), db, env }));
    expect(proposed.status).toBe('awaiting_owner_passphrase');
    const dry = parse(await call('team_GAMMA', { reference: proposed.reference, dryRun: true }));
    expect(dry).toMatchObject({ status: 'preview', family: 'production_enable' });
    expect(dry.summary).toContain('Enable production access for team_GAMMA');
    expect((await rawQuery("SELECT production_enabled FROM vercel_accounts WHERE id='team_GAMMA'"))[0]
      .production_enabled).toBe(false);
    const applied = parse(await call('team_GAMMA', { reference: proposed.reference, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true,
      family: 'production_enable', productionEnabled: true });
    expect((await rawQuery("SELECT production_enabled FROM vercel_accounts WHERE id='team_GAMMA'"))[0]
      .production_enabled).toBe(true);
    const logs = await rawQuery("SELECT summary FROM change_log WHERE tool='vercel_enable_production' AND vercel_account='team_GAMMA' AND production=TRUE");
    expect(logs.some(row => row.summary.includes('passphrase verified'))).toBe(true);
    expect(parse(await call('team_GAMMA', { reference: proposed.reference, confirm: true })).status)
      .toBe('refused_by_guard');
  });
});
