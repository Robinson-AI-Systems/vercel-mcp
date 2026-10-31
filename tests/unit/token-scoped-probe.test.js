import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { probeToken, storeToken } from '../../src/vercel/tokens.js';
import { createVercelLoginService } from '../../src/vercel/login.js';

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

// Enrollment-surface legibility (AUD-AR enroll branch; the driver
// was the setup page until AUD-AV deleted it): each probe leg forced
// to fail must surface its own name in the enrollment error — never
// the unnamed catch-all, never the token, never a provider body.
const setupEnv = { ADMIN_PASSPHRASE: 'fixture-owner-passphrase',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
async function enroll({ db = fakeDb(), fetchImpl, token = TOKEN,
  teamId = 'team_FAKE', projectId = 'prj_FAKE', allowFull, env = setupEnv } = {}) {
  const service = createVercelLoginService(
    { listVercelAccounts: async () => [], ...db }, { fetchImpl });
  return service.enrollToken({ token, teamId, projectId, allowFull }, env);
}

describe('AUD-F enrollment failure surface names the failed leg', () => {
  it('names the projects leg for a scoped token that cannot read the project', async () => {
    const api = makeFakeVercel().scopedProject(null);
    const res = await enroll({ fetchImpl: api.fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Enrollment failed at the projects check');
    expect(res.error).not.toContain('could not be completed');
    expect(res.error).not.toContain(TOKEN);
  });
  it('names the project-team match leg when the project belongs elsewhere', async () => {
    const api = makeFakeVercel().scopedProject({ ...PROJECT, accountId: 'team_OTHER' });
    const res = await enroll({ fetchImpl: api.fetch });
    expect(res.error).toContain('Enrollment failed at the project-team match check');
    expect(res.error).not.toContain(TOKEN);
  });
  it('names the input leg for a whitespace token', async () => {
    const api = makeFakeVercel().scopedProject(PROJECT);
    const res = await enroll({ fetchImpl: api.fetch, token: 'vcp_FAKE token' });
    expect(res.error).toContain('Enrollment failed at the input check');
  });
  it('names the storage leg when saving the verified token fails', async () => {
    const api = makeFakeVercel().scopedProject(PROJECT);
    const db = fakeDb();
    db.upsertVercelAccount = async () => { throw new Error('DO_NOT_ECHO_DB_DETAIL'); };
    const res = await enroll({ db, fetchImpl: api.fetch });
    expect(res.error).toContain('Enrollment failed at the storage check');
    expect(res.error).not.toContain('DO_NOT_ECHO_DB_DETAIL');
    expect(res.error).not.toContain(TOKEN);
  });
  it('names identity, teams and broad-visibility legs on the team/full path', async () => {
    const noIdentity = makeFakeVercel();
    noIdentity.when('GET', '/v2/user').rejects(403);
    noIdentity.when('GET', '/v2/teams').resolves({ teams: [{ id: 'team_FAKE', slug: 'fixture' }] });
    noIdentity.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const identityRes = await enroll({ fetchImpl: noIdentity.fetch, projectId: null });
    expect(identityRes.error).toContain('Enrollment failed at the identity check');

    const noTeam = makeFakeVercel();
    noTeam.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
    noTeam.when('GET', '/v2/teams').resolves({ teams: [], pagination: { next: null } });
    noTeam.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const teamRes = await enroll({ fetchImpl: noTeam.fetch, projectId: null });
    expect(teamRes.error).toContain('Enrollment failed at the teams check');

    const broad = makeFakeVercel();
    broad.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
    broad.when('GET', '/v2/teams').resolves({ teams: [
      { id: 'team_FAKE', slug: 'fixture' }, { id: 'team_OTHER', slug: 'other' }] });
    broad.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const broadRes = await enroll({ fetchImpl: broad.fetch, projectId: null });
    expect(broadRes.error).toContain('Enrollment failed at the broad-visibility check');
  });
  it('keeps the unnamed catch-all for non-probe errors, echoing nothing', async () => {
    // A failure with no probe leg (here: no encryption key configured,
    // so storing the verified token cannot even start) falls back to
    // the unnamed catch-all, which names no leg and echoes nothing.
    const api = makeFakeVercel().scopedProject(PROJECT);
    const res = await enroll({ fetchImpl: api.fetch, env: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Enrollment could not be completed');
    expect(res.error).not.toContain('check:');
  });
});
