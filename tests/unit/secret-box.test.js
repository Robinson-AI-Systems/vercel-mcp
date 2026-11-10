import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, readPreviousKeys } from '../../src/core/secret-box.js';

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
    const parts = box.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    expect(() => decryptSecret(parts.join('.'), 'pending:account_A', env)).toThrow();
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

describe('previous-key read support (TOKEN_ENCRYPTION_KEY_PREVIOUS)', () => {
  const oldKeyHex = randomBytes(32).toString('hex');
  const olderKeyB64 = randomBytes(32).toString('base64url');
  const newKeyHex = randomBytes(32).toString('hex');
  const oldEnv = { TOKEN_ENCRYPTION_KEY: oldKeyHex };
  const rotatedEnv = { TOKEN_ENCRYPTION_KEY: newKeyHex, TOKEN_ENCRYPTION_KEY_PREVIOUS: oldKeyHex };

  it('decrypts values sealed under the old key after a rotation', () => {
    const box = encryptSecret(fakeSecret, 'token:account_FAKE', oldEnv);
    expect(decryptSecret(box, 'token:account_FAKE', rotatedEnv)).toBe(fakeSecret);
  });

  it('seals new values with the current key only', () => {
    const box = encryptSecret(fakeSecret, 'token:account_FAKE', rotatedEnv);
    expect(decryptSecret(box, 'token:account_FAKE', { TOKEN_ENCRYPTION_KEY: newKeyHex })).toBe(fakeSecret);
    expect(() => decryptSecret(box, 'token:account_FAKE', oldEnv)).toThrow(/Unable to decrypt/);
  });

  it('behaves exactly as before when PREVIOUS is unset', () => {
    const box = encryptSecret(fakeSecret, 'token:account_FAKE', oldEnv);
    expect(decryptSecret(box, 'token:account_FAKE', oldEnv)).toBe(fakeSecret);
    expect(() => decryptSecret(box, 'token:account_FAKE', { TOKEN_ENCRYPTION_KEY: newKeyHex }))
      .toThrow(/Unable to decrypt/);
    expect(readPreviousKeys({})).toEqual([]);
    expect(readPreviousKeys({ TOKEN_ENCRYPTION_KEY_PREVIOUS: '  ' })).toEqual([]);
  });

  it('accepts up to two previous keys in either key shape', () => {
    const sealedByOlder = encryptSecret(fakeSecret, 'token:account_FAKE',
      { TOKEN_ENCRYPTION_KEY: olderKeyB64 });
    const env = { TOKEN_ENCRYPTION_KEY: newKeyHex,
      TOKEN_ENCRYPTION_KEY_PREVIOUS: oldKeyHex + ',' + olderKeyB64 };
    expect(decryptSecret(sealedByOlder, 'token:account_FAKE', env)).toBe(fakeSecret);
    expect(readPreviousKeys(env)).toHaveLength(2);
  });

  it('validates the previous-key setting and never lets it weaken the current key', () => {
    expect(() => readPreviousKeys({ TOKEN_ENCRYPTION_KEY_PREVIOUS: 'weak' })).toThrow(/32-byte/);
    expect(() => readPreviousKeys({ TOKEN_ENCRYPTION_KEY_PREVIOUS:
      [oldKeyHex, oldKeyHex, oldKeyHex].join(',') })).toThrow(/at most two/);
    const box = encryptSecret(fakeSecret, 'token:account_FAKE', { TOKEN_ENCRYPTION_KEY: newKeyHex });
    const messy = { TOKEN_ENCRYPTION_KEY: newKeyHex, TOKEN_ENCRYPTION_KEY_PREVIOUS: 'weak' };
    expect(decryptSecret(box, 'token:account_FAKE', messy)).toBe(fakeSecret);
  });
});
