import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../../src/core/secret-box.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { recheckStoredToken, recheckRefusalSummary } from '../../src/vercel/tokens.js';
import { explainVercelError, vercelErrorResult } from '../../src/tools/errors.js';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';

// AUD-AI (recheck conviction dossier, 2026-10-30): the user-token
// recheck refused opaquely — every probe failure collapsed into
// unknown_error at the tool surface and nothing was journaled, so
// a twice-reproduced live failure preserved no cause. These tests
// pin the instrument: the journaled redacted fingerprint, the
// leg-named surfaced classification, journal-failure tolerance,
// and the ungated scope derivation (one-team and two-team fakes).

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const token = 'vcp_FAKE_recheck_12345678';

function teamFixture({ scope = 'team', teams = 1, journalThrows = false,
  missing = false } = {}) {
  const accountId = 'team_FAKE_a';
  const changes = [];
  const db = {
    getAccountCredential: vi.fn(async id => id === accountId && !missing ? {
      id: accountId, team_id: 'team_FAKE_a', project_id: null, scope,
      token_expires_at: null,
      token_enc: encryptSecret(token, 'token:' + accountId, env),
      token_probe: {}
    } : null),
    upsertVercelAccount: vi.fn(),
    recordChange: journalThrows ?
      vi.fn(async () => { throw new Error('journal unavailable'); }) :
      vi.fn(async entry => { changes.push(entry); })
  };
  const api = makeFakeVercel();
  api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
  api.when('GET', '/v2/teams').resolves({ teams: [
    { id: 'team_FAKE_a', slug: 'fixture-a' },
    ...(teams > 1 ? [{ id: 'team_FAKE_b', slug: 'fixture-b' }] : [])
  ] });
  api.when('GET', '/v10/projects').resolves({
    projects: [{ id: 'prj_FAKE_a', name: 'fixture-a' }], pagination: { next: null }
  });
  const connection = { account: accountId, mode: 'preview',
    profile: 'read_only', listing: 'compact' };
  // The live door (src/rtc/door.js) dispatches with
  // formatError: vercelErrorResult; mirror it so the surfaced
  // classification under test is the one production produces.
  const call = () => dispatchReadOnlyTool({
    registry, name: 'vercel_check_token', args: {}, connection, db, env,
    fetchImpl: api.fetch, formatError: vercelErrorResult
  });
  return { db, api, call, changes, accountId };
}

describe('AUD-AI recheck derivation (success path unchanged but for derivedScope)', () => {
  it('one team derives team scope, matching the stored scope, and journals nothing', async () => {
    const { db, call, changes } = teamFixture({ teams: 1 });
    const result = await call();
    expect(result.isError).not.toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({ storedScope: 'team', derivedScope: 'team',
      visibleTeamCount: 1, visibleProjectCount: 1, access: 'read_verified',
      scopeVerified: false, writePermissions: 'unknown', persisted: false });
    expect(changes).toHaveLength(0);
    expect(db.upsertVercelAccount).not.toHaveBeenCalled();
  });

  it('two teams derive full scope against a stored team scope — drift reported, not refused', async () => {
    const { db, call, changes } = teamFixture({ teams: 2 });
    const result = await call();
    expect(result.isError).not.toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({ storedScope: 'team', derivedScope: 'full',
      visibleTeamCount: 2, visibleProjectCount: 1, persisted: false });
    expect(result.content[0].text).not.toContain(token);
    expect(changes).toHaveLength(0);
    expect(db.upsertVercelAccount).not.toHaveBeenCalled();
  });
});

describe('AUD-AI recheck fingerprint + leg-named classification', () => {
  it('an identity 401 names the identity leg and journals leg:status', async () => {
    const { api, call, changes } = teamFixture();
    api.when('GET', '/v2/user').rejects(401,
      { error: { code: 'unauthorized', message: 'DO_NOT_LEAK' } });
    const result = await call();
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('stopped at the identity check');
    expect(text).toContain('recheck_failed');
    expect(text).toContain('(HTTP 401)');
    expect(text).not.toContain('unknown_error');
    expect(text).not.toContain('DO_NOT_LEAK');
    expect(text).not.toContain(token);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ tool: 'vercel_check_token',
      mode: 'preview', dryRun: false, production: false,
      summary: 'SHAPE-FP recheck failed=[identity:401:absent] route:user stored:team' });
  });

  it('a visibility shape refusal journals the leg with absent status and code', async () => {
    const { api, call, changes } = teamFixture();
    api.when('GET', '/v2/teams').resolves({ teams: [
      { id: 'team_FAKE_a', slug: 'fixture-a' },
      { id: 'team_FAKE_a', slug: 'fixture-a-again' }
    ] });
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('stopped at the team visibility check');
    expect(changes).toHaveLength(1);
    expect(changes[0].summary).toBe(
      'SHAPE-FP recheck failed=[teams:absent:absent] route:user stored:team');
  });

  it('a missing stored credential journals the load phase and never calls the provider', async () => {
    const { api, call, changes } = teamFixture({ missing: true });
    const result = await call();
    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    expect(changes).toHaveLength(1);
    expect(changes[0].summary).toBe(
      'SHAPE-FP recheck failed=[load:absent:absent] route:user stored:absent');
  });

  it('a throwing journal write never changes the recheck outcome', async () => {
    const { db, api, accountId } = teamFixture({ journalThrows: true });
    api.when('GET', '/v2/user').rejects(403,
      { error: { code: 'forbidden', message: 'DO_NOT_LEAK' } });
    const err = await recheckStoredToken({ db, accountId, env,
      fetchImpl: api.fetch }).catch(e => e);
    expect(err.probeLeg).toBe('identity');
    expect(err.status).toBe(403);
    expect(err.message).not.toContain('DO_NOT_LEAK');
    expect(db.recordChange).toHaveBeenCalledTimes(1);
  });

  it('provider text, token material and IDs never reach the journal or the result', async () => {
    const { api, call, changes } = teamFixture();
    api.when('GET', '/v2/user').rejects(403, { error: {
      code: 'forbidden',
      message: 'denied for vcp_FAKE_leak_1234567890 on team_FAKE_a'
    } });
    const result = await call();
    const text = result.content[0].text;
    expect(text).not.toContain('vcp_FAKE_leak');
    expect(text).not.toContain('denied for');
    expect(text).not.toContain(token);
    expect(changes).toHaveLength(1);
    expect(changes[0].summary).not.toContain('vcp_FAKE_leak');
    expect(changes[0].summary).not.toContain('team_FAKE_a');
    expect(changes[0].summary).toBe(
      'SHAPE-FP recheck failed=[identity:403:absent] route:user stored:team');
  });

  it('a personal seat journals its own route label', async () => {
    const accountId = 'user_FAKE';
    const changes = [];
    const db = {
      getAccountCredential: vi.fn(async id => id === accountId ? {
        id: accountId, team_id: accountId, project_id: null, scope: 'team',
        token_expires_at: null,
        token_enc: encryptSecret(token, 'token:' + accountId, env),
        token_probe: { accountKind: 'personal' }
      } : null),
      upsertVercelAccount: vi.fn(),
      recordChange: vi.fn(async entry => { changes.push(entry); })
    };
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').rejects(401,
      { error: { code: 'unauthorized', message: 'DO_NOT_LEAK' } });
    const err = await recheckStoredToken({ db, accountId, env,
      fetchImpl: api.fetch }).catch(e => e);
    expect(err.probeLeg).toBe('identity');
    expect(changes).toHaveLength(1);
    expect(changes[0].summary).toBe(
      'SHAPE-FP recheck failed=[identity:401:absent] route:personal stored:team');
  });
});

describe('AUD-AI fingerprint grammar (recheckRefusalSummary)', () => {
  it('screens leg, status and code shapes and stays inside the read bound', () => {
    const summary = recheckRefusalSummary({
      err: Object.assign(new Error('x'), {
        probeLeg: 'configuration_integration', status: 403,
        code: 'integration_configuration_disabled'
      }),
      route: 'installation', storedScope: 'project'
    });
    expect(summary).toBe('SHAPE-FP recheck failed=[configuration_integration:403:' +
      'integration_configuration_disabled] route:installation stored:project');
    expect(summary.length).toBeLessThanOrEqual(160);
  });

  it('falls back to phase/absent for unshaped leg, status and code values', () => {
    const summary = recheckRefusalSummary({
      err: Object.assign(new Error('x'), {
        probeLeg: 'BAD LEG WITH SPACES AND PADDING TO SPARE', status: '403',
        code: 'has spaces; DROP TABLE'
      }),
      phase: 'load', route: 'user', storedScope: 'bogus'
    });
    expect(summary).toBe(
      'SHAPE-FP recheck failed=[load:absent:absent] route:user stored:absent');
  });
});

describe('AUD-AI errors.js probe classification', () => {
  it('names the broader-visibility leg with no status', () => {
    const explained = explainVercelError(Object.assign(
      new Error('Broader token visibility requires explicit owner allowance'),
      { probeLeg: 'broad_visibility' }), { operation: 'vercel_check_token' });
    expect(explained.what).toContain('broader visibility check');
    expect(explained.technical).toContain('recheck_failed');
    expect(explained.technical).not.toContain('HTTP');
  });

  it('an unlegged plain error still classifies as unknown_error, unchanged', () => {
    const explained = explainVercelError(new Error('anything at all'),
      { operation: 'vercel_check_token' });
    expect(explained.what).toBe('Vercel could not complete the request.');
    expect(explained.technical).toContain('unknown_error');
  });

  it('a malformed probeLeg value falls through to the generic buckets', () => {
    const explained = explainVercelError(Object.assign(new Error('x'),
      { probeLeg: 'not a leg' }), { operation: 'vercel_check_token' });
    expect(explained.technical).toContain('unknown_error');
  });
});
