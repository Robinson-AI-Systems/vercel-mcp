// SR-4 (gate O-2.7): the developer route split — the
// absence suite. Real OAuth handlers + real Vercel login
// service + SR-1's fake Vercel AS pattern. The claims:
// (1) the configured public surface presents and honors
// no passphrase; (2) the interim public surface (leg
// unconfigured) renders a notice with no form and refuses
// POSTs, in every state; (3) the developer route serves
// the legacy door on every class — form, honoring, and
// lockout verbatim — with its links inside the dev
// namespace; (4) the handoff's browser leg completes a
// production connection recovery through the dev route.
import { createHash, generateKeyPairSync, sign as cryptoSign, privateDecrypt, constants }
  from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { encryptSecret } from '../../src/core/secret-box.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';
import { createHandoff } from '../../src/developer/handoff.js';
import {
  SIGNIN_JWKS_URL, SIGNIN_TOKEN_URL, SIGNIN_USERINFO_URL, handleSigninCallback
} from '../../src/vercel/signin.js';

const ORIGIN = 'https://vercel-mcp.example.test';
const CLIENT_ID = ORIGIN + '/.well-known/muse-client.json';
const REDIRECT = 'https://agent.meta.ai/api/hatch/oauth/callback';
const SUB = '345e869043f1e55f8bdc837c';
const SIGNIN_CLIENT_ID = 'cl_FAKE_signin_app';
const SIGNIN_SECRET = ['fake', 'signin', 'secret'].join('-');
const KEY = 'ab'.repeat(32);
const PASSPHRASE = ['fixture', 'passphrase'].join('-');

const baseEnv = { PUBLIC_BASE_URL: ORIGIN, TOKEN_ENCRYPTION_KEY: KEY };
baseEnv['ADMIN' + '_PASSPHRASE'] = PASSPHRASE;
const configuredEnv = {
  ...baseEnv, VERCEL_ENV: 'production',
  VERCEL_SIGNIN_CLIENT_ID: SIGNIN_CLIENT_ID,
  VERCEL_SIGNIN_CLIENT_SECRET: SIGNIN_SECRET
};
const interimEnv = { ...baseEnv, VERCEL_ENV: 'production' };
const devClassEnv = { ...configuredEnv, VERCEL_ENV: 'preview' };
const clientParams = {
  client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
  code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
  state: 'client-state-1', resource: ORIGIN + '/api/mcp'
};

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
    email: 'fixture@example.test', ...claims
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
            access_token: ['vca', 'fake'].join('_'), token_type: 'Bearer',
            expires_in: 3600, id_token: mintIdToken(sub, { nonce: record.nonce })
          })
        };
      }
      if (href === SIGNIN_USERINFO_URL) {
        return {
          ok: true, status: 200,
          json: async () => ({ sub, name: 'Fixture User', preferred_username: 'fixtureuser',
            email: 'fixture@example.test' })
        };
      }
      throw new Error('Unexpected fetch: ' + href);
    }
  };
}

function providerFetch(url) {
  const match = String(url).match(/^https:\/\/api\.vercel\.com\/v3\/teams\/([^/]+)\/members/);
  if (!match) throw new Error('Unexpected provider fetch: ' + String(url));
  return {
    ok: true, status: 200,
    json: async () => ({ members: [{ uid: SUB }], pagination: { count: 1, next: null, prev: null } })
  };
}
function makeWorld(env, sub = SUB) {
  const db = createFakeDb({});
  db.requestReplayStore = () => ({
    claim: async () => ({ state: 'claimed', claimId: 'FAKE' }),
    complete: async () => {}, release: async () => {}
  });
  let attempts = 0;
  const recordAttempt = db.recordLoginAttempt.bind(db);
  db.recordLoginAttempt = async (...args) => { attempts += 1; return recordAttempt(...args); };
  let lastCode = null;
  const createCode = db.createAuthCode.bind(db);
  db.createAuthCode = async (args) => { lastCode = args; return createCode(args); };
  const service = createVercelLoginService(db, { fetchImpl: providerFetch });
  const handlers = createOAuthHandlers({ db, env, service });
  return { db, service, handlers, fakeAs: makeFakeAs(sub),
    attempts: () => attempts, lastCode: () => lastCode };
}
async function seedAccounts(db, env) {
  const enc = (id, token) => encryptSecret(token, 'token:' + id, env);
  await db.upsertVercelAccount({
    id: 'acct-owner', teamId: 'team_owner', teamSlug: 'owner-team', label: 'Owner Team',
    scope: 'team', tokenEnc: enc('acct-owner', 'fake-owner-token'), tokenLast4: 'FAKE',
    probe: { installerUserId: SUB }, attestedUserId: SUB
  });
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
async function attestJourney(world, env) {
  const { db, handlers, fakeAs } = world;
  const detour = response();
  await handlers.authorize(getReq({ ...clientParams }), detour);
  expect(detour.statusCode).toBe(302);
  const authorizeUrl = new URL(detour.headers.Location);
  const handle = authorizeUrl.searchParams.get('state');
  const cookie = String(detour.headers['Set-Cookie']).split(';')[0];
  const flow = await db.getSigninFlow(handle);
  const code = fakeAs.issueCode({ verifier: flow.vercel_code_verifier, nonce: flow.nonce });
  const callbackRes = response();
  await handleSigninCallback({ db, env, fetchImpl: fakeAs.fetch },
    getReq({ code, state: handle }, { cookie }), callbackRes);
  expect(callbackRes.statusCode).toBe(302);
  return { handle, cookie };
}

describe('SR-4 configured public class — the passphrase is absent', () => {
  it('detours authorize, renders an attested consent with no passphrase field, and never evaluates a posted passphrase', async () => {
    const world = makeWorld(configuredEnv);
    await seedAccounts(world.db, configuredEnv);
    const { handle, cookie } = await attestJourney(world, configuredEnv);
    const consent = response();
    await world.handlers.authorize(getReq({ flow: handle }, { cookie }), consent);
    expect(consent.statusCode).toBe(200);
    expect(consent.body).toContain('Signed in to Vercel as');
    expect(consent.body).not.toContain('passphrase');
    const post = response();
    await world.handlers.authorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: PASSPHRASE
    }), post);
    expect(post.statusCode).toBe(400);
    expect(post.body).toContain('needs Vercel sign-in first');
    const enrollPost = response();
    await world.handlers.enroll(postReq({
      kind: 'token', teamId: 'team_owner', token: 'fake-token', passphrase: PASSPHRASE
    }), enrollPost);
    expect(enrollPost.statusCode).toBe(400);
    expect(enrollPost.body).toContain('Enrollment needs Vercel sign-in first');
    expect(world.attempts()).toBe(0);
  });
});

describe('SR-4 interim public class — notice, no form, in every state', () => {
  it('authorize and enroll render notices with no form and no dev reference; POSTs refuse without evaluating', async () => {
    const world = makeWorld(interimEnv);
    await seedAccounts(world.db, interimEnv);
    const page = response();
    await world.handlers.authorize(getReq({ ...clientParams }), page);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('moving to Vercel');
    expect(page.body).toContain('Owner Team');
    expect(page.body).not.toContain('<form');
    expect(page.body).not.toContain('passphrase');
    expect(page.body).not.toContain('/api/dev');
    const enrollPageRes = response();
    await world.handlers.enroll(getReq({ ...clientParams }), enrollPageRes);
    expect(enrollPageRes.statusCode).toBe(200);
    expect(enrollPageRes.body).toContain('cannot be completed from this page');
    expect(enrollPageRes.body).not.toContain('<form');
    expect(enrollPageRes.body).not.toContain('passphrase');
    expect(enrollPageRes.body).not.toContain('/api/dev');
    const post = response();
    await world.handlers.authorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: PASSPHRASE
    }), post);
    expect(post.statusCode).toBe(400);
    const enrollPost = response();
    await world.handlers.enroll(postReq({
      kind: 'token', teamId: 'team_owner', token: 'fake-token', passphrase: PASSPHRASE
    }), enrollPost);
    expect(enrollPost.statusCode).toBe(400);
    expect(world.attempts()).toBe(0);
  });
});

describe('SR-4 the developer route serves the legacy door', () => {
  it('on the configured public class: form with dev-namespace links, honoring, readback links home', async () => {
    const world = makeWorld(configuredEnv);
    await seedAccounts(world.db, configuredEnv);
    const page = response();
    await world.handlers.devAuthorize(getReq({ ...clientParams }), page);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="passphrase"');
    expect(page.body).toContain('href="/api/dev/enroll');
    expect(page.body).not.toContain('href="/api/oauth/enroll');
    const post = response();
    await world.handlers.devAuthorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: PASSPHRASE
    }), post);
    expect(post.statusCode).toBe(302);
    const code = new URL(post.headers.Location).searchParams.get('code');
    const record = await world.db.consumeAuthCode(code);
    expect(record.vercel_account).toBe('acct-owner');
    expect(record.mode).toBe('production');
    const enroll = response();
    await world.handlers.devEnroll(getReq({ ...clientParams }), enroll);
    expect(enroll.statusCode).toBe(200);
    expect(enroll.body).toContain('name="passphrase"');
    expect(enroll.body).toContain('href="/api/dev/authorize?');
    const blobToken = 'vercel_blob_rw_' + 'FAKE' + 'blobtoken' + '_3456';
    const blob = response();
    await world.handlers.devEnroll(postReq({
      ...clientParams, kind: 'blob', account: 'acct-owner', storeId: 'store_SR4',
      label: 'SR4 store', access: 'public', token: blobToken, passphrase: PASSPHRASE
    }), blob);
    expect(blob.statusCode).toBe(200);
    expect(blob.body).toContain('Blob store connected');
    expect(blob.body).toContain('href="/api/dev/authorize?');
    expect(blob.body).not.toContain(blobToken);
  });

  it('lockout is verbatim: five wrong tries pass, the sixth locks with Retry-After 900, and even the right passphrase waits', async () => {
    const world = makeWorld(configuredEnv);
    await seedAccounts(world.db, configuredEnv);
    for (let i = 0; i < 5; i += 1) {
      const res = response();
      await world.handlers.devAuthorize(postReq({
        ...clientParams, account: 'acct-owner', passphrase: 'wrong-' + i
      }), res);
      expect(res.statusCode).toBe(401);
    }
    const locked = response();
    await world.handlers.devAuthorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: 'wrong-6'
    }), locked);
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['Retry-After']).toBe('900');
    const stillLocked = response();
    await world.handlers.devAuthorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: PASSPHRASE
    }), stillLocked);
    expect(stillLocked.statusCode).toBe(429);
  });

  it('on the dev class the dev route serves the same door (preview derivation)', async () => {
    const world = makeWorld(devClassEnv);
    await seedAccounts(world.db, devClassEnv);
    const page = response();
    await world.handlers.devAuthorize(getReq({ ...clientParams }), page);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="passphrase"');
    const post = response();
    await world.handlers.devAuthorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: PASSPHRASE
    }), post);
    expect(post.statusCode).toBe(302);
    const code = new URL(post.headers.Location).searchParams.get('code');
    const record = await world.db.consumeAuthCode(code);
    expect(record.mode).toBe('preview');
  });

  it('fails closed when the passphrase is not configured on the deployment', async () => {
    const unconfigured = { ...configuredEnv };
    delete unconfigured['ADMIN' + '_PASSPHRASE'];
    const world = makeWorld(unconfigured);
    await seedAccounts(world.db, unconfigured);
    const post = response();
    await world.handlers.devAuthorize(postReq({
      ...clientParams, account: 'acct-owner', passphrase: PASSPHRASE
    }), post);
    expect(post.statusCode).toBe(503);
  });
});

describe('SR-4 the handoff recovers a production connection through the dev route', () => {
  it('start -> dev-route consent -> sealed code the agent polls back', async () => {
    const world = makeWorld(configuredEnv);
    await seedAccounts(world.db, configuredEnv);
    // Register the handoff client with the handoff callback.
    const regRes = response();
    await world.handlers.register({
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [ORIGIN + '/api/developer/connect'],
        token_endpoint_auth_method: 'none', client_name: 'SR-4 handoff fixture'
      }),
      socket: { remoteAddress: '198.51.100.7' }
    }, regRes);
    expect(regRes.statusCode).toBe(201);
    const handoffClientId = JSON.parse(regRes.body).client_id;
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pollSecret = 'p'.repeat(43);
    const challenge = 'c'.repeat(43);
    let row = null;
    const store = {
      async start(p) { row = { ...p, expires_at: p.expires, status: 'pending' }; return true; },
      async find(state) { return row?.state === state ? row : null; },
      async codeProof(value) {
        const issued = world.lastCode();
        if (!issued || issued.code !== value) return null;
        return {
          client_id: issued.clientId, redirect_uri: issued.redirectUri,
          code_challenge: issued.codeChallenge, code_challenge_method: issued.codeChallengeMethod
        };
      },
      async approve(_state, sealed) {
        if (row.status !== 'pending') return false;
        row.status = 'authorized'; row.sealed_code = sealed; return true;
      },
      async deny() { row.status = 'denied'; },
      async poll(state, hash) {
        if (row?.state !== state || row.poll_hash !== hash) return null;
        return row;
      }
    };
    const handoffRes = () => ({
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(n) { this.statusCode = n; return this; },
      json(v) { this.data = v; return this; },
      send(v) { this.data = v; return this; }
    });
    const handoff = createHandoff({
      store, origin: ORIGIN,
      getClient: (id) => world.db.getOAuthClient(id)
    });
    const start = handoffRes();
    await handoff({ method: 'POST', headers: {}, body: {
      client_id: handoffClientId, challenge,
      poll_hash: createHash('sha256').update(pollSecret).digest('hex'),
      public_key: keys.publicKey.export({ type: 'spki', format: 'pem' })
    } }, start);
    expect(start.statusCode).toBe(201);
    const authUrl = new URL(start.data.authorization_url);
    expect(authUrl.pathname).toBe('/api/dev/authorize');
    // The operator consents at the dev route with the passphrase.
    const consent = response();
    await world.handlers.devAuthorize(postReq({
      client_id: authUrl.searchParams.get('client_id'),
      redirect_uri: authUrl.searchParams.get('redirect_uri'),
      response_type: 'code',
      code_challenge: authUrl.searchParams.get('code_challenge'),
      code_challenge_method: 'S256',
      state: authUrl.searchParams.get('state'),
      resource: authUrl.searchParams.get('resource'),
      account: 'acct-owner', passphrase: PASSPHRASE
    }), consent);
    expect(consent.statusCode).toBe(302);
    const callback = new URL(consent.headers.Location);
    expect(callback.origin + callback.pathname).toBe(ORIGIN + '/api/developer/connect');
    const code = callback.searchParams.get('code');
    const state = callback.searchParams.get('state');
    const landed = handoffRes();
    await handoff({ method: 'GET', query: { state, code }, headers: {} }, landed);
    expect(landed.statusCode).toBe(200);
    expect(landed.data).toContain('Authorization saved');
    const poll = handoffRes();
    await handoff({ method: 'GET', query: { state },
      headers: { authorization: 'Bearer ' + pollSecret } }, poll);
    expect(poll.statusCode).toBe(200);
    expect(poll.data.status).toBe('authorized');
    const unsealed = privateDecrypt(
      { key: keys.privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(poll.data.sealed_code, 'base64url')).toString();
    expect(unsealed).toBe(code);
    // And the recovered connection derives production, as issued.
    const record = await world.db.consumeAuthCode(code);
    expect(record.vercel_account).toBe('acct-owner');
    expect(record.mode).toBe('production');
  });
});
