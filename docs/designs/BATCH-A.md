# Design — Batch A: Foundation (repo, tests, login, token store, Vercel client)

Status: **APPROVED DESIGN pending IN-00** (plan approval). Written 2026-10-10 by Claude (Opus 5.5) for an empty
repository. Scope and acceptance: `docs/PLAN.md` → Batch A. Cards A-1 … A-6.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| A1 | The code to copy exists in the most mature source, in this order of preference: (a) a `robinson-mcp-core` release from the hub (`Robinson-AI-Systems/robinsons-toolkit-hub`, hub card K-3); (b) the Stripe MCP's `src/core/` at its `main` once its Batches A–C have merged; (c) the Google Workspace MCP files the Stripe plan's A-1 lists (`api/oauth/*`, `api/well-known/*`, `src/oauth/*`, `src/crypto.js`, `src/once.js`, `src/changelog.js`, `src/tools/{write,util,errors}.js`, `scripts/check-writes.mjs`, `test/helpers/{fake-db,pg-neon-adapter}.js`, `test/contract/db-contract.js`, `.github/workflows/ci.yml`) | hub: `gh release list -R Robinson-AI-Systems/robinsons-toolkit-hub \| head`; Stripe: `sed -n '1,40p' docs/STATUS.md` in a read-only clone; Workspace: clone to `/tmp/gw` and `ls` the paths |
| A2 | Vercel's OpenAPI description is downloadable from `https://vercel.com/openapi.json` (or `https://openapi.vercel.sh/`) and lists ~438 operations | `curl -sSfo /tmp/vercel-openapi.json https://vercel.com/openapi.json && node -e "…count paths×methods…"` |
| A3 | `emulate` (Vercel Labs) installs under Node 24 and answers `GET /v2/user`, `GET /v10/projects`, `POST /v13/deployments`, `POST /v10/projects/{id}/env` | `npx --yes emulate@0.12.1 --service vercel --port 4000` then `curl localhost:4000/v10/projects` (stop it after) |
| A4 | Vercel's default Node runtime is 24.x and Node 20 builds are deprecated (changelog "Node.js 20 is being deprecated on October 1, 2026") | `https://vercel.com/docs/functions/runtimes/node-js/node-js-versions` |
| A5 | A team-scoped token is accepted with an explicit `teamId` query parameter, and a project-scoped token too (both infer scope; the parameter must not cause a 403) | A-4: one read against `emulate`; X-2 against the real team; record in the PR |
| A6 | Neon's serverless driver and `@modelcontextprotocol/sdk` install under Node 24 | `npm i` in A-1 |

If any row is false, stop and report; the design may need amending.

## 1. Decisions (made — do not re-open)

**A1. A separate, hosted server built like the Stripe MCP.** Reason: production deploys, DNS and spend need the
preview/confirm/read-back/change-log discipline, hosted so it works from Chris's phone. Same layout as the Stripe plan:
`api/` Vercel functions, `src/core/` contract-generic code (imports nothing Vercel-specific), `src/vercel/` the only way
to reach Vercel, `src/tools/` one module per area, `src/db.js` all SQL, `tests/unit|db|emulate|schema|doors`.

**A2. Copy, don't reinvent.** Contract-generic code comes from the most mature source in row A1 (core package → Stripe
`src/core/` → Workspace files). First line of each copied file: `// Copied from <repo> <path> @ <commit>`. Fixes made
here go in ROADMAP "port back" lines; they never flow back automatically.

**A3. Node 24.x, plain ES modules, no build step.** The brief named Node 20; Vercel deprecated Node 20 builds on
2026-10-01 and its default is 24.x (Appliance Desk runs 24). `engines.node` is `"24.x"`; code uses nothing that Node 20
lacks, so `src/core/` stays usable by the hub's core package on 20+.

**A4. Tokens live encrypted in Neon; no plain copy; no fallback.** `TOKEN_ENCRYPTION_KEY` (AES-256-GCM) is required;
without it the setup page refuses to store a token and every tool says what to set.

**A5. A Vercel token never passes through Claude.** Tokens are added only on `api/vercel/setup.js`, behind the same
passphrase and lockout as the connector login. No tool takes a token argument; no result, log, change-log row or test
contains one (fake tokens only: `vcp_FAKE…`).

**A6. Accounts are teams (or one project).** One row per team-scoped token; optionally extra rows for project-scoped
tokens (narrow connections). The setup page probes a pasted token (`GET /v2/user`, `GET /v2/teams`,
`GET /v10/projects?limit=1`) to record its scope, team, project and expiry. A full-account token is **refused** unless
Chris ticks "allow full-account token" on the setup page (IN-04). Each connection is bound at login to one account, one
**mode** (`preview` default; `production` offered only when `production_enabled` for that account — Batch B), one
profile and one listing mode.

**A7. A thin client, not `@vercel/sdk`.** `src/vercel/client.js` calls `https://api.vercel.com` with `fetch`. Reasons
(research §11): the SDK lacks operations this plan needs (billing charges, contract commitments, sandbox create and
command execution), is 55 MB unpacked and republished almost daily, and a thin client is the one place for team
scoping, timeouts, rate-limit handling, request keys and request validation. Every operation the server calls is listed
in `src/vercel/operations.js` (`{ id: { method, path } }` with the pinned path version); a test fails if an entry is not
in the vendored OpenAPI snapshot. Moving any path version, or the snapshot, is its own card with a diff review
(`scripts/openapi-diff.mjs`).

**A8. Vendored OpenAPI snapshot with a recorded date and hash.** Vercel's `info.version` is a constant (`0.0.1`), so the
pin is `vendor/vercel-openapi/openapi-<YYYY-MM-DD>.json` plus `SOURCE.md` (URL, download date, SHA-256, operation
count). If the agent's workspace cannot reach `vercel.com`, A-4 stops and asks (an agent with web access, or Chris,
downloads it); it never reconstructs the file from the SDK.

**A9. No idempotency keys exist at Vercel, so retries are made safe here.** Each write gets a request key
`rmcp_<tool>_<sha256(account, mode, tool, canonical JSON of args without dryRun/confirm/fields/detail)>_<10-minute
bucket>` (or the caller's `requestKey`). A second call with the same key inside 10 minutes returns the stored result
from the change log instead of writing again (contract §6). The client never automatically retries a POST/PUT/PATCH;
GET/HEAD/DELETE are retried once on a network error or 5xx. A write whose outcome is unknown (timeout) is reported as
`confirmed: null` with the read-back the tool should run.

**A10. Rate limits are respected, not fought.** On 429 the client reads `error.limit.reset` (and `Retry-After` /
`X-RateLimit-*` headers when present) and returns code `rate_limited` with the wait in plain words; it waits and retries
once only when the reset is ≤5 seconds away and the call is a read.

**A11. One-time secrets and pending inputs.** `one_time_secrets` holds encrypted secrets Vercel returns once (new
tokens, webhook signing secrets, bypass secrets, Global Config tokens, transfer codes, passes). A tool returns a link
`/api/vercel/setup?show=<id>`; behind the passphrase the page shows the secret once, for 10 minutes, then deletes it.
`pending_inputs` is the reverse direction: values Chris pastes on the setup page for a tool to use (an environment
variable's secret value, a deployment password, a domain transfer auth code); the tool references the input's ID; the
value is used once and deleted.

**A12. Previews of this server never hold a production-mode token flag.** On any non-production deployment of this
server (`VERCEL_ENV !== 'production'`), `production_enabled` is treated as false and the setup page does not offer
production enabling. (Previews share the database, so they can see account rows; they cannot use production mode.)

## 2. Schema (additive; A-2 creates these, later batches add their own)

```sql
CREATE TABLE IF NOT EXISTS vercel_accounts (
  id TEXT PRIMARY KEY,                      -- team_… or team_…/prj_… for a project-scoped account (never committed)
  team_id TEXT NOT NULL, team_slug TEXT NOT NULL, label TEXT NOT NULL,
  scope TEXT NOT NULL,                      -- 'team' | 'project' | 'full' (full only if allowed, IN-04)
  project_id TEXT, project_name TEXT,       -- set when scope = 'project'
  token_enc TEXT NOT NULL, token_last4 TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ, token_checked_at TIMESTAMPTZ, token_probe JSONB,
  production_enabled BOOLEAN NOT NULL DEFAULT FALSE,           -- Batch B decides how it turns on
  spend_limit_cents INTEGER NOT NULL DEFAULT 0,                 -- IN-08
  sandbox_minutes_per_day INTEGER NOT NULL DEFAULT 60,          -- IN-13 (Batch V)
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS oauth_clients (client_id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS oauth_codes (code TEXT PRIMARY KEY, client_id TEXT NOT NULL, data JSONB NOT NULL,
  vercel_account TEXT, mode TEXT NOT NULL DEFAULT 'preview', profile TEXT NOT NULL DEFAULT 'everyday',
  listing TEXT NOT NULL DEFAULT 'catalog', expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT, refresh_hash TEXT,
  vercel_account TEXT, mode TEXT NOT NULL DEFAULT 'preview', profile TEXT NOT NULL DEFAULT 'everyday',
  listing TEXT NOT NULL DEFAULT 'catalog', kind TEXT NOT NULL DEFAULT 'connector',   -- 'pass' added in Batch R
  expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_attempts (id BIGSERIAL PRIMARY KEY, ip TEXT NOT NULL, attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(), success BOOLEAN NOT NULL);
CREATE TABLE IF NOT EXISTS change_log (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
  vercel_account TEXT, mode TEXT, connection TEXT, tool TEXT NOT NULL, project_id TEXT, target TEXT,
  summary TEXT NOT NULL, before JSONB, after JSONB, dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  production BOOLEAN NOT NULL DEFAULT FALSE, spend_cents BIGINT, request_key TEXT, result JSONB,
  inverse JSONB, undone_by BIGINT);
CREATE INDEX IF NOT EXISTS change_log_request_key ON change_log (request_key, at);
CREATE TABLE IF NOT EXISTS one_time_secrets (id TEXT PRIMARY KEY, vercel_account TEXT, kind TEXT NOT NULL, label TEXT,
  ciphertext TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, viewed_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS pending_inputs (id TEXT PRIMARY KEY, vercel_account TEXT NOT NULL, kind TEXT NOT NULL,
  label TEXT NOT NULL, ciphertext TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ);   -- kind: 'env_value' | 'deploy_password' | 'transfer_auth_code'
CREATE TABLE IF NOT EXISTS protected_resources (id BIGSERIAL PRIMARY KEY, vercel_account TEXT,  -- NULL = every account
  kind TEXT NOT NULL, match TEXT NOT NULL, note TEXT, source TEXT NOT NULL DEFAULT 'default',     -- 'default' | 'setup_page'
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (vercel_account, kind, match));
```

Tokens and passes are stored hashed (SHA-256), never plain. `change_log.before/after/result` never contain an
environment variable value or a secret (B-5 shaping runs before logging). `protected_resources` is seeded by A-5 with
the defaults in IN-07 (kind `project`, match by project name) and edited only on the setup page (B-3).

## 3. Shared primitives

```js
// src/vercel/client.js — the only file that calls api.vercel.com
export const VERCEL_API_BASE = 'https://api.vercel.com';
export const OPENAPI_SNAPSHOT = { date: '<YYYY-MM-DD>', sha256: '<hex>', operations: 0 };   // from vendor/…/SOURCE.md
/** @returns {{ request(opId: string, p?: { path?: object, query?: object, body?: any }): Promise<any>,
 *             paginate(opId: string, p: object, o?: { max?: number }): Promise<{ items: any[], capped: boolean }> }} */
export function makeVercelClient({ token, account }) {}    // injects teamId; 25 s timeout; A9 retries; A10 rate limits
export function requestKey(ctx, tool, args) {}              // A9
// src/vercel/operations.js
export const OPS = { project_get: { method: 'GET', path: '/v9/projects/{idOrName}' }, /* … one entry per operation used */ };
// src/vercel/tokens.js
export async function storeToken({ token, allowFull }) {}  // probe → { account, scope, team, project, expiresAt, last4 }
export async function loadToken(accountId) {}              // decrypt per request; never cached across requests
export async function probeToken(client) {}                // per-area ok | denied, with the reason
```

## 4. Work units (in order)

### A-1 — Repository, test harness, CI and doc checks
Files: `package.json` (`"type": "module"`, `engines.node: "24.x"`), `.github/workflows/ci.yml` (jobs `check`, `unit`,
`db`, `emulate`, final `ci` needing all; `permissions: contents: read`; no secrets; no `pull_request_target`),
`vitest.config.js`, `vitest.db.config.js`, `vitest.emulate.config.js`,
`scripts/{check-secrets,check-docs-updated,check-writes,check-budgets,check-core-imports}.mjs`,
`scripts/local-postgres-test.sh`, `scripts/emulate.sh`, `src/tools/index.js` (empty registry via `mergeNamespaces`),
`test/helpers/{fake-db,pg-neon-adapter,fake-vercel}.js`, `test/contract/db-contract.js`, `README.md`. Exact contents:
`docs/pr-cards/A-1.md`.
Done when: `npm run check`, `npm test`, `npm run test:db`, `npm run test:emulate` pass locally and in CI; a deliberately
failing test turned CI red once.

### A-2 — Database schema
Files: `src/db.js` (all SQL; `initSchema()` idempotent), fake and contract updated.
Tests: contract against fake and Postgres; `initSchema()` twice changes nothing; `protected_resources` unique per
(account, kind, match).

### A-3 — Connector login (account, mode, profile, listing)
Files: `api/oauth/*`, `api/well-known/*`, `src/core/oauth/*`, `api/mcp.js` (zero tools until B), `api/index.js` (home
page with counts).
Change: port the login flow. The authorize page shows the account dropdown, mode (`preview` only unless
`production_enabled` and not a preview deployment, A12), profile, listing, passphrase. Hash tokens. **Settings survive
refresh**: account, mode, profile and listing are stored on the authorization code and the token row; one helper copies
every connection setting from the issuing row for both grant types; a refresh never falls back to defaults.
Tests: 5 wrong passphrases in 15 minutes lock the address (counted in `login_attempts`, not memory); a forged
`mode=production` post is refused when not enabled; refresh only for the same client; revoked tokens refused; tokens
stored hashed; after a refresh the new token keeps account, mode, profile and listing (unit + database test); a test
fails if a connection-setting column is added to `oauth_tokens` but not copied by the helper.

### A-4 — Vercel client, operation table and OpenAPI index
Files: `src/vercel/client.js`, `src/vercel/operations.js`, `vendor/vercel-openapi/openapi-<date>.json`,
`vendor/vercel-openapi/SOURCE.md`, `scripts/openapi-find.mjs` (prints matching operations: method, path, summary, ≤20
lines), `scripts/openapi-diff.mjs` (added/removed/changed operations between two snapshots), `test/helpers/openapi-validate.js`
(validates a recorded request — operation exists, path/query/body valid — with a pinned JSON-schema validator).
Tests: same args → same request key; `dryRun/confirm/fields/detail` don't change it; `requestKey` does; a repeated key
within 10 minutes returns the stored result and makes no call; POST never retried; GET retried once on 503; 429 →
`rate_limited` with the wait; `paginate` stops at the cap and says so; every `OPS` entry exists in the snapshot; a grep
test proves only `src/vercel/client.js` contains `api.vercel.com`; `emulate` accepts `GET /v2/user` and
`GET /v10/projects` through the client with `teamId` set (row A5).

### A-5 — Encrypted token store, setup page, one-time secrets, pending inputs, protected-resource seed
Files: `api/vercel/setup.js`, `src/vercel/tokens.js`, `src/core/one-time-secrets.js`, `src/core/pending-inputs.js`,
`src/tools/server.js` (`vercel_whoami`, `vercel_list_accounts`, read-only).
Change: paste token → probe (A6) → refuse full-account unless allowed → store encrypted → show scope, team, project,
expiry and last 4. Seed `protected_resources` (IN-07 defaults) the first time an account is added. "Paste a value for a
tool" form creates a `pending_inputs` row and shows its ID (no value echoed).
Tests (fake tokens only): stored value is ciphertext; wrong encryption key gives a plain error, never the token; a test
scans every tool result and change-log row the whole unit suite produced for token- and key-shaped strings (`vcp_`,
`vercel_blob_rw_`, `sk_live_`, `whsec_`, `ghp_`, `github_pat_`, `postgres://user:pass@`) and fails if any appear;
one-time secret shown once then gone; a pending input is usable once and then gone; a full-account token is refused by
default; production enabling is not offered on a preview deployment.

### A-6 — DEPLOY.md (docs) `[light effort]`
Files: `docs/DEPLOY.md`.
Change: Vercel project `vercel-mcp`, Neon database, env vars (`DATABASE_URL`, `ADMIN_PASSPHRASE`, `PUBLIC_BASE_URL`,
`TOKEN_ENCRYPTION_KEY`), generating the encryption key, creating a team-scoped token with a 90-day expiry (exact clicks
on the Account Tokens page), adding it on the setup page, adding the connector in claude.ai (preview mode first).
Done when: a reviewer pretending to be Chris can follow it without a question.

## 5. Stop-and-ask points

1. Any row of section 0 false.
2. The OpenAPI snapshot cannot be downloaded from the workspace (A8): stop, ask for it; never rebuild it from the SDK.
3. Anything requiring a paid Vercel/Neon plan (IN-02).

## 6. Acceptance mapping

| PLAN Batch A line | Evidence |
|---|---|
| CI with all checks | A-1 CI run |
| Login, lockout, hashed tokens, mode/profile binding, settings survive refresh | `tests/unit/oauth*.test.js`, `tests/db/oauth-refresh.test.js` |
| Tokens encrypted, never exposed; full-account refused | `tests/unit/tokens.test.js`, key-scan test |
| One client, operation table in the snapshot, safe retries, rate limits | `tests/unit/client.test.js`, `tests/emulate/client.test.js` |
| One-time secrets and pending inputs | `tests/unit/one-time-secrets.test.js`, `tests/unit/pending-inputs.test.js` |
| DEPLOY.md followable | A-6 PR review note |

## Amendments

(Dated entries only.)
