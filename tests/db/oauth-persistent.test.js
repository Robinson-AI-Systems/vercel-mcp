import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';
import { closeIsolatedSchema, neonShapedQuery, openIsolatedSchema, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let db;
const env = {
  PUBLIC_BASE_URL: 'https://vercel-mcp.example.test',
  ADMIN_PASSPHRASE: 'throwaway-test-passphrase',
  VERCEL_ENV: 'preview'
};
const callback = 'https://client.example.test/callback';
const resource = env.PUBLIC_BASE_URL + '/api/mcp';
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function request(method, data) {
  return {
    method, headers: {},
    body: method === 'GET' ? undefined : data,
    query: method === 'GET' ? data : undefined,
    socket: { remoteAddress: '198.51.100.10' }
  };
}
function response() {
  return {
    statusCode: 200, headers: {}, body: null, ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = JSON.stringify(value); return this; },
    end() { this.ended = true; return this; }
  };
}
async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}
const json = (res) => JSON.parse(res.body);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be a disposable localhost Postgres');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) {
    throw new Error('Refusing a remote database');
  }
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery(`INSERT INTO vercel_accounts
    (id, team_id, team_slug, label, scope, token_enc, token_last4, production_enabled, is_default)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['team_persistent_fixture','team_persistent_fixture','fixture','Persistent fixture','team','fake-ciphertext','1234',false,true]);
});
afterAll(async () => { await closeIsolatedSchema(); });

describe('A-3b OAuth persistence on throwaway PostgreSQL', () => {
  it('lists connection metadata without exposing encrypted account credentials', async () => {
    const accounts = await db.listVercelAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      id: 'team_persistent_fixture', label: 'Persistent fixture',
      production_enabled: false, is_default: true
    });
    expect(JSON.stringify(accounts)).not.toContain('fake-ciphertext');
    expect(JSON.stringify(accounts)).not.toContain('token_enc');
  });

  it('completes an authorization-code exchange and refresh with persistent connection settings', async () => {
    const service = createVercelLoginService(db);
    const handlers = createOAuthHandlers({ db, env, service });
    const registered = await call(handlers.register, request('POST', {
      redirect_uris: [callback], client_name: 'Persistent fixture'
    }));
    expect(registered.statusCode).toBe(201);
    const client = json(registered);
    const params = {
      client_id: client.client_id, redirect_uri: callback, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', resource,
      state: 'persistent-state', account: 'team_persistent_fixture',
      mode: 'preview', profile: 'read_only', listing: 'compact'
    };
    const authorized = await call(handlers.authorize, request('POST', {
      ...params, passphrase: env.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    const granted = await call(handlers.token, request('POST', {
      grant_type: 'authorization_code', client_id: client.client_id,
      client_secret: client.client_secret, redirect_uri: callback,
      code, code_verifier: verifier, resource
    }));
    expect(granted.statusCode).toBe(200);
    const first = json(granted);
    expect(await db.getAccessToken(first.access_token)).toMatchObject({
      vercel_account: 'team_persistent_fixture', mode: 'preview',
      profile: 'read_only', listing: 'compact'
    });
    const refreshed = await call(handlers.token, request('POST', {
      grant_type: 'refresh_token', client_id: client.client_id,
      client_secret: client.client_secret, refresh_token: first.refresh_token, resource
    }));
    expect(refreshed.statusCode).toBe(200);
    const second = json(refreshed);
    expect(await db.getAccessToken(second.access_token)).toMatchObject({
      vercel_account: 'team_persistent_fixture', mode: 'preview',
      profile: 'read_only', listing: 'compact'
    });
    const rows = await rawQuery('SELECT token_hash, refresh_hash FROM oauth_tokens WHERE client_id = $1', [client.client_id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBeTruthy();
    expect(rows[0].token_hash).not.toBe(second.access_token);
    expect(rows[0].refresh_hash).not.toBe(second.refresh_token);
  });
});
