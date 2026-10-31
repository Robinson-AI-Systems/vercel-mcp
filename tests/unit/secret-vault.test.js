import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
function fakeDb() {
  const one = new Map();
  return {
    one,
    async insertOneTimeSecret(row) { one.set(row.id, structuredClone(row)); },
    async consumeOneTimeSecret({ id, account }) {
      const row = one.get(id);
      if (!row || row.account !== account && row.vercel_account !== account) return null;
      one.delete(id);
      return { ...row, vercel_account: row.account };
    }
  };
}

describe('single-use server-only secret services', () => {
  it('reveals once, never stores plaintext or returns values in creation receipts', async () => {
    const db = fakeDb();
    const secrets = oneTimeSecrets({ db, env });
    const value = 'vcp_FAKEsecretSample_123456';
    const issued = await secrets.issue({ account: 'team_FAKE', kind: 'new_token', value });
    expect(JSON.stringify(issued)).not.toContain(value);
    expect(JSON.stringify([...db.one.values()])).not.toContain(value);
    expect(await secrets.reveal({ id: issued.id, account: 'another-team' })).toBeNull();
    expect((await secrets.reveal({ id: issued.id, account: 'team_FAKE' })).value).toBe(value);
    expect(await secrets.reveal({ id: issued.id, account: 'team_FAKE' })).toBeNull();
  });
});
