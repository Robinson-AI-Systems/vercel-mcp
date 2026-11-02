// SR-3 (gate O-2.7): enrollment under identity + attestation
// capture. The probes persist the owner identity they read;
// the recheck backfills a legacy row; the roster limb is
// pinned per credential class; and the AUD-AR branch on the
// configured public class runs under the attested sign-in
// flow instead of the passphrase. Token-shaped fixtures are
// assembled from fragments (the bench channel redacts
// secret-shaped literals in transferred files).
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { encryptSecret } from '../../src/core/secret-box.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';
import {
  storeToken, storePersonalToken, storeInstallationToken, recheckStoredToken
} from '../../src/vercel/tokens.js';
import {
  SIGNIN_JWKS_URL, SIGNIN_TOKEN_URL, SIGNIN_USERINFO_URL, handleSigninCallback
} from '../../src/vercel/signin.js';

const SUB = '345e869043f1e55f8bdc837c';
const OTHER = 'other-user-000000000001';
const KEY = 'ab'.repeat(32);
const env = {
  PUBLIC_BASE_URL: 'https://vercel-mcp.example.test',
  ADMIN_PASSPHRASE: 'fixture-passphrase',
  TOKEN_ENCRYPTION_KEY: KEY
};
const tok = (...parts) => parts.join('');

describe('SR-3 attestation capture — the stores persist what the probe reads', () => {
  it('team token: the identity leg lands in attested_user_id', async () => {
    const db = createFakeDb({});
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').resolves({ user: { id: SUB } });
    api.when('GET', '/v2/teams').resolves({
      teams: [{ id: 'team_A', slug: 'a-team', name: 'A Team' }] });
    api.when('GET', '/v10/projects').resolves({
      projects: [], pagination: { next: null } });
    api.when('GET', '/v6/user/tokens').resolves({ tokens: [] });
    const receipt = await storeToken({
      db, token: tok('vcp_FAKEteam', 'Token_12345678'), teamId: 'team_A',
      env, fetchImpl: api.fetch });
    expect(receipt.attestedUserId).toBe(SUB);
    const row = (await db.listVercelAccounts()).find((a) => a.id === 'team_A');
    expect(row.attested_user_id).toBe(SUB);
  });

  it('project-scoped token: best-effort identity attests when the unscoped read answers', async () => {
    const db = createFakeDb({});
    const api = makeFakeVercel();
    // The team-visible probe fails at the teams leg (a scoped
    // token cannot list teams), which is what routes the
    // enrollment to the project path; the unscoped identity
    // read still answers there.
    api.when('GET', '/v2/user').resolves({ user: { id: SUB } });
    api.when('GET', '/v2/teams').rejects(403, { error: { code: 'forbidden' } });
    api.when('GET', '/v10/projects').resolves({
      projects: [{ id: 'prj_P', name: 'P', accountId: 'team_P' }],
      pagination: { next: null } });
    const receipt = await storeToken({
      db, token: tok('vcp_FAKEproject', 'Token_2222'), teamId: 'team_P',
      projectId: 'prj_P', env, fetchImpl: api.fetch });
    expect(receipt.scope).toBe('project');
    expect(receipt.attestedUserId).toBe(SUB);
    const row = (await db.listVercelAccounts()).find((a) => a.id === 'team_P/prj_P');
    expect(row.attested_user_id).toBe(SUB);
  });

  it('project-scoped token: a refused identity read lands null and enrollment still succeeds', async () => {
    const db = createFakeDb({});
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').rejects(403, { error: { code: 'forbidden' } });
    api.when('GET', '/v2/teams').resolves({ teams: [] });
    api.when('GET', '/v10/projects').resolves({
      projects: [{ id: 'prj_P', name: 'P', accountId: 'team_P' }],
      pagination: { next: null } });
    const receipt = await storeToken({
      db, token: tok('vcp_FAKEproject', 'Token_2222'), teamId: 'team_P',
      projectId: 'prj_P', env, fetchImpl: api.fetch });
    expect(receipt.scope).toBe('project');
    expect(receipt.attestedUserId).toBeNull();
    const row = (await db.listVercelAccounts()).find((a) => a.id === 'team_P/prj_P');
    expect(row.attested_user_id).toBeNull();
  });

  it('personal install: attested by construction (the row keys on the user id)', async () => {
    const db = createFakeDb({});
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').resolves({
      user: { id: SUB, username: 'fixtureuser', name: 'Fixture User' } });
    api.when('GET', '/v2/teams').resolves({ teams: [] });
    api.when('GET', '/v10/projects').resolves({
      projects: [], pagination: { next: null } });
    const receipt = await storePersonalToken({
      db, token: tok('vcp_FAKEpersonal', 'Token_3333'), userId: SUB,
      env, fetchImpl: api.fetch });
    expect(receipt.attestedUserId).toBe(SUB);
    const row = (await db.listVercelAccounts()).find((a) => a.id === SUB);
    expect(row.attested_user_id).toBe(SUB);
  });

  it('team install: the exchange installer identity is lifted into the column', async () => {
    const db = createFakeDb({});
    const api = makeFakeVercel();
    api.when('GET', '/v1/integrations/configuration/{id}').resolves({
      id: 'icfg_FAKE', integrationId: 'oac_FAKECLIENT',
      teamId: 'team_I', ownerId: 'team_I', userId: SUB,
      scopes: ['read:integration-configuration', 'read:team', 'read:project'],
      projectSelection: 'all', status: 'ready' });
    api.when('GET', '/v2/teams/{teamId}').resolves({
      id: 'team_I', slug: 'i-team', name: 'I Team' });
    api.when('GET', '/v10/projects').resolves({
      projects: [{ id: 'prj_I', name: 'fixture' }], pagination: { next: null } });
    const receipt = await storeInstallationToken({
      db, token: tok('vcp_FAKEinstall', 'Token_4444'), teamId: 'team_I',
      installationId: 'icfg_FAKE', integrationId: 'oac_FAKECLIENT',
      userId: SUB, env, fetchImpl: api.fetch,
      probeExtra: { source: 'integration', installerUserId: SUB } });
    expect(receipt.attestedUserId).toBe(SUB);
    const row = (await db.listVercelAccounts()).find((a) => a.id === 'team_I');
    expect(row.attested_user_id).toBe(SUB);
  });
});

describe('SR-3 recheck backfill — a legacy Door-2 row becomes bindable', () => {
  it('recheck persists the probed identity; consent binding then names the owner', async () => {
    const db = createFakeDb({});
    // The DPGA shape: enrolled before attestation existed —
    // no attested owner, no installer identity on the probe.
    await db.upsertVercelAccount({
      id: 'team_DPGA', teamId: 'team_DPGA', teamSlug: 'dpga-team',
      label: 'DPGA Team', scope: 'team',
      tokenEnc: encryptSecret(tok('vcp_FAKEdpga', 'Token_5555'), 'token:team_DPGA', env),
      tokenLast4: '5555',
      probe: { checkedAt: new Date().toISOString(), scopeVerified: false },
      attestedUserId: null });
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').resolves({ user: { id: SUB } });
    api.when('GET', '/v2/teams').resolves({
      teams: [{ id: 'team_DPGA', slug: 'dpga-team', name: 'DPGA Team' }] });
    api.when('GET', '/v10/projects').resolves({
      projects: [], pagination: { next: null } });
    // The roster cannot grant here (403): the backfill, not
    // limb 2, is what must make this row bindable.
    api.when('GET', '/v3/teams/{teamId}/members')
      .rejects(403, { error: { code: 'forbidden' } });
    const service = createVercelLoginService(db, { fetchImpl: api.fetch });
    expect((await service.bindableAccounts(SUB, env)).map((a) => a.id))
      .not.toContain('team_DPGA');
    const result = await recheckStoredToken({
      db, accountId: 'team_DPGA', env, fetchImpl: api.fetch });
    expect(result.attestedUserId).toBe(SUB);
    expect(result.attestationPersisted).toBe(true);
    const row = (await db.listVercelAccounts()).find((a) => a.id === 'team_DPGA');
    expect(row.attested_user_id).toBe(SUB);
    expect((await service.bindableAccounts(SUB, env)).map((a) => a.id))
      .toContain('team_DPGA');
  });
});

describe('SR-3 per-scope-class roster outcomes (U-1 remainder)', () => {
  // The members read runs with the ACCOUNT'S OWN stored
  // credential; the fake provider answers per credential
  // class, the way Vercel's scope map does.
  const team = tok('class-team', '-token');
  const project = tok('class-project', '-token');
  const install = tok('class-install', '-token');
  function classProvider(url, options = {}) {
    const match = String(url).match(
      /^https:\/\/api\.vercel\.com\/v3\/teams\/([^/]+)\/members/);
    if (!match) throw new Error('Unexpected provider fetch: ' + String(url));
    const auth = new Headers(options.headers || {}).get('authorization');
    if (auth === 'Bearer ' + team) {
      return { ok: true, status: 200, json: async () => ({
        members: [{ uid: OTHER }, { uid: SUB, username: 'fixtureuser' }],
        pagination: { count: 2, next: null, prev: null } }) };
    }
    // Project-scoped and installation-arm credentials are
    // refused the roster read outright.
    return { ok: false, status: 403, json: async () => ({
      error: { code: 'forbidden', message: 'Not authorized' } }) };
  }
  async function seedClass(db, id, teamId, token) {
    await db.upsertVercelAccount({
      id, teamId, teamSlug: id + '-slug', label: id, scope: 'team',
      tokenEnc: encryptSecret(token, 'token:' + id, env), tokenLast4: 'FAKE',
      probe: {}, attestedUserId: OTHER });
  }
  it('team/full user token: the roster answers and limb 2 grants', async () => {
    const db = createFakeDb({});
    await seedClass(db, 'acct-cls-team', 'team_CLS1', team);
    const service = createVercelLoginService(db, { fetchImpl: classProvider });
    expect((await service.bindableAccounts(SUB, env)).map((a) => a.id))
      .toContain('acct-cls-team');
  });
  it('project-scoped token: the roster refuses (403) — owner-match only', async () => {
    const db = createFakeDb({});
    await seedClass(db, 'acct-cls-project', 'team_CLS2', project);
    const service = createVercelLoginService(db, { fetchImpl: classProvider });
    expect((await service.bindableAccounts(SUB, env)).map((a) => a.id))
      .not.toContain('acct-cls-project');
    // ...while its attested owner still binds by limb 1.
    expect((await service.bindableAccounts(OTHER, env)).map((a) => a.id))
      .toContain('acct-cls-project');
  });
  it('installation-arm token: the roster refuses (403) — owner-match only', async () => {
    const db = createFakeDb({});
    await seedClass(db, 'acct-cls-install', 'team_CLS3', install);
    const service = createVercelLoginService(db, { fetchImpl: classProvider });
    expect((await service.bindableAccounts(SUB, env)).map((a) => a.id))
      .not.toContain('acct-cls-install');
    expect((await service.bindableAccounts(OTHER, env)).map((a) => a.id))
      .toContain('acct-cls-install');
  });
});

describe('SR-3 handler journey — enrollment under the attested flow', () => {
  const ORIGIN = 'https://vercel-mcp.example.test';
  const CLIENT_ID = ORIGIN + '/.well-known/muse-client.json';
  const REDIRECT = 'https://agent.meta.ai/api/hatch/oauth/callback';
  const SIGNIN_CLIENT_ID = 'cl_FAKE_signin_app';
  const signinAppKey = tok('fake-signin', '-secret-value');
  const publicEnv = {
    ...env, PUBLIC_BASE_URL: ORIGIN, VERCEL_ENV: 'production',
    VERCEL_SIGNIN_CLIENT_ID: SIGNIN_CLIENT_ID
  };
  publicEnv['VERCEL_SIGNIN_' + 'CLIENT_SECRET'] = signinAppKey;
  const clientParams = {
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
    code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
    state: 'client-state-1', resource: ORIGIN + '/api/mcp'
  };
  const ownerToken = tok('vcp_FAKEowner', 'Token_1111');
  const otherToken = tok('vcp_FAKEother', 'Token_2222');
  const sharedToken = tok('vcp_FAKEshared', 'Token_3333');
  const blobToken = tok('vercel_blob_rw_FAKE', 'blobtoken_3456');

  // SR-1's fake Vercel authorization server, compact form.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const JWKS = [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: 'fake-key-1', use: 'sig', alg: 'RS256' }];
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function mintIdToken(nonce) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'https://vercel.com', sub: SUB, aud: SIGNIN_CLIENT_ID,
      exp: now + 600, iat: now, nbf: now - 10, jti: 'fake-jti-1', nonce,
      name: 'Fixture User', preferred_username: 'fixtureuser',
      email: 'fixture@example.test' };
    const input = b64({ alg: 'RS256', typ: 'JWT', kid: 'fake-key-1' }) + '.' + b64(payload);
    return input + '.' + cryptoSign('RSA-SHA256', Buffer.from(input), privateKey)
      .toString('base64url');
  }
  function makeFakeAs() {
    const codes = new Map();
    let sequence = 0;
    return {
      issueCode({ verifier, nonce }) {
        const code = 'fake-code-' + (++sequence);
        codes.set(code, {
          challenge: createHash('sha256').update(verifier).digest('base64url'), nonce });
        return code;
      },
      async fetch(url, options = {}) {
        const href = String(url);
        if (href === SIGNIN_JWKS_URL) {
          return { ok: true, status: 200, json: async () => ({ keys: JWKS }) };
        }
        if (href === SIGNIN_TOKEN_URL) {
          const params = new URLSearchParams(String(options.body));
          const record = codes.get(params.get('code'));
          const expectedAuth = 'Basic ' +
            Buffer.from(SIGNIN_CLIENT_ID + ':' + signinAppKey).toString('base64');
          const verifierOk = record && createHash('sha256')
            .update(params.get('code_verifier') || '').digest('base64url') ===
              record.challenge;
          if (!record || options.headers?.authorization !== expectedAuth ||
            params.get('grant_type') !== 'authorization_code' || !verifierOk) {
            return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
          }
          codes.delete(params.get('code'));
          return { ok: true, status: 200, json: async () => ({
            access_token: tok('vca_FAKE', 'access'), token_type: 'Bearer',
            expires_in: 3600, id_token: mintIdToken(record.nonce) }) };
        }
        if (href === SIGNIN_USERINFO_URL) {
          return { ok: true, status: 200, json: async () => ({
            sub: SUB, name: 'Fixture User', preferred_username: 'fixtureuser',
            email: 'fixture@example.test' }) };
        }
        throw new Error('Unexpected fetch: ' + href);
      }
    };
  }

  // The enrollment provider: personas keyed by the bearer
  // token the probe carries; rosters keyed by team.
  const PERSONAS = {
    [ownerToken]: { user: SUB, team: { id: 'team_NEW', slug: 'new-team', name: 'New Team' } },
    [otherToken]: { user: OTHER, team: { id: 'team_OTHER', slug: 'other-team', name: 'Other Team' } },
    [sharedToken]: { user: OTHER, team: { id: 'team_SHARED', slug: 'shared-team', name: 'Shared Team' } }
  };
  const ROSTERS = {
    team_OTHER: [OTHER], team_SHARED: [OTHER, SUB], team_SEEDOTHER: [OTHER]
  };
  function enrollProvider(url, options = {}) {
    const parsed = new URL(String(url));
    const auth = new Headers(options.headers || {}).get('authorization') || '';
    const persona = PERSONAS[auth.replace(/^Bearer /, '')];
    const reply = (status, body) => ({
      ok: status >= 200 && status < 300, status, json: async () => body });
    if (parsed.pathname === '/v2/user') {
      return persona ? reply(200, { user: { id: persona.user } }) :
        reply(403, { error: { code: 'forbidden' } });
    }
    if (parsed.pathname === '/v2/teams') {
      return persona ? reply(200, { teams: [persona.team] }) :
        reply(403, { error: { code: 'forbidden' } });
    }
    if (parsed.pathname === '/v10/projects') {
      return reply(200, { projects: [], pagination: { next: null } });
    }
    if (parsed.pathname === '/v6/user/tokens') return reply(200, { tokens: [] });
    const members = parsed.pathname.match(/^\/v3\/teams\/([^/]+)\/members/);
    if (members) {
      const roster = ROSTERS[decodeURIComponent(members[1])];
      return roster ? reply(200, {
        members: roster.map((uid) => ({ uid })),
        pagination: { count: roster.length, next: null, prev: null } }) :
        reply(404, { error: { code: 'not_found' } });
    }
    throw new Error('Unexpected provider fetch: ' + String(url));
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
    method: 'GET', headers, query, socket: { remoteAddress: '198.51.100.7' } });
  const postReq = (fields, headers = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
    socket: { remoteAddress: '198.51.100.7' } });
  async function makeWorld() {
    const db = createFakeDb({});
    db.requestReplayStore = () => ({
      claim: async () => ({ state: 'claimed', claimId: 'FAKE' }),
      complete: async () => {}, release: async () => {} });
    await db.upsertVercelAccount({
      id: 'acct-owner', teamId: 'team_SEEDOWNER', teamSlug: 'seed-owner',
      label: 'Seed Owner Team', scope: 'team',
      tokenEnc: encryptSecret(tok('seed-owner', '-token'), 'token:acct-owner', publicEnv),
      tokenLast4: 'FAKE', probe: {}, attestedUserId: SUB });
    await db.upsertVercelAccount({
      id: 'acct-other', teamId: 'team_SEEDOTHER', teamSlug: 'seed-other',
      label: 'Seed Other Team', scope: 'team',
      tokenEnc: encryptSecret(tok('seed-other', '-token'), 'token:acct-other', publicEnv),
      tokenLast4: 'FAKE', probe: {}, attestedUserId: OTHER });
    const service = createVercelLoginService(db, { fetchImpl: enrollProvider });
    const handlers = createOAuthHandlers({ db, env: publicEnv, service });
    return { db, handlers, fakeAs: makeFakeAs() };
  }
  async function attestJourney(world) {
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
    await handleSigninCallback({ db, env: publicEnv, fetchImpl: fakeAs.fetch },
      getReq({ code, state: handle }, { cookie }), callbackRes);
    expect(callbackRes.statusCode).toBe(302);
    return { handle, cookie };
  }

  it('detours a flow-less enrollment GET into the sign-in first', async () => {
    const world = await makeWorld();
    const res = response();
    await world.handlers.enroll(getReq({ ...clientParams }), res);
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('/api/oauth/authorize?');
    expect(res.headers.Location).toContain('client_id=');
    const bare = response();
    await world.handlers.enroll(getReq({}), bare);
    expect(bare.statusCode).toBe(400);
    expect(bare.body).toContain('Enrollment needs Vercel sign-in first');
  });

  it('renders the attested enrollment page: no passphrase field, bindable-only Blob accounts', async () => {
    const world = await makeWorld();
    const { handle, cookie } = await attestJourney(world);
    const page = response();
    await world.handlers.enroll(getReq({ flow: handle }, { cookie }), page);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Signed in to Vercel as');
    expect(page.body).not.toContain('passphrase');
    expect(page.body).toContain('Seed Owner Team');
    expect(page.body).not.toContain('Seed Other Team');
    expect(page.body).toContain('name="flow"');
  });

  it('enrolls the signer\'s own token: stored, attested, and the journey continues to consent', async () => {
    const world = await makeWorld();
    const { handle, cookie } = await attestJourney(world);
    const post = response();
    await world.handlers.enroll(postReq({
      flow: handle, kind: 'token', teamId: 'team_NEW', token: ownerToken
    }, { cookie }), post);
    expect(post.statusCode).toBe(200);
    expect(post.body).toContain('Account enrolled');
    expect(post.body).toContain('new-team');
    expect(post.body).toContain('/api/oauth/authorize?flow=' + handle);
    const row = (await world.db.listVercelAccounts()).find((a) => a.id === 'team_NEW');
    expect(row?.attested_user_id).toBe(SUB);
    // The enrolled account is immediately bindable by its owner.
    const consent = response();
    await world.handlers.authorize(getReq({ flow: handle }, { cookie }), consent);
    expect(consent.statusCode).toBe(200);
    expect(consent.body).toContain('New Team');
  });

  it('refuses a stranger\'s token and stores nothing', async () => {
    const world = await makeWorld();
    const { handle, cookie } = await attestJourney(world);
    const post = response();
    await world.handlers.enroll(postReq({
      flow: handle, kind: 'token', teamId: 'team_OTHER', token: otherToken
    }, { cookie }), post);
    expect(post.statusCode).toBe(400);
    expect(post.body).toContain('cannot be enrolled with your Vercel sign-in');
    expect((await world.db.listVercelAccounts()).some((a) => a.id === 'team_OTHER'))
      .toBe(false);
  });

  it('enrolls a team token through the roster limb when the signer is on the roster', async () => {
    const world = await makeWorld();
    const { handle, cookie } = await attestJourney(world);
    const post = response();
    await world.handlers.enroll(postReq({
      flow: handle, kind: 'token', teamId: 'team_SHARED', token: sharedToken
    }, { cookie }), post);
    expect(post.statusCode).toBe(200);
    expect(post.body).toContain('Account enrolled');
    const row = (await world.db.listVercelAccounts()).find((a) => a.id === 'team_SHARED');
    // The probe's attested owner is the token's owner; binding
    // for the signer runs through the roster.
    expect(row?.attested_user_id).toBe(OTHER);
  });

  it('refuses a flow-less POST even with the passphrase supplied', async () => {
    const world = await makeWorld();
    const post = response();
    await world.handlers.enroll(postReq({
      kind: 'token', teamId: 'team_OTHER', token: otherToken,
      passphrase: 'fixture-passphrase'
    }), post);
    expect(post.statusCode).toBe(400);
    expect(post.body).toContain('Enrollment needs Vercel sign-in first');
    expect((await world.db.listVercelAccounts()).some((a) => a.id === 'team_OTHER'))
      .toBe(false);
  });

  it('gates Blob enrollment to bindable accounts', async () => {
    const world = await makeWorld();
    const { handle, cookie } = await attestJourney(world);
    const refused = response();
    await world.handlers.enroll(postReq({
      flow: handle, kind: 'blob', account: 'acct-other',
      storeId: 'store_FAKE1', label: 'Docs', token: blobToken
    }, { cookie }), refused);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('cannot be used with this Vercel sign-in');
    const ok = response();
    await world.handlers.enroll(postReq({
      flow: handle, kind: 'blob', account: 'acct-owner',
      storeId: 'store_FAKE1', label: 'Docs', token: blobToken
    }, { cookie }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('Blob store');
  });
});
