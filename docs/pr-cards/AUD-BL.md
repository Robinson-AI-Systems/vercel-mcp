# AUD-BL — D-4 work-index dated refresh (PR #205 premise corrected)

**Baseline inspected:** main `a104d234` (AUD-BH, #377) at first
filing; rebuilt on main `471b5ed` (#379) for this PR. Live
`8fb9e83` (the 2026-10-31 promotion).

**ID history, recorded plainly:** this refresh was first filed as
PR #380 under the ID AUD-BK, chosen as the next unissued ID at
dispatch time. While #380 sat in CI, the ID was concurrently
issued to the U-1 premise-check card, which merged as PR #379 and
created `docs/pr-cards/AUD-BK.md` — leaving #380 conflicted on
that path, STATUS and the index, and its ID taken. #380 was
closed unmerged with the reason recorded on it; this replacement
carries the next ID, AUD-BL, on current main, with the D-4
content unchanged in substance.

**Filing history, continued:** the AUD-BL re-file (PR #385,
from a git-data snapshot) drew zero workflow runs at its head —
verified roughly six minutes after opening, both required checks
missing — and was closed unmerged under the ratified CI-firing
exception. This branch was then pushed from the Workshop
(chris-agent-01, user credential, true git history) before its
PR (#391) opened; #391's open also drew no runs and a
close/reopen did not fire them, so #391 was closed unmerged as
well and this filing was rebased onto the then-current main
(which had advanced three merges) and pushed from the Workshop
again under a successor branch. The firing saga is recorded on
#385 and #391 themselves; it is an event-delivery problem on
App-born and reopened PRs during a heavy landing window, not a
defect in this change — the identical tree passed the full local
check at every filing.

**No catalog impact.** No tool is added, removed, renamed or
re-described; the registry is unchanged (253 registered / 254
catalog rows) and `docs/TOOL-CATALOG.md` is untouched. This card
changes only the D-4 entry in
[`work-index.json`](work-index.json), this card file, and one
[STATUS](../STATUS.md) bullet. No code changed; no live calls made.

## Why this card exists

The 2026-10-31 finish pass tasked an implementer with fixing
"draft PR #205's exact-head check/unit/review failures and merging
it when green", quoting the D-4 index entry's revisit verbatim.
Ground truth, re-verified this session through the connector and
the git record, is that the premise was already false:

- PR #205 (`feat(d4): complete guarded rolling-release workflows`,
  branch `ai/gpt6/d4-rolling-complete-20261014`) **merged on
  2026-10-15**: merge commit `51a64e4`, head `8f6122ab`, state
  closed/merged, zero unresolved review threads.
- Its exact-head checks read back green today: `ci` **success**
  and `release-policy` **success** at head `8f6122ab` (check runs
  completed 2026-10-15T04:09–04:10Z) — matching the merged PR's own
  handoff record (check/unit/db/emulate/ci/release-policy SUCCESS,
  841 unit tests).
- The merge is an ancestor of current main and of live `8fb9e83`,
  so the D-4 card's "checked production ancestry" gate is
  discharged as well.
- Together with PR #203 (merge `3938e65`, the seven
  release-routing/alias tools), all **12 approved D-4 tools are in
  source** on main: the five rolling-release tools
  (`vercel_rolling_get`, `vercel_rolling_update_config`,
  `vercel_rolling_start`, `vercel_rolling_approve_stage`,
  `vercel_rolling_complete`) sit in
  `src/tools/release-rolling-reads.js` and
  `src/tools/release-rolling-write.js`.

The index entry never caught up: its `pr` record omitted #203 and
its revisit still instructed a future implementer to fix and merge
a PR that merged two weeks earlier. The documentation audit had
already flagged this shape ("index entries need a dated refresh,
not a silent edit"). This card is that dated refresh.

## Gating verification (read-back on main, this session)

The rolling-release writes were spot-verified on current main
against the family's shipped pattern (the #203 tools and the
repo's guarded-write construction): the handlers are built with
`defineWrite` + `bindGuardedWrite`; every spec carries
`dryRun`/`confirm`/`requestKey`; the write declares
`production: true` with its reason and refuses unless the
connection mode is production; dispatch is preceded by exact
revision/deployment checks (`RefusalError` on a changed current
production deployment); success is confirmed only by independent
after-state readback per operation (config enabled-state match,
start/approve ACTIVE state, complete COMPLETED state with alias
proof); the start operation's description carries the
metered-charge warning, and positive activation remains
fail-closed under IN-08 (provider-enforceable lifetime ceiling
plus independent owner purchase grant), exactly as the D-4 card
records. This is a seam-level read-back of merged code, not a
re-audit and not provider acceptance.

## The one judgment call: status stays IN_PROGRESS

AUD-BC (merged today, #374) held a deliberate boundary: D-1..D-4,
E-1..E-4, U-1, R-1 and R-2 keep IN_PROGRESS because their entries
carry their own acceptance bookkeeping — "a deliberate lifecycle
distinction, not lag", and changing it "is a lifecycle decision
rather than a factual correction". This refresh therefore corrects
only what is factually false (the `pr` record and the revisit
premise) and states the source phase's completion plainly inside
the revisit, but does **not** flip D-4's status against a same-day
reconciliation ruling. The flip is a one-line change whenever the
lifecycle ruling is taken explicitly; the evidence for it is
assembled here. Tallies are unchanged: MERGED 54 / IN_PROGRESS 11
/ APPROVED 3 of 68.

What remains for D-4, named in the corrected revisit:
**externalAcceptance NOT_VERIFIED** — the owner-approved
disposable TEST-fixture acceptance (predispatch route
change/readback, staged-produce vs previously-serving rollback
proof, alias exact identity/owner, rolling-release
read/denial/readback, cleanup); the #205 handoff's open evidence
item (reconcile the paid PATCH configuration body's pinned
official shape — existing tests prove the other rolling-release
methods and the safe DELETE disable, not a positive billed PATCH);
and IN-08's bar on positive activation. Index semantics remain
source coverage, never a claim of live acceptance.

## Drift check

| Assumption | Evidence | Resolution |
|---|---|---|
| PR #205 is an open draft with failing checks (the finish pass's premise, quoting the index) | Connector reads: PR closed/merged 2026-10-15, merge `51a64e4`; `ci` + `release-policy` success at head `8f6122ab`; 0 unresolved threads | Premise falsified; nothing to fix or merge. The work is the dated index refresh |
| The D-4 entry's staleness is ordinary lag AUD-BC would have flipped | AUD-BC's card names D-1..D-4 as deliberately kept IN_PROGRESS (acceptance-lifecycle encoding) | Correct facts only; status held; the flip is flagged as an explicit lifecycle ruling, not taken silently here |
| D-4's remaining gates include checked production ancestry | `git merge-base --is-ancestor 51a64e4 origin/live` — yes, live `8fb9e83` | Ancestry gate recorded discharged in the revisit; only TEST-fixture acceptance remains |
| Flipping or editing D-4.md's header is part of the refresh | AUD-BC precedent: unit card files untouched (N-1.md still reads IN_PROGRESS with its index entry MERGED); D-4.md's own body already records the #205 merge | Card file untouched; the index is the surface `session:status` reads |
| Rolling-release gating regressed since merge | Seam read-back on main (above): `defineWrite`/`bindGuardedWrite`, production-only connection, revision checks, readback-confirmed success, metered warning, IN-08 fail-closed | No regression found at the seams read; full re-audit and provider acceptance remain separate, unclaimed |
| The first filing's ID (AUD-BK) was safe to reuse | PR #379 merged a different AUD-BK card while PR #380 was in CI; #380 closed unmerged with the reason on it | Replacement filed as AUD-BL on current main; the collision is recorded here and on #380, not smoothed over |

## Self-review

Docs-only diff (index entry, this card, one STATUS bullet)
reviewed against the connector and git evidence above. No code,
no catalog, no secrets, no real IDs beyond public commit SHAs
already in the repo's own records. Blocking findings: none.
