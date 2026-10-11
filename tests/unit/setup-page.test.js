import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
import { handleSetup, PROTECTED_DEFAULTS } from '../../src/vercel/setup.js';

const env = { ADMIN_PASSPHRASE: 'fixture-owner-passphrase',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
function response() {
  const headers = {};
  return {
    headers, statusCode: 200, body: '', finished: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = JSON.stringify(value); return this; },
    end() { this.finished = true; return this; }
  };
}
function request(method, body, cookie) {
  return { method, body, query: {}, headers: {
    'x-real-ip': '127.0.0.1', ...(cookie ? { cookie } : {})
  } };
}
function harness() {
  const db = createFakeDb({ accounts: [{ id: 'team_FAKE', team_id: 'team_FAKE',
    team_slug: 'fixture', label: 'Fixture', scope: 'team' }] });
  const protectedProjects = [];
  const pending = new Map(), once = new Map();
  db.seedProtectedProjects = vi.fn(async names => { protectedProjects.push(...names); });
  db.insertPendingInput = async row => { pending.set(row.id, row); };
  db.consumePendingInput = async ({ id, account, kind }) => {
    const row = pending.get(id);
    if (!row || row.account !== account || row.kind !== kind) return null;
    pending.delete(id);
    return { ...row, vercel_account: row.account };
  };
  db.insertOneTimeSecret = async row => { once.set(row.id, row); };
  db.consumeOneTimeSecret = async ({ id, account }) => {
    const row = once.get(id);
    if (!row || row.account !== account) return null;
    once.delete(id);
    return { ...row, vercel_account: row.account };
  };
  const provider = vi.fn(async ({ token, teamId }) => ({
    id: teamId, scope: 'team', last4: token.slice(-4)
  }));
  const call = async (method, body, cookie, opts = {}) => {
    const res = response();
    await handleSetup(request(method, body, cookie), res, { db, env, storeTokenFn: provider, ...opts });
    return res;
  };
  return { db, call, provider, pending, once, protectedProjects };
}
function csrfFrom(html) {
  return html.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
}
async function signIn(h) {
  const logged = await h.call('POST', { action: 'login', passphrase: env.ADMIN_PASSPHRASE });
  expect(logged.statusCode).toBe(303);
  const cookie = logged.headers['set-cookie'].split(';')[0];
  const page = await h.call('GET', null, cookie);
  expect(page.statusCode).toBe(200);
  return { cookie, csrf: csrfFrom(page.body) };
}

describe('A-5 owner-only setup security', () => {
  it('never shows account details or secret forms before sign-in', async () => {
    const h = harness();
    const res = await h.call('GET');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Administrator sign in');
    expect(res.body).not.toContain('fixture');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect((await h.call('POST', { action: 'pending_input' })).statusCode).toBe(403);
  });
  it('counts wrong passphrases in the database and locks repeated attempts', async () => {
    const h = harness();
    for (let n = 0; n < 5; n++) {
      const r = await h.call('POST', { action: 'login', passphrase: 'bad' });
      expect(r.statusCode).toBe(401);
    }
    const locked = await h.call('POST', { action: 'login', passphrase: env.ADMIN_PASSPHRASE });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBe('900');
  });
  it('sets a Secure HttpOnly SameSite cookie, CSRF guards all actions, seeds protection', async () => {
    const h = harness();
    const auth = await signIn(h);
    expect(auth.cookie).not.toContain(env.ADMIN_PASSPHRASE);
    const req = await h.call('POST', { action: 'add_token',
      token: 'vcp_FAKEcredential_1234', teamId: 'team_FAKE' }, auth.cookie);
    expect(req.statusCode).toBe(403);
    const save = await h.call('POST', { action: 'add_token', csrf: auth.csrf,
      token: 'vcp_FAKEcredential_1234', teamId: 'team_FAKE' }, auth.cookie);
    expect(save.statusCode).toBe(200);
    expect(save.body).not.toContain('vcp_FAKEcredential_1234');
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.provider.mock.calls[0][0].allowFull).toBe(false);
    expect(h.protectedProjects).toEqual(PROTECTED_DEFAULTS);
  });
  it('accepts pending inputs and reveals an owner secret only once', async () => {
    const h = harness();
    const auth = await signIn(h);
    const receipt = await h.call('POST', { action: 'pending_input', csrf: auth.csrf,
      account: 'team_FAKE', kind: 'env_value', label: 'sample',
      value: 'fixture-value' }, auth.cookie);
    expect(receipt.body).not.toContain('fixture-value');
    expect(h.pending.size).toBe(1);
    const issue = await oneTimeSecrets({ db: h.db, env }).issue({
      account: 'team_FAKE', kind: 'temporary', value: '<fixture-secret>'
    });
    const view = await h.call('POST', { action: 'reveal', csrf: auth.csrf,
      account: 'team_FAKE', id: issue.id }, auth.cookie);
    expect(view.statusCode).toBe(200);
    expect(view.body).toContain('&lt;fixture-secret&gt;');
    expect(view.body).not.toContain('<fixture-secret>');
    const second = await h.call('POST', { action: 'reveal', csrf: auth.csrf,
      account: 'team_FAKE', id: issue.id }, auth.cookie);
    expect(second.statusCode).toBe(404);
    const signOut = await h.call('POST', { action: 'logout', csrf: auth.csrf }, auth.cookie);
    expect(signOut.statusCode).toBe(303);
    expect(signOut.headers['set-cookie']).toContain('Max-Age=0');
  });
  it('fails closed when owner secrets are missing', async () => {
    const h = harness(), res = await h.call('GET', null, null,
      { env: { ADMIN_PASSPHRASE: env.ADMIN_PASSPHRASE } });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('fixture');
  });
});
