import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
import { pendingInputs } from '../../src/core/pending-inputs.js';

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
function fakeDb() {
  const one = new Map(), pending = new Map();
  return {
    one, pending,
    async insertOneTimeSecret(row) { one.set(row.id, structuredClone(row)); },
    async consumeOneTimeSecret({ id, account }) {
      const row = one.get(id);
      if (!row || row.account !== account && row.vercel_account !== account) return null;
      one.delete(id);
      return { ...row, vercel_account: row.account };
    },
    async insertPendingInput(row) { pending.set(row.id, structuredClone(row)); },
    async consumePendingInput({ id, account, kind }) {
      const row = pending.get(id);
      if (!row || row.account !== account || row.kind !== kind) return null;
      pending.delete(id);
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
  it('pending inputs require exact account/kind and are atomically consumed', async () => {
    const db = fakeDb();
    const p = pendingInputs({ db, env });
    const receipt = await p.submit({ account: 'team_FAKE', kind: 'env_value',
      label: 'fake key', value: 'fake value' });
    expect(JSON.stringify([...db.pending.values()])).not.toContain('fake value');
    expect(await p.consume({ id: receipt.id, account: 'another', kind: 'env_value' })).toBeNull();
    expect(await p.consume({ id: receipt.id, account: 'team_FAKE', kind: 'deploy_password' })).toBeNull();
    expect(await p.consume({ id: receipt.id, account: 'team_FAKE', kind: 'env_value' })).toBe('fake value');
    expect(await p.consume({ id: receipt.id, account: 'team_FAKE', kind: 'env_value' })).toBeNull();
    await expect(p.submit({ account: 'team_FAKE', kind: 'unknown', label: 'x', value: 'x' }))
      .rejects.toThrow(/Invalid pending/);
  });
});
