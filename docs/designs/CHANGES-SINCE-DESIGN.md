# Changes since design

Dated entries only: contract changes (signatures, tables, guard behavior, defaults) that later cards inherit and that
are not yet in their design. A card consuming an entry says so; batch close-out (DRIFT-PROTOCOL C) retires consumed entries.

**2026-10-10 — A-1 (PR #1), inherited by every later card.**
- `test/helpers/fake-vercel.js`: `makeFakeVercel({ base?, now? })` → `{ fetch, calls, unmatched, when, verify }`.
  `when(method, '/v9/projects/{idOrName}')` (or `:idOrName`) `.resolves(json, status?, headers?)`,
  `.rejects(status, errorBody?)` (default body is Vercel's `{ error: { code, message } }`), `.rateLimited(resetInMs,
  total?)` (429, `error.limit.{remaining, reset, resetMs, total}`, `x-ratelimit-*` headers). Responses on one rule are
  used in order and the last repeats; the newest matching rule wins; calls record `{ method, path, params, query,
  body, headers }` with `authorization` as `Bearer [hidden]`; an unmatched call rejects and makes `verify()` throw.
  A-4's client must take an injectable `fetch` so tests can pass `vercel.fetch`.
- Check scripts export pure functions for tests: `checkWrites(tools)`, `checkBudgets(tools)`,
  `checkCoreImports(root)`, `checkCatalog(text, registeredNames)`, `missingDocs(changed, body)`, `scanText`/`scanFiles`.
  B-7 extends `checkWrites`; C-2 extends `checkBudgets`.
- `npm run test:emulate` sets `VERCEL_API_BASE`; A-4's client reads its base URL from an option (tests) and never from
  user input. `emulate` accepts any bearer token.
- A-2: `protected_resources` uniqueness needs `UNIQUE NULLS NOT DISTINCT` (Postgres 15+) so "every account" defaults
  (NULL account) cannot be duplicated; A-6's DEPLOY.md must ask for a Neon database on Postgres 15 or newer.

**2026-10-11 — A-2 (PR #6), inherited by A-3.**
- `src/db.js` is the only SQL entry point. `createDb(query?)` accepts a Neon-shaped tagged-template function for tests and resolves `DATABASE_URL` lazily on first schema initialization; import alone never connects.
- `SCHEMA_TABLES` contains the nine Batch A tables; `CONNECTION_FIELDS` is exactly `vercel_account`, `mode`, `profile`, `listing`; `connectionSettings(row)` copies only those fields for OAuth refresh.
- `test/helpers/fake-db.js` now implements idempotent `initSchema()` and `listTables()` while preserving `put/get`.
- `protected_resources` uses `UNIQUE NULLS NOT DISTINCT (vercel_account, kind, match)` to prevent duplicate global defaults. PostgreSQL 15+ is required; A-6 deployment instructions must state this.


**2026-10-11 — A-3a (PR #7), inherited by A-3b.**
- `src/core/oauth.js` is service-neutral and provides `randomToken`, SHA-256 `hashToken`, timing-safe `secretsMatch`, S256-only PKCE verification, redirect URI validation, trusted client IP normalization, and `evaluateLogin` with a 5-failure/15-minute database-backed lockout policy.
- `src/db.js` and `test/helpers/fake-db.js` implement OAuth client registration with hashed client secrets, hashed single-use authorization codes, hashed access/refresh tokens, access-token expiry/revocation checks, same-client atomic refresh rotation, and login-attempt counters.
- Connection scope is copied only through A-2's `connectionSettings(row)` helper: `vercel_account`, `mode`, `profile`, and `listing`. OAuth defaults use `preview`, `everyday`, and `catalog`; the production-mode deployment gate belongs to A-3b.
