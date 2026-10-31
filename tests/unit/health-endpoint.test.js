import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { HEALTH_PATH, createHealthHandler, healthDocument, oauthMetadataConsistent } from '../../src/health.js';
import { oauthServerMetadata } from '../../src/core/oauth-handlers.js';
import { SERVICE_VERSION } from '../../src/service-identity.js';
import { registry } from '../../src/tools/index.js';

// AUD-AP: the public health endpoint. The watch reads it keyless every
// few minutes, so the shape is pinned exactly and the body must be safe
// to be public: liveness roll-up only, never a credential, a config
// value, an internal hostname or a per-check breakdown.
const ENV = { PUBLIC_BASE_URL: 'https://vercel-mcp.example.test' };
const SHA = 'b'.repeat(40);
const NOW = () => new Date('2026-10-31T07:00:00.000Z');
const up = { storeReachable: async () => true };
const down = { storeReachable: async () => false };
const FIELDS = ['deployed_source_sha', 'status', 'timestamp', 'tools', 'version'];

function mockRes() {
  return { headers: {}, statusCode: null, payload: '',
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.payload = body; return this; } };
}

describe('AUD-AP health document', () => {
  it('pins the exact public field set and healthy values', async () => {
    const { healthy, document } = await healthDocument({ db: up, env: ENV, buildSha: SHA, now: NOW });
    expect(healthy).toBe(true);
    expect(Object.keys(document).sort()).toEqual(FIELDS);
    expect(document).toEqual({
      status: 'ok', version: SERVICE_VERSION, deployed_source_sha: SHA,
      tools: registry.tools.length, timestamp: '2026-10-31T07:00:00.000Z'
    });
  });

  it('reports a non-SHA build stamp as null, like the front-door document', async () => {
    const { document } = await healthDocument({ db: up, env: ENV, buildSha: 'not-a-sha', now: NOW });
    expect(document.deployed_source_sha).toBe(null);
  });

  it('flips to degraded when the store does not answer', async () => {
    const { healthy, document } = await healthDocument({ db: down, env: ENV, buildSha: SHA, now: NOW });
    expect(healthy).toBe(false);
    expect(document.status).toBe('degraded');
    expect(Object.keys(document).sort()).toEqual(FIELDS);
  });

  it('flips to degraded when the store check itself throws', async () => {
    const broken = { storeReachable: async () => { throw new Error('store unreachable'); } };
    const { healthy, document } = await healthDocument({ db: broken, env: ENV, buildSha: SHA, now: NOW });
    expect(healthy).toBe(false);
    expect(document.status).toBe('degraded');
  });

  it('flips to degraded when the OAuth origin is not configured as an HTTPS origin', async () => {
    for (const env of [{}, { PUBLIC_BASE_URL: '' }, { PUBLIC_BASE_URL: 'http://vercel-mcp.example.test' },
      { PUBLIC_BASE_URL: 'https://user:pass@vercel-mcp.example.test' }]) {
      const { healthy, document } = await healthDocument({ db: up, env, buildSha: SHA, now: NOW });
      expect(healthy).toBe(false);
      expect(document.status).toBe('degraded');
    }
  });

  it('flips to degraded when the served metadata drifts from the configured origin', async () => {
    const drifted = (origin) => ({ ...oauthServerMetadata(origin), issuer: 'https://other.example.test' });
    const { healthy, document } = await healthDocument({ db: up, env: ENV, buildSha: SHA, now: NOW, metadataFor: drifted });
    expect(healthy).toBe(false);
    expect(document.status).toBe('degraded');
    const wrongPath = (origin) => ({ ...oauthServerMetadata(origin), token_endpoint: origin + '/api/oauth/tokens' });
    expect(oauthMetadataConsistent(ENV, wrongPath)).toBe(false);
    expect(oauthMetadataConsistent(ENV)).toBe(true);
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
    await createHealthHandler({ db: up, env: ENV, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Content-Type']).toContain('application/json');
    const body = JSON.parse(res.payload);
    expect(Object.keys(body).sort()).toEqual(FIELDS);
    expect(body.status).toBe('ok');
  });

  it('serves 503 with the same pinned shape while degraded', async () => {
    const res = mockRes();
    await createHealthHandler({ db: down, env: ENV, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(Object.keys(body).sort()).toEqual(FIELDS);
    expect(body.status).toBe('degraded');
  });

  it('refuses non-GET methods', async () => {
    const res = mockRes();
    await createHealthHandler({ db: up, env: ENV, buildSha: SHA, now: NOW })({ method: 'POST', headers: {} }, res);
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
    const env = { ...ENV, DATABASE_URL: plantedDbUrl,
      TOKEN_ENCRYPTION_KEY: 'planted-encryption-key', ADMIN_PASSPHRASE: 'planted-passphrase' };
    for (const db of [up, down]) {
      const res = mockRes();
      await createHealthHandler({ db, env, buildSha: SHA, now: NOW })({ method: 'GET', headers: {} }, res);
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
