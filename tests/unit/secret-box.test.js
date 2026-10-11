import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../../src/core/secret-box.js';

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const fakeSecret = 'vcp_FAKEexampleSecretValue_123456789';

describe('server-only authenticated credential encryption', () => {
  it('round-trips with random IVs and never records plaintext', () => {
    const first = encryptSecret(fakeSecret, 'token:account_FAKE', env);
    const second = encryptSecret(fakeSecret, 'token:account_FAKE', env);
    expect(first).not.toBe(second);
    expect(first).not.toContain(fakeSecret);
    expect(decryptSecret(first, 'token:account_FAKE', env)).toBe(fakeSecret);
    expect(decryptSecret(second, 'token:account_FAKE', env)).toBe(fakeSecret);
  });
  it('rejects swapping ciphertext between accounts', () => {
    const box = encryptSecret(fakeSecret, 'token:account_A', env);
    expect(() => decryptSecret(box, 'token:account_B', env)).toThrow(/Unable to decrypt/);
  });
  it('rejects invalid, absent or weak keys and tampered ciphertext', () => {
    const box = encryptSecret(fakeSecret, 'pending:account_A', env);
    expect(() => decryptSecret(box.slice(0, -1) + 'A', 'pending:account_A', env)).toThrow();
    expect(() => encryptSecret(fakeSecret, 'pending:account_A', {})).toThrow(/not configured/);
    expect(() => encryptSecret(fakeSecret, 'pending:account_A', { TOKEN_ENCRYPTION_KEY: 'weak' }))
      .toThrow(/32-byte/);
    expect(() => decryptSecret(box, 'pending:account_A', { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') }))
      .toThrow(/Unable to decrypt/);
  });
  it('supports strict base64url keys, bounds secrets and requires a purpose', () => {
    const base64env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64url') };
    const ciphertext = encryptSecret('fixture-value', 'once:ref_FAKE', base64env);
    expect(decryptSecret(ciphertext, 'once:ref_FAKE', base64env)).toBe('fixture-value');
    expect(() => encryptSecret('x'.repeat(65537), 'once:ref_FAKE', env)).toThrow(/too large/);
    expect(() => encryptSecret('', 'once:ref_FAKE', env)).toThrow(/non-empty/);
    expect(() => encryptSecret('fixture', '', env)).toThrow(/purpose/);
  });
});
