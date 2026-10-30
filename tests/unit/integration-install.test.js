import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { exchangeInstallCode, enrollInstallation,
  handleIntegrationCallback } from '../../src/vercel/integration.js';
import { recheckStoredToken } from '../../src/vercel/tokens.js';

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

// AUD-K remodel: the team-install fixture is built from the
// documented configuration shape (vendored OpenAPI snapshot,
// GET /v1/integrations/configuration/{id}) — the read the
// installation token is actually granted. The teams LIST fake the
// S1 fixture carried modeled a call no scope grants an installation
// token (it 403s live; that was A-1), so it is deleted, and the
// user read stays ONLY so the enrollment test can prove the
// installation probe never consults it.
// AUD-M3 remodel: the canonical fixture now carries the LIVE shape
// the AUD-M2 fingerprint captured on the 2026-10-30 closure re-run
// (failed=[type] types: type:absent id:string integrationId:string
// teamId:string ownerId:string userId:string scopes:array) — the
// live record OMITS `type` although the snapshot lists it in every
// variant. The documented type survives as an explicit variant in
// the AUD-M3 tests below (present-correct enrolls and is recorded
// as evidence; present-but-wrong still refuses).
const CONFIG = {
  id: 'icfg_FAKE',
  integrationId: 'oac_FAKECLIENT', teamId: 'team_FAKE', ownerId: 'team_FAKE',
  userId: 'user_FAKE',
  scopes: ['read:integration-configuration', 'read:team', 'read:user', 'read:project'],
  projectSelection: 'all', slug: 'fake-integration', status: 'ready',
  createdAt: 1, updatedAt: 1, notification: { level: 'info', title: 'fake' }
};

function fixture({ teamId = 'team_FAKE' } = {}) {
  const api = makeFakeVercel();
  api.when('POST', '/v2/oauth/access_token').resolves({
    token_type: 'Bearer', access_token: INSTALL_TOKEN,
    installation_id: 'icfg_FAKE', user_id: 'user_FAKE', team_id: teamId
  });
  api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
  api.when('GET', '/v1/integrations/configuration/{id}').resolves({
    ...CONFIG, teamId, ownerId: teamId
  });
  api.when('GET', '/v2/teams/{teamId}').resolves({
    id: 'team_FAKE', slug: 'test-team', name: 'Fixture Team'
  });
  api.when('GET', '/v10/projects').resolves({
    projects: [{ id: 'prj_FAKE', name: 'fixture' }], pagination: { next: null }
  });
  return api;
}

// AUD-K negative/variant fixture: one knob per documented branch of
// the configuration contract.
function configFixture({ config = {}, configError = null, projects = null,
  projectsError = null, teamRow = undefined } = {}) {
  const api = makeFakeVercel();
  api.when('POST', '/v2/oauth/access_token').resolves({
    token_type: 'Bearer', access_token: INSTALL_TOKEN,
    installation_id: 'icfg_FAKE', user_id: 'user_FAKE', team_id: 'team_FAKE'
  });
  const cfg = api.when('GET', '/v1/integrations/configuration/{id}');
  if (configError) cfg.rejects(configError.status, configError.body);
  else cfg.resolves({ ...CONFIG, ...config });
  const prj = api.when('GET', '/v10/projects');
  if (projectsError) prj.rejects(projectsError);
  else prj.resolves(projects ??
    { projects: [{ id: 'prj_FAKE', name: 'fixture' }], pagination: { next: null } });
  if (teamRow !== null) {
    const team = api.when('GET', '/v2/teams/{teamId}');
    if (teamRow === 'reject') team.rejects(403);
    else team.resolves(teamRow ?? { id: 'team_FAKE', slug: 'test-team', name: 'Fixture Team' });
  }
  return api;
}

function fakeDb() {
  const rows = new Map();
  const changes = [];
  return {
    rows, changes,
    // AUD-M2: the change_log journal the callback writes shape
    // fingerprints into; captured verbatim for assertion.
    async recordChange(entry) { changes.push(entry); return changes.length; },
    async upsertVercelAccount(row) {
      rows.set(row.id, { ...row, token_enc: row.tokenEnc,
        token_expires_at: row.expiresAt,
        team_id: row.teamId, project_id: row.projectId });
    },
    async getAccountCredential(id) {
      const row = rows.get(id);
      return row ? { id, team_id: row.team_id, scope: row.scope,
        project_id: row.project_id, token_enc: row.token_enc,
        token_expires_at: row.token_expires_at,
        token_probe: row.probe ?? null } : null;
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

  it('AUD-M2: demotes a missing user_id on a TEAM install to evidence (userId null), never a refusal', async () => {
    const api = makeFakeVercel();
    api.when('POST', '/v2/oauth/access_token').resolves({
      token_type: 'Bearer', access_token: INSTALL_TOKEN,
      installation_id: 'icfg_FAKE', team_id: 'team_FAKE'
    });
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    expect(exchange.userId).toBe(null);
    expect(exchange.teamId).toBe('team_FAKE');
  });

  it('AUD-M2: still refuses a missing user_id on a PERSONAL install, with a fingerprint', async () => {
    const api = makeFakeVercel();
    api.when('POST', '/v2/oauth/access_token').resolves({
      token_type: 'Bearer', access_token: INSTALL_TOKEN,
      installation_id: 'icfg_FAKE', team_id: null
    });
    const err = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch })
      .catch(e => e);
    expect(err.code).toBe('exchange_malformed');
    expect(err.fingerprint.gate).toBe('exchange');
    expect(err.fingerprint.failed).toEqual(['user_id']);
    expect(err.fingerprint.types).toMatchObject({
      access_token: 'string', token_type: 'string',
      installation_id: 'string', user_id: 'absent', team_id: 'null'
    });
    expect(err.fingerprintSummary).not.toContain(INSTALL_TOKEN);
    expect(err.fingerprintSummary).not.toContain('icfg_FAKE');
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
  it('enrolls a team install through the installation-aware probe with its identity recorded', async () => {
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
    // AUD-K: the configuration-derived evidence rides the probe record.
    expect(row.probe.grantedScopes).toEqual(CONFIG.scopes);
    expect(row.probe.projectSelection).toBe('all');
    expect(row.probe.configurationStatus).toBe('ready');
    expect(row.probe.installerMatchesConfiguration).toBe(true);
    expect(JSON.stringify([...db.rows.values()])).not.toContain(INSTALL_TOKEN);
    // The probe's call set is the documented one for this credential
    // class — configuration read, projects list, single-team label
    // read — and never the teams list or the user read.
    const paths = api.calls.map(c => c.path);
    expect(paths).toContain('/v1/integrations/configuration/icfg_FAKE');
    expect(paths).not.toContain('/v2/teams');
    expect(paths).not.toContain('/v2/user');
    const configCall = api.calls.find(c => c.path === '/v1/integrations/configuration/icfg_FAKE');
    expect(configCall.query.teamId).toBe('team_FAKE');
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

  it('AUD-M2: enrolls a team install whose exchange carried no user_id — installer evidence is null end to end', async () => {
    const api = configFixture();
    api.when('POST', '/v2/oauth/access_token').resolves({
      token_type: 'Bearer', access_token: INSTALL_TOKEN,
      installation_id: 'icfg_FAKE', team_id: 'team_FAKE'
    });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    const row = db.rows.get('team_FAKE');
    expect(row.probe.installerUserId).toBe(null);
    expect(row.probe.installerMatchesConfiguration).toBe(null);
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

describe('AUD-K: installation-aware probe branches', () => {
  const refuses = async (api, pattern) => {
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    await expect(enrollInstallation({ db, exchange, env, fetchImpl: api.fetch }))
      .rejects.toThrow(pattern);
    expect(db.rows.size).toBe(0);
  };

  it('classifies a bare configuration 403 as the missing installation-read scope', async () => {
    await refuses(configFixture({ configError: { status: 403 } }),
      /missing the permission to read its installations/);
  });

  it('flows the disabled-configuration envelope through the S5 classification', async () => {
    await refuses(configFixture({ configError: { status: 403,
      body: { error: { code: 'integration_configuration_disabled', message: 'x' } } } }),
      /integration behind this connection was disabled/);
  });

  it('classifies a configuration 401 as a dead credential', async () => {
    await refuses(configFixture({ configError: { status: 401 } }),
      /does not accept the installed credential/);
  });

  it('classifies a missing installation (404 and 410) as no longer existing', async () => {
    await refuses(configFixture({ configError: { status: 404 } }), /no longer exists at Vercel/);
    await refuses(configFixture({ configError: { status: 410 } }), /no longer exists at Vercel/);
  });

  it('refuses a configuration belonging to a different integration', async () => {
    await refuses(configFixture({ config: { integrationId: 'oac_OTHER' } }),
      /belongs to a different integration/);
  });

  it('refuses a configuration belonging to a different team', async () => {
    await refuses(configFixture({ config: { teamId: 'team_OTHER', ownerId: 'team_OTHER' } }),
      /belongs to a different team/);
  });

  it('refuses a configuration disabled in its body, with the S5 wording', async () => {
    await refuses(configFixture({ config: { disabledAt: 1,
      disabledReason: 'original-owner-left-the-team' } }), /was disabled/);
  });

  it('refuses a deleted or uninstalled configuration', async () => {
    await refuses(configFixture({ config: { deletedAt: 1 } }), /was removed at Vercel/);
    await refuses(configFixture({ config: { status: 'uninstalled' } }), /was removed at Vercel/);
  });

  it('refuses a malformed configuration (missing granted scopes)', async () => {
    await refuses(configFixture({ config: { scopes: undefined } }), /unexpected shape/);
  });

  it('enrolls a single-project-limited install as a project row', async () => {
    const api = configFixture({ config: { projectSelection: 'selected',
      projects: ['prj_FAKE'] } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(result.account.id).toBe('team_FAKE/prj_FAKE');
    expect(result.account.scope).toBe('project');
    expect(result.account.project).toBe('fixture');
    const row = db.rows.get('team_FAKE/prj_FAKE');
    expect(row.scope).toBe('project');
    expect(row.probe.projectSelection).toBe('selected');
  });

  it('refuses a multi-project-limited install (one row covers one project)', async () => {
    await refuses(configFixture({ config: { projectSelection: 'selected',
      projects: ['prj_FAKE', 'prj_FAKE2'] } }), /more than one project/);
  });

  it('refuses a selected install granted no project at all', async () => {
    await refuses(configFixture({ config: { projectSelection: 'selected', projects: [] } }),
      /not granted access to any project/);
  });

  it('refuses when the credential sees a project outside the granted set', async () => {
    await refuses(configFixture({ config: { projectSelection: 'selected',
      projects: ['prj_FAKE'] },
      projects: { projects: [{ id: 'prj_FAKE', name: 'fixture' },
        { id: 'prj_OTHER', name: 'other' }], pagination: { next: null } } }),
      /reach disagree/);
  });

  it('refuses when the single granted project is not visible to the credential', async () => {
    await refuses(configFixture({ config: { projectSelection: 'selected',
      projects: ['prj_FAKE'] },
      projects: { projects: [], pagination: { next: null } } }), /reach disagree/);
  });

  it('classifies a projects-list 403 as the missing project read scope', async () => {
    await refuses(configFixture({ projectsError: 403 }), /missing project read permission/);
  });

  it('still enrolls when the label read fails — the team ID labels the row', async () => {
    const api = configFixture({ teamRow: 'reject' });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(result.account.team).toBe('team_FAKE');
    expect(db.rows.get('team_FAKE').label).toBe('team_FAKE');
  });

  it('treats an absent configuration status as the documented ready default', async () => {
    const api = configFixture({ config: { status: undefined } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(db.rows.get('team_FAKE').probe.configurationStatus).toBe('ready');
  });

  it('enrolls when the configuration carries no installer (userId absent) — evidence records null', async () => {
    const api = configFixture({ config: { userId: undefined } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(db.rows.get('team_FAKE').probe.installerMatchesConfiguration).toBe(null);
  });

  it('enrolls when the configuration installer is mistyped — evidence records null, never a false mismatch', async () => {
    const api = configFixture({ config: { userId: 42 } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(db.rows.get('team_FAKE').probe.installerMatchesConfiguration).toBe(null);
  });

  it('AUD-M3: enrolls on the live configuration shape — type absent, evidence records absent', async () => {
    // The canonical fixture IS the live shape the 2026-10-30
    // fingerprint captured (type omitted; every other gate field
    // present and correctly typed). Against the pre-fix gate this
    // enrollment refuses with failed=[type]; with the fix it lands
    // and the stored evidence names the posture.
    const api = configFixture();
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(db.rows.get('team_FAKE').probe.configurationType).toBe('absent');
  });

  it('AUD-M3: enrolls when the configuration carries the documented type — evidence records it', async () => {
    const api = configFixture({ config: { type: 'integration-configuration' } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const result = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    expect(result.enrolled).toBe(true);
    expect(db.rows.get('team_FAKE').probe.configurationType)
      .toBe('integration-configuration');
  });

  it('AUD-M3: refuses a present-but-wrong type — a different resource kind — WITH the fingerprint naming type', async () => {
    const api = configFixture({ config: { type: 'some-other-resource' } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const err = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch })
      .catch(e => e);
    expect(err.probeLeg).toBe('configuration');
    expect(err.message).toMatch(/unexpected shape/);
    expect(err.fingerprint.failed).toEqual(['type']);
    expect(err.fingerprint.types.type).toBe('string');
    expect(err.fingerprintSummary + JSON.stringify(err.fingerprint))
      .not.toContain('some-other-resource');
    expect(db.rows.size).toBe(0);
  });

  it('AUD-M3: refuses a null type — present, but not the documented kind', async () => {
    await refuses(configFixture({ config: { type: null } }), /unexpected shape/);
  });

  it('refuses a shape-broken configuration WITH a redacted fingerprint: predicate names and types, no values', async () => {
    // AUD-M3: this AUD-M2 test models the full documented-shape
    // record (type present), so the type stays explicit in the
    // override — the canonical fixture now carries the live
    // type-absent shape, and this test's exact type map stands.
    const api = configFixture({ config: { scopes: 'read:team', teamId: 42,
      type: 'integration-configuration' } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const err = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch })
      .catch(e => e);
    expect(err.probeLeg).toBe('configuration');
    expect(err.fingerprint.gate).toBe('configuration');
    expect(err.fingerprint.failed).toEqual(expect.arrayContaining(['scopes', 'teamId']));
    expect(err.fingerprint.types).toMatchObject({
      id: 'string', type: 'string', integrationId: 'string',
      teamId: 'number', ownerId: 'string', userId: 'string', scopes: 'string'
    });
    expect(err.fingerprint.integrationMatch).toBe('not-reached');
    const fingerprintText = err.fingerprintSummary + JSON.stringify(err.fingerprint);
    for (const value of ['team_FAKE', 'icfg_FAKE', 'oac_FAKECLIENT',
      'user_FAKE', 'read:team', INSTALL_TOKEN]) {
      expect(fingerprintText).not.toContain(value);
    }
    expect(err.fingerprintSummary.length).toBeLessThanOrEqual(160);
    expect(db.rows.size).toBe(0);
  });

  it('records the integration comparison outcome in the fingerprint when it is reached', async () => {
    const api = configFixture({ config: { integrationId: 'oac_OTHER' } });
    const db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    const err = await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch })
      .catch(e => e);
    expect(err.probeLeg).toBe('configuration_integration');
    expect(err.fingerprint.integrationMatch).toBe('mismatch');
    expect(err.fingerprint.failed).toEqual(['integrationIdMatch']);
    expect(JSON.stringify(err.fingerprint)).not.toContain('oac_OTHER');
    expect(JSON.stringify(err.fingerprint)).not.toContain('oac_FAKECLIENT');
  });

  it('rechecks a stored integration team seat through the configuration read', async () => {
    const api = fixture(), db = fakeDb();
    const exchange = await exchangeInstallCode({ code: 'c', env, fetchImpl: api.fetch });
    await enrollInstallation({ db, exchange, env, fetchImpl: api.fetch });
    api.calls.length = 0;
    const result = await recheckStoredToken({ db, accountId: 'team_FAKE', env,
      fetchImpl: api.fetch });
    expect(result.access).toBe('read_verified');
    expect(result.teamSlug).toBe('test-team');
    const paths = api.calls.map(c => c.path);
    expect(paths).toContain('/v1/integrations/configuration/icfg_FAKE');
    expect(paths).not.toContain('/v2/teams');
    expect(paths).not.toContain('/v2/user');
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

  it('completes when the redirect parameters agree with the exchange (AUD-K)', async () => {
    const api = fixture(), db = fakeDb(), res = fakeRes();
    await handleIntegrationCallback(
      get('/api/vercel/integration?code=abc&configurationId=icfg_FAKE&teamId=team_FAKE'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Connected');
    expect(db.rows.size).toBe(1);
  });

  it('refuses a redirect whose configurationId disagrees with the exchange (AUD-K)', async () => {
    const api = fixture(), db = fakeDb(), res = fakeRes();
    await handleIntegrationCallback(
      get('/api/vercel/integration?code=abc&configurationId=icfg_OTHER'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('does not match the install that was started');
    expect(db.rows.size).toBe(0);
    // Refused before any probe call: only the exchange was made.
    expect(api.calls.map(c => c.path)).toEqual(['/v2/oauth/access_token']);
  });

  it('refuses a redirect whose teamId disagrees with the exchange (AUD-K)', async () => {
    const api = fixture(), db = fakeDb(), res = fakeRes();
    await handleIntegrationCallback(
      get('/api/vercel/integration?code=abc&teamId=team_OTHER'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('does not match the install that was started');
    expect(db.rows.size).toBe(0);
  });

  it('AUD-M2: journals the shape fingerprint of a refused enrollment for operator read-back', async () => {
    const api = configFixture({ config: { scopes: undefined } }), db = fakeDb(), res = fakeRes();
    await handleIntegrationCallback(get('/api/vercel/integration?code=abc'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('unexpected shape');
    expect(res.body).not.toContain('SHAPE-FP');
    expect(db.rows.size).toBe(0);
    expect(db.changes).toHaveLength(1);
    const row = db.changes[0];
    expect(row.tool).toBe('vercel_integration_install');
    expect(row.account).toBe('team_FAKE');
    expect(row.summary).toContain('failed=[scopes]');
    expect(row.summary).toContain('scopes:absent');
    expect(row.summary.length).toBeLessThanOrEqual(160);
    for (const value of ['team_FAKE', 'icfg_FAKE', 'user_FAKE', INSTALL_TOKEN]) {
      expect(row.summary).not.toContain(value);
    }
  });

  it('AUD-M2: journals an exchange shape refusal under the redirect team key', async () => {
    const api = makeFakeVercel(), db = fakeDb(), res = fakeRes();
    api.when('POST', '/v2/oauth/access_token').resolves({
      token_type: 'Bearer', access_token: INSTALL_TOKEN,
      installation_id: 'icfg_FAKE', team_id: null
    });
    await handleIntegrationCallback(
      get('/api/vercel/integration?code=abc&teamId=team_FAKE'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(502);
    expect(db.rows.size).toBe(0);
    expect(db.changes).toHaveLength(1);
    expect(db.changes[0].account).toBe('team_FAKE');
    expect(db.changes[0].summary).toContain('failed=[user_id]');
    expect(db.changes[0].summary).not.toContain(INSTALL_TOKEN);
  });

  it('AUD-M2: a successful install journals nothing', async () => {
    const api = fixture(), db = fakeDb(), res = fakeRes();
    await handleIntegrationCallback(get('/api/vercel/integration?code=abc'), res,
      { db, env, fetchImpl: api.fetch });
    expect(res.statusCode).toBe(200);
    expect(db.changes).toHaveLength(0);
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
