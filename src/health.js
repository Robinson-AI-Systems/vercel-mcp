// AUD-AP: the public health/posture endpoint (api/health.js is the thin
// function). A scripted watch reads this as its third leg — beside the
// front door and the keyless-401 check — so the shape is pinned and
// minimal: liveness only. Everything deeper (account, mode, profile,
// expiry posture) stays behind authenticated whoami (A-15); this
// endpoint complements it and never duplicates its detail.
//
// AUD-BY (2026-11-03, the Neon wake-up fix): the public document is
// answered entirely from memory and configuration — it must NEVER
// touch the store. The store lives in Neon with scale-to-zero after
// five quiet minutes; a health probe that runs a store query on every
// visit keeps the compute awake around the clock and burns the
// owner's money proving nothing a watcher needs. The one check that
// remains here (OAuth metadata self-consistency) is derived from
// configuration alone and can still genuinely fail. The real store
// check moved to the authenticated deep-health path below
// (GET /api/health/deep, api/health-deep.js behind a rewrite): a
// deliberate, signed-in check still proves the store answers, and
// nobody polls it routinely.
import { createDb } from './db.js';
import { only, publicOrigin, send } from './core/http.js';
import { requireMcpToken } from './core/mcp-auth.js';
import { oauthServerMetadata } from './core/oauth-handlers.js';
import { SERVICE_VERSION } from './service-identity.js';
import { registry } from './tools/index.js';

export const HEALTH_PATH = '/api/health';
export const DEEP_HEALTH_PATH = '/api/health/deep';

// The response field set is pinned by tests/unit/health-endpoint.test.js:
// status, version, deployed_source_sha, tools, timestamp — nothing else.
// The body is public by design, so it carries no credentials, no user
// data, no internal hostnames, no config values and no per-check detail
// (which dependency failed stays internal; only the roll-up is public).
const ENDPOINT_PATHS = {
  authorization_endpoint: '/api/oauth/authorize',
  token_endpoint: '/api/oauth/token',
  registration_endpoint: '/api/oauth/register',
  revocation_endpoint: '/api/oauth/revoke'
};

// OAuth issuer/metadata self-consistency: the metadata document this
// server serves must be the document its own configured origin implies.
// Can fail two honest ways: PUBLIC_BASE_URL missing or not an HTTPS
// origin (publicOrigin throws — the same failure that breaks the OAuth
// routes), or the served document's issuer/endpoints drifting from that
// origin (a metadata-builder edit that stops deriving from the origin).
export function oauthMetadataConsistent(env, metadataFor = oauthServerMetadata) {
  try {
    const origin = publicOrigin(env);
    const doc = metadataFor(origin);
    if (!doc || doc.issuer !== origin) return false;
    return Object.entries(ENDPOINT_PATHS).every(([field, path]) => doc[field] === origin + path);
  } catch { return false; }
}

function baseDocument({ env, buildSha, now, metadataFor }) {
  const sourceSha = typeof buildSha === 'string' && /^[a-f0-9]{40}$/.test(buildSha)
    ? buildSha : null;
  return {
    sourceSha,
    metadata: oauthMetadataConsistent(env, metadataFor),
    fields: {
      version: SERVICE_VERSION,
      deployed_source_sha: sourceSha,
      tools: registry.tools.length,
      timestamp: now().toISOString()
    }
  };
}

// The public health document: memory and configuration only. There is
// deliberately no db parameter — a caller cannot wire the store into
// this path by accident (pinned by test: a store handle passed in the
// deps is never queried).
export function healthDocument({ env = process.env,
  buildSha = process.env.VERCEL_GIT_COMMIT_SHA, now = () => new Date(),
  metadataFor = oauthServerMetadata } = {}) {
  const { metadata, fields } = baseDocument({ env, buildSha, now, metadataFor });
  const healthy = metadata;
  return {
    healthy,
    document: { status: healthy ? 'ok' : 'degraded', ...fields }
  };
}

export function createHealthHandler(deps = {}) {
  return async (req, res) => {
    if (!only(res, req, ['GET'])) return;
    const { healthy, document } = healthDocument(deps);
    // send() sets Cache-Control: no-store — the same posture as the
    // front-door JSON document and the OAuth surfaces — so a watcher
    // always reads live posture, never a cached one.
    return send(res, healthy ? 200 : 503, document);
  };
}

// Production wiring: no store handle is built at all on this path —
// not per request, not lazily. The endpoint cannot wake the database
// because it holds nothing that could query it.
export function handleHealth(req, res) {
  return createHealthHandler({ env: process.env })(req, res);
}

// The deep health document: the public five fields plus the per-check
// breakdown, including the real store probe (db.storeReachable() — the
// constant read AUD-AP added, deliberately no initSchema: a probe
// must not run DDL). Served only behind a connection bearer token, so
// the breakdown is not public and the store query runs only when a
// signed-in caller deliberately asks.
export async function deepHealthDocument({ db, env = process.env,
  buildSha = process.env.VERCEL_GIT_COMMIT_SHA, now = () => new Date(),
  metadataFor = oauthServerMetadata } = {}) {
  let store = false;
  try { store = Boolean(await db.storeReachable()); } catch { store = false; }
  const { metadata, fields } = baseDocument({ env, buildSha, now, metadataFor });
  const healthy = store && metadata;
  return {
    healthy,
    document: {
      status: healthy ? 'ok' : 'degraded', ...fields,
      checks: { store, oauth_metadata: metadata }
    }
  };
}

export function createDeepHealthHandler(deps = {}) {
  const authenticate = deps.authenticate ?? requireMcpToken;
  return async (req, res) => {
    if (!only(res, req, ['GET'])) return;
    // The server's existing authenticated surface pattern: the same
    // connection bearer check as /api/mcp (requireMcpToken answers
    // the 401 itself and returns null). Authentication runs first —
    // a refused caller never reaches the store probe.
    const connection = await authenticate(req, res, deps.db, deps.env ?? process.env);
    if (!connection) return;
    const { healthy, document } = await deepHealthDocument(deps);
    return send(res, healthy ? 200 : 503, document);
  };
}

// Production wiring: the store handle is built per request, like the
// OAuth routes (src/oauth/routes.js) — the deliberate signed-in probe
// is the one place a health path is allowed to hold one.
export function handleDeepHealth(req, res) {
  return createDeepHealthHandler({ db: createDb(), env: process.env })(req, res);
}
