import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { closeIsolatedSchema, neonShapedQuery, openIsolatedSchema, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let store;
beforeAll(async () => {
  const dbUrl = process.env.TEST_DATABASE_URL;
  if (!dbUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(dbUrl).hostname)) {
    throw new Error('Replay tests require disposable localhost Postgres');
  }
  await openIsolatedSchema(dbUrl);
  const db = createDb(neonShapedQuery());
  await db.initSchema();
  store = db.requestReplayStore();
});
afterAll(async () => { await closeIsolatedSchema(); });

describe('atomic durable write replay in Postgres', () => {
  const claim = key => store.claim({ key, account: 'account_FAKE', mode: 'preview', tool: 'projects_create', ttlMs: 600000 });

  it('only one of two competing claims wins, and a repeated key returns shaped saved output', async () => {
    const [first, second] = await Promise.all([claim('same_request_key_123'), claim('same_request_key_123')]);
    const claimed = [first, second].filter(x => x.state === 'claimed');
    expect(claimed).toHaveLength(1);
    expect([first.state, second.state].sort()).toEqual(['claimed', 'pending']);
    await store.complete({ key: 'same_request_key_123', claimId: claimed[0].claimId,
      result: { id: 'prj_FAKE' } });
    expect(await claim('same_request_key_123')).toEqual({ state: 'completed', result: { id: 'prj_FAKE' } });
    const rows = await rawQuery("SELECT request_key, status, result FROM request_replay WHERE request_key = 'same_request_key_123'");
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toEqual({ id: 'prj_FAKE' });
  });

  it('releases only its own pending refusal and allows the same request key',async()=>{
    const first=await claim('preflight_release_test_123');
    expect(first.state).toBe('claimed');
    await expect(store.release({key:'preflight_release_test_123',claimId:'wrong_claim'})).rejects.toThrow();
    expect((await claim('preflight_release_test_123')).state).toBe('pending');
    await store.release({key:'preflight_release_test_123',claimId:first.claimId});
    const second=await claim('preflight_release_test_123');
    expect(second.state).toBe('claimed');
    await expect(store.release({key:'preflight_release_test_123',claimId:first.claimId})).rejects.toThrow();
    await store.complete({key:'preflight_release_test_123',claimId:second.claimId,result:{confirmed:true}});
    expect((await claim('preflight_release_test_123')).state).toBe('completed');
  });
  it('expired claim can be safely reissued, but an old claimant cannot complete it', async () => {
    const old = await claim('expired_request_key_123');
    expect(old.state).toBe('claimed');
    await rawQuery("UPDATE request_replay SET expires_at = now() - interval '1 minute' WHERE request_key = 'expired_request_key_123'");
    const fresh = await claim('expired_request_key_123');
    expect(fresh.state).toBe('claimed');
    expect(fresh.claimId).not.toBe(old.claimId);
    await expect(store.complete({ key: 'expired_request_key_123', claimId: old.claimId,
      result: { ok: true } })).rejects.toThrow(/expired or was replaced/);
    await store.complete({ key: 'expired_request_key_123', claimId: fresh.claimId, result: { ok: true } });
    expect(await claim('expired_request_key_123')).toEqual({ state: 'completed', result: { ok: true } });
  });

  it('never persists oversized or missing shaped results', async () => {
    const current = await claim('big_request_key_123');
    await expect(store.complete({ key: 'big_request_key_123', claimId: current.claimId,
      result: { text: 'x'.repeat(9000) } })).rejects.toThrow(/safe storage limit/);
    await expect(store.complete({ key: 'big_request_key_123', claimId: current.claimId }))
      .rejects.toThrow(/shaped result/);
  });
});
