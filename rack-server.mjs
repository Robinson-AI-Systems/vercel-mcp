#!/usr/bin/env node
// Development Rack entrypoint (RACK-STAGING S-2): the thin standalone
// HTTP server that runs this service outside Vercel. It reproduces,
// route for route, the platform contract the api/ functions are
// written against:
//
//   - filesystem binding: every api/**/*.js default export serves at
//     its /api/* path, exactly as Vercel binds function files (an
//     index.js also serves at its directory path, so the front door
//     answers at /api and /api/index, and the tools index at
//     /api/tools and /api/tools/index); bracket segments ([name],
//     [handle]) bind as query parameters, as Vercel binds them, and
//     literal files (_batch) win over the bracket door beside them;
//   - the vercel.json rewrites, verbatim: /api/openapi.json onto the
//     RTC OpenAPI document, the three /.well-known documents onto
//     their handlers, /api/health/deep onto the deep health door,
//     / onto the front door, /connection onto the connection page,
//     and the two /brand/icon-*.png addresses onto the front door
//     with their brand_icon query parameter;
//   - the (req, res) surface the handlers use: req.method / headers /
//     query / body (parsed per each function's exported bodyParser
//     config, with Vercel's default 4.5 MB limit when a function does
//     not set one) and the chainable res.status / res.json / res.send
//     helpers on a real Node ServerResponse, so the MCP handler's
//     streaming transport keeps working untouched.
//
// Body contract, per route (the Workspace Phase-2 defect rule: an
// entrypoint must never consume a stream and then let a handler
// re-read it): the one bodyParser:false function — the deployment
// webhook receiver, which verifies its HMAC over the raw bytes —
// receives the request stream UNTOUCHED. Every other function
// receives the buffered, parsed body exactly as Vercel presents it
// (JSON and form bodies as objects, anything else as a string, no
// body as undefined; a JSON parse failure is the platform's 400,
// answered before the handler). api/mcp.js declares bodyParser:true
// and takes the same parsed-body path. Handlers here read only
// req.body, never the stream, so the buffered body is the whole
// contract for them.
//
// No application logic lives here; every request is dispatched to
// the same handler module Vercel invokes. No per-route duration
// timer is imposed: Vercel's function durations are platform
// ceilings, and the rule for this entrypoint is only that it must
// not impose a SHORTER one — a standalone server imposes none.
//
// Release identity: health and the front door read the deployed
// commit from VERCEL_GIT_COMMIT_SHA, which Vercel sets per
// deployment and nothing sets on the rack. The rack build therefore
// pins it: RACK_RELEASE_COMMIT (the promoted commit the build was
// made from, declared in the rack environment) or a
// release-commit.txt beside this file, written by the build recipe.
// pinReleaseCommit() runs before the server accepts traffic; with
// no valid pin the variable stays unset and health honestly reports
// a null commit — the acceptance read-back then fails by design
// rather than passing on a synthesized value.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import connection from './api/connection.js';
import contract from './api/contract.js';
import devAuthorize from './api/dev/authorize.js';
import devEnroll from './api/dev/enroll.js';
import developerConnect from './api/developer/connect.js';
import health from './api/health.js';
import healthDeep from './api/health-deep.js';
import frontDoor from './api/index.js';
import mcp, { config as mcpConfig } from './api/mcp.js';
import oauthAuthorize from './api/oauth/authorize.js';
import oauthEnroll from './api/oauth/enroll.js';
import oauthRegister from './api/oauth/register.js';
import oauthRevoke from './api/oauth/revoke.js';
import oauthToken from './api/oauth/token.js';
import oauthVercelCallback from './api/oauth/vercel/callback.js';
import resultHandle from './api/results/[handle].js';
import rtcOpenapi from './api/rtc-openapi.js';
import toolBatch from './api/tools/_batch.js';
import toolName from './api/tools/[name].js';
import toolsIndex from './api/tools/index.js';
import vercelConnect from './api/vercel/connect.js';
import vercelIntegration from './api/vercel/integration.js';
import deploymentWebhook, { config as webhookConfig } from './api/webhooks/deployments.js';
import wellKnownClient from './api/well-known/muse-client.js';
import wellKnownAS from './api/well-known/oauth-authorization-server.js';
import wellKnownPR from './api/well-known/oauth-protected-resource.js';
import whoami from './api/whoami.js';

const SHA40 = /^[a-f0-9]{40}$/;

// Pins the release identity for this process (see header). Returns
// the pinned commit, the platform-provided one, or null when no
// valid pin exists. Never overwrites a valid platform value, never
// synthesizes a commit.
export function pinReleaseCommit(env = process.env) {
  const existing = typeof env.VERCEL_GIT_COMMIT_SHA === 'string'
    ? env.VERCEL_GIT_COMMIT_SHA.trim()
    : '';
  if (SHA40.test(existing)) return existing;
  let candidate = typeof env.RACK_RELEASE_COMMIT === 'string'
    ? env.RACK_RELEASE_COMMIT.trim()
    : '';
  if (!SHA40.test(candidate)) {
    try {
      candidate = readFileSync(new URL('./release-commit.txt', import.meta.url), 'utf8').trim();
    } catch { candidate = ''; }
  }
  if (!SHA40.test(candidate)) return null;
  env.VERCEL_GIT_COMMIT_SHA = candidate;
  return candidate;
}

const pinnedCommit = pinReleaseCommit();

const route = (handler, config) => Object.freeze({ handler, config });

export const FILE_ROUTES = new Map([
  ['/api/connection', route(connection)],
  ['/api/contract', route(contract)],
  ['/api/dev/authorize', route(devAuthorize)],
  ['/api/dev/enroll', route(devEnroll)],
  ['/api/developer/connect', route(developerConnect)],
  ['/api/health', route(health)],
  ['/api/health-deep', route(healthDeep)],
  ['/api/index', route(frontDoor)],
  ['/api', route(frontDoor)],
  ['/api/mcp', route(mcp, mcpConfig)],
  ['/api/oauth/authorize', route(oauthAuthorize)],
  ['/api/oauth/enroll', route(oauthEnroll)],
  ['/api/oauth/register', route(oauthRegister)],
  ['/api/oauth/revoke', route(oauthRevoke)],
  ['/api/oauth/token', route(oauthToken)],
  ['/api/oauth/vercel/callback', route(oauthVercelCallback)],
  ['/api/rtc-openapi', route(rtcOpenapi)],
  ['/api/tools/_batch', route(toolBatch)],
  ['/api/tools/index', route(toolsIndex)],
  ['/api/tools', route(toolsIndex)],
  ['/api/vercel/connect', route(vercelConnect)],
  ['/api/vercel/integration', route(vercelIntegration)],
  ['/api/webhooks/deployments', route(deploymentWebhook, webhookConfig)],
  ['/api/well-known/muse-client', route(wellKnownClient)],
  ['/api/well-known/oauth-authorization-server', route(wellKnownAS)],
  ['/api/well-known/oauth-protected-resource', route(wellKnownPR)],
  ['/api/whoami', route(whoami)],
]);

// The vercel.json rewrite table, verbatim. The brand-icon rewrites
// carry their query parameter into the resolved route.
export const REWRITE_ROUTES = new Map([
  ['/api/openapi.json', route(rtcOpenapi)],
  ['/.well-known/oauth-authorization-server', route(wellKnownAS)],
  ['/.well-known/oauth-protected-resource', route(wellKnownPR)],
  ['/.well-known/muse-client.json', route(wellKnownClient)],
  ['/api/health/deep', route(healthDeep)],
  ['/', route(frontDoor)],
  ['/connection', route(connection)],
  ['/brand/icon-256.png', Object.freeze({ handler: frontDoor, config: undefined, query: { brand_icon: '256' } })],
  ['/brand/icon-64.png', Object.freeze({ handler: frontDoor, config: undefined, query: { brand_icon: '64' } })],
]);

// Resolves a request path to {handler, config, query} — query carries
// the bracket-segment and rewrite parameters — or null (404). Literal
// file routes resolve before the bracket doors, as on Vercel.
export function resolveRoute(pathname) {
  const rewritten = REWRITE_ROUTES.get(pathname);
  if (rewritten) return { handler: rewritten.handler, config: rewritten.config, query: { ...(rewritten.query || {}) } };
  const file = FILE_ROUTES.get(pathname);
  if (file) return { ...file, query: {} };
  let match = /^\/api\/tools\/([^/]+)$/.exec(pathname);
  if (match) return { ...route(toolName), query: { name: decodeURIComponent(match[1]) } };
  match = /^\/api\/results\/([^/]+)$/.exec(pathname);
  if (match) return { ...route(resultHandle), query: { handle: decodeURIComponent(match[1]) } };
  return null;
}

const DEFAULT_BODY_LIMIT = 4_572_800; // Vercel's function body limit when a function sets none (4.5 MB)

export function bodyLimitBytes(config) {
  const parser = config?.api?.bodyParser;
  if (parser === false) return 0;
  const declared = typeof parser === 'object' && parser !== null ? parser.sizeLimit : undefined;
  if (declared === undefined) return DEFAULT_BODY_LIMIT;
  if (typeof declared === 'number') return declared;
  const parsed = /^(\d+(?:\.\d+)?)\s*(b|kb|mb)$/i.exec(String(declared).trim());
  if (!parsed) return DEFAULT_BODY_LIMIT;
  const factor = { b: 1, kb: 1024, mb: 1024 * 1024 }[parsed[2].toLowerCase()];
  return Math.floor(Number(parsed[1]) * factor);
}

function queryObject(searchParams) {
  const query = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  return query;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Reproduces Vercel's bodyParser: JSON and form bodies arrive as
// objects, anything else as a string, no body as undefined. A JSON
// parse failure is the platform's 400, answered before the handler.
function parseBody(raw, contentType) {
  if (raw.length === 0) return undefined;
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const text = raw.toString('utf8');
  if (type === 'application/json') {
    try {
      return JSON.parse(text);
    } catch {
      const error = new Error('Invalid JSON body');
      error.statusCode = 400;
      throw error;
    }
  }
  if (type === 'application/x-www-form-urlencoded') return queryObject(new URLSearchParams(text));
  return text;
}

function decorateResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
  res.send = (body) => {
    if (body === undefined || body === null) {
      res.end();
      return res;
    }
    if (typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    if (typeof body === 'string' && !res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
    res.end(body);
    return res;
  };
  return res;
}

function platformError(res, statusCode, error) {
  if (res.headersSent) return;
  res.setHeader('Cache-Control', 'no-store');
  res.status(statusCode).json({ error, error_description: statusCode === 413
    ? 'The request body exceeds this function\'s configured limit.'
    : 'The request body could not be parsed as JSON.' });
}

export function createRackServer() {
  return createServer(async (req, res) => {
    decorateResponse(res);
    try {
      const url = new URL(req.url, 'http://rack.internal');
      const resolved = resolveRoute(url.pathname);
      if (!resolved) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: 'not_found' });
      }
      req.query = { ...queryObject(url.searchParams), ...resolved.query };
      const limit = bodyLimitBytes(resolved.config);
      if (limit > 0 && req.method !== 'GET' && req.method !== 'HEAD') {
        const raw = await readBody(req, limit);
        req.body = parseBody(raw, req.headers['content-type']);
      }
      return await resolved.handler(req, res);
    } catch (error) {
      if (error?.statusCode === 400 || error?.statusCode === 413) {
        return platformError(res, error.statusCode, error.statusCode === 413 ? 'payload_too_large' : 'invalid_json');
      }
      if (!res.headersSent) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(500).json({ error: 'internal_error' });
      }
      res.end();
    }
  });
}

if (process.argv[1]?.endsWith('rack-server.mjs')) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  if (!pinnedCommit) {
    console.warn('rack-server: no release pin found (RACK_RELEASE_COMMIT or release-commit.txt); health will report a null commit until the build pins one.');
  }
  createRackServer().listen(port, host, () => {
    console.log(`Vercel Unleashed rack entrypoint listening on ${host}:${port} (release ${pinnedCommit || 'unpinned'})`);
  });
}
