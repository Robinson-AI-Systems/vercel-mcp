import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  FILE_ROUTES, REWRITE_ROUTES, resolveRoute, bodyLimitBytes,
  pinReleaseCommit, createRackServer,
} from '../../rack-server.mjs';
import { registry } from '../../src/tools/index.js';

// RACK-STAGING S-2: the rack entrypoint reproduces the Vercel
// contract — filesystem routes for all 27 function files, the nine
// vercel.json rewrites verbatim, bracket segments as query
// parameters, per-function bodyParser handling (the deployment
// webhook's raw stream untouched; every other handler on the parsed
// body), and the release-identity pin. HTTP legs run the real
// handlers with no store configured, so every answer is the
// production fail-closed posture, never a fixture invention. The
// store-backed legs (registration write through the pg seam, the
// webhook receiver's signed raw-body proof, the authorize submit
// against a live store) run in the rack rehearsal battery, where a
// fixture store exists; the db-side seam itself is proven by
// tests/db/transport.test.js.
describe('rack entrypoint route table', () => {
  it('binds every api/ function file at its Vercel path', () => {
    for (const [path, entry] of FILE_ROUTES) {
      const resolved = resolveRoute(path);
      expect(resolved, path).toBeTruthy();
      expect(typeof resolved.handler).toBe('function');
      expect(entry.handler).toBe(resolved.handler);
    }
    // 25 literal function files plus the two directory bindings
    // (/api for the front door, /api/tools for the tools index); the
    // two bracket files resolve through the dynamic doors below.
    expect(FILE_ROUTES.size).toBe(27);
  });

  it('applies the vercel.json rewrites verbatim', () => {
    expect(REWRITE_ROUTES.size).toBe(9);
    expect(resolveRoute('/api/openapi.json').handler)
      .toBe(FILE_ROUTES.get('/api/rtc-openapi').handler);
    expect(resolveRoute('/.well-known/oauth-authorization-server').handler)
      .toBe(FILE_ROUTES.get('/api/well-known/oauth-authorization-server').handler);
    expect(resolveRoute('/.well-known/oauth-protected-resource').handler)
      .toBe(FILE_ROUTES.get('/api/well-known/oauth-protected-resource').handler);
    expect(resolveRoute('/.well-known/muse-client.json').handler)
      .toBe(FILE_ROUTES.get('/api/well-known/muse-client').handler);
    expect(resolveRoute('/api/health/deep').handler)
      .toBe(FILE_ROUTES.get('/api/health-deep').handler);
    expect(resolveRoute('/').handler).toBe(FILE_ROUTES.get('/api/index').handler);
    expect(resolveRoute('/connection').handler)
      .toBe(FILE_ROUTES.get('/api/connection').handler);
    const icon = resolveRoute('/brand/icon-256.png');
    expect(icon.handler).toBe(FILE_ROUTES.get('/api/index').handler);
    expect(icon.query).toEqual({ brand_icon: '256' });
    expect(resolveRoute('/brand/icon-64.png').query).toEqual({ brand_icon: '64' });
  });

  it('binds bracket segments as query parameters, literals first', () => {
    expect(resolveRoute('/api/tools/vercel_list_projects').query)
      .toEqual({ name: 'vercel_list_projects' });
    expect(resolveRoute('/api/results/abc123').query).toEqual({ handle: 'abc123' });
    // Literal files win over the bracket door beside them, as on Vercel.
    expect(resolveRoute('/api/tools/_batch').handler)
      .toBe(FILE_ROUTES.get('/api/tools/_batch').handler);
    expect(resolveRoute('/api/tools/index').handler)
      .toBe(FILE_ROUTES.get('/api/tools/index').handler);
    expect(resolveRoute('/api/tools').handler)
      .toBe(FILE_ROUTES.get('/api/tools').handler);
    expect(resolveRoute('/nope')).toBeNull();
    expect(resolveRoute('/api/nope')).toBeNull();
  });

  it('pins the body-contract split: webhook raw, everything else parsed', () => {
    // The deployment webhook's exported bodyParser:false rides its
    // route, so the entrypoint leaves its stream untouched for the
    // HMAC check over the raw bytes.
    expect(bodyLimitBytes(resolveRoute('/api/webhooks/deployments').config)).toBe(0);
    // api/mcp.js declares bodyParser:true — the parsed-body path.
    expect(bodyLimitBytes(resolveRoute('/api/mcp').config)).toBe(4_572_800);
    expect(bodyLimitBytes(resolveRoute('/api/oauth/authorize').config)).toBe(4_572_800);
    expect(bodyLimitBytes(undefined)).toBe(4_572_800);
    expect(bodyLimitBytes({ api: { bodyParser: false } })).toBe(0);
    expect(bodyLimitBytes({ api: { bodyParser: { sizeLimit: '1mb' } } })).toBe(1_048_576);
    expect(bodyLimitBytes({ api: { bodyParser: { sizeLimit: 2048 } } })).toBe(2048);
  });

  it('pins the release identity without ever synthesizing one', () => {
    const sha = 'a'.repeat(40);
    const platform = { VERCEL_GIT_COMMIT_SHA: sha };
    expect(pinReleaseCommit(platform)).toBe(sha);
    const rack = { RACK_RELEASE_COMMIT: sha };
    expect(pinReleaseCommit(rack)).toBe(sha);
    expect(rack.VERCEL_GIT_COMMIT_SHA).toBe(sha);
    const garbage = { RACK_RELEASE_COMMIT: 'not-a-sha' };
    expect(pinReleaseCommit(garbage)).toBeNull();
    expect(garbage.VERCEL_GIT_COMMIT_SHA).toBeUndefined();
  });
});

describe('rack entrypoint HTTP contract (no store configured)', () => {
  let server;
  let base;
  const savedEnv = {};
  beforeAll(async () => {
    for (const key of ['DATABASE_URL', 'PUBLIC_BASE_URL', 'STORE_TRANSPORT',
      'VERCEL_GIT_COMMIT_SHA', 'RACK_RELEASE_COMMIT', 'VERCEL_DEPLOY_WEBHOOK_SECRET']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PUBLIC_BASE_URL = 'https://fixture.example';
    server = createRackServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('answers the front door at / and /api in its live shape', async () => {
    for (const path of ['/', '/api', '/api/index']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Vercel Unleashed by Robinson AI Systems');
      expect(body.status).toBe('service-online');
      expect(body.tools).toBe(registry.tools.length);
      expect(body.deployed_source_sha).toBeNull();
    }
  });

  it('answers health in the pinned five-field shape', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['deployed_source_sha', 'status', 'timestamp', 'tools', 'version']);
    expect(body.status).toBe('ok');
    expect(body.tools).toBe(registry.tools.length);
    expect(body.deployed_source_sha).toBeNull();
  });

  it('serves the brand icon through its rewrite, query included', async () => {
    const res = await fetch(`${base}/brand/icon-256.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('answers discovery fail-closed without a store, as production does', async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('temporarily_unavailable');
  });

  it('refuses a tokenless MCP call in the production shape', async () => {
    const res = await fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    // No store configured: the handler's own fail-closed 503, reached
    // through the entrypoint's parsed-body path — not an entrypoint 500.
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('temporarily_unavailable');
  });

  it('answers an authorize submit instead of hanging (the paid-for defect)', async () => {
    // The Workspace Phase-2 defect class: an entrypoint that consumed
    // the body before dispatch left this POST unanswered forever.
    // Here the handler must answer in its own fail-closed shape.
    const res = await fetch(`${base}/api/oauth/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'response_type=code&client_id=fixture&redirect_uri=https%3A%2F%2Ffixture.example%2Fcb',
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('temporarily_unavailable');
  });

  it('parses JSON bodies before the handler (platform 400 on bad JSON)', async () => {
    const bad = await fetch(`${base}/api/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('invalid_json');
    const good = await fetch(`${base}/api/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'rack-staging', redirect_uris: ['https://fixture.example/cb'] }),
    });
    // Well-formed: the handler itself answers, in its fail-closed shape.
    expect(good.status).toBe(503);
    expect((await good.json()).error).toBe('temporarily_unavailable');
  });

  it('routes the deployment webhook to its raw-stream receiver', async () => {
    const res = await fetch(`${base}/api/webhooks/deployments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'deployment.succeeded', payload: {} }),
    });
    // No signing secret configured: the receiver's own answer, which
    // proves the request reached it; the signed raw-body proof runs
    // in the rehearsal battery against a fixture store.
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('webhook_secret_not_configured');
  });

  it('404s unknown paths in the entrypoint shape', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
