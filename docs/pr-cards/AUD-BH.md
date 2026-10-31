# AUD-BH — the RTC 2 ruling, mirrored into this repo's decisions log

**Baseline inspected:** main `71c3ce8` (AUD-BD, #376).
**Ruling:** Chris, 2026-10-31 ~16:32 MDT — the five RTC 2 decisions
(D1–D5) ruled as recommended, following the AUD-BF judgment dossier
(`r3-conformance-judgment-2026-10-31.md`, goal files), which found
R-3 not cleanly buildable as specified: the hub's conformance suite
drifted after the RTC 1 freeze (2026-10-11) — post-pin commits
changed the catalog-pagination and result-recovery dialects away
from both this server's shipped shapes and CONTRACT §§4/7, with no
new RTC version or dated decision as CONTRACT §9 requires.
**This card is docs-only:** it mirrors the dated decision into this
repo's `docs/DECISIONS.md`. The primary record is the hub repo's
(`Robinson-AI-Systems/robinsons-toolkit-hub`) `docs/DECISIONS.md`,
written in parallel; this entry cross-references it as primary.

## What the ruling decides (mirrored verbatim in DECISIONS.md)

- **D1** — Result recovery = CONTENT PAGES (the RTC 2 draft's §7
  stands as written).
- **D2** — OAuth = OPTIONAL-BUT-SPECIFIED in RTC 2; passes remain
  the required baseline.
- **D3** — Handle lifetime = 24 HOURS, carried from RTC 1.
- **D4** — The health path IS included in the advertisement
  (SHOULD-level manifest field).
- **D5** — The R-3 disposition is THE COMPOSITE: the RTC 1 freeze
  HOLDS (option (b) — no shipped dialect is amended to chase the
  unversioned suite drift), AND RTC 2 is ADOPTED by this dated
  decision as RTC 1's §9 successor.

## What this means for vercel-mcp (recorded, not executed here)

- **R-3 executes under (b)**: its CI harness targets the frozen pin
  suite (e76b1f8) with the full named subset wired, per the AUD-BF
  dossier's build sketch; reads/writes semantics are dispositioned
  to the server-side write-contract/HTTPS suites the plan names,
  with the divergence recorded in `docs/RTC-HUB-INTEGRATION.md`.
  That is R-3's own card, written at its start — not this card.
- **This server's RTC 2 adoption is its own later card** (dialect
  and manifest changes land there, under the adopted contract —
  never as a chase of the unversioned suite).
- **The other servers** (Workspace, GitHub, Dokploy) adopt RTC 2
  through their own cards per RTC 2 §12 — noted in the decision
  record as follow-ons, not executed in this sequence.

## Catalog judgment

None — docs only. No tool added, removed or renamed; registry and
`docs/TOOL-CATALOG.md` untouched. No work-index entry (the AUD
precedent: AUD cards are not index units).

## Evidence

Docs-only change: `docs/DECISIONS.md` (the mirrored entry),
`docs/STATUS.md` (one bullet), this card. Verified by the repo
check at the exact head and CI (ci + release-policy) at the same
head; counts and run IDs are recorded in the PR's self-review.
