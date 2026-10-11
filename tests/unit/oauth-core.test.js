import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  clientIp, evaluateLogin, hashToken, LOCKOUT_WINDOW_MINUTES, MAX_FAILED_LOGINS,
  randomToken, secretsMatch, validRedirectUri, verifyPkce
} from '../../src/core/oauth.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

describe('portable OAuth security primitives', () => {
  it('generates random tokens and hashes credentials without exposing their value', () => {
    const first = randomToken(32);
    const second = randomToken(32);
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(32);
    expect(hashToken(first)).toBe(hashToken(first));
    expect(hashToken(first)).not.toContain(first);
    expect(secretsMatch(first, first)).toBe(true);
    expect(secretsMatch(first, second)).toBe(false);
    expect(secretsMatch('', 'configured-secret')).toBe(false);
    expect(secretsMatch('supplied-secret', '')).toBe(false);
    expect(() => hashToken('')).toThrow(/non-empty/);
  });

  it('requires S256 PKCE with a valid verifier and challenge', () => {
    const verifier = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
    expect(verifyPkce(verifier, challenge, 'plain')).toBe(false);
    expect(verifyPkce(`wrong-${verifier}`, challenge)).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
    expect(verifyPkce(verifier, undefined)).toBe(false);
  });

  it('accepts HTTPS and localhost redirects, rejecting insecure or open redirect forms', () => {
    expect(validRedirectUri('https://example.test/connector/callback')).toBe(true);
    expect(validRedirectUri('http://localhost:3456/callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:2345/callback')).toBe(true);
    for (const value of [
      'http://example.test/callback', 'javascript:alert(1)', 'https://user:pass@example.test/cb',
      'https://example.test/cb#fragment', 'not a URL'
    ]) expect(validRedirectUri(value)).toBe(false);
  });

  it('uses trusted platform IP headers and refuses caller-controlled forwarded-for', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.1' } })).toBe('unknown');
    expect(clientIp({ headers: { 'x-real-ip': '198.51.100.2' } })).toBe('198.51.100.2');
    expect(clientIp({ headers: { 'x-vercel-forwarded-for': '198.51.100.3' } })).toBe('198.51.100.3');
    expect(clientIp({ socket: { remoteAddress: '::ffff:198.51.100.4' } })).toBe('198.51.100.4');
  });

  it('locks after five failed attempts for fifteen minutes and then allows login', async () => {
    let now = 1_000_000;
    const db = createFakeDb({ clock: () => now });
    for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt++) {
      const result = await evaluateLogin({ ip: '192.0.2.1', supplied: 'wrong', expected: 'correct', store: db });
      expect(result.status).toBe('wrong');
    }
    expect((await evaluateLogin({
      ip: '192.0.2.1', supplied: 'correct', expected: 'correct', store: db
    })).status).toBe('locked');
    expect(LOCKOUT_WINDOW_MINUTES).toBe(15);
    now += 16 * 60_000;
    expect((await evaluateLogin({
      ip: '192.0.2.1', supplied: 'correct', expected: 'correct', store: db
    })).status).toBe('ok');
  });

  it('fails closed when the passphrase is not configured and handles empty submissions safely', async () => {
    const db = createFakeDb();
    await expect(evaluateLogin({ ip: 'unknown', supplied: '', expected: '', store: db }))
      .rejects.toThrow(/not configured/);
    expect((await evaluateLogin({
      ip: '192.0.2.2', supplied: '', expected: 'configured-secret', store: db
    })).status).toBe('wrong');
  });
});
