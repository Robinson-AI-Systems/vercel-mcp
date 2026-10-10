# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-10: **A-1 foundation built** (PR #1) — repository tooling, test harness and CI. No server code, endpoints,
tables or tools exist yet.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repo `Robinson-AI-Systems/vercel-mcp` | Public; plan on `main`; A-1 merged (PR #1) |
| Runtime | Node 24.x, plain ES modules, no build step (`package.json` `engines`, `"type": "module"`); exact dependency versions, `package-lock.json` committed; CI runs plain `npm ci` |
| CI (`.github/workflows/ci.yml`) | On every PR and push to `main`; `permissions: contents: read`; no secrets; no `pull_request_target`; Node 24. Jobs: `check` (`npm run check`), `unit` (`npm test`), `db` (`npm run test:db` on a `public.ecr.aws/docker/library/postgres:17` service), `emulate` (`npm run test:emulate`); **`ci`** (`if: always()`) fails unless all four are `success` — the single merge gate |
| Quick gate `npm run check` | `scripts/check-secrets.mjs` (every tracked file; reports file and kind, never the value) → `check-docs-updated.mjs` (DRIFT-PROTOCOL B) → `docs/pr-cards/validate-index.py` → `eslint .` → `check-catalog.mjs` (TOOL-CATALOG counts, totals, names; registered ⊆ catalog) → `check-writes.mjs` → `check-core-imports.mjs` → `check-budgets.mjs` |
| Test layers | `tests/unit` (vitest, `test/helpers/fake-vercel.js` HTTP-level fake, `test/helpers/fake-db.js`); `tests/db` (`scripts/local-postgres-test.sh`: CI service or a disposable local cluster, localhost only, isolated schema per run via `test/helpers/pg-neon-adapter.js`); `tests/emulate` (`scripts/emulate.sh`: pinned `emulate` 0.12.1 devDependency on 127.0.0.1:4000, `VERCEL_API_BASE` set, stopped on exit) |
| Code | `src/core/registry.js` (`mergeNamespaces`); `src/tools/index.js` (empty registry). No `api/`, `src/vercel/` or `src/db.js` yet |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| Vercel tokens | None added |

## Environment variables

None yet. Batch A defines `DATABASE_URL`, `ADMIN_PASSPHRASE`, `PUBLIC_BASE_URL`, `TOKEN_ENCRYPTION_KEY`; record each
here with its environments when A-5 ships. Never record values.

## Database tables

None yet. Each batch's design lists its tables; record them here as they ship.

## Endpoints

None yet.

## Vercel API

No OpenAPI snapshot vendored yet (A-4). Record the snapshot date, SHA-256 and operation count here when A-4 ships, and
every path-version or snapshot move after that.
