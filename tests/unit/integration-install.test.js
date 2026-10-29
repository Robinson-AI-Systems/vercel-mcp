import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { exchangeInstallCode, enrollInstallation,
  handleIntegrationCallback } from '../../src/vercel/integration.js';

// AUD-I S1 — the Integrations connect tier (Door 1). Every fake below
// models the DOCUMENTED exchange contract (Vercel docs,
// /docs/integrations/create-integration/vercel-api-integrations,
// updated 2026-09-16, read 2026-10-28): POST /v2/oauth/access_token,
// form fields client_id / client_secret / code / redirect_uri, and the
// response { token_type: "Bearer", access_token, installation_id:
// "icfg_…", user_id, team_id: null | "team_…" } — team_id null exactly
// for a personal-account install.

const INSTALL_TOKEN = 'vcp_FAKEinstallToken_12345678';
const env = {
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  VERCEL_INTEGRATION_CLIENT_ID: 'oac_FAKECLIENT',
  VERCEL_INTEGRATION_CLIENT_SECRET: 'FAKEsecret',
  VERCEL_INTEGRATION_REDIRECT_URI: 'https://example.invalid/api/vercel/integration'
};

function fixture({ teamId = 'team_FAKE' } = {}) {
  const api = makeFakeVercel();
  api.when('POST', '/v2/oauth/access_token').resolves({
    token_type: 'Bearer', access_token: INSTALL_TOKEN,
    installation_id: 'icfg_FAKE', user_id: 'user_FAKE', team_id: teamId
  });
  api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
  api.when('GET', '/v2/teams').resolves({
    teams: [{ id: 'team_FAKE', slug: 'test-team', name: 'Fixture Team' }]
  });
  api.when('GET', '/v10/projects').resolves({
    projects: [{ id: 'prj_FAKE', name: 'fixture' }], pagination: { next: null }
  });
  return api;
}

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async upsertVercelAccount(row) {
      rows.set(row.id, { ...row, token_enc: row.tokenEnc,
        token_expires_at: row.expiresAt,
        team_id: row.teamId, project_id: row.projectId });
    },
    async getAccountCredential(id) {
      const row = rows.get(id);
      return row ? { id, team_id: row.team_id, scope: row.scope,
        project_id: row.project_id, token_enc: row.token_enc,
        token_expires_at: row.token_expires_at } : null;
    }
  };
}

describe('AUD-I S1: install code exchange', () => {
  it('sends the documented form exchange and returns the validated identity', async () => {
    const api = fixture();
    const exchange = await exchangeInstallCode({ code: 'FAKEcode123', env, fetchImpl: api.fetch });
    expect(exchange).toEqual({ accessToken: INSTALL_TOKEN, installationId: 'icfg_FAKE',
      userId: 'user_FAKE', teamId: 'team_FAKE' });
    const call = api.calls.find(c => c.path === '/v2/oauth/access_token');
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toContain('application/x-www-form-urlencoded');
    const form = new URLSearchParams(call.body);
    expect(form.get('client_id')).toBe('oac_FAKECLIENT');
    expect(form.get('client_secret')).toBe('FAKEsecret');
    expect(form.get('code')).toBe('FAKEcode123');
    expect(form.get('redirect_uri')).toBe(env.VERCEL_INTEGRATION_REDIRECT_URI);
  });

  it('refuses when the integration is not configured, and never calls out', async () => {
    const api = fixture();
    await expect(exchangeInstallCode({ code: 'x', env: {}, fetchImpl: api.fetch }))
      .rejects.toMatchObject({ code: 'integration_not_configured' });
    expect(api.calls).toHaveLength(0);
  });

  it('classifies a refused exchange and a malformed answer distinctly', async () => {
    const refused = makeFakeVercel();
    refused.when('POST', '/v2/oauth/access_token').rejects(400);
    await expect(exchangeInstallCode({ code: 'spent', env, fetchImpl: refused.fetch }))
      .rejects.toMatchObject({ code: 'exchange_refused' });
    const malformed = makeFakeVercel();
    malformed.when('POST', '/v2/oauth/access_token').resolves({ token_type: 'Bearer' });
    await expect(exchangeInstallCode({ code: 'ok', env, fetchImpl: malformed.fetch }))
      .rejects.toMatchObject({ code: 'exchange_malformed' });
  });
});

describe('AUD-I S1: installation enrollment', () => {
  it('enrolls a team install through the probe/store path with its identity recorded', async () => {
    const api = fixture(), db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(result.account.id).toBe('team_FAKE');
    expect(result.account.scope).toBe('team');
    const row = db.rows.get('team_FAKE');
    expect(row.probe.source).toBe('integration');
    expect(row.probe.installationId).toBe('icfg_FAKE');
    expect(row.probe.installerUserId).toBe('user_FAKE');
    expect(row.probe.declaredBox).toBe('team');
    expect(JSON.stringify([...db.rows.values()])).not.toContain(INSTALL_TOKEN);
  });

  it('enrolls a personal install through the user-keyed probe (S1b)', async () => {
    const api = personalFixture(), db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    expect(exchange.teamId).toBe(null);
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(result.kind).toBe('personal');
    expect(result.account.id).toBe('user_FAKE');
    const row = db.rows.get('user_FAKE');
    expect(row.probe.accountKind).toBe('personal');
    expect(row.probe.source).toBe('integration');
    expect(row.probe.installationId).toBe('icfg_FAKE');
    expect(row.probe.declaredBox).toBe('personal');
    expect(JSON.stringify([...db.rows.values()])).not.toContain(INSTALL_TOKEN);
    // Every probe call is unscoped: no request carries a teamId.
    for (const call of api.calls) expect(call.query.teamId).toBeUndefined();
  });

  it('refuses a personal install whose credential acts for a different user', async () => {
    const api = personalFixture({ identityId: 'user_SOMEONE_ELSE' }), db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    await expect(enrollInstallation({ db, exchange, env, fetchImpl: api.fetch }))
      .rejects.toThrow(/does not act for the user/);
    expect(db.rows.size).toBe(0);
  });

  it('refuses a personal install with team visibility beyond its box', async () => {
    const api = personalFixture({ teamsVisible: 1 }), db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    await expect(enrollInstallation({ db, exchange, env, fetchImpl: api.fetch }))
      .rejects.toThrow(/Broader token visibility/);
    expect(db.rows.size).toBe(0);
  });
});

// S1b fixture: a personal install — the exchange answers team_id
// null, the identity read names the installer, the unscoped project
// list is the personal account's granted set, and (by default) the
// token sees no teams.
function personalFixture({ identityId = 'user_FAKE', teamsVisible = 0 } = {}) {
  const api = makeFakeVercel();
  api.when('POST', '/v2/oauth/access_token').resolves({
    token_type: 'Bearer', access_token: INSTALL_TOKEN,
    installation_id: 'icfg_FAKE', user_id: 'user_FAKE', team_id: null
  });
  api.when('GET', '/v2/user').resolves({
    user: { id: identityId, username: 'installer-fake', name: 'Installer Fake' }
  });
  api.when('GET', '/v2/teams').resolves({
    teams: teamsVisible ? [{ id: 'team_FAKE', slug: 'test-team' }] : []
  });
  api.when('GET', '/v10/projects').resolves({
    projects: [{ id: 'prj_FAKE', name: 'fixture' }], pagination: { next: null }
  });
  return api;
}

describe('AUD-I S1: the callback page', () => {
  function fakeRes() {
    const headers = {};
    return {
      headers, statusCode: 200, body: '',
      setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      send(value) { this.body = value; return this; },
      json(value) { this.body = JSON.stringify(value); return this; }
    };
  }
  const get = (url) => ({ method: 'GET', url, headers: {} });

  it('completes a team install end to end and confirms without leaking the token', async () => {
    const api = fixture(), db = fakeDb(), res = fakeRes();
    await handleIntegrationCallback(get('/api/vercel/integration?code=abc'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Connected');
    expect(res.body).not.toContain(INSTALL_TOKEN);
    expect(db.rows.size).toBe(1);
  });

  it('without a code, stores nothing and says how to restart', async () => {
    const api = fixture(), db = fakeDb(), res = fakeRes();
    await handleIntegrationCallback(get('/api/vercel/integration'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Start the install again');
    expect(db.rows.size).toBe(0);
    expect(api.calls).toHaveLength(0);
  });

  it('a spent code surfaces the expiry guidance, not a raw failure', async () => {
    const api = makeFakeVercel(), db = fakeDb(), res = fakeRes();
    api.when('POST', '/v2/oauth/access_token').rejects(400);
    await handleIntegrationCallback(get('/api/vercel/integration?code=spent'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('30 minutes');
    expect(db.rows.size).toBe(0);
  });
});
