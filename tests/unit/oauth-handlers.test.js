import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';
import { hashToken, randomToken } from '../../src/core/oauth.js';
import { listMcpTools } from '../../src/core/mcp-server.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';
import { registry } from '../../src/tools/index.js';

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
  // AUD-AZ: the clean sign-in posts no mode/profile/listing — those
  // values are derived from the chosen account at issuance. Tests
  // that pass them do so deliberately, to prove they cannot steer
  // the issued connection.
  return {
    client_id: client.client_id, redirect_uri: callback, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'state-fixture',
    resource, account: 'team_fixture',
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

  it('renders account + passphrase only — no mode, profile or listing pickers (AUD-AZ)', async () => {
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
    // The pickers and the per-account modes script are gone: the
    // form carries exactly the account choice and the passphrase.
    expect(previewPage.body).not.toContain('name="mode"');
    expect(previewPage.body).not.toContain('name="profile"');
    expect(previewPage.body).not.toContain('name="listing"');
    expect(previewPage.body).not.toContain('<script');
    expect(previewPage.body).not.toContain('account-modes');
    expect(previewPage.body).toContain('name="account"');
    expect(previewPage.body).toContain('name="passphrase"');
    // The enrollment branch is linked as part of this same flow,
    // and the consent body names no setup surface. (The shared
    // shell's footer link is AUD-AV's removal, sequenced with the
    // route deletion; the assertion is scoped to the page body
    // above the footer for exactly that reason.)
    expect(previewPage.body).toContain('/api/oauth/enroll');
    const consentBody = previewPage.body.split('<footer>')[0];
    expect(consentBody).not.toContain('/api/vercel/setup');
    expect(previewPage.body).not.toContain('setup page');
    // The AUD-W production note survives as information: this
    // fixture's switch is ON, so the reason is the deployment.
    expect(previewPage.body).toContain('starts in preview');
    expect(previewPage.body).toContain('Production mode is offered by this server');

    const productionFixture = createFixture({
      accounts: [{
        id: 'team_fixture', label: 'Fixture team', scope: 'team',
        production_enabled: true, team_id: 'team_fixture', team_slug: 'fixture'
      }],
      env: { VERCEL_ENV: 'production' }
    });
    const productionClient = await register(productionFixture.handlers);
    const productionPage = await call(productionFixture.handlers.authorize, request('GET', authorizeArgs(productionClient)));
    expect(productionPage.body).toContain('starts in production');
    expect(productionPage.body).toContain('<div id="mode-note"></div>');

    const switchedOff = createFixture({
      accounts: [{
        id: 'team_fixture', label: 'Fixture team', scope: 'team',
        production_enabled: false, team_id: 'team_fixture', team_slug: 'fixture'
      }],
      env: { VERCEL_ENV: 'production' }
    });
    const switchedOffClient = await register(switchedOff.handlers);
    const switchedOffPage = await call(switchedOff.handlers.authorize, request('GET', authorizeArgs(switchedOffClient)));
    expect(switchedOffPage.body).toContain('starts in preview');
    expect(switchedOffPage.body).toContain('Production mode is switched off for this account');
    expect(switchedOffPage.body).toContain('vercel_set_working_box');
  });

  it('preselects the flagged default account and captions every account with its own posture (AUD-AE/AUD-AZ)', async () => {
    // The live shape that convicted the AUD-AE defect: the default
    // account is NOT the first row of the account list, and the
    // first row's switch is off while the default's is on. AUD-AE
    // fixed the preselection and rendered per-account mode views;
    // AUD-AZ keeps the preselection and the per-account truth, and
    // deletes the pickers the views served: every option now
    // carries its own derivation as its caption, with no script.
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
    // Each account's own posture, in its caption: the default
    // starts in production (no note), the scratch account in
    // preview — the server's derivation, not the first row's.
    expect(page.body).toContain('ZZZ Real fixture — Team · starts in production');
    expect(page.body).toContain('AAA Scratch fixture — Team · starts in preview');
    expect(page.body).toContain('<div id="mode-note"></div>');
    expect(page.body).not.toContain('account-modes');
    expect(page.body).not.toContain('<script');
    // The consent the old form could never produce — the default
    // account in production — is now simply what derivation issues
    // for it: no mode is posted at all.
    const authorized = await call(fixture.handlers.authorize, request('POST', {
      ...authorizeArgs(client), account: 'team_real',
      passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    expect(await fixture.db.consumeAuthCode(code)).toMatchObject({
      vercel_account: 'team_real', mode: 'production', profile: 'full', listing: 'front_door'
    });
  });

  it('keeps both AUD-W note variants, rendered for the selected account (AUD-AE/AUD-AZ)', async () => {
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
    // The default (switch on, preview deployment) renders the
    // deployment variant as its note; both accounts caption their
    // own preview start, and no embedded map or script remains.
    expect(page.body).toContain('<div id="mode-note"><p>Production mode is offered by this server');
    expect(page.body).not.toContain('account-modes');
    // The other account's own variant renders when it is the
    // selected account — the note follows the selection exactly as
    // the AUD-AE page's did, now by re-render instead of script.
    const offArgs = authorizeArgs(client, { account: 'team_off' });
    const offPage = await call(fixture.handlers.authorize, request('GET', offArgs));
    expect(offPage.body).toContain('<div id="mode-note"><p>Production mode is switched off for this account');
    expect(offPage.body).toContain('vercel_set_working_box');
  });

  it('an explicit account choice still wins over the default, with that account\'s posture (AUD-AE/AUD-AZ)', async () => {
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
    expect(page.body).not.toContain('name="mode"');
  });

  it('authorizes a connection and binds the derived account, mode, profile, and listing to its one-time code', async () => {
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
    // The fixture account is a token enrollment (Door 2 → full)
    // with its production switch off (→ preview); the listing is
    // always the front door for an OAuth issuance (AUD-AZ).
    expect(await db.consumeAuthCode(code)).toMatchObject({
      client_id: client.client_id, vercel_account: 'team_fixture',
      mode: 'preview', profile: 'full', listing: 'front_door'
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

  it('refuses unknown accounts, and posted mode/profile/listing cannot steer the issued values (AUD-AZ)', async () => {
    const { db, handlers } = createFixture();
    const client = await register(handlers);
    const unknown = await call(handlers.authorize, request('POST', {
      ...authorizeArgs(client), account: 'team_unknown', passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(unknown.statusCode).toBe(400);
    // The pre-AUD-AZ refusal of a forged production mode becomes a
    // stronger property: the posted values are not read at all, so
    // a client asking for production + read_only + catalog is
    // issued exactly what the account derives — preview, full,
    // front_door for this switch-off token enrollment.
    const forged = await call(handlers.authorize, request('POST', {
      ...authorizeArgs(client), mode: 'production', profile: 'read_only', listing: 'catalog',
      passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(forged.statusCode).toBe(302);
    const code = new URL(forged.headers.Location).searchParams.get('code');
    expect(await db.consumeAuthCode(code)).toMatchObject({
      vercel_account: 'team_fixture', mode: 'preview', profile: 'full', listing: 'front_door'
    });
  });

  it('derives profile from the door and mode from the account switch (AUD-AZ matrix)', async () => {
    const integrationProbe = { source: 'integration', declaredBox: 'team', accountKind: 'team' };
    const cases = [
      { name: 'token door, switch off', account: {}, env: {}, profile: 'full', mode: 'preview' },
      { name: 'token door, switch on, production deployment', account: { production_enabled: true }, env: { VERCEL_ENV: 'production' }, profile: 'full', mode: 'production' },
      { name: 'token door, switch on, preview deployment', account: { production_enabled: true }, env: {}, profile: 'full', mode: 'preview' },
      { name: 'integration door, switch off', account: { token_probe: integrationProbe }, env: { VERCEL_ENV: 'production' }, profile: 'everyday', mode: 'preview' },
      { name: 'integration door, switch on, production deployment', account: { token_probe: integrationProbe, production_enabled: true }, env: { VERCEL_ENV: 'production' }, profile: 'everyday', mode: 'production' },
      { name: 'integration door, switch on, preview deployment', account: { token_probe: integrationProbe, production_enabled: true }, env: {}, profile: 'everyday', mode: 'preview' }
    ];
    for (const testCase of cases) {
      const fixture = createFixture({
        accounts: [{
          id: 'team_fixture', label: 'Fixture team', scope: 'team',
          production_enabled: false, team_id: 'team_fixture', team_slug: 'fixture',
          ...testCase.account
        }],
        env: testCase.env
      });
      const client = await register(fixture.handlers);
      const authorized = await call(fixture.handlers.authorize, request('POST', {
        ...authorizeArgs(client), passphrase: baseEnv.ADMIN_PASSPHRASE
      }));
      expect(authorized.statusCode, testCase.name).toBe(302);
      const code = new URL(authorized.headers.Location).searchParams.get('code');
      expect(await fixture.db.consumeAuthCode(code), testCase.name).toMatchObject({
        vercel_account: 'team_fixture', mode: testCase.mode,
        profile: testCase.profile, listing: 'front_door'
      });
    }
  });

  it('drives the real tool boundary from the issued values and leaves stored legacy connections untouched (AUD-AZ)', async () => {
    const connect = async (fixture, token) => requireMcpToken(
      { headers: { authorization: 'Bearer ' + token } }, response(), fixture.db, fixture.env);
    const exchange = async (fixture, client) => {
      const authorized = await call(fixture.handlers.authorize, request('POST', {
        ...authorizeArgs(client), passphrase: baseEnv.ADMIN_PASSPHRASE
      }));
      expect(authorized.statusCode).toBe(302);
      const code = new URL(authorized.headers.Location).searchParams.get('code');
      const granted = await call(fixture.handlers.token, request('POST', {
        grant_type: 'authorization_code', client_id: client.client_id,
        client_secret: client.client_secret, redirect_uri: callback,
        code, code_verifier: verifier, resource
      }));
      expect(granted.statusCode).toBe(200);
      return json(granted);
    };
    // Door 1 (integration) enrollment → everyday at the boundary.
    const door1 = createFixture({
      accounts: [{
        id: 'team_fixture', label: 'Fixture team', scope: 'team',
        production_enabled: false, team_id: 'team_fixture', team_slug: 'fixture',
        token_probe: { source: 'integration', declaredBox: 'team', accountKind: 'team' }
      }]
    });
    const client1 = await register(door1.handlers);
    // A connection stored before derivation existed (the AUD-C
    // shape): grandfathered — new issuance must never rewrite it.
    const legacyAccess = randomToken();
    await door1.db.createAccessToken({
      accessToken: legacyAccess, refreshToken: randomToken(), clientId: client1.client_id,
      vercelAccount: 'team_fixture', mode: 'preview', profile: 'read_only', listing: 'compact'
    });
    const connection1 = await connect(door1, (await exchange(door1, client1)).access_token);
    expect(connection1).toMatchObject({ profile: 'everyday', listing: 'front_door', mode: 'preview' });
    const door1Names = listMcpTools(registry, connection1).map((tool) => tool.name);
    expect(door1Names).toContain('vercel_whoami');
    expect(door1Names).not.toContain('vercel_workflow_project_setup');
    const legacy = await connect(door1, legacyAccess);
    expect(legacy).toMatchObject({ profile: 'read_only', listing: 'compact', mode: 'preview' });
    expect(await door1.db.getAccessToken(legacyAccess)).toMatchObject({
      profile: 'read_only', listing: 'compact'
    });
    // Door 2 (token) enrollment → full at the same boundary.
    const door2 = createFixture();
    const client2 = await register(door2.handlers);
    const connection2 = await connect(door2, (await exchange(door2, client2)).access_token);
    expect(connection2).toMatchObject({ profile: 'full', listing: 'front_door', mode: 'preview' });
    expect(listMcpTools(registry, connection2).map((tool) => tool.name))
      .toContain('vercel_workflow_project_setup');
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
      mode: 'preview', profile: 'full', listing: 'front_door'
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
      mode: 'preview', profile: 'full', listing: 'front_door'
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
