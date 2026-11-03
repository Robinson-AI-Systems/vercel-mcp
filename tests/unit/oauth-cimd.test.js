import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';

// AUD-BX: Client ID Metadata Document resolution. Every fetch is
// mocked through the handlers' fetchDocument seam — no test
// touches the network. The Claude-shaped fixture mirrors the
// live document at https://claude.ai/oauth/mcp-oauth-client-metadata
// (fetched and recorded on the card, 2026-11-02).

const baseEnv = {
  PUBLIC_BASE_URL: 'https://vercel-mcp.example.test',
  ADMIN_PASSPHRASE: 'test-passphrase-fixture',
  VERCEL_ENV: 'preview'
};
const resource = baseEnv.PUBLIC_BASE_URL + '/api/mcp';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const claudeDocument = {
  client_id: CLAUDE_ID,
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  redirect_uris: [CLAUDE_CALLBACK],
  grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none'
};
const CHATGPT_ID = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
// ChatGPT's real document shape, fetched live 2026-11-02: the
// singular method is private_key_jwt; the plural list offers
// "none". This is the shape PenPal's singular-only checker
// refused (see the card).
const chatgptDocument = {
  client_id: CHATGPT_ID,
  client_uri: 'https://chatgpt.com/',
  redirect_uris: [CHATGPT_CALLBACK],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  client_name: 'ChatGPT',
  token_endpoint_auth_signing_alg: 'RS256',
  jwks_uri: 'https://chatgpt.com/oauth/jwks.json'
};

const CODE_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const codeDocument = {
  client_id: CODE_ID,
  client_name: 'Claude Code',
  client_uri: 'https://claude.ai',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none'
};

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
function createFixture({ fetchDocument } = {}) {
  const db = createFakeDb({
    accounts: [{
      id: 'team_fixture', label: 'Fixture team', scope: 'team',
      production_enabled: false, team_id: 'team_fixture', team_slug: 'fixture'
    }]
  });
  const service = createVercelLoginService(db);
  const handlers = createOAuthHandlers({ db, env: { ...baseEnv }, service, fetchDocument });
  return { db, handlers };
}
function serving(documents) {
  return vi.fn(async (url) => {
    const doc = documents[url.toString()];
    if (!doc) throw new Error('not found');
    return structuredClone(doc);
  });
}
function authorizeArgs(clientId, redirectUri, extra = {}) {
  return {
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'state-fixture',
    resource, account: 'team_fixture', ...extra
  };
}

describe('CIMD client resolution (AUD-BX)', () => {
  it('resolves a Claude-shaped document and authorize proceeds past the client gate', async () => {
    const fetchDocument = serving({ [CLAUDE_ID]: claudeDocument });
    const { handlers } = createFixture({ fetchDocument });
    const res = await call(handlers.authorize, request('GET', authorizeArgs(CLAUDE_ID, CLAUDE_CALLBACK)));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Fixture team');
    expect(fetchDocument).toHaveBeenCalledTimes(1);
    expect(fetchDocument.mock.calls[0][0].toString()).toBe(CLAUDE_ID);
  });

  it('completes authorize -> token exchange for a CIMD client (token endpoint resolves the URL too)', async () => {
    const fetchDocument = serving({ [CLAUDE_ID]: claudeDocument });
    const { handlers } = createFixture({ fetchDocument });
    const params = authorizeArgs(CLAUDE_ID, CLAUDE_CALLBACK);
    const authorized = await call(handlers.authorize, request('POST', {
      ...params, passphrase: baseEnv.ADMIN_PASSPHRASE
    }));
    expect(authorized.statusCode).toBe(302);
    const redirect = new URL(authorized.headers.Location);
    expect(redirect.origin + redirect.pathname).toBe(CLAUDE_CALLBACK);
    const code = redirect.searchParams.get('code');
    expect(code).toBeTruthy();
    const tokenRes = await call(handlers.token, request('POST', {
      grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK,
      code_verifier: verifier, client_id: CLAUDE_ID, resource
    }));
    expect(tokenRes.statusCode).toBe(200);
    const tokens = JSON.parse(tokenRes.body);
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    // The second resolution (token) is served from the cache:
    // one fetch for the whole journey.
    expect(fetchDocument).toHaveBeenCalledTimes(1);
  });

  it('refuses a document whose client_id does not equal the URL it was fetched from', async () => {
    const fetchDocument = serving({
      [CLAUDE_ID]: { ...claudeDocument, client_id: 'https://claude.ai/oauth/other-document' }
    });
    const { handlers } = createFixture({ fetchDocument });
    const res = await call(handlers.authorize, request('GET', authorizeArgs(CLAUDE_ID, CLAUDE_CALLBACK)));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_description).toBe('Unknown client or redirect address');
  });

  it('refuses a redirect_uri that is not in the document', async () => {
    const fetchDocument = serving({ [CLAUDE_ID]: claudeDocument });
    const { handlers } = createFixture({ fetchDocument });
    const res = await call(handlers.authorize, request('GET',
      authorizeArgs(CLAUDE_ID, 'https://claude.ai/api/mcp/other-callback')));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_description).toBe('Unknown client or redirect address');
  });

  it('refuses non-https and private/loopback-host client_id URLs without fetching', async () => {
    const fetchDocument = serving({});
    const { handlers } = createFixture({ fetchDocument });
    for (const clientId of [
      'http://claude.ai/oauth/mcp-oauth-client-metadata',
      'https://127.0.0.1/oauth/client',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/oauth/client',
      'https://localhost/oauth/client',
      'https://internal.localhost/oauth/client'
    ]) {
      const res = await call(handlers.authorize, request('GET',
        authorizeArgs(clientId, CLAUDE_CALLBACK)));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error_description).toBe('Unknown client or redirect address');
    }
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it('refuses a document that declares a shared-secret auth method or carries secret material', async () => {
    for (const doc of [
      { ...claudeDocument, token_endpoint_auth_method: 'client_secret_post' },
      { ...claudeDocument, token_endpoint_auth_method: 'client_secret_basic' },
      { ...claudeDocument, client_secret: 'handed-out-in-public' }
    ]) {
      const fetchDocument = serving({ [CLAUDE_ID]: doc });
      const { handlers } = createFixture({ fetchDocument });
      const res = await call(handlers.authorize, request('GET', authorizeArgs(CLAUDE_ID, CLAUDE_CALLBACK)));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error_description).toBe('Unknown client or redirect address');
    }
  });

  it('refuses when the fetch fails or the document is oversized', async () => {
    const failing = vi.fn(async () => { throw new Error('network down'); });
    const a = createFixture({ fetchDocument: failing });
    const failRes = await call(a.handlers.authorize, request('GET', authorizeArgs(CLAUDE_ID, CLAUDE_CALLBACK)));
    expect(failRes.statusCode).toBe(400);
    expect(JSON.parse(failRes.body).error_description).toBe('Unknown client or redirect address');

    const oversized = { ...claudeDocument, client_name: 'x'.repeat(70000) };
    const b = createFixture({ fetchDocument: serving({ [CLAUDE_ID]: oversized }) });
    const bigRes = await call(b.handlers.authorize, request('GET', authorizeArgs(CLAUDE_ID, CLAUDE_CALLBACK)));
    expect(bigRes.statusCode).toBe(400);
    expect(JSON.parse(bigRes.body).error_description).toBe('Unknown client or redirect address');
  });

  it('admits the Claude Code loopback document with an ephemeral-port redirect (RFC 8252 7.3)', async () => {
    const fetchDocument = serving({ [CODE_ID]: codeDocument });
    const { handlers } = createFixture({ fetchDocument });
    const res = await call(handlers.authorize, request('GET',
      authorizeArgs(CODE_ID, 'http://127.0.0.1:47823/callback')));
    expect(res.statusCode).toBe(200);
    // ...but a different loopback path is still refused.
    const wrong = await call(handlers.authorize, request('GET',
      authorizeArgs(CODE_ID, 'http://127.0.0.1:47823/other')));
    expect(wrong.statusCode).toBe(400);
  });

  it('keeps the Muse document local (no fetch) and DCR registration unchanged', async () => {
    const fetchDocument = serving({});
    const { handlers } = createFixture({ fetchDocument });
    const museId = baseEnv.PUBLIC_BASE_URL + '/.well-known/muse-client.json';
    const museRes = await call(handlers.authorize, request('GET',
      authorizeArgs(museId, 'https://agent.meta.ai/api/hatch/oauth/callback')));
    expect(museRes.statusCode).toBe(200);
    expect(fetchDocument).not.toHaveBeenCalled();

    const registered = await call(handlers.register, request('POST', {
      redirect_uris: ['https://client.example.test/callback'], client_name: 'Test client'
    }));
    expect(registered.statusCode).toBe(201);
    const client = JSON.parse(registered.body);
    const dcrRes = await call(handlers.authorize, request('GET',
      authorizeArgs(client.client_id, 'https://client.example.test/callback')));
    expect(dcrRes.statusCode).toBe(200);
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it('resolves a ChatGPT-shaped document: singular private_key_jwt, plural offering "none" (PenPal rule)', async () => {
    const fetchDocument = serving({ [CHATGPT_ID]: chatgptDocument });
    const { handlers } = createFixture({ fetchDocument });
    const res = await call(handlers.authorize, request('GET',
      authorizeArgs(CHATGPT_ID, CHATGPT_CALLBACK)));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Fixture team');
  });

  it('refuses a document offering ONLY private_key_jwt (full support out of scope)', async () => {
    const jwtOnly = {
      ...chatgptDocument,
      token_endpoint_auth_methods_supported: ['private_key_jwt']
    };
    const fetchDocument = serving({ [CHATGPT_ID]: jwtOnly });
    const { handlers } = createFixture({ fetchDocument });
    const res = await call(handlers.authorize, request('GET',
      authorizeArgs(CHATGPT_ID, CHATGPT_CALLBACK)));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_description).toBe('Unknown client or redirect address');
  });
});
