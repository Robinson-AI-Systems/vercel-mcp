// SR-2 (gate O-2.7): the public-class journey end to end —
// the real OAuth handlers + the real Vercel login service +
// SR-1's fake Vercel authorization server (a real RSA keypair
// published as JWKS, genuinely signed ID Tokens, PKCE and
// client_secret_basic enforced) + a fake provider for the
// roster read. Refusals assert the SPECIFIC refusal, never
// merely that an error came back.
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { encryptSecret } from '../../src/core/secret-box.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';
import {
  SIGNIN_JWKS_URL, SIGNIN_TOKEN_URL, SIGNIN_USERINFO_URL, handleSigninCallback
} from '../../src/vercel/signin.js';

const ORIGIN = 'https://vercel-mcp.example.test';
const CLIENT_ID = ORIGIN + '/.well-known/muse-client.json';
const REDIRECT = 'https://agent.meta.ai/api/hatch/oauth/callback';
const SUB = '345e869043f1e55f8bdc837c';
const SUB2 = 'a11ce00000000000000000other';
const SIGNIN_CLIENT_ID = 'cl_FAKE_signin_app';
const SIGNIN_SECRET = 'fake-signin-secret';
const KEY = 'ab'.repeat(32);

const baseEnv = {
  PUBLIC_BASE_URL: ORIGIN,
  ADMIN_PASSPHRASE: 'fixture-passphrase',
  TOKEN_ENCRYPTION_KEY: KEY
};
const publicEnv = {
  ...baseEnv, VERCEL_ENV: 'production',
  VERCEL_SIGNIN_CLIENT_ID: SIGNIN_CLIENT_ID,
  VERCEL_SIGNIN_CLIENT_SECRET: SIGNIN_SECRET
};
const clientParams = {
  client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
  code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
  state: 'client-state-1', resource: ORIGIN + '/api/mcp'
};

// --- the fake Vercel authorization server (SR-1's pattern) ---
function makeKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwks: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid, use: 'sig', alg: 'RS256' }] };
}
const mainKey = makeKey('fake-key-1');
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function mintIdToken(sub, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://vercel.com', sub, aud: SIGNIN_CLIENT_ID,
    exp: now + 600, iat: now, nbf: now - 10, jti: 'fake-jti-1',
    name: 'Fixture User', preferred_username: 'fixtureuser',
    email: 'fixture@example.test', picture: 'https://example.test/pic.png', ...claims
  };
  const input = b64({ alg: 'RS256', typ: 'JWT', kid: mainKey.kid }) + '.' + b64(payload);
  return input + '.' + cryptoSign('RSA-SHA256', Buffer.from(input), mainKey.privateKey).toString('base64url');
}
function makeFakeAs(sub) {
  const codes = new Map();
  let sequence = 0;
  return {
    issueCode({ verifier, nonce }) {
      const code = 'fake-code-' + (++sequence);
      codes.set(code, {
        challenge: createHash('sha256').update(verifier).digest('base64url'), nonce
      });
      return code;
    },
    async fetch(url, options = {}) {
      const href = String(url);
      if (href === SIGNIN_JWKS_URL) {
        return { ok: true, status: 200, json: async () => ({ keys: mainKey.jwks }) };
      }
      if (href === SIGNIN_TOKEN_URL) {
        const params = new URLSearchParams(String(options.body));
        const record = codes.get(params.get('code'));
        const expectedAuth = 'Basic ' +
          Buffer.from(SIGNIN_CLIENT_ID + ':' + SIGNIN_SECRET).toString('base64');
        const verifierOk = record &&
          createHash('sha256').update(params.get('code_verifier') || '').digest('base64url') ===
            record.challenge;
        if (!record || options.headers?.authorization !== expectedAuth ||
          params.get('grant_type') !== 'authorization_code' || !verifierOk) {
          return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
        }
        codes.delete(params.get('code'));
        return {
          ok: true, status: 200,
          json: async () => ({
            access_token: 'vca_FAKE_access', token_type: 'Bearer',
            expires_in: 3600, id_token: mintIdToken(sub, { nonce: record.nonce })
          })
        };
      }
      if (href === SIGNIN_USERINFO_URL) {
        if (options.headers?.authorization !== 'Bearer vca_FAKE_access') {
          return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) };
        }
        return {
          ok: true, status: 200,
          json: async () => ({
            sub, name: 'Fixture User', preferred_username: 'fixtureuser',
            email: 'fixture@example.test', picture: 'https://example.test/pic.png'
          })
        };
      }
      throw new Error('Unexpected fetch: ' + href);
    }
  };
}

// --- the fake provider: team rosters by team id ---
const ROSTERS = {
  team_roster: [{ uid: SUB, username: 'fixtureuser' }, { uid: 'someone-else' }],
  team_stranger: [{ uid: 'someone-else' }],
  team_orphan: [{ uid: 'someone-else' }],
  team_expired: [{ uid: SUB, username: 'fixtureuser' }]
};
function providerFetch(url) {
  const match = String(url).match(/^https:\/\/api\.vercel\.com\/v3\/teams\/([^/]+)\/members/);
  if (!match) throw new Error('Unexpected provider fetch: ' + String(url));
  const members = ROSTERS[decodeURIComponent(match[1])];
  if (!members) {
    return {
      ok: false, status: 404,
      json: async () => ({ error: { code: 'not_found', message: 'Team not found' } })
    };
  }
  return {
    ok: true, status: 200,
    json: async () => ({ members, pagination: { count: members.length, next: null, prev: null } })
  };
}

// --- fixtures ---
async function seedAccounts(db, env) {
  const enc = (id, token) => encryptSecret(token, 'token:' + id, env);
  await db.upsertVercelAccount({
    id: 'acct-owner', teamId: 'team_owner', teamSlug: 'owner-team', label: 'Owner Team',
    scope: 'team', tokenEnc: enc('acct-owner', 'fake-owner-token'), tokenLast4: 'FAKE',
    probe: { installerUserId: SUB }, attestedUserId: SUB
  });
  await db.upsertVercelAccount({
    id: 'acct-roster', teamId: 'team_roster', teamSlug: 'roster-team', label: 'Roster Team',
    scope: 'team', tokenEnc: enc('acct-roster', 'fake-roster-token'), tokenLast4: 'FAKE',
    probe: { installerUserId: 'someone-else' }, attestedUserId: 'someone-else'
  });
  await db.upsertVercelAccount({
    id: 'acct-stranger', teamId: 'team_stranger', teamSlug: 'stranger-team', label: 'Stranger Team',
    scope: 'team', tokenEnc: enc('acct-stranger', 'fake-stranger-token'), tokenLast4: 'FAKE',
    probe: { installerUserId: 'someone-else' }, attestedUserId: 'someone-else'
  });
  await db.upsertVercelAccount({
    id: 'acct-orphan', teamId: 'team_orphan', teamSlug: 'orphan-team', label: 'Orphan Team',
    scope: 'team', tokenEnc: enc('acct-orphan', 'fake-orphan-token'), tokenLast4: 'FAKE',
    probe: {}
  });
  await db.upsertVercelAccount({
    id: 'acct-expired', teamId: 'team_expired', teamSlug: 'expired-team', label: 'Expired Team',
    scope: 'team', tokenEnc: enc('acct-expired', 'fake-expired-token'), tokenLast4: 'FAKE',
    probe: { installerUserId: 'someone-else' }, attestedUserId: 'someone-else',
    expiresAt: new Date(Date.now() - 60000)
  });
}
function makeWorld(env, sub = SUB) {
  const db = createFakeDb({});
  db.requestReplayStore = () => ({
    claim: async () => ({ state: 'claimed', claimId: 'FAKE' }),
    complete: async () => {}, release: async () => {}
  });
  const service = createVercelLoginService(db, { fetchImpl: providerFetch });
  const handlers = createOAuthHandlers({ db, env, service });
  const fakeAs = makeFakeAs(sub);
  return { db, service, handlers, fakeAs };
}
function response() {
  return {
    statusCode: 200, headers: {}, body: null, ended: false,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = JSON.stringify(value); return this; },
    end() { this.ended = true; return this; }
  };
}
const getReq = (query, headers = {}) => ({
  method: 'GET', headers, query, socket: { remoteAddress: '198.51.100.7' }
});
const postReq = (fields, headers = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(fields).toString(),
  socket: { remoteAddress: '198.51.100.7' }
});
// Drives detour -> callback; returns the pieces the consent
// steps need.
async function attestJourney(world, env) {
  const { db, handlers, fakeAs } = world;
  const detour = response();
  await handlers.authorize(getReq({ ...clientParams }), detour);
  expect(detour.statusCode).toBe(302);
  const authorizeUrl = new URL(detour.headers.Location);
  expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://vercel.com/oauth/authorize');
  const handle = authorizeUrl.searchParams.get('state');
  const cookie = String(detour.headers['Set-Cookie']).split(';')[0];
  expect(cookie.startsWith('rmcp_signin_binding=')).toBe(true);
  const flow = await db.getSigninFlow(handle);
  const code = fakeAs.issueCode({ verifier: flow.vercel_code_verifier, nonce: flow.nonce });
  const callbackRes = response();
  await handleSigninCallback({ db, env, fetchImpl: fakeAs.fetch },
    getReq({ code, state: handle }, { cookie }), callbackRes);
  expect(callbackRes.statusCode).toBe(302);
  expect(callbackRes.headers.Location).toBe(ORIGIN + '/api/oauth/authorize?flow=' + handle);
  return { handle, cookie };
}

describe('SR-2 public-class journey', () => {
  it('runs end to end: detour, attested consent with only bindable accounts, issued code', async () => {
    const world = makeWorld(publicEnv);
    await seedAccounts(world.db, publicEnv);
    const { handle, cookie } = await attestJourney(world, publicEnv);
    const consent = response();
    await world.handlers.authorize(getReq({ flow: handle }, { cookie }), consent);
    expect(consent.statusCode).toBe(200);
    expect(consent.body).toContain('Signed in to Vercel as');
    expect(consent.body).toContain('fixtureuser');
    // Limb 1 (owner match) and limb 2 (roster) render; the
    // stranger, the unattested orphan and the expired-credential
    // account do not.
    expect(consent.body).toContain('Owner Team');
    expect(consent.body).toContain('Roster Team');
    expect(consent.body).not.toContain('Stranger Team');
    expect(consent.body).not.toContain('Orphan Team');
    expect(consent.body).not.toContain('Expired Team');
    // No passphrase field exists on this class.
    expect(consent.body).not.toContain('passphrase');
    expect(consent.body).toContain('Authorize this connection');

    const post = response();
    await world.handlers.authorize(postReq({ flow: handle, account: 'acct-roster' }, { cookie }), post);
    expect(post.statusCode).toBe(302);
    const destination = new URL(post.headers.Location);
    expect(destination.origin + destination.pathname).toBe(REDIRECT);
    expect(destination.searchParams.get('state')).toBe('client-state-1');
    const code = destination.searchParams.get('code');
    expect(code).toBeTruthy();
    // The issued code carries the DERIVED issuance for the
    // chosen account (AUD-AZ), bound to the record's client.
    const record = await world.db.consumeAuthCode(code);
    expect(record.vercel_account).toBe('acct-roster');
    expect(record.mode).toBe('production');
    expect(record.profile).toBe('full');
    expect(record.listing).toBe('front_door');
    expect((await world.db.getSigninFlow(handle)).consumed_at).not.toBeNull();

    // Replay: the consumed flow refuses, plainly.
    const replay = response();
    await world.handlers.authorize(postReq({ flow: handle, account: 'acct-roster' }, { cookie }), replay);
    expect(replay.statusCode).toBe(400);
    expect(replay.body).toContain('no longer usable');
  });

  it('refuses a tampered account id at POST time without consuming the flow', async () => {
    const world = makeWorld(publicEnv);
    await seedAccounts(world.db, publicEnv);
    const { handle, cookie } = await attestJourney(world, publicEnv);
    const tampered = response();
    await world.handlers.authorize(postReq({ flow: handle, account: 'acct-stranger' }, { cookie }), tampered);
    expect(tampered.statusCode).toBe(400);
    expect(tampered.body).toContain('cannot be connected with this Vercel sign-in');
    const unknown = response();
    await world.handlers.authorize(postReq({ flow: handle, account: 'acct-nope' }, { cookie }), unknown);
    expect(unknown.statusCode).toBe(400);
    // Neither refusal consumed the flow: a legitimate choice
    // still completes.
    expect((await world.db.getSigninFlow(handle)).consumed_at).toBeNull();
    const post = response();
    await world.handlers.authorize(postReq({ flow: handle, account: 'acct-owner' }, { cookie }), post);
    expect(post.statusCode).toBe(302);
  });

  it('renders the enrollment legs and no authorize button when the identity binds nothing', async () => {
    const world = makeWorld(publicEnv, SUB2);
    await seedAccounts(world.db, publicEnv);
    const { handle, cookie } = await attestJourney(world, publicEnv);
    const consent = response();
    await world.handlers.authorize(getReq({ flow: handle }, { cookie }), consent);
    expect(consent.statusCode).toBe(200);
    expect(consent.body).toContain('None of the accounts connected to this server');
    expect(consent.body).toContain('/api/oauth/enroll');
    expect(consent.body).toContain('/api/vercel/connect');
    expect(consent.body).not.toContain('Authorize this connection');
    expect(consent.body).not.toContain('passphrase');
  });

  it('refuses the consent from a different browser (binding mismatch or missing cookie)', async () => {
    const world = makeWorld(publicEnv);
    await seedAccounts(world.db, publicEnv);
    const { handle } = await attestJourney(world, publicEnv);
    const wrong = response();
    await world.handlers.authorize(
      getReq({ flow: handle }, { cookie: 'rmcp_signin_binding=wrong-value' }), wrong);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.body).toContain('browser that started it');
    const missing = response();
    await world.handlers.authorize(getReq({ flow: handle }), missing);
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain('browser that started it');
  });

  it('refuses an expired flow at the consent step', async () => {
    // A store clock eleven minutes in the past: the flow it
    // seeds is already expired by the real clock the handler
    // reads, while the store's own attestation guard (on its
    // clock) still accepts the attestation.
    const pastDb = createFakeDb({ clock: () => Date.now() - 601000 });
    pastDb.requestReplayStore = () => ({
      claim: async () => ({ state: 'claimed', claimId: 'FAKE' }),
      complete: async () => {}, release: async () => {}
    });
    const service = createVercelLoginService(pastDb, { fetchImpl: providerFetch });
    const handlers = createOAuthHandlers({ db: pastDb, env: publicEnv, service });
    const handle = 'expired-flow-handle';
    await pastDb.createSigninFlow({
      handle, clientId: CLIENT_ID, redirectUri: REDIRECT,
      codeChallenge: 'c'.repeat(43), clientState: 'client-state-1',
      resource: ORIGIN + '/api/mcp', vercelCodeVerifier: 'v'.repeat(43),
      nonce: 'nonce-fixture', browserBindingHash: null
    });
    expect(await pastDb.attestSigninFlow({
      handle, userId: SUB, claims: { username: 'fixtureuser' }
    })).toBe(true);
    const res = response();
    await handlers.authorize(getReq({ flow: handle }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('no longer usable');
  });

  it('refuses a flow-less POST on the configured public class — the passphrase is not honored', async () => {
    const world = makeWorld(publicEnv);
    await seedAccounts(world.db, publicEnv);
    const res = response();
    await world.handlers.authorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: 'fixture-passphrase'
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('needs Vercel sign-in first');
  });

  it('validates a malformed fresh request before any detour', async () => {
    const world = makeWorld(publicEnv);
    const res = response();
    await world.handlers.authorize(getReq({ ...clientParams, redirect_uri: 'https://evil.example/cb' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers.Location).toBeUndefined();
  });
});

describe('SR-2 binding limbs (service level)', () => {
  it('binds owner-match and roster membership only; roster failure fails closed', async () => {
    const world = makeWorld(publicEnv);
    await seedAccounts(world.db, publicEnv);
    const bindable = await world.service.bindableAccounts(SUB, publicEnv);
    expect(bindable.map((account) => account.id).sort()).toEqual(['acct-owner', 'acct-roster']);
    // A provider that throws reads as no roster grant.
    const downService = createVercelLoginService(world.db, {
      fetchImpl: () => { throw new Error('provider down'); }
    });
    const degraded = await downService.bindableAccounts(SUB, publicEnv);
    expect(degraded.map((account) => account.id)).toEqual(['acct-owner']);
    expect(await world.service.bindableAccounts('', publicEnv)).toEqual([]);
  });
});

describe('SR-2 dev class and interim behavior', () => {
  it('keeps the passphrase form on the dev class (no detour)', async () => {
    const devEnv = { ...publicEnv, VERCEL_ENV: 'preview' };
    const world = makeWorld(devEnv);
    await seedAccounts(world.db, devEnv);
    const res = response();
    await world.handlers.authorize(getReq({ ...clientParams }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Administrator passphrase');
    expect(res.headers.Location).toBeUndefined();
  });

  it('interim: while the sign-in client is unconfigured, the public class keeps the working passphrase path', async () => {
    const interimEnv = { ...baseEnv, VERCEL_ENV: 'production' };
    const world = makeWorld(interimEnv);
    await seedAccounts(world.db, interimEnv);
    const page = response();
    await world.handlers.authorize(getReq({ ...clientParams }), page);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Administrator passphrase');
    const post = response();
    await world.handlers.authorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: 'fixture-passphrase'
    }), post);
    expect(post.statusCode).toBe(302);
    const code = new URL(post.headers.Location).searchParams.get('code');
    const record = await world.db.consumeAuthCode(code);
    expect(record.vercel_account).toBe('acct-owner');
    expect(record.mode).toBe('production');
  });
});

