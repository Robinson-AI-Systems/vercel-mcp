// AUD-AP: the public health/posture endpoint (api/health.js is the thin
// function). A scripted watch reads this as its third leg — beside the
// front door and the keyless-401 check — so the shape is pinned and
// minimal: liveness only. Everything deeper (account, mode, profile,
// expiry posture) stays behind authenticated whoami (A-15); this
// endpoint complements it and never duplicates its detail.
import { createDb } from './db.js';
import { only, publicOrigin, send } from './core/http.js';
import { oauthServerMetadata } from './core/oauth-handlers.js';
import { SERVICE_VERSION } from './service-identity.js';
import { registry } from './tools/index.js';

export const HEALTH_PATH = '/api/health';

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

export async function healthDocument({ db, env = process.env,
  buildSha = process.env.VERCEL_GIT_COMMIT_SHA, now = () => new Date(),
  metadataFor = oauthServerMetadata } = {}) {
  let store = false;
  try { store = Boolean(await db.storeReachable()); } catch { store = false; }
  const healthy = store && oauthMetadataConsistent(env, metadataFor);
  const sourceSha = typeof buildSha === 'string' && /^[a-f0-9]{40}$/.test(buildSha)
    ? buildSha : null;
  return {
    healthy,
    document: {
      status: healthy ? 'ok' : 'degraded',
      version: SERVICE_VERSION,
      deployed_source_sha: sourceSha,
      tools: registry.tools.length,
      timestamp: now().toISOString()
    }
  };
}

export function createHealthHandler(deps = {}) {
  return async (req, res) => {
    if (!only(res, req, ['GET'])) return;
    const { healthy, document } = await healthDocument(deps);
    // send() sets Cache-Control: no-store — the same posture as the
    // front-door JSON document and the OAuth surfaces — so a watcher
    // always reads live posture, never a cached one.
    return send(res, healthy ? 200 : 503, document);
  };
}

// Production wiring: the store handle is built per request, like the
// OAuth routes (src/oauth/routes.js) — but deliberately no initSchema:
// a liveness probe must not run DDL, and the store check needs none.
export function handleHealth(req, res) {
  return createHealthHandler({ db: createDb(), env: process.env })(req, res);
}
