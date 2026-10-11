# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-11: **A-1 foundation built** (PR #1); **A-2 schema implemented in PR #6 (merge pending)**. No endpoints or Vercel tools exist yet. The schema has been exercised only in isolated throwaway Postgres tests, not against a real Neon database.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repo `Robinson-AI-Systems/vercel-mcp` | Public; plan on `main`; A-1 merged (PR #1) |
| Runtime | Node 24.x, plain ES modules, no build step (`package.json` `engines`, `"type": "module"`); exact dependency versions, `package-lock.json` committed; CI runs plain `npm ci` |
| CI (`.github/workflows/ci.yml`) | On every PR and push to `main`; `permissions: contents: read`; no secrets; no `pull_request_target`; Node 24. Jobs: `check` (`npm run check`), `unit` (`npm test`), `db` (`npm run test:db` on a `public.ecr.aws/docker/library/postgres:17` service), `emulate` (`npm run test:emulate`); **`ci`** (`if: always()`) fails unless all four are `success` — the single merge gate |
| Quick gate `npm run check` | `scripts/check-secrets.mjs` (every tracked file; reports file and kind, never the value) → `check-docs-updated.mjs` (DRIFT-PROTOCOL B) → `docs/pr-cards/validate-index.py` → `eslint .` → `check-catalog.mjs` (TOOL-CATALOG counts, totals, names; registered ⊆ catalog) → `check-writes.mjs` → `check-core-imports.mjs` → `check-budgets.mjs` |
| Test layers | `tests/unit` (vitest, `test/helpers/fake-vercel.js` HTTP-level fake, `test/helpers/fake-db.js`); `tests/db` (`scripts/local-postgres-test.sh`: CI service or a disposable local cluster, localhost only, isolated schema per run via `test/helpers/pg-neon-adapter.js`); `tests/emulate` (`scripts/emulate.sh`: pinned `emulate` 0.12.1 devDependency on 127.0.0.1:4000, `VERCEL_API_BASE` set, stopped on exit) |
| Code | `src/core/registry.js` (`mergeNamespaces`); `src/tools/index.js` (empty registry); `src/db.js` owns all SQL and exports `createDb`, `SCHEMA_TABLES`, `CONNECTION_FIELDS`, and `connectionSettings`. No `api/` or `src/vercel/` yet |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| Vercel tokens | None added |

## Environment variables

None yet. Batch A defines `DATABASE_URL`, `ADMIN_PASSPHRASE`, `PUBLIC_BASE_URL`, `TOKEN_ENCRYPTION_KEY`; record each
here with its environments when A-5 ships. Never record values.

## Database tables

Implemented in A-2 PR #6; initialization is additive and idempotent. No real Neon database has been created or initialized.

- `vercel_accounts`
- `oauth_clients`
- `oauth_codes`
- `oauth_tokens`
- `login_attempts`
- `change_log`
- `one_time_secrets`
- `pending_inputs`
- `protected_resources`

Indexes: `change_log_request_key`, `oauth_codes_expires_at`, `oauth_tokens_refresh_hash`, `oauth_tokens_expires_at`, `login_attempts_ip_attempted_at`, `change_log_account_at`, `one_time_secrets_expires_at`, `pending_inputs_expires_at`. `protected_resources` uses PostgreSQL 15+ `UNIQUE NULLS NOT DISTINCT` so the NULL-account global defaults cannot be duplicated.

## Endpoints

None yet.

## Vercel API

No OpenAPI snapshot vendored yet (A-4). Record the snapshot date, SHA-256 and operation count here when A-4 ships, and
every path-version or snapshot move after that.
