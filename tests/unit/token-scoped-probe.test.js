import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { probeToken, storeToken } from '../../src/vercel/tokens.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { handleSetup } from '../../src/vercel/setup.js';

// AUD-F / VMCP-022: a genuinely project-scoped token must enroll on in-scope
// reads alone, and every probe failure must name its leg. The fake's
// scopedProject mode models the real scoped-token behavior that the old
// all-answering fake hid: user/teams reads refused or empty, projects read
// returns exactly the scoped project (which carries its owning accountId).
const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const TOKEN = 'vcp_FAKEscopedToken_12345678';
const PROJECT = { id: 'prj_FAKE', name: 'fixture', accountId: 'team_FAKE' };

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async upsertVercelAccount(row) {
      rows.set(row.id, { ...row, token_enc: row.tokenEnc, token_expires_at: row.expiresAt,
        team_id: row.teamId, project_id: row.projectId });
    },
    async getAccountCredential(id) {
      const row = rows.get(id);
      return row ? { id, team_id: row.team_id, scope: row.scope, project_id: row.project_id,
        token_enc: row.token_enc, token_expires_at: row.token_expires_at } : null;
    }
  };
}

describe('AUD-F scoped-token enrollment probe', () => {
  it.each(['refuse', 'empty'])('enrolls a project-scoped token when user/teams reads are %s', async teams => {
    const api = makeFakeVercel().scopedProject(PROJECT, { teams });
    const db = fakeDb();
    const receipt = await storeToken({ db, token: TOKEN, teamId: 'team_FAKE',
      projectId: 'prj_FAKE', env, fetchImpl: api.fetch });
    expect(receipt.id).toBe('team_FAKE/prj_FAKE');
    expect(receipt.scope).toBe('project');
    expect(receipt.project).toBe('fixture');
    expect(JSON.stringify(receipt)).not.toContain(TOKEN);
    const row = db.rows.get('team_FAKE/prj_FAKE');
    expect(row).toMatchObject({ scope: 'project', teamId: 'team_FAKE', projectId: 'prj_FAKE',
      projectName: 'fixture' });
    expect(JSON.stringify([...db.rows.values()])).not.toContain(TOKEN);
    // The proof rested on a scope-inferred projects read: at least one
    // projects call carried no teamId query parameter.
    const projectCalls = api.calls.filter(c => c.path === '/v10/projects');
    expect(projectCalls.some(c => c.query.teamId === undefined)).toBe(true);
    api.verify();
  });

  it('derives the team from the direct project read when the list row lacks accountId', async () => {
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').rejects(403);
    api.when('GET', '/v2/teams').rejects(403);
    api.when('GET', '/v10/projects').resolves({
      projects: [{ id: 'prj_FAKE', name: 'fixture' }], pagination: { next: null } });
    api.when('GET', '/v9/projects/{idOrName}').resolves(PROJECT);
    const result = await probeToken({ token: TOKEN, teamId: 'team_FAKE',
      projectId: 'prj_FAKE', fetchImpl: api.fetch });
    expect(result.scope).toBe('project');
    expect(result.projectName).toBe('fixture');
    const get = api.calls.find(c => c.path === '/v9/projects/prj_FAKE');
    expect(get.query.teamId).toBe(undefined);
  });

  it('refuses a scoped token that can read only a different project, naming the projects leg', async () => {
    const api = makeFakeVercel().scopedProject({ id: 'prj_OTHER', name: 'other', accountId: 'team_FAKE' });
    const db = fakeDb();
    const failure = await storeToken({ db, token: TOKEN, teamId: 'team_FAKE',
      projectId: 'prj_FAKE', env, fetchImpl: api.fetch }).catch(e => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.probeLeg).toBe('projects');
    expect(failure.message).toMatch(/selected project/);
    expect(failure.message).not.toContain(TOKEN);
    expect(db.rows.size).toBe(0);
  });

  it('refuses a scoped token that can read no projects, naming the projects leg', async () => {
    const api = makeFakeVercel().scopedProject(null);
    const db = fakeDb();
    const failure = await storeToken({ db, token: TOKEN, teamId: 'team_FAKE',
      projectId: 'prj_FAKE', env, fetchImpl: api.fetch }).catch(e => e);
    expect(failure.probeLeg).toBe('projects');
    expect(db.rows.size).toBe(0);
  });

  it('refuses when the project belongs to a different team, naming the match leg', async () => {
    const api = makeFakeVercel().scopedProject({ ...PROJECT, accountId: 'team_OTHER' });
    const db = fakeDb();
    const failure = await storeToken({ db, token: TOKEN, teamId: 'team_FAKE',
      projectId: 'prj_FAKE', env, fetchImpl: api.fetch }).catch(e => e);
    expect(failure.probeLeg).toBe('project_team_match');
    expect(failure.message).not.toContain(TOKEN);
    expect(db.rows.size).toBe(0);
  });

  it('refuses a token containing whitespace at the input leg, before any provider call', async () => {
    const api = makeFakeVercel().scopedProject(PROJECT);
    const failure = await probeToken({ token: 'vcp_FAKE token with spaces', teamId: 'team_FAKE',
      projectId: 'prj_FAKE', fetchImpl: api.fetch }).catch(e => e);
    expect(failure.probeLeg).toBe('input');
    expect(api.calls).toHaveLength(0);
  });
});

// Setup-surface legibility: each probe leg forced to fail must surface its
// own name on the setup page — never the unnamed catch-all, never the token,
// never a provider body.
const setupEnv = { ADMIN_PASSPHRASE: 'fixture-owner-passphrase',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
function response() {
  const headers = {};
  return { headers, statusCode: 200, body: '',
    setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = JSON.stringify(value); return this; },
    end() { this.finished = true; return this; } };
}
function request(method, body, cookie) {
  return { method, body, query: {}, headers: {
    'x-real-ip': '127.0.0.1', ...(cookie ? { cookie } : {}) } };
}
async function addTokenViaSetup(storeTokenFn) {
  const db = createFakeDb({ accounts: [] });
  const call = async (method, body, cookie) => {
    const res = response();
    await handleSetup(request(method, body, cookie), res, { db, env: setupEnv, storeTokenFn });
    return res;
  };
  const logged = await call('POST', { action: 'login', passphrase: setupEnv.ADMIN_PASSPHRASE });
  const cookie = logged.headers['set-cookie'].split(';')[0];
  const page = await call('GET', null, cookie);
  const csrf = page.body.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)[1];
  return call('POST', { action: 'add_token', csrf, token: TOKEN,
    teamId: 'team_FAKE', projectId: 'prj_FAKE' }, cookie);
}
const viaRealProbe = api => async ({ token, teamId, projectId, allowFull }) =>
  storeToken({ db: fakeDb(), token, teamId, projectId, allowFull,
    env: setupEnv, fetchImpl: api.fetch });

describe('AUD-F setup failure surface names the failed leg', () => {
  it('names the projects leg for a scoped token that cannot read the project', async () => {
    const api = makeFakeVercel().scopedProject(null);
    const res = await addTokenViaSetup(viaRealProbe(api));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Setup failed at the projects check');
    expect(res.body).not.toContain('Could not complete the request');
    expect(res.body).not.toContain(TOKEN);
  });
  it('names the project-team match leg when the project belongs elsewhere', async () => {
    const api = makeFakeVercel().scopedProject({ ...PROJECT, accountId: 'team_OTHER' });
    const res = await addTokenViaSetup(viaRealProbe(api));
    expect(res.body).toContain('Setup failed at the project-team match check');
    expect(res.body).not.toContain(TOKEN);
  });
  it('names the input leg for a whitespace token', async () => {
    const api = makeFakeVercel().scopedProject(PROJECT);
    const res = await addTokenViaSetup(async ({ teamId, projectId, allowFull }) =>
      storeToken({ db: fakeDb(), token: 'vcp_FAKE token', teamId, projectId,
        allowFull, env: setupEnv, fetchImpl: api.fetch }));
    expect(res.body).toContain('Setup failed at the input check');
  });
  it('names the storage leg when saving the verified token fails', async () => {
    const api = makeFakeVercel().scopedProject(PROJECT);
    const db = fakeDb();
    db.upsertVercelAccount = async () => { throw new Error('DO_NOT_ECHO_DB_DETAIL'); };
    const res = await addTokenViaSetup(async ({ token, teamId, projectId, allowFull }) =>
      storeToken({ db, token, teamId, projectId, allowFull, env: setupEnv, fetchImpl: api.fetch }));
    expect(res.body).toContain('Setup failed at the storage check');
    expect(res.body).not.toContain('DO_NOT_ECHO_DB_DETAIL');
    expect(res.body).not.toContain(TOKEN);
  });
  it('names identity, teams and broad-visibility legs on the team/full path', async () => {
    const noIdentity = makeFakeVercel();
    noIdentity.when('GET', '/v2/user').rejects(403);
    noIdentity.when('GET', '/v2/teams').resolves({ teams: [{ id: 'team_FAKE', slug: 'fixture' }] });
    noIdentity.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const identityRes = await addTokenViaSetup(async ({ token, teamId, allowFull }) =>
      storeToken({ db: fakeDb(), token, teamId, projectId: null, allowFull,
        env: setupEnv, fetchImpl: noIdentity.fetch }));
    expect(identityRes.body).toContain('Setup failed at the identity check');

    const noTeam = makeFakeVercel();
    noTeam.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
    noTeam.when('GET', '/v2/teams').resolves({ teams: [], pagination: { next: null } });
    noTeam.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const teamRes = await addTokenViaSetup(async ({ token, teamId, allowFull }) =>
      storeToken({ db: fakeDb(), token, teamId, projectId: null, allowFull,
        env: setupEnv, fetchImpl: noTeam.fetch }));
    expect(teamRes.body).toContain('Setup failed at the teams check');

    const broad = makeFakeVercel();
    broad.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
    broad.when('GET', '/v2/teams').resolves({ teams: [
      { id: 'team_FAKE', slug: 'fixture' }, { id: 'team_OTHER', slug: 'other' }] });
    broad.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const broadRes = await addTokenViaSetup(async ({ token, teamId, allowFull }) =>
      storeToken({ db: fakeDb(), token, teamId, projectId: null, allowFull,
        env: setupEnv, fetchImpl: broad.fetch }));
    expect(broadRes.body).toContain('Setup failed at the broad-visibility check');
  });
  it('keeps the unnamed catch-all for non-probe errors, echoing nothing', async () => {
    const res = await addTokenViaSetup(async () => { throw new Error('DO_NOT_ECHO_ANYTHING'); });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Could not complete the request');
    expect(res.body).not.toContain('DO_NOT_ECHO_ANYTHING');
  });
});
