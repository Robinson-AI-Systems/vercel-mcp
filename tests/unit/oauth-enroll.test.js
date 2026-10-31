import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';
import { loadToken } from '../../src/vercel/tokens.js';

// AUD-AR — the enrollment branch of the sign-in flow (dossier §2.2):
// /api/oauth/enroll is a stateless branch of the OAuth surface gated
// by the same per-request passphrase proof as the authorize POST.
// The provider is the repo's fake (test/helpers/fake-vercel.js); all
// token values are fake-shaped fixtures, and every test sweeps the
// rendered pages and stored rows for them.

const baseEnv = {
  PUBLIC_BASE_URL: 'https://vercel-mcp.example.test',
  ADMIN_PASSPHRASE: 'test-passphrase-fixture',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  VERCEL_ENV: 'preview'
};
const resource = baseEnv.PUBLIC_BASE_URL + '/api/mcp';
const callback = 'https://client.example.test/callback';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

const teamToken = 'vcp_FAKEteamToken_12345678';
const rotatedToken = 'vcp_FAKErotatedToken_9999';
const blobToken = 'vercel_blob_rw_FAKEblobtoken_3456';

function request(method, data, headers = {}) {
  return {
    method, headers,
    body: method === 'GET' ? undefined : data,
    query: method === 'GET' ? data : undefined,
    socket: { remoteAddress: '198.51.100.1' }
  };
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
async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}
function provider({ multipleTeams = false } = {}) {
  const api = makeFakeVercel();
  api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
  api.when('GET', '/v2/teams').resolves({ teams: [
    { id: 'team_FAKE', slug: 'test-team', name: 'Fixture Team' },
    ...(multipleTeams ? [{ id: 'team_OTHER', slug: 'another' }] : [])
  ] });
  api.when('GET', '/v10/projects').resolves({ projects: [
    { id: 'prj_FAKE', name: 'fixture' }
  ], pagination: { next: null } });
  return api;
}
function createFixture({ multipleTeams = false } = {}) {
  const db = createFakeDb({ accounts: [] });
  const api = provider({ multipleTeams });
  const service = createVercelLoginService(db, { fetchImpl: api.fetch });
  const handlers = createOAuthHandlers({ db, env: baseEnv, service });
  return { db, api, handlers };
}
async function flowParams(handlers) {
  const res = await call(handlers.register, request('POST', {
    redirect_uris: [callback], client_name: 'Test client'
  }));
  expect(res.statusCode).toBe(201);
  const client = JSON.parse(res.body);
  return {
    client_id: client.client_id, redirect_uri: callback, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'state-fixture',
    resource
  };
}
const enrollTokenPost = (flow, extra = {}) => ({
  ...flow, kind: 'token', teamId: 'team_FAKE', token: teamToken,
  passphrase: baseEnv.ADMIN_PASSPHRASE, ...extra
});

describe('OAuth enrollment branch (AUD-AR)', () => {
  it('renders both enrollment forms, carries the flow, and names no setup surface', async () => {
    const { handlers } = createFixture();
    const flow = await flowParams(handlers);
    const page = await call(handlers.enroll, request('GET', flow));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="kind" value="token"');
    expect(page.body).toContain('name="teamId"');
    expect(page.body).toContain('name="projectId"');
    expect(page.body).toContain('name="allowFull"');
    expect(page.body).toContain('name="passphrase"');
    // The in-flight OAuth parameters ride along as hidden fields so
    // completing or abandoning returns to the same consent.
    expect(page.body).toContain('name="client_id" value="' + flow.client_id + '"');
    expect(page.body).toContain('name="code_challenge" value="' + challenge + '"');
    expect(page.body).toContain('href="/api/oauth/authorize?');
    // No account yet: the Blob form waits for the first enrollment.
    expect(page.body).toContain('Enroll a token first');
    // The consent body names no setup surface (the shared shell's
    // footer link is AUD-AV's removal, sequenced with the route
    // deletion — the assertion is scoped above the footer, as in
    // AUD-AZ's suite).
    expect(page.body.split('<footer>')[0]).not.toContain('/api/vercel/setup');
  });

  it('enrolls a team token: read-back stated, ciphertext only, nothing binds', async () => {
    const { db, api, handlers } = createFixture();
    const flow = await flowParams(handlers);
    const res = await call(handlers.enroll, request('POST', enrollTokenPost(flow)));
    expect(res.statusCode).toBe(200);
    // The scope read-back in plain words, from what was stored.
    expect(res.body).toContain('Connected test-team');
    expect(res.body).toContain('reach read back as one team');
    expect(res.body).toContain('token ending 5678, saved encrypted');
    expect(res.body).toContain('Declared box: One team. Probed box: One team.');
    expect(res.body).toContain('Nothing has been switched on');
    // The continue action returns to the SAME consent, with the new
    // account preselected — enrollment itself issued nothing.
    expect(res.body).toContain('/api/oauth/authorize?');
    expect(res.body).toContain('account=team_FAKE');
    expect(res.headers.Location).toBeUndefined();
    expect(res.body).not.toContain(teamToken);
    // The probe ran (identity, teams, projects) before the store,
    // and only ciphertext was persisted.
    expect(api.calls).toHaveLength(3);
    const accounts = await db.listVercelAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: 'team_FAKE', scope: 'team', token_last4: '5678' });
    expect(JSON.stringify(accounts)).not.toContain(teamToken);
    const loaded = await loadToken({ db, accountId: 'team_FAKE', env: baseEnv });
    expect(loaded.token).toBe(teamToken);
    // The enrolled account is now offered at consent — the bind
    // still happens only there.
    const consent = await call(handlers.authorize, request('GET', {
      ...flow, account: 'team_FAKE'
    }));
    expect(consent.statusCode).toBe(200);
    expect(consent.body).toContain('Fixture Team');
  });

  it('reads back Full Account scope for an owner-allowed broad token', async () => {
    const { db, handlers } = createFixture({ multipleTeams: true });
    const flow = await flowParams(handlers);
    const res = await call(handlers.enroll, request('POST',
      enrollTokenPost(flow, { allowFull: 'yes' })));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('reach read back as Full Account (account-wide)');
    const accounts = await db.listVercelAccounts();
    expect(accounts[0]).toMatchObject({ id: 'team_FAKE', scope: 'full' });
  });

  it('refuses broad visibility without the allowance, naming the leg, storing nothing', async () => {
    const { db, handlers } = createFixture({ multipleTeams: true });
    const flow = await flowParams(handlers);
    const res = await call(handlers.enroll, request('POST', enrollTokenPost(flow)));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Enrollment failed at the broad-visibility check');
    expect(await db.listVercelAccounts()).toHaveLength(0);
  });

  it('pins a project-scoped read-back', async () => {
    const { db, handlers } = createFixture();
    const flow = await flowParams(handlers);
    const res = await call(handlers.enroll, request('POST',
      enrollTokenPost(flow, { projectId: 'prj_FAKE' })));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('reach read back as one project (fixture)');
    const accounts = await db.listVercelAccounts();
    expect(accounts[0]).toMatchObject({ id: 'team_FAKE/prj_FAKE', scope: 'project' });
  });

  it('refuses a wrong passphrase before any probe, and stores nothing', async () => {
    const { db, api, handlers } = createFixture();
    const flow = await flowParams(handlers);
    const res = await call(handlers.enroll, request('POST',
      enrollTokenPost(flow, { passphrase: 'not-the-passphrase' })));
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Incorrect passphrase');
    expect(api.calls).toHaveLength(0);
    expect(await db.listVercelAccounts()).toHaveLength(0);
  });

  it('names the failed probe leg and stores nothing when the team is not visible', async () => {
    const { db, handlers } = createFixture();
    const flow = await flowParams(handlers);
    const res = await call(handlers.enroll, request('POST',
      enrollTokenPost(flow, { teamId: 'team_NOT_VISIBLE' })));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Enrollment failed at the teams check');
    expect(res.body).toContain('verified access');
    expect(res.body).not.toContain(teamToken);
    expect(await db.listVercelAccounts()).toHaveLength(0);
  });

  it('rotation: re-enrolling the same team replaces the stored token', async () => {
    const { db, handlers } = createFixture();
    const flow = await flowParams(handlers);
    await call(handlers.enroll, request('POST', enrollTokenPost(flow)));
    const first = (await db.listVercelAccounts())[0];
    const res = await call(handlers.enroll, request('POST',
      enrollTokenPost(flow, { token: rotatedToken })));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('token ending 9999, saved encrypted');
    const accounts = await db.listVercelAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].token_last4).toBe('9999');
    expect(accounts[0].token_version).not.toBe(first.token_version);
    const loaded = await loadToken({ db, accountId: 'team_FAKE', env: baseEnv });
    expect(loaded.token).toBe(rotatedToken);
  });

  it('connects a Blob store to an enrolled account; its token is never shown or listed', async () => {
    const { db, handlers } = createFixture();
    const flow = await flowParams(handlers);
    await call(handlers.enroll, request('POST', enrollTokenPost(flow)));
    const page = await call(handlers.enroll, request('GET', flow));
    expect(page.body).toContain('name="kind" value="blob"');
    expect(page.body).toContain('value="team_FAKE"');
    const res = await call(handlers.enroll, request('POST', {
      ...flow, kind: 'blob', account: 'team_FAKE', storeId: 'store_FAKE1',
      label: 'Fixture store', access: 'private', token: blobToken,
      passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Blob store store_FAKE1 connected as Fixture store');
    expect(res.body).toContain('will not be shown again');
    expect(res.body).not.toContain(blobToken);
    const stores = await db.listBlobStoreConnections();
    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({ account: 'team_FAKE', storeId: 'store_FAKE1',
      label: 'Fixture store', access: 'private', tokenLast4: '3456' });
    expect(JSON.stringify(stores)).not.toContain(blobToken);
    const ciphertext = await db.getBlobStoreConnectionCiphertext(
      { account: 'team_FAKE', storeId: 'store_FAKE1' });
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).not.toContain(blobToken);
  });

  it('refuses Blob enrollment for an unknown account or a non-Blob token', async () => {
    const { db, handlers } = createFixture();
    const flow = await flowParams(handlers);
    await call(handlers.enroll, request('POST', enrollTokenPost(flow)));
    const unknown = await call(handlers.enroll, request('POST', {
      ...flow, kind: 'blob', account: 'missing', storeId: 'store_FAKE1',
      label: 'Fixture store', access: 'public', token: blobToken,
      passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toContain('Choose a connected account.');
    const wrongKind = await call(handlers.enroll, request('POST', {
      ...flow, kind: 'blob', account: 'team_FAKE', storeId: 'store_FAKE1',
      label: 'Fixture store', access: 'public', token: teamToken,
      passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(wrongKind.statusCode).toBe(400);
    expect(wrongKind.body).toContain('does not look like a Blob read-write token');
    expect(await db.listBlobStoreConnections()).toHaveLength(0);
  });

  it('standalone mode: without flow parameters the read-back returns to the connection guide', async () => {
    const { handlers } = createFixture();
    const res = await call(handlers.enroll, request('POST', {
      kind: 'token', teamId: 'team_FAKE', token: teamToken,
      passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Connected test-team');
    expect(res.body).toContain('href="/api/vercel/connect"');
    expect(res.body).not.toContain('Continue to sign-in');
  });

  it('refuses an unknown enrollment kind', async () => {
    const { handlers } = createFixture();
    const flow = await flowParams(handlers);
    const res = await call(handlers.enroll, request('POST', {
      ...flow, kind: 'wat', passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Choose an enrollment to complete.');
  });
});
