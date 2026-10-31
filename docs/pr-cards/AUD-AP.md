# AUD-AP — Public health/posture endpoint for the scripted watch

**Baseline inspected:** main `8fb9e83` (AUD-AK, #341).
Source: owner directive 2026-10-31 (Production Gate build card) — the
dedicated health endpoint "must be built."

**The gap.** The fleet's scripted watch (vercel-watch, live 2026-10-31,
a 5-minute probe with no agent tokens) reads three legs: the front
door, the keyless-401 refusal, and a posture leg. Until this card the
third leg had to read the OAuth metadata document, because the server
published nothing purpose-built: the root status document proves HTTP
reachability only (its own note says so), and real posture
(`vercel_whoami`, A-15) is authenticated by design and must stay that
way. There was no public, machine-readable liveness signal a script
could read without credentials.

**The change.**

1. **`GET /api/health`** (`api/health.js` → `src/health.js`), a public
   GET-only JSON endpoint. URL choice: `/api/health` is this server's
   established function-route shape — the MCP endpoint is `/api/mcp`,
   the OAuth endpoints live under `/api/oauth/*`, and `api/*.js` files
   serve at their own path with no rewrite — so the watch gets a stable
   address on the same origin as every other machine surface, beside
   the well-known documents that are reserved for discovery metadata.
2. **Pinned minimal shape — five fields, nothing else:** `status`
   (`"ok"` / `"degraded"`), `version` (`SERVICE_VERSION`),
   `deployed_source_sha` (the build's 40-hex commit SHA, else `null` —
   the front-door document's rule, shared), `tools` (the live registry
   count), `timestamp` (ISO, per request). HTTP 200 when healthy, 503
   when a checked dependency is degraded; the body shape is identical
   either way, so a watcher never has to parse a second form.
3. **The front-door document names it:** `publicInfo()` gains
   `health: '/api/health'` beside `oauth` and `endpoint`
   (`api/index.js`). The one pre-existing pin of that document
   (`tests/unit/landing-status.test.js`) is updated deliberately to
   assert the new field.

**Dependency checks — what shipped, and what was rejected.**

- **Server store reachable** (`src/db.js` `storeReachable()`): one
  constant read (`SELECT 1`) against the server's own store through
  the existing `createDb` seam. It genuinely flips: an unreachable
  store, a driver error or a missing `DATABASE_URL` all answer
  degraded. It returns only a boolean — no row data, no counts, no
  table names — and it deliberately runs **no `initSchema`**: a
  liveness probe must not perform DDL on every read.
- **OAuth issuer/metadata self-consistency** (`src/health.js`
  `oauthMetadataConsistent()`): the metadata document this server
  serves must be the document its own configured origin implies. The
  document's construction is extracted to one exported builder
  (`oauthServerMetadata()` in `src/core/oauth-handlers.js`, now used
  by the metadata route itself — no behavior change; the OAuth suite
  passes unmodified) and the check compares the served document
  against `publicOrigin(env)`: issuer equal to the origin and every
  endpoint equal to origin + its path. It genuinely flips two honest
  ways: `PUBLIC_BASE_URL` missing or not an HTTPS origin
  (`publicOrigin` throws — the same failure that breaks the OAuth
  routes), and any future builder drift away from the configured
  origin.
- **Rejected as decoration:** a Vercel-provider reachability check.
  This endpoint's contract is the server's own liveness; provider
  reach needs a stored credential (none may be used by a public,
  keyless surface), and a credential-free provider call that cannot
  distinguish "provider down" from "no credential" would be a check
  that reports noise, not posture. Provider posture stays where it
  belongs: authenticated reads and `vercel_check_token`.

**No-leak rule.** The body is public by design: no credentials, no
user data, no internal hostnames, no config values (not even
booleans), no setup/dev information, and no per-check breakdown —
which dependency failed stays internal; only the roll-up is public.
The health suite plants fake config values (a credentialed database
URL, an encryption key, a passphrase) in the environment and asserts
none of them — nor any env-var name or credential-shaped string —
appears in the serialized body, in both the healthy and degraded
forms, alongside the exact-field-set pin.

**Cache/rate posture.** The response goes through the shared `send()`
helper: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
JSON content type — the identical posture to the front-door JSON
document and the OAuth surfaces — so a watcher always reads live
posture rather than a cached one. No authentication and no rate limit,
matching the other public GET surfaces (the front door, the well-known
documents); the endpoint performs two constant-time checks and one
constant read, so there is no amplification surface to limit.

**Catalog judgment (checklist B).** No tool is added, removed or
changed — the registry stays at 240 and `vercel_whoami` keeps the
deeper posture — so no `docs/TOOL-CATALOG.md` note is owed; the change
is front-door surface (`api/`), one core builder extraction
(`src/core/oauth-handlers.js`), one additive db read (`src/db.js`)
and one new module (`src/health.js`), with this card + the STATUS
bullet as the docs reconciliation.

**Acceptance.**

- Front-door document carries `health: '/api/health'` (landing suite).
- Keyless GET returns the pinned five-field shape with live values;
  200 healthy / 503 degraded, with the flip driven by a failing store
  fake and by a broken OAuth origin in tests.
- The served OAuth metadata is byte-identical in shape to before
  (OAuth handlers suite passes unmodified).
- Full local `npm run check` green; CI `ci` + `release-policy` green
  at the exact head before merge.
- After the nightly promotion carries it, the coordinator's gate
  evidence files this under observability, and the main chat repoints
  vercel-watch's third leg from the OAuth metadata document to
  `/api/health`. No live call is made by this card.
