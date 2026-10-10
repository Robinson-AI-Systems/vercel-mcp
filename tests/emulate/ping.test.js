import { beforeAll, describe, expect, it } from 'vitest';

// Runs only through scripts/emulate.sh, which starts Vercel Labs' emulate and sets VERCEL_API_BASE to it.
const base = process.env.VERCEL_API_BASE;
const headers = { Authorization: 'Bearer vcp_FAKEemulateToken', Accept: 'application/json' };

describe('emulate answers the Vercel REST calls the foundation relies on', () => {
  beforeAll(() => {
    if (!base) throw new Error('VERCEL_API_BASE is not set — run `npm run test:emulate`');
    const host = new URL(base).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('emulate tests only ever run against localhost');
  });

  it('GET /v2/user returns the signed-in user as JSON', async () => {
    const res = await fetch(`${base}/v2/user`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/json/);
    const body = await res.json();
    expect(body.user).toEqual(expect.objectContaining({ id: expect.any(String), username: expect.any(String) }));
  });

  it('GET /v10/projects?limit=1 returns a project list with pagination', async () => {
    const res = await fetch(`${base}/v10/projects?limit=1`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.pagination).toEqual(expect.objectContaining({ count: expect.any(Number) }));
  });

  it('refuses a request without a token, in Vercel\'s error envelope', async () => {
    const res = await fetch(`${base}/v2/user`);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toEqual(expect.objectContaining({ code: expect.any(String) }));
  });
});
