import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
import { pendingInputs } from '../../src/core/pending-inputs.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let one, pending;
const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Only disposable localhost Postgres is permitted');
  }
  await openIsolatedSchema(url);
  const db = createDb(neonShapedQuery());
  await db.initSchema();
  one = oneTimeSecrets({ db, env });
  pending = pendingInputs({ db, env });
});
afterAll(async () => closeIsolatedSchema());

describe('atomic one-use database secrets', () => {
  it('only one concurrent request receives one-time secret value', async () => {
    const ref = await one.issue({ account: 'team_FAKE', kind: 'new_token', value: 'vcp_FAKEstorage' });
    const raw = await rawQuery('SELECT ciphertext FROM one_time_secrets WHERE id = $1', [ref.id]);
    expect(raw[0].ciphertext).not.toContain('vcp_FAKEstorage');
    const vals = await Promise.all([one.reveal({ id: ref.id, account: 'team_FAKE' }),
      one.reveal({ id: ref.id, account: 'team_FAKE' })]);
    expect(vals.filter(Boolean)).toHaveLength(1);
    expect(vals.find(Boolean).value).toBe('vcp_FAKEstorage');
  });
  it('wrong account cannot consume; expiration prevents later use', async () => {
    const ref = await one.issue({ account: 'team_A', kind: 'new_token', value: 'vcp_FAKEsample' });
    expect(await one.reveal({ id: ref.id, account: 'team_B' })).toBeNull();
    await rawQuery("UPDATE one_time_secrets SET expires_at = now() - interval '1 second' WHERE id = $1", [ref.id]);
    expect(await one.reveal({ id: ref.id, account: 'team_A' })).toBeNull();
  });
  it('pending input is consumed once across concurrent callers with account/kind fencing', async () => {
    const ref = await pending.submit({ account: 'team_A', kind: 'env_value', label: 'SAMPLE', value: 'vcp_FAKEvalue' });
    expect(await pending.consume({ id: ref.id, account: 'team_B', kind: 'env_value' })).toBeNull();
    expect(await pending.consume({ id: ref.id, account: 'team_A', kind: 'deploy_password' })).toBeNull();
    const result = await Promise.all([pending.consume({ id: ref.id, account: 'team_A', kind: 'env_value' }),
      pending.consume({ id: ref.id, account: 'team_A', kind: 'env_value' })]);
    expect(result.filter(Boolean)).toEqual(['vcp_FAKEvalue']);
    expect(await rawQuery('SELECT id FROM pending_inputs WHERE id = $1', [ref.id])).toHaveLength(0);
  });
});
