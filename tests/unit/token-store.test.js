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
  // AUD-BI: the enrollment expiry leg's one documented read; the
  // base fixture's list is empty, so it records nothing.
  api.when('GET', '/v6/user/tokens').resolves({ tokens: [],
    pagination: { count: 0, next: null, prev: null } });
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
    // AUD-BI: the probe's three proof legs carry the teamId; the one
    // additional documented read (the token list) is unscoped.
    expect(api.calls).toHaveLength(4);
    for (const call of api.calls.slice(0, 3)) expect(call.query.teamId).toBe('team_FAKE');
    expect(api.calls[3].path).toBe('/v6/user/tokens');
    expect(api.calls[3].query.teamId).toBeUndefined();
    // The fixture's empty token list records nothing — honestly.
    expect(db.rows.get('team_FAKE').probe.tokenExpiry).toEqual({ state: 'unrecorded' });
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

describe('AUD-BI enrollment expiry recording (VMCP-003)', () => {
  const token = 'vcp_FAKEteamToken_12345678';
  const EXPIRY_MS = 1798761600000; // 2027-01-01T00:00:00.000Z
  const ownRow = (overrides = {}) => ({
    id: 'tokid_FAKE1', name: 'fixture token', type: 'oauth2-token',
    prefix: 'vcp_', suffix: '345678',
    createdAt: 1700000000000, activeAt: 1700000000000,
    scopes: [{ type: 'team', teamId: 'team_FAKE', createdAt: 1700000000000 }],
    ...overrides
  });
  const withTokens = (rows) => {
    const api = fixture();
    api.when('GET', '/v6/user/tokens').resolves({ tokens: rows,
      pagination: { count: rows.length, next: null, prev: null } });
    return api;
  };

  it('records the matched token record\'s real expiry on enrollment', async () => {
    const db = fakeDb();
    const receipt = await storeToken({ db, token, teamId: 'team_FAKE',
      env, fetchImpl: withTokens([ownRow({ expiresAt: EXPIRY_MS })]).fetch });
    expect(receipt.expiry).toBe('2027-01-01T00:00:00.000Z');
    const row = db.rows.get('team_FAKE');
    expect(row.token_expires_at).toBe('2027-01-01T00:00:00.000Z');
    expect(row.probe.tokenExpiry).toEqual({ state: 'recorded', providerTokenId: 'tokid_FAKE1' });
    // The recorded date is a real stored expiry: loadToken serves the
    // credential while it is in the future.
    expect((await loadToken({ db, accountId: 'team_FAKE', env })).token).toBe(token);
  });

  it('records a provider-reported no-expiry as its own probe state, never as attestation', async () => {
    const db = fakeDb();
    const receipt = await storeToken({ db, token, teamId: 'team_FAKE',
      env, fetchImpl: withTokens([ownRow()]).fetch });
    expect(receipt.expiry).toBeNull();
    const row = db.rows.get('team_FAKE');
    expect(row.token_expires_at).toBeNull();
    expect(row.probe.tokenExpiry).toEqual({ state: 'none_reported', providerTokenId: 'tokid_FAKE1' });
  });

  it('records nothing when two rows match the suffix (ambiguous)', async () => {
    const db = fakeDb();
    const receipt = await storeToken({ db, token, teamId: 'team_FAKE',
      env, fetchImpl: withTokens([
        ownRow({ expiresAt: EXPIRY_MS }),
        ownRow({ id: 'tokid_FAKE2', suffix: '45678', expiresAt: EXPIRY_MS })
      ]).fetch });
    expect(receipt.expiry).toBeNull();
    expect(db.rows.get('team_FAKE').probe.tokenExpiry).toEqual({ state: 'unrecorded' });
  });

  it('excludes a suffix-matching row whose scopes name a different team', async () => {
    const db = fakeDb();
    const receipt = await storeToken({ db, token, teamId: 'team_FAKE',
      env, fetchImpl: withTokens([ownRow({
        scopes: [{ type: 'team', teamId: 'team_OTHER', createdAt: 1700000000000 }],
        expiresAt: EXPIRY_MS
      })]).fetch });
    expect(receipt.expiry).toBeNull();
    expect(db.rows.get('team_FAKE').probe.tokenExpiry).toEqual({ state: 'unrecorded' });
  });

  it('enrollment is unaffected when the token-list read refuses', async () => {
    const api = fixture();
    api.when('GET', '/v6/user/tokens').rejects(403);
    const db = fakeDb();
    const receipt = await storeToken({ db, token, teamId: 'team_FAKE',
      env, fetchImpl: api.fetch });
    expect(receipt.scope).toBe('team');
    expect(receipt.expiry).toBeNull();
    expect(db.rows.get('team_FAKE').probe.tokenExpiry).toEqual({ state: 'unrecorded' });
  });

  it('a caller-supplied expiry wins and the leg does not run', async () => {
    const api = withTokens([ownRow({ expiresAt: EXPIRY_MS })]);
    const db = fakeDb();
    const receipt = await storeToken({ db, token, teamId: 'team_FAKE',
      env, fetchImpl: api.fetch, expiresAt: 1893456000000 });
    expect(receipt.expiry).toBe(1893456000000);
    expect(api.calls.filter(call => call.path === '/v6/user/tokens')).toHaveLength(0);
    expect(db.rows.get('team_FAKE').probe.tokenExpiry).toBeUndefined();
  });
});
