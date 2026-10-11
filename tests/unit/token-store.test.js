import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { probeToken, storeToken, loadToken } from '../../src/vercel/tokens.js';

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
function fixture({ multipleTeams = false, projectCount = 1 } = {}) {
  const api = makeFakeVercel();
  api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
  api.when('GET', '/v2/teams').resolves({ teams: [{ id: 'team_FAKE', slug: 'test-team', name: 'Fixture Team' },
    ...(multipleTeams ? [{ id: 'team_OTHER', slug: 'another' }] : [])] });
  api.when('GET', '/v10/projects').resolves({ projects: [
    { id: 'prj_FAKE', name: 'fixture' },
    ...(projectCount > 1 ? [{ id: 'prj_EXTRA', name: 'another project' }] : [])
  ], pagination: { next: null } });
  return api;
}
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

describe('A-5 Vercel token probes and encrypted persistence', () => {
  it('persists only ciphertext, and server-side load restores the credential', async () => {
    const api = fixture(), db = fakeDb();
    const token = 'vcp_FAKEteamToken_12345678';
    const receipt = await storeToken({ db, token, teamId: 'team_FAKE', env, fetchImpl: api.fetch });
    expect(receipt).toEqual({ id: 'team_FAKE', team: 'test-team', scope: 'team',
      project: null, expiry: null, last4: '5678' });
    expect(JSON.stringify(receipt)).not.toContain(token);
    expect(JSON.stringify([...db.rows.values()])).not.toContain(token);
    const loaded = await loadToken({ db, accountId: 'team_FAKE', env });
    expect(loaded.token).toBe(token);
    expect(loaded.account.team_id).toBe('team_FAKE');
    expect(api.calls).toHaveLength(3);
    for (const call of api.calls) expect(call.query.teamId).toBe('team_FAKE');
  });
  it('refuses invisible teams or project IDs without persisting credentials', async () => {
    const db = fakeDb();
    await expect(storeToken({ db, token: 'vcp_FAKEtest_1234', teamId: 'team_NOT_VISIBLE',
      env, fetchImpl: fixture().fetch })).rejects.toThrow(/verified access/);
    await expect(storeToken({ db, token: 'vcp_FAKEtest_1234', teamId: 'team_FAKE',
      projectId: 'prj_NOT_VISIBLE', env, fetchImpl: fixture().fetch }))
      .rejects.toThrow(/selected project/);
    expect(db.rows.size).toBe(0);
  });
  it('rejects broad visibility by default; allows only with explicit owner flag', async () => {
    const token = 'vcp_FAKEtest_1234';
    await expect(probeToken({ token, teamId: 'team_FAKE',
      fetchImpl: fixture({ multipleTeams: true }).fetch })).rejects.toThrow(/owner allowance/);
    const result = await probeToken({ token, teamId: 'team_FAKE', allowFull: true,
      fetchImpl: fixture({ multipleTeams: true }).fetch });
    expect(result.scope).toBe('full');
    const p = await probeToken({ token, teamId: 'team_FAKE',
      projectId: 'prj_FAKE', fetchImpl: fixture().fetch });
    expect(p.scope).toBe('project');
  });
  it('refuses missing storage/key and wrong encryption purpose', async () => {
    await expect(storeToken({ db: fakeDb(), token: 'vcp_FAKEtest_1234',
      teamId: 'team_FAKE', env: {}, fetchImpl: fixture().fetch })).rejects.toThrow(/KEY/);
    await expect(loadToken({ db: fakeDb(), accountId: 'missing', env })).rejects.toThrow(/missing/);
  });
});
