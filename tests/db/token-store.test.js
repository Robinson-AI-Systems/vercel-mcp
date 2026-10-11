import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { storeToken, loadToken } from '../../src/vercel/tokens.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
let db;
function api() {
  const mock = makeFakeVercel();
  mock.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
  mock.when('GET', '/v2/teams').resolves({ teams: [{ id: 'team_FAKE', slug: 'fixture-team', name: 'Fixture Team' }] });
  mock.when('GET', '/v10/projects').resolves({ projects: [{ id: 'prj_FAKE', name: 'fixture' }], pagination: {} });
  return mock;
}
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname)) {
    throw new Error('Only disposable localhost Postgres is allowed');
  }
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => closeIsolatedSchema());

describe('Postgres encrypted account persistence and rotation', () => {
  it('stores ciphertext only, decrypts server side, preserves production safety on rotation', async () => {
    const first = 'vcp_FAKEpostgresToken_1111';
    const receipt = await storeToken({ db, token: first, teamId: 'team_FAKE',
      env, fetchImpl: api().fetch });
    expect(receipt.scope).toBe('team');
    const rows = await rawQuery(
      'SELECT token_enc, token_last4, production_enabled FROM vercel_accounts WHERE id = $1', ['team_FAKE']
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_enc).not.toContain(first);
    expect(rows[0].token_last4).toBe('1111');
    expect(rows[0].production_enabled).toBe(false);
    expect((await loadToken({ db, accountId: 'team_FAKE', env })).token).toBe(first);

    await rawQuery('UPDATE vercel_accounts SET production_enabled = TRUE WHERE id = $1', ['team_FAKE']);
    const updated = 'vcp_FAKEpostgresToken_2222';
    await storeToken({ db, token: updated, teamId: 'team_FAKE', env, fetchImpl: api().fetch });
    const rotated = await rawQuery(
      'SELECT token_enc, token_last4, production_enabled FROM vercel_accounts WHERE id = $1', ['team_FAKE']
    );
    expect(rotated).toHaveLength(1);
    expect(rotated[0].token_last4).toBe('2222');
    expect(rotated[0].production_enabled).toBe(true);
    expect(rotated[0].token_enc).not.toContain(updated);
    expect((await loadToken({ db, accountId: 'team_FAKE', env })).token).toBe(updated);
  });

  it('isolates a project-scoped account from its containing team credential', async () => {
    await storeToken({ db, token: 'vcp_FAKEprojectToken_3333', teamId: 'team_FAKE',
      projectId: 'prj_FAKE', env, fetchImpl: api().fetch });
    const scoped = await loadToken({ db, accountId: 'team_FAKE/prj_FAKE', env });
    expect(scoped.account.project_id).toBe('prj_FAKE');
    expect(scoped.token).toBe('vcp_FAKEprojectToken_3333');
    expect((await loadToken({ db, accountId: 'team_FAKE', env })).token)
      .toBe('vcp_FAKEpostgresToken_2222');
  });
});
