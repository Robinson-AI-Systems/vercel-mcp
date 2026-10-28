import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery }
  from '../../test/helpers/pg-neon-adapter.js';

// AUD-E (design D-E, ruling IN-04): the owner's no-expiry attestation.
// The beforeAll builds a PRE-AUD-E vercel_accounts table by hand — the
// shape every existing deployment has — so initSchema's additive column
// is exercised exactly as it will run on deploy. A null token_expires_at
// establishes nothing (storeToken writes it unconditionally); only the
// attestation may be presented as "no expiry — owner's choice".
let db;
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname)) {
    throw new Error('Disposable localhost Postgres only');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await rawQuery(`CREATE TABLE vercel_accounts (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, team_slug TEXT NOT NULL, label TEXT NOT NULL,
    scope TEXT NOT NULL, project_id TEXT, project_name TEXT, token_enc TEXT NOT NULL,
    token_last4 TEXT NOT NULL, token_expires_at TIMESTAMPTZ, token_checked_at TIMESTAMPTZ,
    token_probe JSONB, production_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    spend_limit_cents INTEGER NOT NULL DEFAULT 0, sandbox_minutes_per_day INTEGER,
    is_default BOOLEAN NOT NULL DEFAULT FALSE, added_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await rawQuery(`INSERT INTO vercel_accounts
    (id,team_id,team_slug,label,scope,token_enc,token_last4)
    VALUES ('team_FAKE','team_FAKE','fixture','Fixture','team','ciphertext_FAKE_one','1111'),
           ('team_OTHER','team_OTHER','other','Other','team','ciphertext_FAKE_two','2222')`);
});
afterAll(async () => { await closeIsolatedSchema(); });
const audits = () => rawQuery(
  "SELECT vercel_account,tool,summary,after,dry_run,production FROM change_log WHERE tool='vercel_set_token_no_expiry' ORDER BY id");

it('adds the attestation column additively; existing accounts default to not attested', async () => {
  await db.initSchema();
  await db.initSchema();
  expect(await db.getTokenNoExpiry('team_FAKE')).toBe(false);
  expect(await db.getTokenNoExpiry('team_OTHER')).toBe(false);
  const rows = await db.listVercelAccounts();
  expect(rows.find(r => r.id === 'team_FAKE').token_no_expiry).toBe(false);
  expect(rows.find(r => r.id === 'team_FAKE').token_expires_at).toBeNull();
  // A fresh account created after the migration has the safe default.
  await rawQuery(`INSERT INTO vercel_accounts
    (id,team_id,team_slug,label,scope,token_enc,token_last4)
    VALUES ('team_FRESH','team_FRESH','fresh','Fresh','team','ciphertext_FAKE_fresh','3333')`);
  expect(await db.getTokenNoExpiry('team_FRESH')).toBe(false);
});

it('setTokenNoExpiry round-trips and journals every successful set and clear', async () => {
  expect(await db.setTokenNoExpiry('team_FAKE', true)).toBe(true);
  expect(await db.getTokenNoExpiry('team_FAKE')).toBe(true);
  expect(await db.getTokenNoExpiry('team_OTHER')).toBe(false);
  expect(await db.setTokenNoExpiry('team_FAKE', false)).toBe(true);
  expect(await db.getTokenNoExpiry('team_FAKE')).toBe(false);
  const logs = await audits();
  expect(logs).toHaveLength(2);
  expect(logs[0].summary).toContain('attested the enrolled token has no expiry');
  expect(logs[0].after).toEqual({ tokenNoExpiry:true });
  expect(logs[1].summary).toContain('cleared the no-expiry attestation');
  expect(logs[1].after).toEqual({ tokenNoExpiry:false });
  expect(logs.every(r => r.production === true && r.dry_run === false)).toBe(true);
});

it('enrolling or rotating a token clears a previous attestation', async () => {
  expect(await db.setTokenNoExpiry('team_FAKE', true)).toBe(true);
  await db.upsertVercelAccount({
    id: 'team_FAKE', teamId: 'team_FAKE', teamSlug: 'fixture', label: 'Fixture',
    scope: 'team', tokenEnc: 'ciphertext_FAKE_rotated', tokenLast4: '9999',
    expiresAt: null, probe: { checkedAt: '2026-10-28T00:00:00.000Z' }
  });
  expect(await db.getTokenNoExpiry('team_FAKE')).toBe(false);
});

it('rejects invalid attestations and missing accounts without journaling', async () => {
  const before = await audits();
  for (const invalid of ['yes', 1, null, undefined]) {
    await expect(db.setTokenNoExpiry('team_FAKE', invalid)).rejects.toThrow();
  }
  await expect(db.setTokenNoExpiry('bad name', true)).rejects.toThrow();
  await expect(db.getTokenNoExpiry('bad name')).rejects.toThrow();
  expect(await db.setTokenNoExpiry('team_UNKNOWN', true)).toBe(false);
  expect(await db.getTokenNoExpiry('team_UNKNOWN')).toBeNull();
  expect(await audits()).toHaveLength(before.length);
});
