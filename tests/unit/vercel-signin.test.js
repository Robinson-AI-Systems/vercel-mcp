// SR-1 (gate O-2.7): the Sign in with Vercel leg against a fake
// Vercel authorization server built from the documented shapes
// (dossier section 3.1): RS256 ID Tokens from a real RSA key
// published as JWKS, the token endpoint enforcing PKCE and
// client_secret_basic, userinfo behind the access token. The
// negative controls assert the SPECIFIC refusal, never merely
// that an error came back.
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { hashToken, randomToken } from '../../src/core/oauth.js';
import {
  SIGNIN_JWKS_URL, SIGNIN_TOKEN_URL, SIGNIN_USERINFO_URL,
  buildSigninAuthorizeUrl, createSigninPkce, exchangeSigninCode,
  fetchSigninJwks, fetchSigninUserinfo, handleSigninCallback,
  signinConfig, verifySigninIdToken
} from '../../src/vercel/signin.js';

const CLIENT_ID = 'cl_FAKE_signin_app';
const CLIENT_SECRET = 'fake-signin-secret-fixture';
const SUB = '345e869043f1e55f8bdc837c';
const env = {
  PUBLIC_BASE_URL: 'https://vercel-mcp.example.test',
  VERCEL_SIGNIN_CLIENT_ID: CLIENT_ID,
  VERCEL_SIGNIN_CLIENT_SECRET: CLIENT_SECRET
};
const config = signinConfig(env);

function makeKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwks: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid, use: 'sig', alg: 'RS256' }] };
}
const mainKey = makeKey('fake-key-1');
const otherKey = makeKey('fake-key-2');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function mintIdToken(claims = {}, { key = mainKey, kid = key.kid } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://vercel.com', sub: SUB, aud: CLIENT_ID,
    exp: now + 600, iat: now, nbf: now - 10, jti: 'fake-jti-1',
    nonce: 'nonce-fixture', name: 'Fixture User',
    preferred_username: 'fixtureuser', email: 'fixture@example.test',
    picture: 'https://example.test/pic.png', ...claims
  };
  const input = b64({ alg: 'RS256', typ: 'JWT', kid }) + '.' + b64(payload);
  const signature = cryptoSign('RSA-SHA256', Buffer.from(input), key.privateKey).toString('base64url');
  return input + '.' + signature;
}

function makeFakeAs({ idToken = null, userinfoSub = SUB } = {}) {
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
          Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
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
            access_token: 'vca_FAKE_access_token', token_type: 'Bearer',
            expires_in: 3600, id_token: idToken ?? mintIdToken({ nonce: record.nonce })
          })
        };
      }
      if (href === SIGNIN_USERINFO_URL) {
        if (options.headers?.authorization !== 'Bearer vca_FAKE_access_token') {
          return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) };
        }
        return {
          ok: true, status: 200,
          json: async () => ({
            sub: userinfoSub, name: 'Fixture User',
            preferred_username: 'fixtureuser', email: 'fixture@example.test',
            picture: 'https://example.test/pic.png'
          })
        };
      }
      throw new Error('Unexpected fetch: ' + href);
    }
  };
}

describe('SR-1 sign-in client', () => {
  it('derives the config from env and the one public origin; absent env means unconfigured', () => {
    expect(config.clientId).toBe(CLIENT_ID);
    expect(config.redirectUri).toBe('https://vercel-mcp.example.test/api/oauth/vercel/callback');
    expect(signinConfig({ PUBLIC_BASE_URL: env.PUBLIC_BASE_URL })).toBeNull();
    expect(signinConfig({ ...env, VERCEL_SIGNIN_CLIENT_SECRET: '' })).toBeNull();
  });

  it('builds the authorize URL to the documented shape - identity scopes only, never offline_access', () => {
    const url = new URL(buildSigninAuthorizeUrl({
      config, state: 'flow-handle-1', nonce: 'nonce-1', codeChallenge: 'c'.repeat(43)
    }));
    expect(url.origin + url.pathname).toBe('https://vercel.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe('flow-handle-1');
    expect(url.searchParams.get('nonce')).toBe('nonce-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.toString()).not.toContain('offline_access');
  });

  it('creates a PKCE pair whose challenge is the verifier SHA-256', () => {
    const { verifier, challenge } = createSigninPkce();
    expect(verifier).toHaveLength(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('exchanges a code and verifies the ID Token end to end against the fake AS', async () => {
    const fakeAs = makeFakeAs();
    const { verifier } = createSigninPkce();
    const code = fakeAs.issueCode({ verifier, nonce: 'nonce-1' });
    const exchanged = await exchangeSigninCode({
      config, code, codeVerifier: verifier, fetchImpl: fakeAs.fetch
    });
    expect(exchanged.accessToken).toBe('vca_FAKE_access_token');
    const jwks = await fetchSigninJwks({ fetchImpl: fakeAs.fetch });
    const claims = verifySigninIdToken({
      idToken: exchanged.idToken, jwks, clientId: CLIENT_ID, nonce: 'nonce-1'
    });
    expect(claims.sub).toBe(SUB);
    const userinfo = await fetchSigninUserinfo({
      accessToken: exchanged.accessToken, fetchImpl: fakeAs.fetch
    });
    expect(userinfo.sub).toBe(claims.sub);
  });

  it('refuses the exchange when the verifier or the client secret is wrong', async () => {
    const fakeAs = makeFakeAs();
    const { verifier } = createSigninPkce();
    const code = fakeAs.issueCode({ verifier, nonce: 'nonce-1' });
    await expect(exchangeSigninCode({
      config, code, codeVerifier: 'x'.repeat(43), fetchImpl: fakeAs.fetch
    })).rejects.toMatchObject({ name: 'SigninError', code: 'exchange_refused' });
    const code2 = fakeAs.issueCode({ verifier, nonce: 'nonce-1' });
    await expect(exchangeSigninCode({
      config: { ...config, clientSecret: 'wrong-secret' },
      code: code2, codeVerifier: verifier, fetchImpl: fakeAs.fetch
    })).rejects.toMatchObject({ code: 'exchange_refused' });
  });

  it('verifies nothing on a wrong audience, a bad nonce, an expired token, a bad signature, an unknown key or a wrong issuer', () => {
    const jwks = mainKey.jwks;
    const base = { jwks, clientId: CLIENT_ID, nonce: 'nonce-fixture' };
    expect(() => verifySigninIdToken({ ...base, idToken: mintIdToken({ aud: 'cl_OTHER_APP' }) }))
      .toThrowError(expect.objectContaining({ code: 'id_token_invalid' }));
    expect(() => verifySigninIdToken({ ...base, idToken: mintIdToken({ nonce: 'other-nonce' }) }))
      .toThrowError(/does not match this sign-in/);
    expect(() => verifySigninIdToken({
      ...base, idToken: mintIdToken({ exp: Math.floor(Date.now() / 1000) - 60 })
    })).toThrowError(/has expired/);
    expect(() => verifySigninIdToken({
      ...base, idToken: mintIdToken({}, { key: otherKey, kid: mainKey.kid })
    })).toThrowError(/failed signature verification/);
    expect(() => verifySigninIdToken({
      ...base, idToken: mintIdToken({}, { kid: 'no-such-key' })
    })).toThrowError(/unknown key/);
    expect(() => verifySigninIdToken({ ...base, idToken: mintIdToken({ iss: 'https://evil.example' }) }))
      .toThrowError(/wrong issuer/);
    expect(() => verifySigninIdToken({ ...base, idToken: 'not-a-jwt' }))
      .toThrowError(/malformed/);
  });
});

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
const request = (query, headers = {}) => ({
  method: 'GET', headers, query, socket: { remoteAddress: '198.51.100.1' }
});
async function callCallback(deps, query, headers) {
  const res = response();
  await handleSigninCallback(deps, request(query, headers), res);
  return res;
}
async function seedFlow(db, overrides = {}) {
  const handle = randomToken(24);
  const pkce = createSigninPkce();
  await db.createSigninFlow({
    handle,
    clientId: 'https://vercel-mcp.example.test/.well-known/muse-client.json',
    redirectUri: 'https://client.example.test/callback',
    codeChallenge: 'c'.repeat(43), clientState: 'client-state-1',
    resource: 'https://vercel-mcp.example.test/api/mcp',
    vercelCodeVerifier: pkce.verifier, nonce: 'nonce-fixture', ...overrides
  });
  return { handle, pkce };
}

describe('SR-1 sign-in callback handler', () => {
  it('completes the leg: attests the flow, stores display claims only, and mints nothing', async () => {
    const db = createFakeDb({});
    const fakeAs = makeFakeAs();
    const { handle, pkce } = await seedFlow(db);
    const code = fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' });
    const res = await callCallback({ db, env, fetchImpl: fakeAs.fetch }, { code, state: handle });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Vercel sign-in verified');
    expect(res.body).toContain('fixtureuser');
    const flow = await db.getSigninFlow(handle);
    expect(flow.attested_user_id).toBe(SUB);
    expect(flow.vercel_state_consumed_at).not.toBeNull();
    expect(flow.consumed_at).toBeNull();
    expect(flow.attested_claims).toEqual({
      name: 'Fixture User', username: 'fixtureuser',
      email: 'fixture@example.test', picture: 'https://example.test/pic.png'
    });
    // No SiwV token is stored anywhere on the record.
    expect(JSON.stringify(flow)).not.toContain('vca_FAKE');
    expect(JSON.stringify(flow)).not.toContain('id_token');
  });

  it('refuses a replayed state: the same callback a second time finds the leg consumed', async () => {
    const db = createFakeDb({});
    const fakeAs = makeFakeAs();
    const { handle, pkce } = await seedFlow(db);
    const first = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' }), state: handle });
    expect(first.statusCode).toBe(200);
    const replay = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' }), state: handle });
    expect(replay.statusCode).toBe(400);
    expect(replay.body).toContain('already used');
  });

  it('refuses the callback once the flow itself is consumed (the SR-2 consent consume)', async () => {
    const db = createFakeDb({});
    const fakeAs = makeFakeAs();
    const { handle, pkce } = await seedFlow(db);
    const ok = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' }), state: handle });
    expect(ok.statusCode).toBe(200);
    const consumed = await db.consumeSigninFlow({ handle, chosenAccount: 'team_FAKE' });
    expect(consumed?.attested_user_id).toBe(SUB);
    // A second consent consume is refused by the store itself.
    expect(await db.consumeSigninFlow({ handle, chosenAccount: 'team_FAKE' })).toBeNull();
    const after = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' }), state: handle });
    expect(after.statusCode).toBe(400);
    expect(after.body).toContain('already used');
  });
});

describe('SR-1 sign-in callback refusals', () => {
  it('refuses an unknown state and an expired flow with their specific pages', async () => {
    let now = Date.now();
    const db = createFakeDb({ clock: () => now });
    const fakeAs = makeFakeAs();
    const unknown = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: 'fake-code-1', state: 'no-such-flow' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toContain('not recognized');
    const { handle, pkce } = await seedFlow(db);
    now += 601_000;
    // The handler reads the wall clock while the fake store reads
    // its injected clock; advance both so the expiry is real in
    // both domains, exactly as a lapsed TIMESTAMPTZ would be.
    vi.setSystemTime(now);
    const expired = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' }), state: handle });
    expect(expired.statusCode).toBe(400);
    expect(expired.body).toContain('has expired');
    // The store-level attest guard agrees: an expired flow cannot attest.
    expect(await db.attestSigninFlow({ handle, userId: SUB })).toBe(false);
    vi.useRealTimers();
  });

  it("renders Vercel's own refusal (access_denied) as a named refusal, not a raw error", async () => {
    const db = createFakeDb({});
    const res = await callCallback({ db, env, fetchImpl: makeFakeAs().fetch },
      { error: 'access_denied', state: 'whatever' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('cancelled or refused (access_denied)');
  });

  it('refuses honestly when the App is not configured (the leg ships dark)', async () => {
    const db = createFakeDb({});
    const fakeAs = makeFakeAs();
    const { handle, pkce } = await seedFlow(db);
    const res = await callCallback(
      { db, env: { PUBLIC_BASE_URL: env.PUBLIC_BASE_URL }, fetchImpl: fakeAs.fetch },
      { code: fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' }), state: handle });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('not configured on this server yet');
  });

  it('refuses when the ID Token fails verification at the door: wrong audience, bad nonce, expiry, userinfo mismatch', async () => {
    const cases = [
      { as: makeFakeAs({ idToken: mintIdToken({ aud: 'cl_OTHER_APP' }) }), text: 'different app' },
      { as: makeFakeAs({ idToken: mintIdToken({ nonce: 'someone-elses-nonce' }) }), text: 'does not match this sign-in' },
      { as: makeFakeAs({ idToken: mintIdToken({ exp: Math.floor(Date.now() / 1000) - 30 }) }), text: 'has expired' },
      { as: makeFakeAs({ userinfoSub: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), text: 'inconsistent' }
    ];
    for (const { as, text } of cases) {
      const db = createFakeDb({});
      const { handle, pkce } = await seedFlow(db);
      const res = await callCallback({ db, env, fetchImpl: as.fetch },
        { code: as.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' }), state: handle });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('could not be verified');
      expect(res.body).toContain(text);
      // A refused consent attests nothing.
      expect((await db.getSigninFlow(handle)).attested_user_id).toBeNull();
    }
  });

  it('enforces the browser binding when the flow carries one', async () => {
    const db = createFakeDb({});
    const fakeAs = makeFakeAs();
    const { handle, pkce } = await seedFlow(db, {
      browserBindingHash: hashToken('binding-secret-fixture')
    });
    const code = () => fakeAs.issueCode({ verifier: pkce.verifier, nonce: 'nonce-fixture' });
    const noCookie = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: code(), state: handle });
    expect(noCookie.statusCode).toBe(400);
    expect(noCookie.body).toContain('different browser');
    const wrongCookie = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: code(), state: handle }, { cookie: 'rmcp_signin_binding=wrong-value' });
    expect(wrongCookie.statusCode).toBe(400);
    const bound = await callCallback({ db, env, fetchImpl: fakeAs.fetch },
      { code: code(), state: handle }, { cookie: 'rmcp_signin_binding=binding-secret-fixture' });
    expect(bound.statusCode).toBe(200);
  });

  it('accepts only GET', async () => {
    const db = createFakeDb({});
    const res = response();
    await handleSigninCallback({ db, env, fetchImpl: makeFakeAs().fetch },
      { method: 'POST', headers: {}, body: {}, socket: { remoteAddress: '198.51.100.1' } }, res);
    expect(res.statusCode).toBe(405);
  });
});
