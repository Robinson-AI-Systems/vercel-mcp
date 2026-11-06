# RACK-STAGING — Store transport seam and rack entrypoint for the Development Rack move

**Commissioned:** 2026-11-06 by the owner (Chris) through the rack
migration program: every custom MCP server moves to the Development
Rack on his gaming PC **as-is** — the only gate is parity (the server
starts, serves, and answers its health check on the rack in the same
state it runs today); development completion is not a precondition
and continues on the rack. This card is the whole staging build for
Vercel Unleashed by Robinson AI Systems: the two code items the
move needs, proven against a fixture store on the rack before any
production window. The window itself (fence, store copy, route
commit) is program work under the owner's standing migration
authorization, recorded in the program board, not in this card.

## Starting facts (from the code, 2026-11-06)

- The store seam already exists: `createDb(query)` accepts an
  injected Neon-shaped query function, and the db test suite runs a
  proven pg adapter (`test/helpers/pg-neon-adapter.js`) through it.
  What production lacked was the adapter itself behind the default
  path — `getSql()` built the Neon HTTP handle directly.
- A second construction site exists outside the seam:
  `api/developer/connect.js` builds its own Neon handle for the
  developer handoff store.
- The server's functions split on body contracts: exactly one
  handler reads the raw request stream
  (`api/webhooks/deployments.js`, `bodyParser: false` — the HMAC
  signature covers the raw bytes) and one declares parsed bodies
  (`api/mcp.js`, `bodyParser: true`); every other handler follows
  the platform default (parsed body). A sibling server's rack
  entrypoint already shipped the defect this split invites — an
  entrypoint that pre-read the body, hanging the authorize submit
  whose handler tried to read it again.
- `pg` is already a pinned devDependency (the test adapter uses it);
  the production image never installs it today.

## S-1 — transport promotion (this PR)

- `src/db-transport.js`: the proven adapter promoted into `src/`,
  production-shaped — one shared `pg.Pool` per connection string,
  the handle contract (tagged template + `.query(text, values)` +
  idempotent `.end()`), and the selection: an explicit
  `STORE_TRANSPORT` of `neon`/`pg` wins (anything else throws);
  otherwise a `*.neon.tech` store host selects the Neon HTTP driver
  and any other host selects pg. The Neon branch returns the
  driver's own handle untouched, so the hosted build's query path
  is byte-identical to today.
- `src/db.js`: `getSql()` builds the production handle through
  `storeSql(process.env)`; the historical DATABASE_URL error is
  thrown by the transport with the same wording.
- `api/developer/connect.js`: the handoff store's handle comes from
  the same selection.
- `pg` moves from devDependencies to dependencies (same pinned
  version) so the rack image installs it.
- Proof: `tests/unit/db-transport.test.js` pins the selection rules
  and the handle contract without a server;
  `tests/db/transport.test.js` runs `createDb()` with **no injected
  handle** against disposable PostgreSQL through the production
  selection — full enumerated schema init (the 22 `SCHEMA_TABLES`),
  a registration write/read round trip, and `storeReachable()`.

## S-2 — rack entrypoint (next PR, same card)

- `rack-server.mjs` on the fleet pattern: every `api/` function
  bound to its route, the nine `vercel.json` rewrites carried
  verbatim, dynamic doors (`/api/tools/:name`, `/api/results/:handle`)
  bound as parameters.
- The body-contract split is pinned by a route-table test: the
  deployment webhook receives the **raw stream**; parsed-body
  handlers receive the parsed body; no handler's stream is consumed
  before dispatch (the authorize-hang defect class).
- The release identity is pinned from the environment
  (`VERCEL_GIT_COMMIT_SHA` = the exact promoted commit, with the
  fleet's rack release-pin fallback), so the health document's
  `deployed_source_sha` agrees with the promoted build by
  construction.

## Acceptance

- S-1: `npm run check`, the unit suite, and the db suite green on
  the bench at the exact branch head; CI `ci` + `release-policy`
  green at the exact PR head before merge.
- S-2: the same gates, plus the route-table test proving both body
  classes and the webhook raw-body leg by name.
- Neither PR changes any tool, route behavior, or the Neon path;
  both ride the nightly train under the standing release rules.

## Drift check

Drift protocol checklist A run before opening S-1: the dossier's
claims were re-verified against the code at the staging pin
(`createDb` seam, the second construction site in
`api/developer/connect.js`, the two `export const config`
declarations, the 22-table enumeration in `SCHEMA_TABLES`, `pg`
already pinned). One dossier simplification corrected here: the
developer connect door is a second Neon construction site and is
inside S-1's scope, not a later cleanup. Checklist B is written
into this card as if S-1 had merged; the STATUS entry in this PR is
the as-merged record. No tool added, removed or renamed; the
registry stays at 257.

## Delivery — S-1

Filled in at merge: PR number, exact head, bench evidence, CI runs.
