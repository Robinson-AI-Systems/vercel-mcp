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
    // VMCP-025 (AUD-W): production no longer vanishes silently — it
    // renders disabled with its reason. This fixture's switch is ON,
    // so the reason is the deployment, not the account.
    expect(previewPage.body).toContain('value="production" disabled');
    expect(previewPage.body).toContain('production (not available)');
    expect(previewPage.body).toContain('Production mode is offered by this server');

    const productionFixture = createFixture({
      accounts: [{
        id: 'team_fixture', label: 'Fixture team', scope: 'team',
        production_enabled: true, team_id: 'team_fixture', team_slug: 'fixture'
      }],
      env: { VERCEL_ENV: 'production' }
    });
    const switchedOff = createFixture({
      accounts: [{
        id: 'team_fixture', label: 'Fixture team', scope: 'team',
        production_enabled: false, team_id: 'team_fixture', team_slug: 'fixture'
      }],
      env: { VERCEL_ENV: 'production' }
    });
    const switchedOffClient = await register(switchedOff.handlers);
    const switchedOffPage = await call(switchedOff.handlers.authorize, request('GET', authorizeArgs(switchedOffClient)));
    expect(switchedOffPage.body).toContain('value="production" disabled');
    expect(switchedOffPage.body).toContain('Production mode is switched off for this account');
    expect(switchedOffPage.body).toContain('vercel_set_working_box');
    const productionClient = await register(productionFixture.handlers);
    const productionPage = await call(productionFixture.handlers.authorize, request('GET', authorizeArgs(productionClient)));
    expect(productionPage.body).toContain('value="production"');
  });

  it('preselects the flagged default account and renders its own modes, not the first row\'s (AUD-AE)', async () => {
    // The live shape that convicted this defect: the default account
    // is NOT the first row of the account list, and the first row's
    // switch is off while the default's is on. On the production
    // deployment the old page preselected the first row and offered
    // its modes — production disabled with the wrong note — and no
    // account change could ever recompute them.
    const fixture = createFixture({
      accounts: [
        {
          id: 'team_scratch', label: 'AAA Scratch fixture', scope: 'team',
          production_enabled: false, is_default: false, team_id: 'team_scratch', team_slug: 'scratch'
        },
        {
          id: 'team_real', label: 'ZZZ Real fixture', scope: 'team',
          production_enabled: true, is_default: true, team_id: 'team_real', team_slug: 'real'
        }
      ],
      env: { VERCEL_ENV: 'production' }
    });
    const client = await register(fixture.handlers);
    const args = authorizeArgs(client);
    delete args.account;
    const page = await call(fixture.handlers.authorize, request('GET', args));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<option value="team_real" selected>');
    expect(page.body).not.toContain('<option value="team_scratch" selected>');
    // The default account's own view: production selectable, no note.
    expect(page.body).toContain('<option value="production">production</option>');
    expect(page.body).not.toContain('value="production" disabled');
    expect(page.body).toContain('<div id="mode-note"></div>');
    // The embedded per-account map carries every account's own view,
    // so an account change recomputes from the server's own data.
    const embedded = /<script type="application\/json" id="account-modes">([\s\S]*?)<\/script>/.exec(page.body);
    expect(embedded).not.toBeNull();
    const views = JSON.parse(embedded[1].replace(/\\u003c/g, '<'));
    expect(views.team_real).toEqual({ modes: ['preview', 'production'], productionUnavailable: false, note: '' });
    expect(views.team_scratch.modes).toEqual(['preview']);
    expect(views.team_scratch.productionUnavailable).toBe(true);
    expect(views.team_scratch.note).toContain('Production mode is switched off for this account');
    expect(page.body).toContain('accountSelect.addEventListener');
    // And the submission the old form could never produce — the
    // default account in production mode — is accepted by the POST
    // validator exactly as rendered.
    const authorized = await call(fixture.handlers.authorize, request('POST', {
      ...authorizeArgs(client), account: 'team_real', mode: 'production',
      passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    expect(await fixture.db.consumeAuthCode(code)).toMatchObject({
      vercel_account: 'team_real', mode: 'production'
    });
  });

  it('keeps both AUD-W note variants per account on a preview deployment (AUD-AE)', async () => {
    const fixture = createFixture({
      accounts: [
        {
          id: 'team_off', label: 'Switch off fixture', scope: 'team',
          production_enabled: false, is_default: false, team_id: 'team_off', team_slug: 'off'
        },
        {
          id: 'team_on', label: 'Switch on fixture', scope: 'team',
          production_enabled: true, is_default: true, team_id: 'team_on', team_slug: 'on'
        }
      ]
    });
    const client = await register(fixture.handlers);
    const args = authorizeArgs(client);
    delete args.account;
    const page = await call(fixture.handlers.authorize, request('GET', args));
    // The default (switch on) renders the deployment variant.
    expect(page.body).toContain('<div id="mode-note"><p>Production mode is offered by this server');
    expect(page.body).toContain('value="production" disabled');
    const embedded = /<script type="application\/json" id="account-modes">([\s\S]*?)<\/script>/.exec(page.body);
    const views = JSON.parse(embedded[1].replace(/\\u003c/g, '<'));
    expect(views.team_on.productionUnavailable).toBe(true);
    expect(views.team_on.note).toContain('Production mode is offered by this server');
    expect(views.team_off.productionUnavailable).toBe(true);
    expect(views.team_off.note).toContain('Production mode is switched off for this account');
    expect(views.team_off.note).toContain('vercel_set_working_box');
  });

  it('an explicit account choice still wins over the default, with that account\'s modes (AUD-AE)', async () => {
    const fixture = createFixture({
      accounts: [
        {
          id: 'team_off', label: 'Switch off fixture', scope: 'team',
          production_enabled: false, is_default: false, team_id: 'team_off', team_slug: 'off'
        },
        {
          id: 'team_on', label: 'Switch on fixture', scope: 'team',
          production_enabled: true, is_default: true, team_id: 'team_on', team_slug: 'on'
        }
      ],
      env: { VERCEL_ENV: 'production' }
    });
    const client = await register(fixture.handlers);
    const page = await call(fixture.handlers.authorize, request('GET',
      authorizeArgs(client, { account: 'team_off' })));
    expect(page.body).toContain('<option value="team_off" selected>');
    expect(page.body).toContain('<div id="mode-note"><p>Production mode is switched off for this account');
    expect(page.body).toContain('value="production" disabled');
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
