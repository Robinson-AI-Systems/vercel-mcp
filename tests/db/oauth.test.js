import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { hashToken, randomToken } from '../../src/core/oauth.js';
import { closeIsolatedSchema, neonShapedQuery, openIsolatedSchema, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let db;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be a disposable localhost Postgres');
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) {
    throw new Error('Refusing a remote database');
  }
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});

afterAll(async () => { await closeIsolatedSchema(); });

describe('A-3a OAuth persistence on isolated PostgreSQL', () => {
  it('stores client secrets and authorization codes as hashes, and consumes codes once', async () => {
    const clientSecret = randomToken();
    const code = randomToken();
    const verifier = randomToken();
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    await db.createOAuthClient({
      clientId: 'client-a',
      clientSecret,
      redirectUris: ['https://example.test/callback'],
      clientName: 'Example client'
    });
    const client = await db.getOAuthClient('client-a');
    expect(client.client_secret_hash).toBe(hashToken(clientSecret));
    expect(client.client_secret_hash).not.toBe(clientSecret);
    expect(client.redirect_uris).toEqual(['https://example.test/callback']);
    expect(JSON.stringify(client)).not.toContain(clientSecret);

    await db.createAuthCode({
      code,
      clientId: 'client-a',
      redirectUri: 'https://example.test/callback',
      codeChallenge: challenge,
      vercelAccount: 'team_fixture',
      mode: 'preview',
      profile: 'read_only',
      listing: 'compact'
    });
    const rows = await rawQuery('SELECT code FROM oauth_codes');
    expect(rows.map((row) => row.code)).toContain(hashToken(code));
    expect(rows.map((row) => row.code)).not.toContain(code);
    expect(await db.consumeAuthCode(code)).toMatchObject({
      client_id: 'client-a',
      redirect_uri: 'https://example.test/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      vercel_account: 'team_fixture',
      mode: 'preview',
      profile: 'read_only',
      listing: 'compact'
    });
    expect(await db.consumeAuthCode(code)).toBeNull();

    const expiredCode = randomToken();
    await db.createAuthCode({
      code: expiredCode,
      clientId: 'client-a',
      redirectUri: 'https://example.test/callback',
      codeChallenge: challenge,
      ttlSeconds: -10
    });
    expect(await db.consumeAuthCode(expiredCode)).toBeNull();
  });

  it('hashes access and refresh tokens, preserves settings, and refuses expired or revoked access tokens', async () => {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    await db.createAccessToken({
      accessToken,
      refreshToken,
      clientId: 'client-a',
      vercelAccount: 'team_fixture',
      mode: 'preview',
      profile: 'full',
      listing: 'compact'
    });
    const [stored] = await rawQuery(
      'SELECT token_hash, refresh_hash FROM oauth_tokens WHERE client_id = $1',
      ['client-a']
    );
    expect(stored.token_hash).toBe(hashToken(accessToken));
    expect(stored.refresh_hash).toBe(hashToken(refreshToken));
    expect(stored.token_hash).not.toBe(accessToken);
    expect(stored.refresh_hash).not.toBe(refreshToken);
    expect(await db.getAccessToken(accessToken)).toMatchObject({
      client_id: 'client-a',
      vercel_account: 'team_fixture',
      mode: 'preview',
      profile: 'full',
      listing: 'compact',
      kind: 'connector',
      revoked_at: null
    });
    expect(await db.getTokenByRefreshToken(refreshToken)).toMatchObject({
      client_id: 'client-a',
      vercel_account: 'team_fixture',
      mode: 'preview',
      profile: 'full',
      listing: 'compact'
    });

    const expiredAccess = randomToken();
    await db.createAccessToken({ accessToken: expiredAccess, clientId: 'client-a', ttlSeconds: -10 });
    expect(await db.getAccessToken(expiredAccess)).toBeNull();
    expect(await db.revokeAccessToken(accessToken)).toBe(true);
    expect(await db.getAccessToken(accessToken)).toBeNull();
    expect(await db.revokeAccessToken(accessToken)).toBe(false);
  });

  it('refreshes only for the issuing client, atomically rejects replay, and preserves all connection settings', async () => {
    const oldAccess = randomToken();
    const oldRefresh = randomToken();
    await db.createAccessToken({
      accessToken: oldAccess,
      refreshToken: oldRefresh,
      clientId: 'client-refresh',
      vercelAccount: 'team_fixture',
      mode: 'preview',
      profile: 'read_only',
      listing: 'compact'
    });
    const wrongClient = await db.rotateRefreshToken({
      refreshToken: oldRefresh,
      clientId: 'different-client',
      accessToken: randomToken(),
      newRefreshToken: randomToken()
    });
    expect(wrongClient).toBeNull();

    const newAccessA = randomToken();
    const newRefreshA = randomToken();
    const newAccessB = randomToken();
    const newRefreshB = randomToken();
    const rotations = await Promise.all([
      db.rotateRefreshToken({
        refreshToken: oldRefresh, clientId: 'client-refresh',
        accessToken: newAccessA, newRefreshToken: newRefreshA
      }),
      db.rotateRefreshToken({
        refreshToken: oldRefresh, clientId: 'client-refresh',
        accessToken: newAccessB, newRefreshToken: newRefreshB
      })
    ]);
    const winners = rotations.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({
      client_id: 'client-refresh',
      vercel_account: 'team_fixture',
      mode: 'preview',
      profile: 'read_only',
      listing: 'compact'
    });
    expect(await db.getTokenByRefreshToken(oldRefresh)).toBeNull();
    expect(await db.getAccessToken(oldAccess)).toBeNull();
    const winningAccess = rotations[0] ? newAccessA : newAccessB;
    expect(await db.getAccessToken(winningAccess)).toMatchObject({
      vercel_account: 'team_fixture',
      mode: 'preview',
      profile: 'read_only',
      listing: 'compact'
    });
  });

  it('counts failed login attempts by IP and excludes successful attempts', async () => {
    const first = await db.recordLoginAttempt('192.0.2.20');
    expect(await db.countRecentFailedLogins('192.0.2.20', 15)).toBe(1);
    await db.markLoginAttemptSucceeded(first);
    expect(await db.countRecentFailedLogins('192.0.2.20', 15)).toBe(0);
    await db.recordLoginAttempt('192.0.2.20');
    expect(await db.countRecentFailedLogins('192.0.2.21', 15)).toBe(0);
    expect(await db.countRecentFailedLogins('192.0.2.20', 15)).toBe(1);
  });
});
