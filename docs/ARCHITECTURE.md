# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-11: **A-1 through A-3 implemented** (PRs #1, #6, #7, #8), **A-4 transport, snapshot validation and atomic replay implemented in PR #12** (merge pending exact-head CI). The schema has been exercised only in isolated throwaway Postgres tests, not against a real Neon database.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repo `Robinson-AI-Systems/vercel-mcp` | Public; plan on `main`; A-1 merged (PR #1) |
| Runtime | Node 24.x, plain ES modules, no build step (`package.json` `engines`, `"type": "module"`); exact dependency versions, `package-lock.json` committed; CI runs plain `npm ci` |
| CI (`.github/workflows/ci.yml`) | On every PR and push to `main`; `permissions: contents: read`; no secrets; no `pull_request_target`; Node 24. Jobs: `check` (`npm run check`), `unit` (`npm test`), `db` (`npm run test:db` on a `public.ecr.aws/docker/library/postgres:17` service), `emulate` (`npm run test:emulate`); **`ci`** (`if: always()`) fails unless all four are `success` — the single merge gate |
| Quick gate `npm run check` | `scripts/check-secrets.mjs` (every tracked file; reports file and kind, never the value) → `check-docs-updated.mjs` (DRIFT-PROTOCOL B) → `docs/pr-cards/validate-index.py` → `eslint .` → `check-catalog.mjs` (TOOL-CATALOG counts, totals, names; registered ⊆ catalog) → `check-writes.mjs` → `check-core-imports.mjs` → `check-budgets.mjs` |
| Test layers | `tests/unit` (vitest, `test/helpers/fake-vercel.js` HTTP-level fake, `test/helpers/fake-db.js`); `tests/db` (`scripts/local-postgres-test.sh`: CI service or a disposable local cluster, localhost only, isolated schema per run via `test/helpers/pg-neon-adapter.js`); `tests/emulate` (`scripts/emulate.sh`: pinned `emulate` 0.12.1 devDependency on 127.0.0.1:4000, `VERCEL_API_BASE` set, stopped on exit) |
| Code | `src/core/registry.js` (`mergeNamespaces`); `src/core/oauth.js`, `src/core/http.js`, `src/core/oauth-handlers.js`, `src/core/mcp-auth.js`, and `src/core/mcp-server.js`; `src/vercel/login.js`; `src/oauth/routes.js`; `src/db.js` owns SQL plus OAuth persistence; `api/oauth/*`, `api/well-known/*`, `api/mcp.js`, and `api/index.js` are the A-3b endpoint layer. `src/tools/index.js` remains empty; the A-4 Vercel client exists, but no Vercel management tools are exposed yet |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| Vercel tokens | None added |

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
