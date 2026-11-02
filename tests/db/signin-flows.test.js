// SR-1 (gate O-2.7): the signin_flows store against a real
// Postgres database - schema idempotence (the additive
// attested_user_id column lands without touching existing
// rows), the flow lifecycle guards (single-use Vercel-leg
// consume, attested-only consent consume, expiry), and the
// retention sweep's new class (expired flows swept, live
// flows kept).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { hashToken } from '../../src/core/oauth.js';
import {
  closeIsolatedSchema, neonShapedQuery, openIsolatedSchema, rawQuery
} from '../../test/helpers/pg-neon-adapter.js';

let db;
const ACCOUNT = 'team_' + randomUUID().replaceAll('-', '');
const USER_ID = '345e869043f1e55f8bdc837c';

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname)) {
    throw new Error('Only disposable localhost Postgres is permitted');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => closeIsolatedSchema());

function flowFields(overrides = {}) {
  return {
    handle: 'handle-' + randomUUID(),
    clientId: 'https://vercel-mcp.example.test/.well-known/muse-client.json',
    redirectUri: 'https://client.example.test/callback',
    codeChallenge: 'c'.repeat(43),
    clientState: 'client-state-1',
    resource: 'https://vercel-mcp.example.test/api/mcp',
    vercelCodeVerifier: 'v'.repeat(43),
    nonce: 'nonce-1',
    ...overrides
  };
}

describe('SR-1 sign-in flow store', () => {
  it('creates the table and the additive column idempotently, rewriting no stored row', async () => {
    // A row written before the SR-1 column existed (the
    // retention suite's minimal account shape), then the
    // schema runs again: the row must survive byte-identical
    // with the new column NULL - additive means additive.
    await rawQuery(
      `INSERT INTO vercel_accounts (id, team_id, team_slug, label, scope, token_enc, token_last4)
       VALUES ($1, $1, 'fake', 'Fake', 'team', 'opaque-token', 'FAKE')`, [ACCOUNT]);
    await db.initSchema();
    const rows = await rawQuery(
      'SELECT token_enc, attested_user_id FROM vercel_accounts WHERE id = $1', [ACCOUNT]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_enc).toBe('opaque-token');
    expect(rows[0].attested_user_id).toBeNull();
    const tables = await rawQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'signin_flows'`);
    expect(tables).toHaveLength(1);
    const columns = await rawQuery(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE column_name IN ('handle_hash', 'vercel_code_verifier', 'attested_user_id')`);
    const seen = columns.map((row) => row.table_name + '.' + row.column_name).sort();
    expect(seen).toEqual([
      'signin_flows.attested_user_id',
      'signin_flows.handle_hash',
      'signin_flows.vercel_code_verifier',
      'vercel_accounts.attested_user_id'
    ].sort());
  });

  it('runs the lifecycle: attest once, consume once, and never twice', async () => {
    const fields = flowFields();
    await db.createSigninFlow(fields);
    // The stored key is the handle hash, never the handle.
    const stored = await rawQuery(
      'SELECT handle_hash FROM signin_flows WHERE handle_hash = $1', [hashToken(fields.handle)]);
    expect(stored).toHaveLength(1);
    expect(stored[0].handle_hash).toHaveLength(64);
    const row = await db.getSigninFlow(fields.handle);
    expect(row?.client_id).toBe(fields.clientId);
    expect(row?.attested_user_id).toBeNull();
    // Consent consume before attestation is refused.
    expect(await db.consumeSigninFlow({ handle: fields.handle, chosenAccount: ACCOUNT })).toBeNull();
    expect(await db.attestSigninFlow({
      handle: fields.handle, userId: USER_ID, claims: { name: 'Fixture User' }
    })).toBe(true);
    // The Vercel leg is single-use: a second attest is refused.
    expect(await db.attestSigninFlow({ handle: fields.handle, userId: USER_ID })).toBe(false);
    const attested = await db.getSigninFlow(fields.handle);
    expect(attested?.attested_user_id).toBe(USER_ID);
    expect(attested?.attested_claims).toEqual({ name: 'Fixture User' });
    const consumed = await db.consumeSigninFlow({ handle: fields.handle, chosenAccount: ACCOUNT });
    expect(consumed?.attested_user_id).toBe(USER_ID);
    expect(consumed?.chosen_account).toBe(ACCOUNT);
    // And the flow itself is single-use.
    expect(await db.consumeSigninFlow({ handle: fields.handle, chosenAccount: ACCOUNT })).toBeNull();
    expect(await db.getSigninFlow('no-such-handle')).toBeNull();
  });
});

describe('SR-1 sign-in flow retention', () => {
  it('sweeps expired flows at expiry and keeps live ones', async () => {
    const live = flowFields();
    await db.createSigninFlow(live);
    const expired = flowFields();
    await db.createSigninFlow(expired);
    // Age the second flow past its expiry the way time would.
    await rawQuery(
      `UPDATE signin_flows SET expires_at = now() - interval '1 minute' WHERE handle_hash = $1`,
      [hashToken(expired.handle)]);
    // An expired flow can no longer attest.
    expect(await db.attestSigninFlow({ handle: expired.handle, userId: USER_ID })).toBe(false);
    const result = await db.sweepRetention({ now: new Date() });
    expect(result.signinFlows).toBe(1);
    expect(await db.getSigninFlow(expired.handle)).toBeNull();
    expect(await db.getSigninFlow(live.handle)).not.toBeNull();
  });

  it('rejects malformed flows at the store boundary', async () => {
    await expect(db.createSigninFlow(flowFields({ codeChallengeMethod: 'plain' })))
      .rejects.toThrowError(TypeError);
    await expect(db.createSigninFlow(flowFields({ ttlSeconds: 30 })))
      .rejects.toThrowError(TypeError);
    await expect(db.createSigninFlow(flowFields({ vercelCodeVerifier: '' })))
      .rejects.toThrowError(TypeError);
  });
});
