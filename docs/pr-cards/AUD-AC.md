# AUD-AC — Global Config create: the completeness proof reconciled with the documented + live list shape (VMCP-010 gate)

**Baseline inspected:** main `1773ab2` (AUD-AB, #283). Dossier:
`globalconfig-create-dossier-2026-10-30.md` in the audit goal
workspace (documented contract, per-shape completeness rule,
consumer map, schema-alignment analysis) — written before code, per
the research-first rule.

**Conviction (live + code, 2026-10-30 ~07:12 MDT).** The owner
authorized the VMCP-010 closure probe; step 1 stopped:
`vercel_globalconfig_create` (slug `vmcp010-probe`) plan AND dryRun
both returned `refused_by_guard` — "Could not safely preview or
classify the change" — and the store list verified empty after.
Root cause: create's `before()` requires
`listRows(...).complete === true` to prove slug uniqueness, and
`listRows` (`src/tools/globalconfig-common.js`) set `complete` ONLY
when the provider's list response carried `pagination` with
`next === null`. The live response carries no such block (the tool's
own list read: `complete: false`, zero rows, `capped: false`,
`next: null`).

**The documented contract refutes the demand.** The vendored
snapshot's `GET /v1/global-config` 200 response is a **bare array**
("List of all Global Configs") — no envelope, no `pagination`, and
the operation declares no limit/next parameters at all (sibling
endpoints that paginate, e.g. backups, declare them explicitly).
The old unit fixtures faked the one certifying shape
(`{data, pagination:{next:null}}`) that neither the snapshot
documents nor the provider sent, and asserted the documented bare
array was incomplete. Same spec-vs-live family as A-1's absent
`type` (AUD-M3) — here spec and live agree; only the code disagreed.

## What ships

1. **`listRows` completeness rule** (`globalconfig-common.js`, the
   only production logic change in the family core): an inventory
   certifies when it is duplicate-checked, under the existing
   100-row bound (above it still throws), AND either it carries an
   explicit `pagination.next === null`, or it carries **no
   pagination block at all with fewer than 100 rows** (the
   documented bare array and the envelope-without-pagination live
   candidates). Refusal stays for: a pagination block whose `next`
   is anything else (a live cursor, or absent inside a present
   block), and exactly-100 rows without an explicit pagination end
   (a silent provider cap is indistinguishable from a genuine 100).
   The returned `next` projection and all throw behavior unchanged.
2. **Consumers verified, unchanged:** `globalconfig-create.js`
   reads the corrected flag (its proof and its pre-dispatch re-run);
   `vercel_globalconfig_list`'s presented `complete` already ANDs
   the internal flag with its 20-row display bound, so the presented
   flag tells the same truth as the internal value (tonight's live
   team now reads `complete: true, shown: 0`). The patch/delete/
   token/schema/restore paths use `exact()` + `allItems()` and never
   consume `listRows`; `safeItems`' items-view `complete: false` is
   a different endpoint's genuinely unproven claim and stays.
3. **Secondary — `vercel_globalconfig_patch_items` schema
   alignment** (`globalconfig-mutate.js`): the item `value`
   property was published as an empty schema `{}` — present, but
   carrying none of the runtime validator's contract, so the tool
   was not usable as documented (the VMCP-010 runbook's step 2
   depends on it). `value` now carries a `description` stating the
   whole runtime rule: required for create/update/upsert, forbidden
   for delete, plain-JSON `safeJson` constraints (no
   credential-shaped strings/keys, no control bytes, finite numbers,
   depth ≤8, ≤100 entries per array/object), serialized ≤8192
   bytes. No validator change; `required` stays
   `['operation','key']` (the conditional cannot live in a flat
   required list). A test pins schema↔validator agreement both ways.
   **Catalog judgment:** the tool surface does not change (no new
   tool, no renamed or removed argument); the TOOL-CATALOG
   `patch_items` row gains a note because a `src/tools/` module
   changed (drift checklist B), not because the surface grew.
4. **Fixtures remodelled** from the documented contract PLUS the
   live capture: the read/create suite's default list fake is now
   the bare array; certifying variants (bare, envelope without
   pagination, envelope with `next: null`) and refusing variants
   (`next: 99`, pagination block without an end, exactly-100
   unpaginated) are all pinned.

## Evidence

- Defect conviction, pre-fix: with the remodelled tests against the
  unfixed code, 5 tests failed — the live-shaped create returned
  `refused_by_guard` (the exact live behavior), the list read
  `complete: false` on the documented shape, and the schema
  agreement test failed on the missing description — while the
  capped/unverifiable refusal cases already passed.
- Post-fix: all five globalconfig unit files green; a create plan
  against the live-shaped fake (bare `[]`) now APPLIES with
  read-back confirmation; the exactly-100-without-pagination-end and
  `next: 99` shapes still refuse with zero provider writes.
- Full local verification: commit, then
  `BASE_SHA=$(git rev-parse origin/main) npm run check` + full unit
  suite (counts in the PR). No live calls were made; the live
  VMCP-010 probe re-runs after the nightly promotion under the
  owner's existing authorization, run by the coordinator — this
  card's merge does not itself close VMCP-010.

**Self-review:** diff inspected against `docs/AI-PR-READ-FIRST.md`;
no production/spend/secret surface touched (one read-path flag in a
shared family helper, one schema description, tests, docs). The one
behavior widening — create becoming possible on teams whose list
carries no pagination block — is the card's purpose and is bounded
by the retained refusals above; slug uniqueness still fails closed
on duplicates, oversize, truncation signals and foreign rows.
