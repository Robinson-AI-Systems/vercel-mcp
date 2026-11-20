# MAP-CLAIMS-1: every count, date and policy claim in the relational map is tied to its source

## Owner request 2026-11-20

The Second Shift run #2 findings (second-shift-20261120-094156) were handed over at Chris's direction: the relational map stated counts, dates, live-state claims and policy rules that nothing re-checked.

## Outcome and acceptance

- `scripts/check-map-counts.mjs` is the same dependency-free file in vercel-mcp, stripe-mcp, google-workspace-mcp, neon-mcp and github-mcp. Its new checks:
  - Counts are checked as number+label pairs (each `counts.json` entry has a `label`), so two counts swapping numbers is caught.
  - A count is still recognised with an identifier between the number and the noun ("253 registered vercel_* tools"). MAP-COUNTS-1 missed exactly this form.
  - Grouped numbers (1,243), approximations ("~", "about") and prefixed forms (-243, 0.243) never pass as the plain statement.
  - New `docs/relational-map/claims.json` ties each dated, live-state or policy claim to a source file and pattern (a STATUS entry, a code constant, a workflow line or a test name). The checker fails if the map no longer states the claim or the source no longer says it.
  - Every date (YYYY-MM-DD) in a map file must sit inside a registered claim. A date with no source fails the check.
- Proof the check bites: putting back a stale count, or adding an untied date, fails with the reason.

## Drift check

Docs and a check only; no tool or behaviour change.

## This repo

- Real drift found: the README diagram still said "253 registered vercel_* tools"; the code has 257 (MAP-COUNTS-1 fixed the tools page but missed the diagram). Fixed.
- 11 claims tied: the rack move and store retirement (STATUS 2026-11-08), the 2026-11-18 live re-check, SR-6 live 2026-11-02, R-1W pass writes (its card), retention 400/180 days (`src/db.js` constants), the 20:23 America/Denver promotion (`daily-live.yml`), "floor, not a cap" (`promote-live.test.mjs`) and the single merge gate `ci` (`ci.yml`).
