# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-11: **A-1 through A-3 implemented** (PRs #1, #6, #7, #8), **A-4 transport merged in PR #12 and A-5 owner setup built in PRs #13–#15** (PR #15 final CI pending). The schema has been exercised only in isolated throwaway Postgres tests, not against a real Neon database.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repo `Robinson-AI-Systems/vercel-mcp` | Public; plan on `main`; A-1 merged (PR #1) |
| Runtime | Node 24.x, plain ES modules, no build step (`package.json` `engines`, `"type": "module"`); exact dependency versions, `package-lock.json` committed; CI runs plain `npm ci` |
| CI (`.github/workflows/ci.yml`) | On every PR and push to `main`; `permissions: contents: read`; no secrets; no `pull_request_target`; Node 24. Jobs: `check` (`npm run check`), `unit` (`npm test`), `db` (`npm run test:db` on a `postgres:17` service), `emulate` (`npm run test:emulate`); **`ci`** (`if: always()`) fails unless all four are `success` — the single merge gate |
| Quick gate `npm run check` | `scripts/check-secrets.mjs` (every tracked file; reports file and kind, never the value) → `check-docs-updated.mjs` (DRIFT-PROTOCOL B) → `docs/pr-cards/validate-index.py` → `eslint .` → `check-catalog.mjs` (TOOL-CATALOG counts, totals, names; registered ⊆ catalog) → `check-writes.mjs` → `check-core-imports.mjs` → `check-budgets.mjs` |
| Test layers | `tests/unit` (vitest, `test/helpers/fake-vercel.js` HTTP-level fake, `test/helpers/fake-db.js`); `tests/db` (`scripts/local-postgres-test.sh`: CI service or a disposable local cluster, localhost only, isolated schema per run via `test/helpers/pg-neon-adapter.js`); `tests/emulate` (`scripts/emulate.sh`: pinned `emulate` 0.12.1 devDependency on 127.0.0.1:4000, `VERCEL_API_BASE` set, stopped on exit) |
| Code | `src/core/registry.js` (`mergeNamespaces`); `src/core/oauth.js`, `src/core/http.js`, `src/core/oauth-handlers.js`, `src/core/mcp-auth.js`, and `src/core/mcp-server.js`; `src/vercel/login.js`; `src/oauth/routes.js`; `src/db.js` owns SQL plus OAuth persistence; `api/oauth/*`, `api/well-known/*`, `api/mcp.js`, and `api/index.js` are the A-3b endpoint layer. `src/tools/index.js` registers two A-5 read-only account tools; no write tools exist |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| Vercel tokens | None added |

## Secret storage and account boundary (Batch A-5, in progress)

- PR #13 (merged) added `src/core/secret-box.js`, `one-time-secrets.js`, and `pending-inputs.js`; AES-256-GCM purpose-bound ciphertext is stored in the existing Postgres tables and consumed by atomic DELETE RETURNING.
- PR #14 (pending) adds `src/vercel/tokens.js`, provider-verified team/project read probes, and `src/db.js` helpers to encrypt account tokens at rest. No bearer token is passed through MCP or exposed by read tools. Visibility probes cannot prove the full token permission scope; no production or write authorization may be inferred from them.
- The account-owner setup page and first MCP tools do **not** yet exist; A-5b2 (PR #15) implements the passphrase-locked `/api/vercel/setup` page, 15-minute encrypted owner session and CSRF, one-time reveal, global protected default seed, and `vercel_whoami` / `vercel_list_accounts` read-only tools. No live setup yet.

## Batch B trust layer (B-1 PR #17, pending merge)

- `src/core/write-preflight.js` and `src/core/write.js` define the only planned mutation execution contract: production/targets declarations, strict scope, protective hooks, dry-run, confirmation, replay and independent read-back. Unknown state fails closed. Core has **no Vercel-specific imports**.
- `src/vercel/production.js` and `src/vercel/spend.js` classify live risks and use integer USD cents. Default spend cap is $0; unknown priced actions never execute without an explicit owner decision.
- `src/db.js` `recordChange` writes sanitized permanent audit records, rejecting nested secret-shaped keys/strings. No public mutating MCP tools exist; B-2/B-3 supply remaining runtime guard wiring.

## Environment variables

- `DATABASE_URL`: required to initialize the Neon database; no real database has been created/configured yet.
- `PUBLIC_BASE_URL`: fixed HTTPS origin used for OAuth issuer/resource URLs (A-3b).
- `ADMIN_PASSPHRASE`: required for authorization approval; missing configuration fails closed (A-3b).
- `TOKEN_ENCRYPTION_KEY`: reserved for A-5 token storage. Never record values.

## Database tables

Nine original tables implemented in A-2 PR #6; the tenth replay-reservation table is in A-4 draft PR #12. Initialization remains additive and idempotent. No real Neon database has been created or initialized.

- `vercel_accounts`
- `oauth_clients`
- `oauth_codes`
- `oauth_tokens`
- `login_attempts`
- `change_log`
- `one_time_secrets`
- `pending_inputs`
- `protected_resources`
- `request_replay` (A-4, pending PR #12): atomic ten-minute cross-instance write claims and safely shaped result replay; pending outcomes never silently retried

Indexes: `change_log_request_key`, `oauth_codes_expires_at`, `oauth_tokens_refresh_hash`, `oauth_tokens_expires_at`, `login_attempts_ip_attempted_at`, `change_log_account_at`, `one_time_secrets_expires_at`, `pending_inputs_expires_at`. `protected_resources` uses PostgreSQL 15+ `UNIQUE NULLS NOT DISTINCT` so the NULL-account global defaults cannot be duplicated.

## Endpoints

Implemented in A-3 PR #8:

- `POST /api/oauth/register`
- `GET` and `POST /api/oauth/authorize`
- `POST /api/oauth/token`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `/api/mcp` — streamable HTTP MCP endpoint behind bearer authentication; tools remain empty until Batch B
- `/` — home/status page with tool count and setup documentation link

`vercel.json` rewrites the two well-known paths and `/` to their serverless functions.

## Vercel API

No OpenAPI snapshot vendored yet (A-4). Record the snapshot date, SHA-256 and operation count here when A-4 ships, and
every path-version or snapshot move after that.

## Batch B-2: owner production permission switch

PR #18 adds two strictly allowlisted **local** owner tools. Enabling production is never a tool-only action: a full-profile agent can request a 10-minute reference on a production deployment, but only the signed-in owner can reenter the passphrase with CSRF on `/api/vercel/setup` and consume it exactly once. Vercel preview deployments refuse enablement. Confirmed disable clears the selected account's flag and revokes its production connector credentials. No Vercel REST write endpoint is called by these tools. All other write tools remain blocked at the MCP boundary until the later Batch B contract is complete.

## Batch B-3: protected-resource safety

PR #19 implements tenant/global `protected_resources` queries, fail-closed `checkProtected` over project identities and child resources, self-project/token protections, an add-only owner editor with CSRF+fresh passphrase and read-only protected-resource listing. The `checkApp` hook currently allows operations only in the absence of known app profiles; Batch P will define app ownership. No real write tool invokes provider mutations.

## B-8b owner-only default account selection (#30)

The production server's `/api/vercel/setup` owner page (not the MCP/OAuth connector) offers
a global default-account selector guarded by short-lived authenticated session, CSRF, explicit
confirmation and fresh passphrase under DB-backed lockout. `createDb().setDefaultOwnerAccount(id)`
performs conditional all-account default-flag selection and safe `change_log` insertion within
a single Postgres statement, then independently checks that exactly one selected default remains.
It never alters credentials, OAuth token settings, production-enabled flags or Vercel resources.
Preview deployments cannot activate the form. The MCP named write is **not registered**;
B-8 remaining revoke/spend and independent approval still require implementation and owner gates.

## C-1a scoped result persistence (#41)
- `result_store` includes account, per-authenticated-bearer owner, opaque handle, 24-hour max expiry, sanitized JSONB, and an expiry index. Read path removes at most 100 expired rows; no public tool yet.
- `requireMcpToken` internally derives a nonenumerable per-bearer result identity. No live Neon database or Vercel token configured.

IN-08 (PR #108): additive `purchase_intents` ledger stores account, exact operation, request key, hashed payload fingerprint, quoted cents or variable-cost classification, owner ceiling and one-use status. Owner-approved amounts are BIGINT, with no policy-defined upper bound; JavaScript safe-integer validation remains necessary. Separate owner web authorization and paid dispatcher enforcement are not part of this foundation and remain blocked until verified.

IN-08 (PR #109): /api/vercel/setup owner purchase review and owner approval use an HttpOnly session, per-session CSRF, independent password reentry and account-scoped one-time ledger approval/readback. No new provider write. Paid-dispatch enforcement is a separate following PR.


## RTC 1 read-only integration (PRs #112–#115)

Hub discovery uses public `GET /api/contract` and `GET /api/openapi.json` (rewrite to `/api/rtc-openapi`). The standalone MCP door remains `POST /api/mcp` with OAuth tokens. The separate HTTP tool API under `/api/tools`, `/api/whoami`, and `/api/results/{handle}` accepts **only** generated `rtc_pass_` bearer credentials, never OAuth or provider credentials. An independently authenticated owner mints a 1–720-hour pass through setup with `profile=read_only`, `mode=preview`, explicit allowed areas and zero write/money authority. Database stores only pass SHA-256, expires/revokes credentials and serializes the 60/min per-pass window across instances. Pass-specific result-owner hashes prevent cross-pass handle reads. The HTTP implementation invokes the existing MCP guard and secret-safe result shaper; delegated meta tools are denied to scoped passes. No production access or paid writes have been authorized.

The pinned Hub conformance tests and CLI localhost direct runner execute in CI with generated fake passes. Full upstream checks requiring writable full-profile passes are intentionally skipped in the local partial probe; the full suite's own reference fixture is run separately. Hosted direct, relay and Vercel Sandbox acceptance remains unverified and must be recorded after actual authorized runs, not inferred from unit tests.
