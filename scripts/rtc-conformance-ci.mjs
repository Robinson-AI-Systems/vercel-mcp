#!/usr/bin/env node
// AUD-BG / R-3 — RTC 1 conformance in CI, executed under disposition (b)
// (owner's composite ruling, 2026-10-31; hub DECISIONS PR #251, mirrored
// in this repo by AUD-BH #377; build sketch: the AUD-BF dossier).
//
// The harness runs the hub conformance suite AT THE PIN
// (e76b1f8bc76e4658f404263ee47a9edbcbeda625 — the frozen RTC 1 suite)
// against this server's real RTC door (src/rtc/door.js) backed by a
// real Postgres through this server's own src/db.js, with the pinned
// `emulate` fake Vercel behind the provider path. It asserts the full
// named subset the pin can run against a real server (the dossier's
// legs 1–7: manifest, manifest.openapi, catalog, meta, passes,
// passes.read_only, passes.expired, passes.revoked, safety, budget,
// oauth.refresh_settings, limits.two_instance). The suite's `reads`
// and `writes` probes are run for the record and DISPOSITIONED — at
// the pin they hardcode fake-server semantics no real server can
// satisfy; their behavior is covered by the server-side write-contract
// and HTTPS suites BATCH-R §R3 names (see docs/RTC-HUB-INTEGRATION.md).
//
// Fake-only discipline: the database URL must point at a throwaway
// localhost Postgres, and the only Vercel traffic goes to the local
// emulator with its FAKE fixture token. No real IDs, no live calls.
//
// Usage: node scripts/rtc-conformance-ci.mjs
// Env: RTC_CONFORMANCE_DATABASE_URL (or TEST_DATABASE_URL / DATABASE_URL)
//      — a throwaway localhost Postgres database;
//      RTC_HUB_DIR — hub checkout at the pin (default ./rtc-hub).
// `--serve --port N` runs one door process (orchestrator-internal).
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { createDb } from '../src/db.js';
import { encryptSecret } from '../src/core/secret-box.js';
import { rtcDoor } from '../src/rtc/door.js';
import { rtcManifest, rtcOpenApi } from '../src/core/rtc-contract.js';
import { registry } from '../src/tools/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN = 'e76b1f8bc76e4658f404263ee47a9edbcbeda625';
const NAMED = ['manifest', 'manifest.openapi', 'catalog', 'meta', 'passes',
  'passes.read_only', 'passes.expired', 'passes.revoked', 'safety',
  'budget', 'oauth.refresh_settings', 'limits.two_instance'];
const DISPOSITIONED = ['reads', 'writes'];
// The emulator's fixture token is read from the seed fixture itself —
// the single source of truth the `emulate` job also uses.
const SEED_PATH = join(ROOT, 'test', 'fixtures', 'vercel-emulate.yaml');
const EMULATOR_TOKEN = readFileSync(SEED_PATH, 'utf8')
  .match(/^ {2}([A-Za-z0-9_-]+):\s*$/m)?.[1];
if (!EMULATOR_TOKEN) throw new Error('Could not read the emulator fixture token from the seed fixture');
const ACCOUNT_ID = 'team_RTCFIXTURE';
const TEAM_SLUG = 'a4-test-team';
const TWO_INSTANCE_LIMIT = 10;

function neonShapedQuery(pool) {
  return async (strings, ...values) => {
    let statement = strings[0];
    for (let i = 0; i < values.length; i++) statement += `$${i + 1}${strings[i + 1]}`;
    return (await pool.query(statement, values)).rows;
  };
}

function databaseUrl() {
  const url = process.env.RTC_CONFORMANCE_DATABASE_URL ||
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('RTC_CONFORMANCE_DATABASE_URL (a throwaway localhost Postgres) is required');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host))
    throw new Error('The conformance harness may only use a localhost database');
  return url;
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(url, options, what, deadlineMs = 30000) {
  const start = Date.now();
  for (;;) {
    try { const res = await fetch(url, options); if (res.ok) return res; } catch { /* not up yet */ }
    if (Date.now() - start > deadlineMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

// ---------------------------------------------------------------------
// --serve: one door process. Mirrors the production api/* route shape
// (src/rtc/api.js) but builds the db over pg — the Neon serverless
// driver cannot speak to a local Postgres — and passes the door a
// fetchImpl that rewrites the production Vercel origin to the local
// emulator (the shipped seam; production passes no fetchImpl).
// ---------------------------------------------------------------------
async function serve(port) {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  const db = createDb(neonShapedQuery(pool));
  await db.initSchema();
  const emulatorBase = process.env.RTC_EMULATOR_BASE;
  if (!emulatorBase) throw new Error('RTC_EMULATOR_BASE is required for --serve');
  const fetchImpl = (url, init) =>
    fetch(String(url).replace(/^https:\/\/api\.vercel\.com/, emulatorBase), init);
  const door = rtcDoor({ db, registry, env: process.env, fetchImpl });
  const sendJson = (res, code, value) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const query = Object.fromEntries(url.searchParams);
      if (url.pathname === '/api/contract' && req.method === 'GET')
        return sendJson(res, 200, rtcManifest(registry));
      if (url.pathname === '/api/openapi.json' && req.method === 'GET')
        return sendJson(res, 200, rtcOpenApi());
      let route = null;
      if (url.pathname === '/api/whoami') route = 'whoami';
      else if (url.pathname === '/api/tools' && req.method === 'GET') route = 'list';
      else if (url.pathname === '/api/tools/_batch') route = 'batch';
      else if (url.pathname.startsWith('/api/tools/')) {
        query.name = decodeURIComponent(url.pathname.slice('/api/tools/'.length));
        route = req.method === 'GET' ? 'describe' : 'invoke';
      } else if (url.pathname.startsWith('/api/results/')) {
        query.handle = decodeURIComponent(url.pathname.slice('/api/results/'.length));
        route = 'result';
      }
      if (!route) return sendJson(res, 404, { ok: false, error: { code: 'not_found' } });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const adapted = {
        headers: {},
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        status(code) { this.code = code; return this; },
        send(text) { res.writeHead(this.code || 200, this.headers); res.end(text); }
      };
      await door({
        method: req.method, headers: req.headers, query,
        body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined
      }, adapted, route);
    } catch {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: { code: 'service_error' } });
      else res.end();
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`rtc-door-ready ${port}`);
}

// ---------------------------------------------------------------------
// Orchestrator.
// ---------------------------------------------------------------------
async function orchestrate() {
  const hubDir = process.env.RTC_HUB_DIR || join(ROOT, 'rtc-hub');
  const url = databaseUrl();
  const children = [];
  const cleanup = () => { for (const child of children) { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
  process.on('exit', cleanup);
  const watchdog = setTimeout(() => {
    console.error('Conformance harness watchdog fired (240s)');
    cleanup(); process.exit(3);
  }, 240000);
  try {
    // 1. The fake Vercel (pinned emulator, repo seed fixture).
    const emulatorPort = await freePort();
    const emulatorBase = `http://127.0.0.1:${emulatorPort}`;
    const emulator = spawn(process.execPath, [
      join(ROOT, 'node_modules', 'emulate', 'dist', 'index.js'), 'start',
      '--service', 'vercel', '--seed', SEED_PATH,
      '--port', String(emulatorPort), '--host', '127.0.0.1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(emulator);
    let emulatorLog = '';
    emulator.stdout.on('data', d => { emulatorLog += d; });
    emulator.stderr.on('data', d => { emulatorLog += d; });
    await waitFor(`${emulatorBase}/v2/user`,
      { headers: { authorization: `Bearer ${EMULATOR_TOKEN}` } }, 'the emulator')
      .catch(err => { throw new Error(`${err.message}\n${emulatorLog.slice(-2000)}`); });
    const teams = (await (await fetch(`${emulatorBase}/v2/teams`,
      { headers: { authorization: `Bearer ${EMULATOR_TOKEN}` } })).json()).teams;
    const team = teams?.find(t => t.slug === TEAM_SLUG);
    if (!team?.id) throw new Error('The emulator seed team was not found');

    // 2. Throwaway database state through the server's own db layer.
    const pool = new pg.Pool({ connectionString: url });
    const db = createDb(neonShapedQuery(pool));
    await db.initSchema();
    const fixtureEnv = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
    // Fixture hygiene in a reused throwaway database: the emulator
    // assigns its seed team a fresh id per start, and the enrollment
    // upsert's ON CONFLICT path deliberately preserves an existing
    // row's team identity (rotation semantics) — so a stale fixture
    // row would keep pointing at a previous emulator instance's team.
    await pool.query(`DELETE FROM vercel_accounts WHERE id = $1`, [ACCOUNT_ID]);
    await db.upsertVercelAccount({
      id: ACCOUNT_ID, teamId: team.id, teamSlug: TEAM_SLUG,
      label: 'RTC conformance fixture (fake Vercel)', scope: 'team',
      tokenEnc: encryptSecret(EMULATOR_TOKEN, 'token:' + ACCOUNT_ID, fixtureEnv),
      tokenLast4: EMULATOR_TOKEN.slice(-4),
      probe: { fixture: 'rtc-conformance', fake: true }
    });
    const issue = async promise => {
      const pass = await promise;
      if (!pass?.token) throw new Error('Pass issuance failed (account row missing?)');
      return pass;
    };
    // The full pass is scoped to the projects area on purpose: the
    // suite's selection() picks the reference read/write/guarded tools
    // off the first catalog page, and the door's page is the shipped
    // 8 KiB envelope-bounded prefix of the pass-visible catalog. The
    // server area's visible rows are all reads (its connection tools
    // are not pass-visible writes), so a server-scoped page can never
    // satisfy selection; the projects page carries a read
    // (vercel_project_list), a plain write
    // (vercel_project_update_settings) and a guarded write
    // (vercel_project_create) inside the first page.
    const full = await issue(db.issueWriteRtcPass({
      account: ACCOUNT_ID, profile: 'full', mode: 'production', hours: 1,
      areas: ['projects'], spendLimitCents: 0, projectIds: null, rateLimitPerMinute: 300
    }));
    // Issued passes are born with the schema's 'compact' listing; the
    // suite's reference pass is a catalog-listing pass (the door
    // validates both listings, and the hub offline check's fixture
    // pass is a catalog pass too): the suite searches without a
    // listing parameter, which the door scopes to the pass's own
    // listing, and its reference tools are selected from the catalog.
    await pool.query(`UPDATE rtc_passes SET listing = 'catalog' WHERE pass_id = $1`, [full.id]);
    const readOnly = await issue(db.issueReadOnlyRtcPass({
      account: ACCOUNT_ID, hours: 1, areas: ['server'], mode: 'preview', rateLimitPerMinute: 300
    }));
    const expired = await issue(db.issueReadOnlyRtcPass({
      account: ACCOUNT_ID, hours: 1, areas: ['server'], mode: 'preview', rateLimitPerMinute: 300
    }));
    await pool.query(`UPDATE rtc_passes SET expires_at = now() - interval '1 minute' WHERE pass_id = $1`,
      [expired.id]);
    const revoked = await issue(db.issueReadOnlyRtcPass({
      account: ACCOUNT_ID, hours: 1, areas: ['server'], mode: 'preview', rateLimitPerMinute: 300
    }));
    await db.revokeRtcPass({ account: ACCOUNT_ID, id: revoked.id });
    const limiter = await issue(db.issueReadOnlyRtcPass({
      account: ACCOUNT_ID, hours: 1, areas: ['server'], mode: 'preview',
      rateLimitPerMinute: TWO_INSTANCE_LIMIT
    }));

    // 3. OAuth refresh-settings adapter over the server's own OAuth
    // store (createAccessToken / getTokenByRefreshToken /
    // getAccessToken / rotateRefreshToken in src/db.js). Connector
    // tokens carry no areas field; the adapter reports areas: null on
    // both inspections — the honest projection of the stored settings.
    const clientId = 'rtc_conformance_fixture';
    const fresh = prefix => `${prefix}_${randomBytes(24).toString('base64url')}`;
    let currentRefresh = fresh('rtc_oauth_refresh');
    await db.createAccessToken({
      accessToken: fresh('rtc_oauth_access'), refreshToken: currentRefresh,
      clientId, vercelAccount: ACCOUNT_ID, mode: 'preview',
      profile: 'everyday', listing: 'front_door', ttlSeconds: 3600
    });
    const project = row => {
      if (!row) throw new Error('OAuth fixture row missing');
      return { profile: row.profile, listing: row.listing, areas: null, mode: row.mode, account: row.vercel_account };
    };
    const oauth = {
      inspect: async access => project(access
        ? await db.getAccessToken(access)
        : await db.getTokenByRefreshToken(currentRefresh)),
      refresh: async () => {
        const accessToken = fresh('rtc_oauth_access');
        const newRefreshToken = fresh('rtc_oauth_refresh');
        const row = await db.rotateRefreshToken({
          refreshToken: currentRefresh, clientId, accessToken, newRefreshToken, ttlSeconds: 3600
        });
        if (!row) throw new Error('OAuth refresh rotation failed');
        currentRefresh = newRefreshToken;
        return accessToken;
      }
    };

    // 4. Two independent door processes over the one database.
    const doorUrls = [];
    for (let i = 0; i < 2; i++) {
      const port = await freePort();
      const child = spawn(process.execPath,
        [fileURLToPath(import.meta.url), '--serve', '--port', String(port)],
        { env: { ...process.env, RTC_CONFORMANCE_DATABASE_URL: url,
            TOKEN_ENCRYPTION_KEY: fixtureEnv.TOKEN_ENCRYPTION_KEY,
            RTC_EMULATOR_BASE: emulatorBase },
          stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let log = '';
      child.stdout.on('data', d => { log += d; });
      child.stderr.on('data', d => { log += d; });
      await waitFor(`http://127.0.0.1:${port}/api/contract`, {}, `door process ${i + 1}`)
        .catch(err => { throw new Error(`${err.message}\n${log.slice(-2000)}`); });
      doorUrls.push(`http://127.0.0.1:${port}`);
    }

    // 5. The pin suite, run whole; the named subset is asserted.
    const { runConformance } = await import(
      pathToFileURL(join(hubDir, 'packages', 'conformance', 'src', 'run.js')).href);
    const report = await runConformance({
      url: doorUrls[0],
      passes: { full: full.token, readOnly: readOnly.token, expired: expired.token, revoked: revoked.token },
      oauth,
      instances: { urls: doorUrls, pass: limiter.token, limit: TWO_INSTANCE_LIMIT }
    });
    console.log(`RTC 1 conformance at the pin (${PIN}) — named subset asserted, reads/writes dispositioned:`);
    const byName = new Map(report.checks.map(c => [c.name, c]));
    let failed = false;
    for (const check of report.checks) {
      const tag = NAMED.includes(check.name) ? 'asserted'
        : DISPOSITIONED.includes(check.name) ? 'dispositioned' : 'unexpected';
      console.log(`  ${check.name}: ok=${check.ok} skipped=${Boolean(check.skipped)} (${tag})${check.message ? ` — ${check.message}` : ''}`);
      if (tag === 'unexpected') failed = true;
    }
    for (const name of NAMED) {
      const check = byName.get(name);
      if (!check) { console.log(`  MISSING named check: ${name}`); failed = true; }
      else if (!check.ok || check.skipped) { console.log(`  FAILED named check: ${name}`); failed = true; }
    }
    for (const name of DISPOSITIONED)
      if (!byName.has(name)) { console.log(`  MISSING dispositioned check (it must at least run): ${name}`); failed = true; }
    await pool.end().catch(() => {});
    if (failed) { console.error('RTC conformance: named subset FAILED'); process.exitCode = 1; }
    else console.log('RTC conformance: named subset PASSED (reads/writes dispositioned — see docs/RTC-HUB-INTEGRATION.md)');
  } finally {
    clearTimeout(watchdog);
    cleanup();
  }
}

const serveFlag = process.argv.indexOf('--serve');
if (serveFlag >= 0) {
  const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
  if (!Number.isInteger(port) || port < 1) { console.error('--port is required'); process.exit(2); }
  await serve(port);
} else {
  try { await orchestrate(); }
  catch (err) { console.error("Conformance harness failed:", err); process.exit(2); }
}
