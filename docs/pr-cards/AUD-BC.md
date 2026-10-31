# AUD-BC — Work-index status reconciliation

**Baseline inspected:** main `4e8ef0de` (AUD-BB, #373).
Filed by the AUD-AN documentation audit and carried by AUD-AY:
[`work-index.json`](work-index.json) still carried
`"updated": "2026-10-27"` and pre-build-out statuses — 68 cards
reading APPROVED 34 / MERGED 19 / IN_PROGRESS 15 — while the
2026-10-30 build-out had merged most of the approved batches.
`npm run session:status` reads this index, so the pipeline's own
tooling showed a false picture of what remains.

**No catalog impact.** No tool is added, removed, renamed or
re-described; the registry is unchanged (253 registered / 254
catalog rows) and `docs/TOOL-CATALOG.md` is untouched. This card
changes only the index, this card file, and one
[STATUS](../STATUS.md) bullet.

## The semantics applied (from the repo's own tooling)

`scripts/session-status.mjs` defines what the index's status
means: its roadmap summary is "Read-only source/card coverage,
never a claim of accepted live behavior." Status therefore
tracks **source coverage**: a card whose full engineering scope
is on main is MERGED, with any still-queued live acceptance
carried in its `revisit` block — the shape the already-MERGED
V-1/V-2/V-3 entries use (MERGED, acceptance still gated, revisit
retained). Readiness for a merged card follows the batch's own
precedent where one exists (A/B/C use `MERGED`; V-1..V-3 use
`VERIFIED_AND_MERGED`), else `MERGED`.

Two boundaries were held:

- **D/E/U/R were not flattened.** D-1..D-4, E-1..E-4, U-1, R-1
  and R-2 keep IN_PROGRESS: their entries carry their own
  acceptance bookkeeping (D-1 `CODE_COMPLETE_AFTER_GREEN_EXACT_HEAD_CI`
  with external acceptance NOT_VERIFIED, D-3
  `PARTIAL_PENDING_EXACT_HEAD_CI`, E-1 PARTIAL, R-2's HTTP
  write-contract leg still open per the CAP-4 verdict). That
  encoding is a deliberate lifecycle distinction, not lag, and
  changing it is a lifecycle decision rather than a factual
  correction.
- **No new index entries for the 2026-10-31 AUD program cards**
  (AZ/AR/AS/AT/AU/AV/AQ/AW/AX/AY/AP/AO/BA/BB, or this card).
  The AUD-AK precedent holds and the tooling agrees:
  `docs/pr-cards/validate-index.py` pins the unit set to its 68
  REQUIRED_UNITS, so an added unit fails `npm run check`. The
  index's `process` text governs the indexed just-in-time cards;
  AUD cards have never been index units. No conflict found.

## Drift check

| Assumption | Evidence | Resolution |
|---|---|---|
| MERGED can be read as "accepted live" | `session-status.mjs` docstring: the summary is source/card coverage, never a claim of accepted live behavior; V-1 is MERGED with provider acceptance explicitly still gated in its revisit | Flip on source completion only; acceptance stays visible in revisits and the acceptance queues |
| Every IN_PROGRESS with merged source is lag | D/E entries carry `codeAcceptance` markers (PARTIAL / NOT_VERIFIED) that V/N/O entries do not; PLAN.md's convention ties those batches' states to live acceptance | D/E/U/R untouched (above); N/O/V flips rest on their own entries' text being falsified by merged PRs |
| A flipped card's readiness can always rise | `validate-index.py`: readiness other than WRITE_CARD_AT_START requires the card file to exist; no CAP-*.md files exist | CAP-2/3/4 change status + `pr` only; readiness stays WRITE_CARD_AT_START (stated here so the asymmetry is deliberate, not missed) |
| Batch card files' "Status: in progress" lines are a second status surface | They are build-time records written when each card was built; the index is the surface `session:status` reads | Card files untouched; this reconciliation covers the index only |

## Entries changed (34)

Every proof below is a commit on main (`git log main`); PR
numbers are the index's own `pr` convention. Tallies move from
APPROVED 34 / MERGED 19 / IN_PROGRESS 15 to **MERGED 53 /
IN_PROGRESS 11 / APPROVED 4**; `"updated"` moves to 2026-10-31.

### APPROVED → MERGED (30)

| Unit | pr (new) | Proof on main |
|---|---|---|
| F-1 | 296 | Merge `0a23470` "Merge pull request #296" (branch `ai/vivienne/batch-f`, head `da2b96f` carrying the F-1 commits) |
| F-2 | 298 | Merge `6c76a78` (#298); branch head `ac9265e` "F-2: firewall family" |
| F-3 | 300 | Merge `b70f9f5` (#300); branch head `8959131` "F-3: routes, redirects and cache — Batch F complete" |
| M-1 | 292 | `b1b5c10` "M-1: logs, observability and analytics (#292)" |
| M-2 | 299 | `1a53447` "M-2: drains and webhooks (#299)" |
| M-3 | 301 | `625b21a` "M-3: integrations and storage (#301)" |
| M-4 | 302 | `17dfe78` "M-4: Blob files in connected stores (Batch M complete) (#302)" |
| N-2 | 307 | `7e22138` "N-2: DNS records and certificates (#307)" |
| N-3 | 311 | `ec3a159` "N-3: domain registrar (#311)" |
| O-2 | 309 | `a63390a` "O-2: team members and access groups (#309)" |
| O-3 | 314 | `5265f7d` "O-3: API tokens (#314)" |
| O-4 | 319 | `ea96a86` "O-4: billing (FOCUS JSONL) and activity reads (#319)" |
| O-5 | 322 | `e26947c` "O-5: admin security and cost reviews (#322)" |
| O-5b | 332 | `74f92c3` "O-5b: owner data export (VMCP-021) (#332)" |
| O-6 | 338, 339, 340 | `977f4e2` (#338), `b4bf1b9` live record (#339), `4afc8fb` design correction (#340) |
| P-1 | 317 | `2406ccd` "P-1: project profiles (#317)" |
| P-2 | 321 | `3aaab63` "P-2: vercel_workflow_app_readiness (#321)" |
| P-3 | 323 | `93f8314` "P-3: … (Batch P complete) (#323)" |
| W-1 | 324 | `4515355` "W-1: Batch W read workflows (#324)" |
| W-2 | 325 | `ca439bb` "W-2: why_did_build_fail + deploy_and_wait (#325)" |
| W-3 | 326 | `4c16d25` "W-3: ship_to_production + emergency_rollback (#326)" |
| W-4 | 327 | `36be84e` "W-4: workflow_setup_custom_domain (#327)" |
| W-5 | 328 | `815c8db` "W-5: workflow_env_sync + workflow_rotate_secret (#328)" |
| W-6 | 329 | `25609bc` "W-6: … (Batch W complete) (#329)" |
| V-6 | 335 | `c31a273` "V-6 (UA-08): configurable Sandbox sizing and network (#335)"; readiness VERIFIED_AND_MERGED per the V-batch precedent |
| X-1 | 330 | `4f815a4` "X-1: vercel_undo_change + inverse capture (#330)" |
| R-1W | 333 | `47c290e` "R-1W: write-capable RTC passes (BATCH-R amendment) (#333)" |
| CAP-2 | 337 | Verdict record `dbcfaae` "CAP reconciliation 2026-10-30" (#337); [PLAN](../PLAN.md): "CAP-2 SATISFIED in source" |
| CAP-3 | 337 | Same record; PLAN: "CAP-3 SATISFIED in source for existing credential kinds" |
| CAP-4 | 337 | Same record; PLAN: "CAP-4 SATISFIED in source except R-2's separate HTTP write-contract leg, which stays on R-2's card" — the exception stays visible on R-2, which remains IN_PROGRESS |

For CAP-2/3/4 there is no single implementation PR: their
satisfaction was established by the #337 reconciliation against
source built across the build-out, so `pr: [337]` records the
repo's own verdict commit rather than inventing an implementing
PR.

### IN_PROGRESS → MERGED (4)

| Unit | Change | Proof |
|---|---|---|
| N-1 | status + readiness → MERGED; `pr` added [223]; revisit premise corrected (below) | `99a103c` "N-1 team/project domains (112 to 123 tools) (#223)" |
| O-1 | status + readiness → MERGED; `pr` [144–147] gains 305; revisit premise corrected (below) | O-1R `59de9c8` (#305) — its card is titled "O-1 remainder: deployment retention, directory role mappings, SAML + auto-join", the exact remainders O-1's revisit named |
| V-4 | status → MERGED; readiness CARD_WRITTEN → VERIFIED_AND_MERGED (`pr` [216] already recorded) | `0705ba5` (#216); the entry's own revisit already records "PR #216 merged. Sandbox source is complete; real provider acceptance is not yet proven" — the V-1 shape, left byte-identical |
| V-5 | status → MERGED; readiness CARD_WRITTEN → VERIFIED_AND_MERGED (`pr` [216] already recorded) | `0705ba5` (#216); same revisit shape as V-4, left byte-identical |

For N-1 and O-1 the revisit itself asserted a falsified present
state, so — following the V-1 precedent, whose revisit was
updated when it merged — only the `reason` and `nextAction`
fields were corrected: N-1's "not yet merged, no PR" now records
the #223 merge and its `nextAction` keeps the entry's own
acceptance half verbatim; O-1's "remainders remain" now records
their closure by O-1R #305 and points `nextAction` at the queued
hosted acceptance. All other revisit fields are byte-identical,
and no other flipped entry's revisit was touched (the MERGED
A/B/C entries likewise retain their original revisit text).

## Unresolved (1)

- **CAP-1** — left APPROVED, untouched. The #337 verdict is
  "SUPERSEDED in purpose; the generated operation ledger is the
  one unbuilt artifact (commission or waiver owed)". APPROVED
  claims queued build work the verdict contradicts; MERGED
  would claim completion of a card whose one artifact is
  unbuilt. No status in the index's vocabulary states its true
  position; resolving it needs the owner's commission-or-waiver
  decision, not an editor's guess.

## Examined and deliberately left unchanged

- **R-3** (APPROVED) — [MASTER-ROADMAP](../MASTER-ROADMAP.md)'s
  current-state record lists "R-3 conformance" among what
  remains, and the RTC hub record describes the R-3 conformance
  re-run as un-run. PR #115 (`315ea24`) pinned an earlier
  conformance subset in CI; it is not R-3's completion.
  APPROVED stays truthful.
- **X-2** (APPROVED) — the read-only smoke test and
  scratch-project run is recorded as remaining in the same
  MASTER-ROADMAP record; it has not been executed.
- **CAP-5** (APPROVED) — verdict "OPEN by design (two-tenant
  live acceptance needs a second real user)". Approved and
  unexecuted, awaiting its designed precondition, is accurate;
  its execution is an acceptance event, not source work.
- **D-1..D-4, E-1..E-4, U-1, R-1, R-2** (IN_PROGRESS) — held
  under the boundary above: their entries encode
  source-merged/acceptance-pending with their own bookkeeping,
  and several name genuinely open legs (R-2's HTTP
  write-contract leg; D-4's rolling-release remainder).

## Verification

- `python3 docs/pr-cards/validate-index.py` — OK (68 cards,
  16 batches).
- `node scripts/validate-work-queue.mjs` — OK (revisit and
  early-read exceptions pass with the new states).
- `npm run check` with `BASE_SHA` at origin/main — see the PR
  for the recorded result at the exact head.
