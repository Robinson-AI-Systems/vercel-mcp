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
