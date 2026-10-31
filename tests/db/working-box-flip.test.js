// AUD-BB: the working-box mode persists on the token row itself,
// and a journal row in the handler's exact shape reads back
// through listRecentChanges — the vercel_recent_changes read path.
// Real Postgres, isolated throwaway schema (the house adapter).
// The handler-side journaling itself is pinned in
// tests/unit/working-box-flip.test.js; this tier proves the db
// flip's persistence semantics and that rows of the journaled
// shape survive the real record/read round trip.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { randomToken } from '../../src/core/oauth.js';
import { closeIsolatedSchema, neonShapedQuery, openIsolatedSchema } from '../../test/helpers/pg-neon-adapter.js';

let db;
const account = 'team_FAKE';
const otherAccount = 'team_OTHER';
const token = randomToken();
const otherToken = randomToken();

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be a disposable localhost Postgres');
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) {
    throw new Error('Refusing a remote database');
  }
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await db.createAccessToken({
    accessToken: token, refreshToken: randomToken(), clientId: 'client_fixture',
    vercelAccount: account, mode: 'preview', profile: 'full', listing: 'front_door'
  });
  await db.createAccessToken({
    accessToken: otherToken, refreshToken: randomToken(), clientId: 'client_fixture',
    vercelAccount: otherAccount, mode: 'preview', profile: 'full', listing: 'front_door'
  });
});

afterAll(async () => { await closeIsolatedSchema(); });

describe('AUD-BB working-box persistence (Postgres)', () => {
  it('a fresh token row is born in its issued mode', async () => {
    const record = await db.getAccessToken(token);
    expect(record.mode).toBe('preview');
    expect(record.connection_id).toMatch(/^conn_[a-f0-9]{20}$/);
  });

  it('a confirmed flip persists and reads back through getAccessToken, both ways', async () => {
    const record = await db.getAccessToken(token);
    const flip = await db.setOwnConnectionMode({
      account, connectionId: record.connection_id, mode: 'production'
    });
    expect(flip).toEqual({ from: 'preview', to: 'production' });
    expect((await db.getAccessToken(token)).mode).toBe('production');
    const back = await db.setOwnConnectionMode({
      account, connectionId: record.connection_id, mode: 'preview'
    });
    expect(back).toEqual({ from: 'production', to: 'preview' });
    expect((await db.getAccessToken(token)).mode).toBe('preview');
  });

  it('a same-mode ask reports from === to and changes nothing (the handler journals only an actual change)', async () => {
    const record = await db.getAccessToken(token);
    const noop = await db.setOwnConnectionMode({
      account, connectionId: record.connection_id, mode: 'preview'
    });
    expect(noop).toEqual({ from: 'preview', to: 'preview' });
    expect((await db.getAccessToken(token)).mode).toBe('preview');
  });

  it('a foreign connection id flips nothing, even under the right account name', async () => {
    const other = await db.getAccessToken(otherToken);
    const attempt = await db.setOwnConnectionMode({
      account, connectionId: other.connection_id, mode: 'production'
    });
    expect(attempt).toBeNull();
    expect((await db.getAccessToken(otherToken)).mode).toBe('preview');
    expect((await db.getAccessToken(token)).mode).toBe('preview');
  });

  it('malformed flip arguments throw instead of writing', async () => {
    const record = await db.getAccessToken(token);
    await expect(db.setOwnConnectionMode({
      account, connectionId: record.connection_id, mode: 'account'
    })).rejects.toThrow(TypeError);
    await expect(db.setOwnConnectionMode({
      account, connectionId: 'not-a-connection-id', mode: 'production'
    })).rejects.toThrow(TypeError);
    expect((await db.getAccessToken(token)).mode).toBe('preview');
  });

  it('a journal row in the handler shape reads back through listRecentChanges', async () => {
    const id = await db.recordChange({
      account, mode: 'production', tool: 'vercel_set_working_box',
      summary: 'Working-box mode flipped production to preview on this connection',
      dryRun: false, production: true
    });
    expect(id).toBeTruthy();
    const filtered = await db.listRecentChanges({ account, tool: 'vercel_set_working_box' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ tool: 'vercel_set_working_box', mode: 'production',
      summary: 'Working-box mode flipped production to preview on this connection',
      dry_run: false, production: true });
    const unfiltered = await db.listRecentChanges({ account });
    expect(unfiltered.map(row => row.id)).toContain(id);
    const foreign = await db.listRecentChanges({ account: otherAccount });
    expect(foreign).toHaveLength(0);
  });
});
