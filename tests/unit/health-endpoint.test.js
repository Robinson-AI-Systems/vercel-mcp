import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { DEEP_HEALTH_PATH, HEALTH_PATH, createDeepHealthHandler, createHealthHandler,
  deepHealthDocument, healthDocument, oauthMetadataConsistent } from '../../src/health.js';
import { oauthServerMetadata } from '../../src/core/oauth-handlers.js';
import { SERVICE_VERSION } from '../../src/service-identity.js';
import { registry } from '../../src/tools/index.js';

// AUD-AP: the public health endpoint. The watch reads it keyless every
// few minutes, so the shape is pinned exactly and the body must be safe
// to be public: liveness roll-up only, never a credential, a config
// value, an internal hostname or a per-check breakdown.
// AUD-BY: the public document is answered from memory/config only —
// it must never query the store (that query kept the scale-to-zero
// Neon compute awake around the clock). The store probe lives behind
// the authenticated deep-health path instead.
const ENV = { PUBLIC_BASE_URL: 'https://vercel-mcp.example.test' };
const SHA = 'b'.repeat(40);
const NOW = () => new Date('2026-10-31T07:00:00.000Z');
const up = { storeReachable: async () => true };
const down = { storeReachable: async () => false };
const FIELDS = ['deployed_source_sha', 'status', 'timestamp', 'tools', 'version'];
const DEEP_FIELDS = ['checks', 'deployed_source_sha', 'status', 'timestamp', 'tools', 'version'];

function mockRes() {
  return { headers: {}, statusCode: null, payload: '',
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.payload = body; return this; } };
}

function spyingStore(result) {
  const spy = { calls: 0, storeReachable: async () => { spy.calls += 1; return result; } };
  return spy;
}

describe('AUD-AP health document', () => {
  it('pins the exact public field set and healthy values', async () => {
    const { healthy, document } = await healthDocument({ env: ENV, buildSha: SHA, now: NOW });
    expect(healthy).toBe(true);
    expect(Object.keys(document).sort()).toEqual(FIELDS);
    expect(document).toEqual({
      status: 'ok', version: SERVICE_VERSION, deployed_source_sha: SHA,
      tools: registry.tools.length, timestamp: '2026-10-31T07:00:00.000Z'
    });
  });

  it('reports a non-SHA build stamp as null, like the front-door document', async () => {
    const { document } = await healthDocument({ env: ENV, buildSha: 'not-a-sha', now: NOW });
    expect(document.deployed_source_sha).toBe(null);
  });

  it('flips to degraded when the OAuth origin is not configured as an HTTPS origin', async () => {
    for (const env of [{}, { PUBLIC_BASE_URL: '' }, { PUBLIC_BASE_URL: 'http://vercel-mcp.example.test' },
      { PUBLIC_BASE_URL: 'https://user:pass@vercel-mcp.example.test' }]) {
      const { healthy, document } = await healthDocument({ env, buildSha: SHA, now: NOW });
      expect(healthy).toBe(false);
      expect(document.status).toBe('degraded');
    }
  });

  it('flips to degraded when the served metadata drifts from the configured origin', async () => {
    const drifted = (origin) => ({ ...oauthServerMetadata(origin), issuer: 'https://other.example.test' });
    const { healthy, document } = await healthDocument({ env: ENV, buildSha: SHA, now: NOW, metadataFor: drifted });
    expect(healthy).toBe(false);
    expect(document.status).toBe('degraded');
    const wrongPath = (origin) => ({ ...oauthServerMetadata(origin), token_endpoint: origin + '/api/oauth/tokens' });
    expect(oauthMetadataConsistent(ENV, wrongPath)).toBe(false);
    expect(oauthMetadataConsistent(ENV)).toBe(true);
  });

  // SR-2: the consistency leg above passes by construction
  // (health derives the document from the same function the
  // server serves). This pins the document ITSELF — the exact
  // key set and every endpoint derivation — so a future
  // metadata edit fails loudly here instead of drifting.
  it('pins the served OAuth metadata document exactly (SR-2)', () => {
    expect(oauthServerMetadata('https://vercel-mcp.example.test')).toEqual({
      issuer: 'https://vercel-mcp.example.test',
      authorization_endpoint: 'https://vercel-mcp.example.test/api/oauth/authorize',
      token_endpoint: 'https://vercel-mcp.example.test/api/oauth/token',
      registration_endpoint: 'https://vercel-mcp.example.test/api/oauth/register',
      client_id_metadata_document_supported: true,
      revocation_endpoint: 'https://vercel-mcp.example.test/api/oauth/revoke',
      revocation_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none']
    });
  });
});

describe('AUD-BY public health never touches the store', () => {
  it('answers ok with a store handle wired in that is down — and never calls it', async () => {
    const spy = spyingStore(false);
    const { healthy, document } = await healthDocument({ db: spy, env: ENV, buildSha: SHA, now: NOW });
    expect(healthy).toBe(true);
    expect(document.status).toBe('ok');
    expect(spy.calls).toBe(0);
  });

  it('handler serves 200 and issues no store query, even with a throwing store wired in', async () => {
    let calls = 0;
    const broken = { storeReachable: async () => { calls += 1; throw new Error('store unreachable'); } };
    const res = mockRes();
    await createHealthHandler({ db: broken, env: ENV, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe('ok');
    expect(calls).toBe(0);
  });
});

describe('AUD-AP store reachability probe', () => {
  it('answers true only when the store returns a row', async () => {
    const row = () => Promise.resolve([{ one: 1 }]);
    const empty = () => Promise.resolve([]);
    const failing = () => Promise.reject(new Error('connection refused'));
    await expect(createDb(row).storeReachable()).resolves.toBe(true);
    await expect(createDb(empty).storeReachable()).resolves.toBe(false);
    await expect(createDb(failing).storeReachable()).resolves.toBe(false);
  });

  it('answers false when no database is configured', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try { await expect(createDb().storeReachable()).resolves.toBe(false); }
    finally { if (saved !== undefined) process.env.DATABASE_URL = saved; }
  });
});

describe('AUD-AP health handler', () => {
  it('serves 200 with the pinned document while healthy', async () => {
    const res = mockRes();
    await createHealthHandler({ env: ENV, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Content-Type']).toContain('application/json');
    const body = JSON.parse(res.payload);
    expect(Object.keys(body).sort()).toEqual(FIELDS);
    expect(body.status).toBe('ok');
  });

  it('serves 503 with the same pinned shape while degraded', async () => {
    const res = mockRes();
    await createHealthHandler({ env: {}, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(Object.keys(body).sort()).toEqual(FIELDS);
    expect(body.status).toBe('degraded');
  });

  it('refuses non-GET methods', async () => {
    const res = mockRes();
    await createHealthHandler({ env: ENV, buildSha: SHA, now: NOW })({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('leaks nothing: no config values, credentials or internal fields in the body', async () => {
    // Assembled from parts on purpose: the value is fake, but its literal
    // shape is exactly what the repo's secret scan forbids in committed
    // text — the test proves the endpoint never echoes it without
    // committing the shape itself.
    const plantedDbUrl = 'postgres://watchuser:' + 'planted' + '-secret' +
      '@db.internal' + '.example.test:5432/neondb';
    for (const env of [{ ...ENV, DATABASE_URL: plantedDbUrl,
        TOKEN_ENCRYPTION_KEY: 'planted-encryption-key', ADMIN_PASSPHRASE: 'planted-passphrase' },
      { DATABASE_URL: plantedDbUrl,
        TOKEN_ENCRYPTION_KEY: 'planted-encryption-key', ADMIN_PASSPHRASE: 'planted-passphrase' }]) {
      const res = mockRes();
      await createHealthHandler({ env, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
      expect(res.payload).not.toMatch(/DATABASE_URL|TOKEN_ENCRYPTION_KEY|ADMIN_PASSPHRASE|PUBLIC_BASE_URL/);
      expect(res.payload).not.toMatch(/postgres(ql)?:\/\//);
      expect(res.payload).not.toContain('planted-secret');
      expect(res.payload).not.toContain('planted-encryption-key');
      expect(res.payload).not.toContain('planted-passphrase');
      expect(res.payload).not.toContain('db.internal.example.test');
      expect(res.payload).not.toMatch(/vcp_[a-zA-Z0-9_-]{12,}|vercel_blob_rw_[a-zA-Z0-9_-]{12,}/);
      expect(Object.keys(JSON.parse(res.payload)).sort()).toEqual(FIELDS);
    }
  });

  it('is referenced from the front-door document at the pinned path', async () => {
    expect(HEALTH_PATH).toBe('/api/health');
    const { publicInfo } = await import('../../api/index.js');
    expect(publicInfo().health).toBe(HEALTH_PATH);
  });
});

describe('AUD-BY deep health (authenticated store check)', () => {
  const allow = async () => Object.freeze({ clientId: 'test-client' });
  const BEARER = { authorization: 'Bearer ' + 'a'.repeat(43) };

  it('pins the deep path and its vercel.json rewrite to the thin function', () => {
    expect(DEEP_HEALTH_PATH).toBe('/api/health/deep');
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    expect(config.rewrites).toContainEqual({ source: '/api/health/deep', destination: '/api/health-deep' });
  });

  it('deep document reports the real store verdict both ways', async () => {
    const okDoc = await deepHealthDocument({ db: up, env: ENV, buildSha: SHA, now: NOW });
    expect(okDoc.healthy).toBe(true);
    expect(Object.keys(okDoc.document).sort()).toEqual(DEEP_FIELDS);
    expect(okDoc.document).toEqual({
      status: 'ok', version: SERVICE_VERSION, deployed_source_sha: SHA,
      tools: registry.tools.length, timestamp: '2026-10-31T07:00:00.000Z',
      checks: { store: true, oauth_metadata: true }
    });
    const downDoc = await deepHealthDocument({ db: down, env: ENV, buildSha: SHA, now: NOW });
    expect(downDoc.healthy).toBe(false);
    expect(downDoc.document.status).toBe('degraded');
    expect(downDoc.document.checks).toEqual({ store: false, oauth_metadata: true });
    const broken = { storeReachable: async () => { throw new Error('store unreachable'); } };
    const thrownDoc = await deepHealthDocument({ db: broken, env: ENV, buildSha: SHA, now: NOW });
    expect(thrownDoc.healthy).toBe(false);
    expect(thrownDoc.document.checks.store).toBe(false);
  });

  it('refuses a keyless caller with 401 before any store query (real MCP bearer check)', async () => {
    const spy = spyingStore(true);
    const db = { ...spy, getAccessToken: async () => { throw new Error('must not be reached keyless'); } };
    const res = mockRes();
    await createDeepHealthHandler({ db, env: ENV, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error).toBe('unauthorized');
    expect(spy.calls).toBe(0);
  });

  it('refuses an unknown bearer token with 401 and still never probes the store', async () => {
    const spy = spyingStore(true);
    const db = { ...spy, getAccessToken: async () => null };
    const res = mockRes();
    await createDeepHealthHandler({ db, env: ENV, buildSha: SHA, now: NOW })({ method: 'GET', headers: BEARER }, res);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error).toBe('invalid_token');
    expect(spy.calls).toBe(0);
  });

  it('serves the deep document to an authenticated caller, 200 up / 503 down', async () => {
    const resUp = mockRes();
    await createDeepHealthHandler({ db: up, env: ENV, buildSha: SHA, now: NOW, authenticate: allow })(
      { method: 'GET', headers: BEARER }, resUp);
    expect(resUp.statusCode).toBe(200);
    expect(resUp.headers['Cache-Control']).toBe('no-store');
    const bodyUp = JSON.parse(resUp.payload);
    expect(Object.keys(bodyUp).sort()).toEqual(DEEP_FIELDS);
    expect(bodyUp.checks).toEqual({ store: true, oauth_metadata: true });

    const resDown = mockRes();
    await createDeepHealthHandler({ db: down, env: ENV, buildSha: SHA, now: NOW, authenticate: allow })(
      { method: 'GET', headers: BEARER }, resDown);
    expect(resDown.statusCode).toBe(503);
    const bodyDown = JSON.parse(resDown.payload);
    expect(bodyDown.status).toBe('degraded');
    expect(bodyDown.checks).toEqual({ store: false, oauth_metadata: true });
  });

  it('refuses non-GET methods before authentication or any store query', async () => {
    const spy = spyingStore(true);
    let authCalls = 0;
    const countingAuth = async () => { authCalls += 1; return null; };
    const res = mockRes();
    await createDeepHealthHandler({ db: spy, env: ENV, buildSha: SHA, now: NOW, authenticate: countingAuth })(
      { method: 'POST', headers: BEARER }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    expect(authCalls).toBe(0);
    expect(spy.calls).toBe(0);
  });
});
