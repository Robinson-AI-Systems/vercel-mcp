# AUD-AF — Global Config patch/delete: classification rebuilt on the documented record (unreported linkage is live-connected, never an array demand)

**Baseline inspected:** main `5d369bc` (AUD-AE, #286). Dossier:
`globalconfig-mutate-dossier-2026-10-30.md` in the audit goal
workspace (pinned-contract field map for the single-store and items
GETs, predicate-by-predicate verdicts, throw-site triangulation,
consumer map) — written before code, per the research-first rule.

**Conviction (live, 2026-10-30 ~08:38–08:45 MDT, VMCP-010 second
execution).** On the promoted AUD-AC build, from a production-mode
connection: `vercel_globalconfig_create` works end-to-end, but
`vercel_globalconfig_patch_items` (a 3-item batch AND a 1-item tiny
upsert) and `vercel_globalconfig_delete` both refuse at plan with
the generic "Could not safely preview or classify the change".
Both tools' `before()` chains run through `store()` in
globalconfig-mutate.js, which demanded `Array.isArray(row.projects)`.
The pinned snapshot documents the single-store GET with **no
project-link field at all** — `connectedProjects` occurs 0 times in
the entire snapshot; for Edge Config, linkage lives on the project
side (a project reads a store by holding its connection string).
`record()` therefore yields `projects: null` for every real store
— tonight's live list presented exactly that — and the predicate
refused every real store. The dossier's triangulation (§4) proves
the throw site from observed facts: the same `record()` listed the
store live without throwing (identity, slug, owner, itemCount,
updatedAt all presented), and every other `store()` predicate
provably passes on the observed record. Queued immediately behind
it, `allItems()`/`safeItems()` accepted only an invented key map
while the contract documents the items GET as a **bare array** of
GlobalConfigItem — patch/delete would have refused there next.

**Addendum found during the build (dossier §7).** Remodelling the
create fakes convicted a third instance that bypasses
`record()`/`store()` entirely: `globalconfig_create`'s `verify()`
demanded the same links array from the raw readback, so a real
create could never be confirmed (the store landed; the verdict
stayed `confirmed: null` forever).

## What ships

- **globalconfig-mutate.js** — `store()` keeps every provable
  predicate (scope, slug, strict updatedAt revision, itemCount,
  per-project team proofs) and runs the proof loop only over links
  a record actually reports. One exported `linkSnapshot(row)` —
  sorted array when links are reported, `null` when not — is now
  the snapshot/drift/read-back form for the whole family.
  `classification()`: reported non-empty links → production
  (unchanged); **unreported linkage → production**, with the reason
  stated plainly (any project holding the connection string can
  read changes immediately, so the store is treated as
  live-connected); production stays false only for a PROVEN empty
  links array. `targets()` spreads project targets only when links
  exist; previews name reported links as before and say "unreported
  project linkage … treated as live-connected" otherwise.
- **globalconfig-common.js** — one items normalizer,
  `itemEntries()`: accepts the documented bare GlobalConfigItem
  array (bare or enveloped) and the legacy key maps (bare or
  enveloped — the documented backup payload's shape), validates
  keys, duplicates, the 200-entry bound and value presentability,
  and refuses a live pagination cursor. `allItems()` and
  `safeItems()` both build from it, so the items endpoint has one
  shape authority. `record()` also reads the documented
  `sizeInBytes` (the invented `size` name kept as fallback) — the
  same function's other mapping miss; tonight's live list showed
  `size: null` because of it.
- **globalconfig-tokens.js / globalconfig-schema.js /
  globalconfig-remaining.js** — snapshots, previews and verify
  read-backs route through `linkSnapshot`; no predicate of theirs
  changes meaning (their JSON drift comparisons were already
  null-safe).
- **globalconfig-create.js** — `verify()` only: reported links must
  still be empty (`confirmed: false` when not); unreported linkage
  no longer leaves a real create unconfirmed forever.
- **Fakes remodelled from the pinned contract** across the four
  family test files (documented fields only: ownerId, sizeInBytes,
  digest, createdAt; items as the documented array; legacy map
  acceptance pinned in the mutate and restore paths; the
  reported-links variants kept to pin the proof loop).

Nothing is loosened: unknown linkage makes classification MORE
strict — a preview connection can now write only to a store the
record proves unlinked — and identity, owner, revision, itemCount
completeness and per-link team proofs all stand.

## Verification

- Defect convictions: against the pre-fix source, the remodelled
  mutate suite fails 4/9 (both contract-shaped applies, the AUD-AF
  plan/refusal pair, the refusal set); with the fix, patch and
  delete PLAN from a production connection against a
  contract-shaped record, refuse from a preview connection, and
  still refuse on owner identity drift, revision mismatch,
  item-count mismatch and a reported link owned by another team.
- Family suites: 39/39 (mutate 9, read-create 10, schema 7,
  token-restore 9, delivery 4). Full local check and CI at the
  exact head: recorded in the PR.

Rides the nightly promotion. VMCP-010's remaining leg closes when
the coordinator re-runs the probe on the promoted build; the live
probe store (created during the probe) is deleted through the
fixed delete tool after that promotion, or by the owner in the
dashboard — it is not touched by this card.
