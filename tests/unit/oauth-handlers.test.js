import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';
import { hashToken } from '../../src/core/oauth.js';

const baseEnv = {
  PUBLIC_BASE_URL: 'https://vercel-mcp.example.test',
  ADMIN_PASSPHRASE: 'test-passphrase-fixture',
  VERCEL_ENV: 'preview'
};
const resource = baseEnv.PUBLIC_BASE_URL + '/api/mcp';
const callback = 'https://client.example.test/callback';
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
async function register(handlers, redirectUris = [callback]) {
  const res = await call(handlers.register, request('POST', { redirect_uris: redirectUris, client_name: 'Test client' }));
  expect(res.statusCode).toBe(201);
  return json(res);
}
function authorizeArgs(client, extra = {}) {
  return {
    client_id: client.client_id, redirect_uri: callback, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'state-fixture',
    resource, account: 'team_fixture', mode: 'preview', profile: 'full', listing: 'compact',
    ...extra
  };
}

describe('OAuth registration and authorization endpoints', () => {
  it('registers dynamic clients and stores only the client-secret hash', async () => {
    const { db, handlers } = createFixture();
    const client = await register(handlers);
    expect(client.client_id).toBeTruthy();
    expect(client.client_secret).toBeTruthy();
    expect(client.redirect_uris).toEqual([callback]);
    const stored = await db.getOAuthClient(client.client_id);
    expect(stored.client_secret_hash).toBe(hashToken(client.client_secret));
    expect(stored.client_secret_hash).not.toBe(client.client_secret);
  });

  it('rejects insecure or duplicate redirect URIs and unsupported client auth', async () => {
    const { handlers } = createFixture();
    const insecure = await call(handlers.register, request('POST', { redirect_uris: ['http://external.example.test/cb'] }));
    expect(insecure.statusCode).toBe(400);
    const duplicate = await call(handlers.register, request('POST', { redirect_uris: [callback, callback] }));
    expect(duplicate.statusCode).toBe(400);
    const authMethod = await call(handlers.register, request('POST', {
      redirect_uris: [callback], token_endpoint_auth_method: 'client_secret_basic'
    }));
    expect(authMethod.statusCode).toBe(400);
  });

  it('renders only the modes allowed for the selected account and deployment', async () => {
    const { handlers } = createFixture({
      accounts: [{
        id: 'team_fixture', label: 'Fixture team', scope: 'team',
        production_enabled: true, team_id: 'team_fixture', team_slug: 'fixture'
      }]
    });
    const client = await register(handlers);
    const previewPage = await call(handlers.authorize, request('GET', authorizeArgs(client)));
    expect(previewPage.statusCode).toBe(200);
    expect(previewPage.body).toContain('Fixture team');
    expect(previewPage.body).not.toContain('value="production"');

    const productionFixture = createFixture({
      accounts: [{
        id: 'team_fixture', label: 'Fixture team', scope: 'team',
        production_enabled: true, team_id: 'team_fixture', team_slug: 'fixture'
      }],
      env: { VERCEL_ENV: 'production' }
    });
    const productionClient = await register(productionFixture.handlers);
    const productionPage = await call(productionFixture.handlers.authorize, request('GET', authorizeArgs(productionClient)));
    expect(productionPage.body).toContain('value="production"');
  });

  it('authorizes a connection and binds account, mode, profile, and listing to its one-time code', async () => {
    const { db, handlers } = createFixture();
    const client = await register(handlers);
    const params = authorizeArgs(client);
    expect((await call(handlers.authorize, request('GET', params))).statusCode).toBe(200);
    const authorized = await call(handlers.authorize, request('POST', {
      ...params, passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const redirect = new URL(authorized.headers.Location);
    expect(redirect.searchParams.get('state')).toBe('state-fixture');
    const code = redirect.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(await db.consumeAuthCode(code)).toMatchObject({
      client_id: client.client_id, vercel_account: 'team_fixture',
      mode: 'preview', profile: 'full', listing: 'compact'
    });
  });

  it('locks after five wrong passphrases and fails closed if passphrase configuration is absent', async () => {
    const fixture = createFixture();
    const client = await register(fixture.handlers);
    const params = authorizeArgs(client);
    for (let i = 0; i < 5; i++) {
      const res = await call(fixture.handlers.authorize, request('POST', { ...params, passphrase: 'wrong-fixture' }));
      expect(res.statusCode).toBe(401);
    }
    const locked = await call(fixture.handlers.authorize, request('POST', {
      ...params, passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['Retry-After']).toBe('900');

    const missing = createFixture({ env: { ADMIN_PASSPHRASE: '' } });
    const missingClient = await register(missing.handlers);
    const unavailable = await call(missing.handlers.authorize, request('POST', {
      ...authorizeArgs(missingClient), passphrase: 'irrelevant'
    }));
    expect(unavailable.statusCode).toBe(503);
  });

  it('refuses unknown accounts and forged production mode, including enabled accounts on preview deployments', async () => {
    const { handlers } = createFixture();
    const client = await register(handlers);
    const unknown = await call(handlers.authorize, request('POST', {
      ...authorizeArgs(client), account: 'team_unknown', passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(unknown.statusCode).toBe(400);
    const forged = await call(handlers.authorize, request('POST', {
      ...authorizeArgs(client), mode: 'production', passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(forged.statusCode).toBe(400);
  });

  it('publishes fixed OAuth metadata and exact protected-resource metadata', async () => {
    const { handlers } = createFixture();
    const metadata = json(await call(handlers.metadata, request('GET', {})));
    expect(metadata.issuer).toBe(baseEnv.PUBLIC_BASE_URL);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(['client_secret_post','none']);
    const resourceMetadata = json(await call(handlers.resourceMetadata, request('GET', {})));
    expect(resourceMetadata).toEqual({
      resource,
      authorization_servers: [baseEnv.PUBLIC_BASE_URL]
    });
  });

  it('exchanges a one-time PKCE code and rotates refresh credentials without losing connection settings', async () => {
    const fixture = createFixture();
    const client = await register(fixture.handlers);
    const params = authorizeArgs(client);
    const authorized = await call(fixture.handlers.authorize, request('POST', {
      ...params, passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');

    const rejectedClient = await call(fixture.handlers.token, request('POST', {
      grant_type: 'authorization_code', client_id: client.client_id,
      client_secret: 'wrong-client-secret-fixture', redirect_uri: callback,
      code, code_verifier: verifier, resource
    }));
    expect(rejectedClient.statusCode).toBe(401);

    const granted = await call(fixture.handlers.token, request('POST', {
      grant_type: 'authorization_code', client_id: client.client_id,
      client_secret: client.client_secret, redirect_uri: callback,
      code, code_verifier: verifier, resource
    }));
    expect(granted.statusCode).toBe(200);
    const original = json(granted);
    expect(original.expires_in).toBe(3600);
    expect(await fixture.db.getAccessToken(original.access_token)).toMatchObject({
      client_id: client.client_id, vercel_account: 'team_fixture',
      mode: 'preview', profile: 'full', listing: 'compact'
    });

    const replayedCode = await call(fixture.handlers.token, request('POST', {
      grant_type: 'authorization_code', client_id: client.client_id,
      client_secret: client.client_secret, redirect_uri: callback,
      code, code_verifier: verifier, resource
    }));
    expect(replayedCode.statusCode).toBe(400);

    fixture.advance(45 * 24 * 60 * 60 * 1000);
    expect(await fixture.db.getAccessToken(original.access_token)).toBeNull();
    const refreshed = await call(fixture.handlers.token, request('POST', {
      grant_type: 'refresh_token', client_id: client.client_id,
      client_secret: client.client_secret, refresh_token: original.refresh_token, resource
    }));
    expect(refreshed.statusCode).toBe(200);
    const second = json(refreshed);
    expect(await fixture.db.getAccessToken(second.access_token)).toMatchObject({
      client_id: client.client_id, vercel_account: 'team_fixture',
      mode: 'preview', profile: 'full', listing: 'compact'
    });
    const replayedRefresh = await call(fixture.handlers.token, request('POST', {
      grant_type: 'refresh_token', client_id: client.client_id,
      client_secret: client.client_secret, refresh_token: original.refresh_token, resource
    }));
    expect(replayedRefresh.statusCode).toBe(400);
  });

  it('registers secretless public clients and enforces S256 PKCE with one-time refresh',async()=>{
    const fixture=createFixture();
    const registration=await call(fixture.handlers.register,request('POST',{
      redirect_uris:[callback],client_name:'Mobile public fixture',token_endpoint_auth_method:'none'
    }));
    expect(registration.statusCode).toBe(201);
    const client=json(registration);
    expect(client.token_endpoint_auth_method).toBe('none');
    expect(client).not.toHaveProperty('client_secret');
    expect(client).not.toHaveProperty('client_secret_expires_at');
    expect(await fixture.db.getOAuthClient(client.client_id)).toMatchObject({
      token_endpoint_auth_method:'none',client_secret_hash:null
    });
    const params=authorizeArgs(client);
    const badChallenge=await call(fixture.handlers.authorize,request('POST',{
      ...params,code_challenge:'not-a-real-pkce-challenge',
      passphrase:baseEnv.ADMIN_PASSPHRASE
    }));
    expect(badChallenge.statusCode).toBe(400);
    const signed=await call(fixture.handlers.authorize,request('POST',{
      ...params,passphrase:baseEnv.ADMIN_PASSPHRASE
    }));
    expect(signed.statusCode).toBe(302);
    const code=new URL(signed.headers.Location).searchParams.get('code');
    const suppliedSecret=await call(fixture.handlers.token,request('POST',{
      client_id:client.client_id,client_secret:'forged-public-secret',grant_type:'authorization_code',
      redirect_uri:callback,code,code_verifier:verifier,resource
    }));
    expect(suppliedSecret.statusCode).toBe(401);
    const wrongResource=await call(fixture.handlers.token,request('POST',{
      client_id:client.client_id,grant_type:'authorization_code',
      redirect_uri:callback,code,code_verifier:verifier,resource:'https://other.example.test/api/mcp'
    }));
    expect(wrongResource.statusCode).toBe(400);
    const access=await call(fixture.handlers.token,request('POST',{
      client_id:client.client_id,grant_type:'authorization_code',
      redirect_uri:callback,code,code_verifier:verifier,resource
    }));
    expect(access.statusCode).toBe(200);
    const granted=json(access);
    expect(await fixture.db.getAccessToken(granted.access_token)).toMatchObject({
      client_id:client.client_id,vercel_account:'team_fixture',mode:'preview',profile:'full'
    });
    expect((await call(fixture.handlers.token,request('POST',{
      client_id:client.client_id,grant_type:'authorization_code',
      redirect_uri:callback,code,code_verifier:verifier,resource
    }))).statusCode).toBe(400);
    const other=json(await call(fixture.handlers.register,request('POST',{
      redirect_uris:[callback],token_endpoint_auth_method:'none'
    })));
    expect((await call(fixture.handlers.token,request('POST',{
      client_id:other.client_id,grant_type:'refresh_token',
      refresh_token:granted.refresh_token,resource
    }))).statusCode).toBe(400);
    const refresh=await call(fixture.handlers.token,request('POST',{
      client_id:client.client_id,grant_type:'refresh_token',
      refresh_token:granted.refresh_token,resource
    }));
    expect(refresh.statusCode).toBe(200);
    expect((await call(fixture.handlers.token,request('POST',{
      client_id:client.client_id,grant_type:'refresh_token',
      refresh_token:granted.refresh_token,resource
    }))).statusCode).toBe(400);
    expect(await fixture.db.getAccessToken(json(refresh).access_token)).toMatchObject({
      client_id:client.client_id,vercel_account:'team_fixture'
    });
  });
});

describe('Muse client metadata document', () => {
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

  it('serves the client document Muse connects with and advertises CIMD support', async () => {
    const { handlers } = createFixture();
    const doc = json(await call(handlers.museClient, request('GET', {})));
    expect(doc).toEqual({
      client_id: museClientId, client_name: 'Muse',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [museCallback], response_types: ['code'],
      token_endpoint_auth_method: 'none'
    });
    const metadata = json(await call(handlers.metadata, request('GET', {})));
    expect(metadata.client_id_metadata_document_supported).toBe(true);
  });

  it('runs the full code + PKCE + refresh flow for the Muse client without registration', async () => {
    const { db, handlers } = createFixture();
    expect(await db.getOAuthClient(museClientId)).toBeNull();
    const page = await call(handlers.authorize, request('GET', museAuthorizeArgs()));
    expect(page.statusCode).toBe(200);
    const wrongRedirect = await call(handlers.authorize, request('GET',
      museAuthorizeArgs({ redirect_uri: callback })));
    expect(wrongRedirect.statusCode).toBe(400);
    const authorized = await call(handlers.authorize, request('POST', {
      ...museAuthorizeArgs(), passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const destination = new URL(authorized.headers.Location);
    expect(destination.origin + destination.pathname).toBe(museCallback);
    const code = destination.searchParams.get('code');
    expect(code).toBeTruthy();
    const suppliedSecret = await call(handlers.token, request('POST', {
      client_id: museClientId, client_secret: 'forged-public-secret', grant_type: 'authorization_code',
      redirect_uri: museCallback, code, code_verifier: verifier, resource
    }));
    expect(suppliedSecret.statusCode).toBe(401);
    const granted = await call(handlers.token, request('POST', {
      client_id: museClientId, grant_type: 'authorization_code',
      redirect_uri: museCallback, code, code_verifier: verifier, resource
    }));
    expect(granted.statusCode).toBe(200);
    const tokens = json(granted);
    expect(tokens.refresh_token).toBeTruthy();
    expect(await db.getAccessToken(tokens.access_token)).toMatchObject({
      client_id: museClientId, vercel_account: 'team_fixture', listing: 'front_door'
    });
    const refreshed = await call(handlers.token, request('POST', {
      client_id: museClientId, grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token, resource
    }));
    expect(refreshed.statusCode).toBe(200);
  });
});
