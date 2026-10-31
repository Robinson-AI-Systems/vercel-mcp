import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
let db;
const ACCOUNT = 'team_FAKE';
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname)) {
    throw new Error('Only disposable localhost Postgres is permitted');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts (id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES ('team_FAKE','team_FAKE','fake','Fake','team','FAKE','FAKE')");
});
afterAll(async () => closeIsolatedSchema());

const count = async (sql, params = []) => (await rawQuery(sql, params))[0].n;

describe('AUD-AO retention sweep — fleet clocks 400 / 180', () => {
  it('purges change_log rows past 400 days, keeps younger rows, and bounds undo by the same clock', async () => {
    const keptId = Number(await db.recordChange({ account: ACCOUNT, mode: 'preview', tool: 'vercel_fixture_recent',
      summary: 'Recent fixture change', dryRun: false, production: false,
      requestKey: 'retentionRecentFAKE', inverse: { tool: 'vercel_fixture_restore' } }));
    const aged = await rawQuery(`INSERT INTO change_log (vercel_account, mode, tool, summary, dry_run, production, at)
      VALUES ('team_FAKE','preview','vercel_fixture_aged','Aged fixture change',FALSE,FALSE, now() - interval '401 days') RETURNING id`);
    await rawQuery(`INSERT INTO change_log (vercel_account, mode, tool, summary, dry_run, production, at)
      VALUES ('team_FAKE','preview','vercel_fixture_edge','Edge fixture change',FALSE,FALSE, now() - interval '399 days')`);
    const result = await db.sweepRetention();
    expect(result.changeLog).toBe(1);
    expect(await count("SELECT count(*)::integer AS n FROM change_log WHERE tool = 'vercel_fixture_aged'")).toBe(0);
    expect(await count("SELECT count(*)::integer AS n FROM change_log WHERE tool IN ('vercel_fixture_edge','vercel_fixture_recent')")).toBe(2);
    // The stated AUD-AO consequence: undo resolves retained rows and
    // returns null for rows the 400-day clock has purged.
    expect(Number((await db.getChangeForUndo({ account: ACCOUNT, id: keptId }))?.id)).toBe(keptId);
    expect(await db.getChangeForUndo({ account: ACCOUNT, id: Number(aged[0].id) })).toBeNull();
  });

  it('purges unused purchase intents at 180 days but exercised ones only at the 400-day ledger clock', async () => {
    const insert = (id, status, createdDays, expiresDays, approved, consumed) => rawQuery(
      `INSERT INTO purchase_intents (id, vercel_account, operation, request_key, fingerprint, price_cents, pricing_source, status, created_at, expires_at, approved_at, consumed_at)
       VALUES ($1,'team_FAKE','vercel_project_create',$2,$3,2000,'provider_quote',$4, now() - ($5 || ' days')::interval, now() - ($6 || ' days')::interval, $7, $8)`,
      [id, 'rmcp_scoped_' + id.replace(/-/g, ''), 'f'.repeat(64), status, String(createdDays), String(expiresDays),
       approved ? new Date(Date.now() - 1000) : null, consumed ? new Date(Date.now() - 500) : null]);
    // Pending and never approved, lapsed 200 days ago: unused -> 180-day purge.
    await insert('11111111-1111-4111-8111-111111111111', 'pending', 200, 200, false, false);
    // Pending but lapsed only 10 days ago: kept.
    await insert('22222222-2222-4222-8222-222222222222', 'pending', 10, 10, false, false);
    // Approved (exercised by the owner) 200 days ago: NOT unused -> kept.
    await insert('33333333-3333-4333-8333-333333333333', 'approved', 200, 200, true, false);
    // Consumed 401 days ago: exercised, but past the ledger clock -> purged.
    await insert('44444444-4444-4444-8444-444444444444', 'consumed', 401, 401, true, true);
    const result = await db.sweepRetention();
    expect(result.purchaseIntentsUnused).toBe(1);
    expect(result.purchaseIntents).toBe(1);
    const remaining = await rawQuery('SELECT id FROM purchase_intents ORDER BY id');
    expect(remaining.map((r) => r.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333'
    ]);
  });

  it('purges lapsed codes, one-time secrets and pending inputs at 180 days; exercised ones are already gone by construction', async () => {
    await rawQuery(`INSERT INTO oauth_codes (code, client_id, data, vercel_account, expires_at)
      VALUES ('code_FAKE_aged','client_FAKE','{}'::jsonb,'team_FAKE', now() - interval '181 days')`);
    await rawQuery(`INSERT INTO oauth_codes (code, client_id, data, vercel_account, expires_at)
      VALUES ('code_FAKE_recent','client_FAKE','{}'::jsonb,'team_FAKE', now() - interval '10 days')`);
    await rawQuery(`INSERT INTO one_time_secrets (id, vercel_account, kind, ciphertext, expires_at)
      VALUES ('55555555-5555-4555-8555-555555555555','team_FAKE','owner_account_change','FAKE', now() - interval '181 days')`);
    await rawQuery(`INSERT INTO one_time_secrets (id, vercel_account, kind, ciphertext, expires_at)
      VALUES ('66666666-6666-4666-8666-666666666666','team_FAKE','owner_account_change','FAKE', now() - interval '10 days')`);
    await rawQuery(`INSERT INTO pending_inputs (id, vercel_account, kind, label, ciphertext, expires_at)
      VALUES ('77777777-7777-4777-8777-777777777777','team_FAKE','token','Fake','FAKE', now() - interval '181 days')`);
    await rawQuery(`INSERT INTO pending_inputs (id, vercel_account, kind, label, ciphertext, expires_at)
      VALUES ('88888888-8888-4888-8888-888888888888','team_FAKE','token','Fake','FAKE', now() - interval '10 days')`);
    const result = await db.sweepRetention();
    expect(result.oauthCodes).toBe(1);
    expect(result.oneTimeSecrets).toBe(1);
    expect(result.pendingInputs).toBe(1);
    expect(await count("SELECT count(*)::integer AS n FROM oauth_codes WHERE code = 'code_FAKE_recent'")).toBe(1);
    expect(await count('SELECT count(*)::integer AS n FROM one_time_secrets')).toBe(1);
    expect(await count('SELECT count(*)::integer AS n FROM pending_inputs')).toBe(1);
  });

  it('purges only provably unused RTC passes at 180 days — used and revoked passes survive', async () => {
    const pass = (id, digest, windowCount, revoked, expiresDays) => rawQuery(
      `INSERT INTO rtc_passes (pass_id, token_hash, vercel_account, areas, window_count, revoked_at, created_at, expires_at)
       VALUES ($1,$2,'team_FAKE','["server"]'::jsonb,$3,$4, now() - interval '200 days', now() - ($5 || ' days')::interval)`,
      [id, digest, windowCount, revoked ? new Date(Date.now() - 86400000) : null, String(expiresDays)]);
    // Never authorized (window_count 0), never revoked, lapsed 181 days ago: unused -> purged.
    await pass('pass_aaaaaaaaaaaaaaaaaaaa', 'a'.repeat(64), 0, false, 181);
    // Exercised (authorizeRtcPass debited the window): NOT unused -> kept.
    await pass('pass_bbbbbbbbbbbbbbbbbbbb', 'b'.repeat(64), 3, false, 181);
    // Revoked by the owner (a deliberate act, journaled separately): kept.
    await pass('pass_cccccccccccccccccccc', 'c'.repeat(64), 0, true, 181);
    // Unused but lapsed only 10 days ago: kept.
    await pass('pass_dddddddddddddddddddd', 'd'.repeat(64), 0, false, 10);
    const result = await db.sweepRetention();
    expect(result.rtcPassesUnused).toBe(1);
    const remaining = await rawQuery('SELECT pass_id FROM rtc_passes ORDER BY pass_id');
    expect(remaining.map((r) => r.pass_id)).toEqual([
      'pass_bbbbbbbbbbbbbbbbbbbb',
      'pass_cccccccccccccccccccc',
      'pass_dddddddddddddddddddd'
    ]);
  });

  it('journals a purging sweep exactly once with counts only, and an empty sweep not at all', async () => {
    const before = await count("SELECT count(*)::integer AS n FROM change_log WHERE tool = 'vercel_retention_sweep'");
    expect(before).toBeGreaterThanOrEqual(1);
    const journal = await rawQuery(`SELECT summary, after FROM change_log
      WHERE tool = 'vercel_retention_sweep' ORDER BY id`);
    // Every purging sweep above journaled exactly one row; the latest
    // is the RTC-pass sweep (1 unused pass, no journal rows purged).
    expect(journal).toHaveLength(4);
    expect(journal[0].summary).toMatch(/counts only/);
    expect(journal[0].after.changeLog).toBe(1);
    expect(journal[3].after.rtcPassesUnused).toBe(1);
    for (const row of journal) {
      expect(JSON.stringify(row.after)).not.toMatch(/fixture|FAKE/i);
    }
    const empty = await db.sweepRetention();
    expect(empty.total).toBe(0);
    expect(empty.journaled).toBe(false);
    expect(await count("SELECT count(*)::integer AS n FROM change_log WHERE tool = 'vercel_retention_sweep'")).toBe(before);
  });

  it('never sweeps oauth_tokens — refresh rows are live credentials and no use marker exists', async () => {
    await rawQuery(`INSERT INTO oauth_tokens (token_hash, refresh_hash, client_id, vercel_account, expires_at)
      VALUES ($1, $2, 'client_FAKE', 'team_FAKE', now() - interval '200 days')`,
      ['e'.repeat(64), 'f'.repeat(64)]);
    const result = await db.sweepRetention();
    expect(result.total).toBe(0);
    expect(await count('SELECT count(*)::integer AS n FROM oauth_tokens')).toBe(1);
  });
});
