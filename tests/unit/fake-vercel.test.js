import { describe, expect, it } from 'vitest';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';

const AUTH = { Authorization: 'Bearer vcp_FAKEunitTestToken0000000000' };

describe('fake Vercel API', () => {
  it('matches path patterns with parameters ({name} and :name) and records params and query', async () => {
    const vercel = makeFakeVercel();
    vercel.when('GET', '/v9/projects/{idOrName}').resolves({ id: 'prj_FAKE1', name: 'demo' });
    vercel.when('GET', '/v6/deployments/:id/events').resolves([]);
    const res = await vercel.fetch('https://api.vercel.com/v9/projects/my%20app?teamId=team_FAKE1&limit=5', { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'prj_FAKE1', name: 'demo' });
    await vercel.fetch('/v6/deployments/dpl_FAKE9/events?tag=a&tag=b');
    expect(vercel.calls[0]).toMatchObject({ method: 'GET', path: '/v9/projects/my%20app',
      params: { idOrName: 'my app' }, query: { teamId: 'team_FAKE1', limit: '5' } });
    expect(vercel.calls[1]).toMatchObject({ params: { id: 'dpl_FAKE9' }, query: { tag: ['a', 'b'] } });
  });

  it('records a JSON body and never records the token', async () => {
    const vercel = makeFakeVercel();
    vercel.when('POST', '/v10/projects/{idOrName}/env').resolves({ created: { key: 'A' } }, 201);
    const res = await vercel.fetch('https://api.vercel.com/v10/projects/demo/env', {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'A', target: ['preview'] })
    });
    expect(res.status).toBe(201);
    expect(vercel.calls[0].body).toEqual({ key: 'A', target: ['preview'] });
    expect(vercel.calls[0].headers.authorization).toBe('Bearer [hidden]');
    expect(JSON.stringify(vercel.calls)).not.toContain('vcp_FAKEunitTestToken');
  });

  it('accepts a Request object as input', async () => {
    const vercel = makeFakeVercel();
    vercel.when('PATCH', '/v9/projects/{idOrName}').resolves({ ok: true });
    await vercel.fetch(new Request('https://api.vercel.com/v9/projects/demo', {
      method: 'PATCH', headers: { ...AUTH, 'content-type': 'application/json' }, body: '{"framework":null}' }));
    expect(vercel.calls[0]).toMatchObject({ method: 'PATCH', body: { framework: null },
      headers: { authorization: 'Bearer [hidden]' } });
  });

  it('answers configured errors in Vercel\'s error envelope, then the next response (last one repeats)', async () => {
    const vercel = makeFakeVercel();
    vercel.when('GET', '/v2/user').rejects(503).resolves({ user: { id: 'u' } });
    const first = await vercel.fetch('/v2/user');
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ error: { code: 'service_unavailable', message: expect.any(String) } });
    expect((await vercel.fetch('/v2/user')).status).toBe(200);
    expect((await vercel.fetch('/v2/user')).status).toBe(200);
    vercel.when('DELETE', '/v9/projects/{idOrName}').rejects(403, { error: { code: 'forbidden', message: 'No access' } });
    expect(await (await vercel.fetch('/v9/projects/x', { method: 'DELETE' })).json())
      .toEqual({ error: { code: 'forbidden', message: 'No access' } });
  });

  it('configured 429 has Vercel\'s rate_limited body and headers', async () => {
    const now = 1_800_000_000_000;
    const vercel = makeFakeVercel({ now: () => now });
    vercel.when('POST', '/v13/deployments').rateLimited(2500, 60);
    const res = await vercel.fetch('/v13/deployments', { method: 'POST', body: '{}' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: 'rate_limited', message: 'Rate limit exceeded',
      limit: { remaining: 0, reset: Math.ceil((now + 2500) / 1000), resetMs: now + 2500, total: 60 } } });
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(res.headers.get('x-ratelimit-reset')).toBe(String(Math.ceil((now + 2500) / 1000)));
  });

  it('fails loudly on an unmatched call, even if the caller swallows the error', async () => {
    const vercel = makeFakeVercel();
    vercel.when('GET', '/v9/projects/{idOrName}').resolves({});
    await expect(vercel.fetch('/v9/projects/a', { method: 'DELETE' })).rejects.toThrow(/unexpected call DELETE \/v9\/projects\/a/);
    await vercel.fetch('/v10/projects').catch(() => {});
    expect(vercel.unmatched).toEqual(['DELETE /v9/projects/a', 'GET /v10/projects']);
    expect(() => vercel.verify()).toThrow(/unexpected calls/);
  });

  it('the newest matching rule wins, so a test can override a default', async () => {
    const vercel = makeFakeVercel();
    vercel.when('GET', '/v2/teams').resolves({ teams: [] });
    vercel.when('GET', '/v2/teams').resolves({ teams: [{ id: 'team_FAKE1' }] });
    expect(await (await vercel.fetch('/v2/teams')).json()).toEqual({ teams: [{ id: 'team_FAKE1' }] });
    expect(() => vercel.verify()).not.toThrow();
  });
});
