# 06 — Release and operations

## Branches

- `main` — development branch; all PRs target `main` (enforced).
- `live` — production branch. Source on `main` reaches production
  **only** through the checked promotion.

## Promotion (`main` → `live`)

- Workflow: `.github/workflows/daily-live.yml` — nightly at
  20:23 America/Denver (with bounded missed-run recovery crons).
- The promoter (`.github/release/promote-live.mjs`) is a checked
  fast-forward only: exact-head green CI, ancestry, and release-policy
  tests (`.github/release/promote-live.test.mjs`) gate every promotion.
- One automatic promotion a day is the floor, not a cap: an
  owner-authorized additional release runs the same checked promoter
  with the exact expected main SHA.

## CI (`.github/workflows/ci.yml`) — the single merge gate is job `ci`

| Job | Checks |
|---|---|
| `check` | `npm run check`: secret scan, docs-updated, PR-card index, work queue, lint, catalog, operation ledger, writes, core imports, budgets, D1/D2 acceptance, developer evidence, session |
| `unit` | Vitest unit suite, 3 shards |
| `db` | DB tests against disposable Postgres 17, 3 shards |
| `emulate` | Vercel emulator suite (`npm run test:emulate`) |
| `rtc-hub` + `conformance` | Frozen RTC 1 conformance suite from the Hub repo at its pinned SHA, against this server's real door + throwaway Postgres + fake Vercel |

## Production operations

- **Host:** Development Rack (see 01); health at `/api/health` and
  `/api/health/deep` (`src/health.js`).
- **Deployment webhooks:** Vercel posts deployment events to
  `/api/webhooks/deployments`; the receiver is the one
  `bodyParser:false` function — it verifies the HMAC over the raw
  bytes, classifies the event (`src/webhooks/classify.js`,
  `receiver.js`) and records `deployment_events` / `deployments`
  rows that the observability and build-failure surfaces read.
- **Housekeeping:** `.github/workflows/git-housekeeping.yml` runs the
  owner-authorized branch preserve-and-prune plan on pushes to `main`.
