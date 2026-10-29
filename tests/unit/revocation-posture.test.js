// AUD-I S5 — revocation honesty + posture. A dead integration
// credential names its cause class in plain words wherever a probe
// surfaces it (A-5: integration_configuration_disabled — the
// installer left the team); recheck routes by account kind, so a
// personal seat is re-proven by the user-keyed probe, never the
// team probe. Disconnect itself is server-side (the revoke paths)
// and never depends on Vercel answering.
import { describe, it, expect } from 'vitest';
import { recheckStoredToken, probeToken } from '../../src/vercel/tokens.js';
import { encryptSecret } from '../../src/core/secret-box.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';

import { randomBytes } from 'node:crypto';
const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const TOKEN = 'vca_FAKEdeadbeefdeadbeefdeadbeef';

function credentialDb({ accountKind } = {}) {
  const id = accountKind === 'personal' ? 'user_FAKE' : 'team_FAKE';
  return {
    async getAccountCredential(requested) {
      if (requested !== id) return null;
      return { id, team_id: id, scope: 'team', project_id: null,
        token_enc: encryptSecret(TOKEN, 'token:' + id, env), token_expires_at: null,
        token_probe: accountKind ? { accountKind, source: 'integration' } : { source: 'token' } };
    }
  };
}

describe('AUD-I S5: dead-credential posture', () => {
  it('names the disabled-integration cause class in plain words', async () => {
    const api = makeFakeVercel();
    api.when('GET', '/v2/user')
      .rejects(403, { error: { code: 'integration_configuration_disabled', message: 'x' } });
    api.when('GET', '/v2/teams').resolves({ teams: [] });
    api.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const err = await probeToken({ token: TOKEN, teamId: 'team_FAKE', fetchImpl: api.fetch }).catch(e => e);
    expect(err.probeLeg).toBe('integration_disabled');
    expect(err.message).toContain('integration behind this connection was disabled');
    expect(err.message).toContain('disconnecting here still completes');
  });

  it('keeps other provider failures on the generic leg message (no leak)', async () => {
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').rejects(403, { error: { code: 'forbidden', message: 'DO_NOT_LEAK' } });
    api.when('GET', '/v2/teams').resolves({ teams: [] });
    api.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const err = await probeToken({ token: TOKEN, teamId: 'team_FAKE', fetchImpl: api.fetch })
      .catch(e => e);
    expect(err.probeLeg).toBe('identity');
    expect(err.message).not.toContain('forbidden');
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('AUD-I S5: recheck routes by account kind', () => {
  it('re-proves a personal seat through the user-keyed probe', async () => {
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE', username: 'fake', name: 'Fake' } });
    api.when('GET', '/v2/teams').resolves({ teams: [] });
    api.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const result = await recheckStoredToken({
      db: credentialDb({ accountKind: 'personal' }), accountId: 'user_FAKE', env, fetchImpl: api.fetch
    });
    expect(result.access).toBe('read_verified');
    expect(result.accountKind).toBe('personal');
    // The user-keyed probe is unscoped: no call carried a teamId.
    for (const call of api.calls) expect(call.query.teamId).toBeUndefined();
  });

  it('re-proves a team seat through the team probe as before', async () => {
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
    api.when('GET', '/v2/teams').resolves({ teams: [{ id: 'team_FAKE', slug: 'test-team' }] });
    api.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    const result = await recheckStoredToken({
      db: credentialDb(), accountId: 'team_FAKE', env, fetchImpl: api.fetch
    });
    expect(result.access).toBe('read_verified');
    expect(result.accountKind).toBeUndefined();
    expect(result.teamSlug).toBe('test-team');
  });

  it('surfaces the disabled class through recheck for an install seat', async () => {
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').rejects(403, { error: { code: 'integration_configuration_disabled', message: 'x' } });
    api.when('GET', '/v2/teams').resolves({ teams: [] });
    api.when('GET', '/v10/projects').resolves({ projects: [], pagination: { next: null } });
    await expect(recheckStoredToken({
      db: credentialDb(), accountId: 'team_FAKE', env, fetchImpl: api.fetch
    })).rejects.toThrow(/integration behind this connection was disabled/);
  });
});
