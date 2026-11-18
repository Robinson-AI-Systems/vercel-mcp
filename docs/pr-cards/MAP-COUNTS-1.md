# MAP-COUNTS-1: the relational map's numbers are checked against the code

## Owner request 2026-11-18

Chris: "Yes" to dealing with the Second Shift 48-hour run's relational-map findings (here: findings 8 and 9 on PR #458).

## Outcome and acceptance

- `scripts/check-map-counts.mjs` (the same dependency-free file across the fleet repos) reads `docs/relational-map/counts.json`, computes each stated count from the code at this commit, and fails if a value differs, a listed file does not state it, or the map states a count (or a "~" approximation) the file does not list. It runs in `npm run check`.
- It found real drift: the map said "253 of 254 catalog tools are registered"; `scripts/check-catalog.mjs` reports 257 of 258. Fixed.
- The "production on the rack since 2026-11-08, hosted copy retired" claim now cites its record (the 2026-11-08 `docs/STATUS.md` entry) and today's live re-check (rack route table and release receipt; no vercel-mcp project left in the Vercel team).
- Proof the check bites: a wrong value in `counts.json` fails with the code's real number.

## Drift check

Docs and a check only; no tool or behaviour change; registry unchanged at 257.

## Also: RUNNER-DEADLOCK-1 (same morning)

With two of the three self-hosted machines offline, a release's promotion job waited for the newest required check on main, which was another release run's job queued behind it on the only runner, until its 15-minute timeout (seen live on rack-mcp). `.github/release/promote-live.mjs` now goes by the newest *finished* run of each required check: a queued copy no longer holds it back, a newer failure still blocks, nothing passes without a finished success. Acceptance: `.github/release/promote-live.test.mjs`.
