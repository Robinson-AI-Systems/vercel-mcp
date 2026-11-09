// RAS MCP Standard — Muse connection design (MC-4): an omitted `resource`
// means this server's own MCP endpoint at every door.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';

const baseEnv = {
  PUBLIC_BASE_URL: 'https://vercel-mcp.example.test',
  ADMIN_PASSPHRASE: 'test-passphrase-fixture',
  VERCEL_ENV: 'preview'
};
const resource = baseEnv.PUBLIC_BASE_URL + '/api/mcp';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function request(method, data, headers = {}) {
  return {
    method, headers,
    body: method === 'GET' ? undefined : data,
    query: method === 'GET' ? data : undefined,
    socket: { remoteAddress: '198.51.100.1' }
  };
}
function response() {
  return {
    statusCode: 200, headers: {}, body: null, ended: false,
    setHeader(name, value) { this.headers[name] = value; return this; },
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
function json(res) { return JSON.parse(res.body); }
function createFixture({ accounts, env = {} } = {}) {
  let now = Date.now();
  const db = createFakeDb({
    clock: () => now,
    accounts: accounts || [{
      id: 'team_fixture', label: 'Fixture team', scope: 'team',
      production_enabled: false, team_id: 'team_fixture', team_slug: 'fixture'
    }]
  });
  const runtimeEnv = { ...baseEnv, ...env };
  const service = createVercelLoginService(db);
  const handlers = createOAuthHandlers({ db, env: runtimeEnv, service });
  return { db, handlers, env: runtimeEnv, advance: (ms) => { now += ms; } };
}
describe('Muse sign-in with resource omitted', () => {
  const museClientId = baseEnv.PUBLIC_BASE_URL + '/.well-known/muse-client.json';
  const museCallback = 'https://agent.meta.ai/api/hatch/oauth/callback';
  function museAuthorizeArgs(extra = {}) {
    return {
      client_id: museClientId, redirect_uri: museCallback, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', state: 'state-fixture',
      resource, account: 'team_fixture', mode: 'preview', profile: 'full', listing: 'front_door',
      ...extra
    };
  }

  // RAS MCP Standard — Muse connection design MC-4: Muse may leave out
  // `resource`. Absent means this server's MCP; a foreign value is refused.
  it('completes the Muse flow with resource omitted at authorize, token and refresh', async () => {
    const { db, handlers } = createFixture();
    const noResource = museAuthorizeArgs();
    delete noResource.resource;
    const page = await call(handlers.authorize, request('GET', noResource));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('value="' + resource + '"');
    const authorized = await call(handlers.authorize, request('POST', {
      ...noResource, passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    const granted = await call(handlers.token, request('POST', {
      client_id: museClientId, grant_type: 'authorization_code',
      redirect_uri: museCallback, code, code_verifier: verifier
    }));
    expect(granted.statusCode).toBe(200);
    const tokens = json(granted);
    expect(await db.getAccessToken(tokens.access_token)).toMatchObject({ client_id: museClientId });
    const refreshed = await call(handlers.token, request('POST', {
      client_id: museClientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token
    }));
    expect(refreshed.statusCode).toBe(200);
    const foreignAuthorize = await call(handlers.authorize, request('GET',
      museAuthorizeArgs({ resource: 'https://evil.example.test/api/mcp' })));
    expect(foreignAuthorize.statusCode).toBe(400);
    const foreignToken = await call(handlers.token, request('POST', {
      client_id: museClientId, grant_type: 'refresh_token',
      refresh_token: json(refreshed).refresh_token, resource: 'https://evil.example.test/api/mcp'
    }));
    expect(foreignToken.statusCode).toBe(400);
    expect(json(foreignToken).error).toBe('invalid_target');
  });
});
