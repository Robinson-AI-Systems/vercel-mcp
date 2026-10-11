import { describe, expect, it, vi } from 'vitest';
import { makeVercelClient, requestKey, OPENAPI_SNAPSHOT } from '../../src/vercel/client.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';

const account = { id: 'account_FAKE', team_id: 'team_FAKE' };
const token = 'vcp_FAKE_client';
function create(fake, extra = {}) {
  return makeVercelClient({ token, account, fetchImpl: fake.fetch, ...extra });
}
function replay() {
  const states = new Map();
  return {
    states,
    async claim({ key }) {
      if (!states.has(key)) { states.set(key, { state: 'pending' }); return { state: 'claimed' }; }
      return states.get(key);
    },
    async complete({ key, result }) { states.set(key, { state: 'completed', result }); }
  };
}

describe('A-4 Vercel HTTP client', () => {
  it('hashes canonical scoped request values but ignores presentation flags', () => {
    const ctx = { account: account.id, mode: 'preview', now: 1000000 };
    const a = requestKey(ctx, 'deploy', { b: 2, a: 1, confirm: true, dryRun: true });
    const b = requestKey(ctx, 'deploy', { a: 1, b: 2, fields: ['x'], detail: 'full' });
    expect(a).toBe(b);
    expect(a).not.toBe(requestKey({ ...ctx, account: 'other' }, 'deploy', { a: 1, b: 2 }));
    expect(a).not.toBe(requestKey({ ...ctx, now: 1600000 }, 'deploy', { a: 1, b: 2 }));
    expect(requestKey(ctx, 'deploy', { requestKey: 'caller_override_123' })).toBe('caller_override_123');
    expect(() => requestKey(ctx, 'deploy', { requestKey: '..' })).toThrow();
    expect(OPENAPI_SNAPSHOT.operations).toBe(451);
  });

  it('injects teamId and only calls published operations', async () => {
    const fake = makeFakeVercel();
    fake.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
    expect(await create(fake).request('user_get')).toEqual({ user: { id: 'user_FAKE' } });
    expect(fake.calls[0].query.teamId).toBe('team_FAKE');
    expect(fake.calls[0].headers.authorization).toBe('Bearer [hidden]');
    await expect(create(fake).request('user_get', { query: { teamId: 'other' } }))
      .rejects.toMatchObject({ code: 'team_scope_mismatch' });
    await expect(create(fake).request('unknown')).rejects.toThrow(/Unknown Vercel operation/);
    fake.verify();
  });

  it('retries GET once on a 503 and not a successful call', async () => {
    const fake = makeFakeVercel();
    fake.when('GET', '/v2/user').rejects(503).resolves({ user: { id: 'x' } });
    const client = create(fake);
    expect(await client.request('user_get')).toEqual({ user: { id: 'x' } });
    expect(fake.calls).toHaveLength(2);
  });

  it('turns rate limits into a bounded retry only for reads', async () => {
    const fake = makeFakeVercel({ now: () => 100000 });
    fake.when('GET', '/v2/user').rateLimited(2000).resolves({ ok: true });
    const wait = vi.fn(async () => {});
    expect(await create(fake, { now: () => 100000, sleep: wait }).request('user_get')).toEqual({ ok: true });
    expect(wait).toHaveBeenCalledWith(2000);
    const limited = makeFakeVercel({ now: () => 100000 });
    limited.when('GET', '/v2/user').rateLimited(8000);
    await expect(create(limited, { now: () => 100000, sleep: wait }).request('user_get'))
      .rejects.toMatchObject({ code: 'rate_limited' });
    expect(limited.calls).toHaveLength(1);
  });

  it('fails closed on writes without durable replay and a shaping function', async () => {
    const fake = makeFakeVercel();
    await expect(create(fake).request('projects_create', { body: { name: 'demo' } }))
      .rejects.toMatchObject({ code: 'write_guard_unavailable' });
    expect(fake.calls).toHaveLength(0);
  });

  it('never retries a POST and returns shaped saved output on a repeated request key', async () => {
    const fake = makeFakeVercel();
    const store = replay();
    fake.when('POST', '/v11/projects').resolves({ id: 'prj_FAKE_new', token: 'hidden' });
    const client = create(fake, { replayStore: store, now: () => 100000 });
    const options = { requestKey: 'approved_write_123', shapeResult: raw => ({ id: raw.id }) };
    const args = { body: { name: 'demo' } };
    expect(await client.request('projects_create', args, options)).toEqual({ id: 'prj_FAKE_new' });
    expect(await client.request('projects_create', args, options)).toEqual({ id: 'prj_FAKE_new' });
    expect(fake.calls).toHaveLength(1);
    expect(JSON.stringify([...store.states.values()])).not.toContain('hidden');

    const fail = makeFakeVercel();
    fail.when('POST', '/v11/projects').rejects(503);
    await expect(create(fail, { replayStore: replay() }).request('projects_create', args, options))
      .rejects.toMatchObject({ status: 503 });
    expect(fail.calls).toHaveLength(1);
  });

  it('caps pagination and rejects repeated cursor loops', async () => {
    const fake = makeFakeVercel();
    fake.when('GET', '/v10/projects').resolves({ projects: [{ id: '1' }, { id: '2' }],
      pagination: { next: null } });
    expect(await create(fake).paginate('projects_list', {}, { max: 2 }))
      .toEqual({ items: [{ id: '1' }, { id: '2' }], capped: false });
    expect(fake.calls[0].query.teamId).toBe('team_FAKE');
    await expect(create(fake).paginate('projects_list', {}, { max: 0 })).rejects.toThrow();
  });
});
