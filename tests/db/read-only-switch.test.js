// AUD-AQ: the read-only switch persists on the token row itself.
// Real Postgres, isolated throwaway schema (the house adapter).
// Three proofs: a fresh token is born switch-off (the migration
// default), a confirmed flip persists and reads back through
// getAccessToken (the read the auth layer actually performs), and
// a connection id that is not the caller's own flips nothing.
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

describe('AUD-AQ read-only switch persistence (Postgres)', () => {
  it('a fresh token row is born with the switch off', async () => {
    const record = await db.getAccessToken(token);
    expect(record.read_only).toBe(false);
    expect(record.connection_id).toMatch(/^conn_[a-f0-9]{20}$/);
  });

  it('a confirmed flip persists and reads back through getAccessToken', async () => {
    const record = await db.getAccessToken(token);
    const flip = await db.setOwnConnectionReadOnly({
      account, connectionId: record.connection_id, readOnly: true
    });
    expect(flip).toEqual({ from: false, to: true });
    expect((await db.getAccessToken(token)).read_only).toBe(true);
    const back = await db.setOwnConnectionReadOnly({
      account, connectionId: record.connection_id, readOnly: false
    });
    expect(back).toEqual({ from: true, to: false });
    expect((await db.getAccessToken(token)).read_only).toBe(false);
  });

  it('a foreign connection id flips nothing, even under the right account name', async () => {
    const other = await db.getAccessToken(otherToken);
    const attempt = await db.setOwnConnectionReadOnly({
      account, connectionId: other.connection_id, readOnly: true
    });
    expect(attempt).toBeNull();
    expect((await db.getAccessToken(otherToken)).read_only).toBe(false);
    expect((await db.getAccessToken(token)).read_only).toBe(false);
  });

  it('malformed flip arguments throw instead of writing', async () => {
    const record = await db.getAccessToken(token);
    await expect(db.setOwnConnectionReadOnly({
      account, connectionId: record.connection_id, readOnly: 'yes'
    })).rejects.toThrow(TypeError);
    await expect(db.setOwnConnectionReadOnly({
      account, connectionId: 'not-a-connection-id', readOnly: true
    })).rejects.toThrow(TypeError);
    expect((await db.getAccessToken(token)).read_only).toBe(false);
  });
});
