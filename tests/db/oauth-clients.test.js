// RECENSUS-1: the OAuth client registration lifecycle against real
// PostgreSQL — register (the public route's own store call) → list →
// read → update → delete → gone, with the dependent token families
// read back revoked, the outstanding codes removed, the deletion
// journaled, and the secret hash never present in a public shape.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { hashToken } from '../../src/core/oauth.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let db;
const CLIENT = 'FAKEclient-id_0123456789abcd';
const ACCOUNT = 'team_FAKE';
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
    throw Error('Disposable localhost PostgreSQL required');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });

describe('RECENSUS-1 registration lifecycle (real PostgreSQL)', () => {
  it('runs register → list → read → update → delete with dependents settled', async () => {
    await db.createOAuthClient({ clientId: CLIENT, clientSecret: 'FAKE-secret',
      redirectUris: ['https://example.test/callback'], clientName: 'Probe client',
      tokenEndpointAuthMethod: 'client_secret_post' });
    // Two live token families and one already-revoked, one code.
    for (const [token, refresh] of [['FAKE-access-1', 'FAKE-refresh-1'],
      ['FAKE-access-2', 'FAKE-refresh-2'], ['FAKE-access-3', 'FAKE-refresh-3']]) {
      await rawQuery('INSERT INTO oauth_tokens (token_hash, refresh_hash, client_id, kind) VALUES ($1, $2, $3, $4)',
        [hashToken(token), hashToken(refresh), CLIENT, 'connector']);
    }
    await rawQuery('UPDATE oauth_tokens SET revoked_at = now() WHERE token_hash = $1',
      [hashToken('FAKE-access-3')]);
    await db.createAuthCode({ code: 'FAKE-code', clientId: CLIENT,
      redirectUri: 'https://example.test/callback', codeChallenge: 'FAKE-challenge' });

    const listed = await db.listOAuthClients();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ client_id: CLIENT, client_name: 'Probe client',
      client_type: 'confidential', live_tokens: 2, tokens_total: 3,
      codes_outstanding: 1 });
    expect(listed[0].created_at).toBeTruthy();
    expect(JSON.stringify(listed)).not.toContain('client_secret_hash');
    expect(JSON.stringify(listed)).not.toContain(hashToken('FAKE-secret'));

    const read = await db.getOAuthClientRegistration(CLIENT);
    expect(read).toEqual(listed[0]);

    const updated = await db.updateOAuthClient({ clientId: CLIENT,
      clientName: 'Renamed client', redirectUris: ['https://example.test/new'] });
    expect(updated.client_name).toBe('Renamed client');
    expect(updated.redirect_uris).toEqual(['https://example.test/new']);
    // The credential and identity survive the edit untouched.
    const internal = await db.getOAuthClient(CLIENT);
    expect(internal.token_endpoint_auth_method).toBe('client_secret_post');
    expect(internal.client_secret_hash).toBe(hashToken('FAKE-secret'));

    const outcome = await db.deleteOAuthClient({ clientId: CLIENT, account: ACCOUNT });
    expect(outcome).toEqual({ deleted: true, tokensRevoked: 2, codesRemoved: 1 });
    expect(await db.getOAuthClientRegistration(CLIENT)).toBeNull();
    expect(await db.getOAuthClient(CLIENT)).toBeNull();
    expect(await db.listOAuthClients()).toHaveLength(0);
    const tokenRows = await rawQuery(
      'SELECT revoked_at FROM oauth_tokens WHERE client_id = $1', [CLIENT]);
    expect(tokenRows).toHaveLength(3);
    expect(tokenRows.every(row => row.revoked_at !== null)).toBe(true);
    expect(await rawQuery('SELECT code FROM oauth_codes WHERE client_id = $1',
      [CLIENT])).toHaveLength(0);
    const journal = await rawQuery(
      'SELECT tool, summary FROM change_log WHERE vercel_account = $1', [ACCOUNT]);
    expect(journal).toHaveLength(1);
    expect(journal[0].tool).toBe('vercel_delete_oauth_client');
    expect(journal[0].summary).toContain(CLIENT);
  });

  it('deleting a nonexistent registration mutates nothing and journals nothing', async () => {
    // Orphan dependents keyed to a client that has no registration:
    // the delete must not touch them (no partial mutation).
    await rawQuery('INSERT INTO oauth_tokens (token_hash, refresh_hash, client_id, kind) VALUES ($1, $2, $3, $4)',
      [hashToken('FAKE-orphan'), hashToken('FAKE-orphan-refresh'), 'FAKE-ghost', 'connector']);
    expect(await db.deleteOAuthClient({ clientId: 'FAKE-ghost', account: ACCOUNT })).toBeNull();
    const rows = await rawQuery(
      'SELECT revoked_at FROM oauth_tokens WHERE token_hash = $1', [hashToken('FAKE-orphan')]);
    expect(rows[0].revoked_at).toBeNull();
    const journal = await rawQuery(
      'SELECT id FROM change_log WHERE vercel_account = $1', [ACCOUNT]);
    expect(journal).toHaveLength(1); // still only the real deletion above
    expect(await db.updateOAuthClient({ clientId: 'FAKE-ghost', clientName: 'X' })).toBeNull();
  });

  it('refuses invalid updates at the store boundary', async () => {
    await expect(db.updateOAuthClient({ clientId: CLIENT, redirectUris: [] }))
      .rejects.toThrow(/Invalid OAuth client update/);
    await expect(db.updateOAuthClient({ clientId: CLIENT,
      redirectUris: ['not a uri'] })).rejects.toThrow(/Invalid OAuth client update/);
    await expect(db.updateOAuthClient({ clientId: CLIENT }))
      .rejects.toThrow(/Invalid OAuth client update/);
  });
});
