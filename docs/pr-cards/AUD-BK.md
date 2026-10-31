# AUD-BK — `vercel_api_write` premise check: the filed build already shipped; U-1's index premise corrected

**Baseline inspected:** main `a104d234` (AUD-BH, #377).
**Filed premise:** the finish-building directive (owner, 2026-10-31
~17:00 MDT) carried the work index's U-1 revisit text: audit finding
VMCP-013 (2026-10-27) — "`vercel_api_read` is built and
`vercel_api_write` is not, so any unbuilt provider write is impossible
through the server even though Batch U designed it (U1–U8)". AUD-BK
was filed to build the tool to `docs/designs/BATCH-U.md` U1–U8 plus
the design's 2026-10-27 amendment.

**Finding: the premise is stale; the build already shipped.** The
dossier pass below was run against the code before any building, and
it convicts the index entry, not the code. `vercel_api_write` was
built by **U-1m, PR #297 (commit `186b898`, merged 2026-10-30)** —
after the AUD-A2/AUD-B packets the VMCP-013 direction sequenced it
behind — and U-1's own card records the slice
(`docs/pr-cards/U-1.md` §U-1m), the catalog row is marked built
(`docs/TOOL-CATALOG.md`, "U-1 (built — this PR)"), and AUD-BE's
operation ledger already counts the door (132 `universal_write`
rows). What never happened is the paperwork catch-up: U-1's index
entry still lists only PRs #148–#156 and still says the tool is not
built. This card therefore does the honest remainder — verify the
shipped tool decision-by-decision against its design, and correct
the index entry in the AUD-BC/V-1 shape. **No code changes; no tool
is added, removed, renamed or re-described.**

**Catalog judgment (drift checklist B):** no `TOOL-CATALOG.md`
change is owed. The `vercel_api_write` row already exists and is
marked built; measured on this baseline by the repo's own
`scripts/check-catalog.mjs`: **254 catalog rows, 253 registered** —
`vercel_api_write` is one of the 253; the one unregistered row is
`vercel_admin_overview`, closed by the IN-16 ruling (AUD-AY census).
The filed expectation of a 253 → 254 registry move does not occur,
because the tool was already counted. **Operation ledger:**
`scripts/check-operation-ledger.mjs` passes with no drift (455
rows); the generator's sources did not change, so no regeneration.

## Shape map of the shipped tool (as verified, not as filed)

- **Registry** (`src/tools/universal.js`): `vercel_api_write`,
  `writes: true`, `guardedWrite: true`, area `universal`,
  profiles `['full']` only, `destructiveHint: true`. The handler is
  `bindGuardedWrite(defineWrite(apiWriteSpec), writeCtx, resultMapper)`
  — the same guarded-write context every write namespace composes
  (audit = `db.recordChange`, replay store, protected-target and
  app guards, account spend guard). Its registry entry carries the
  write contract; a unit test pins it ("registry entry carries the
  full-profile guarded write contract").
- **Classification** (`parseApiWrite` in
  `src/vercel/api-write-policy.js`, pure, before any provider I/O
  beyond identity reads): the `op` resolves through the pinned
  snapshot index (`apiOperation`); unknown operation → refused in
  words. Method must be POST/PUT/PATCH/DELETE; a read operation is
  refused with a pointer to `vercel_api_read`. Full snapshot
  validation (`validateRequest`) runs before dispatch (U2).
- **Preflight, confirmation, journaling:** the `defineWrite`
  lifecycle supplies dryRun/confirm (U3: always confirm; the preview
  renders method + path + summary in plain words, body/query field
  names, and the object as it is now when the path identifies one
  object and a same-template GET exists). Apply failures journal one
  best-effort AUD-AG-shaped SHAPE-FP row (status/code class and
  field names/types, never values) so an `outcome_unknown` is never
  journal-silent. Replay identity rides the write contract's
  request key (pattern-pinned in the tool schema).
- **Refused outright, by class:** operations a hand-built tool
  covers refuse and name the tool (`handBuiltWrites`, U7);
  credential-returning operations refuse by class
  (`secretWriteOperation`, U5) with the hand-built tool or
  `vercel_where_is_setting` named instead; request bodies are
  B5-scanned — a credential-shaped value anywhere, or any string in
  a credential-named field, refuses with the dashboard/hand-built
  remedy; caller-supplied `teamId`/`slug` are refused (team
  authority comes from the stored account); path/query values pass
  control/credential screens; a project-scoped connection can only
  write its own project.
- **Spend and access declarations:** `spendOperation(row)` (U4 —
  the spend table in `src/vercel/spend-operations.js`, plus the
  design's unknown-operation default: an unlisted operation whose
  summary or path mentions buy/purchase/renew/upgrade/credit/
  billing/plan/invoice, or that creates a team, store or sandbox, is
  treated as spend) feeds the executor's spend guard, and detected
  spend on an owner connection discloses and executes on the
  owner's word (the amendment's D-A integration — no retired grant
  resurrected). Member/role/access-group operations declare access
  (`accessFor`) to the same machinery.
- **Production (U6):** decided from proven target evidence — the
  target project is independently read back first; proven live →
  production, proven non-live → the one non-production outcome,
  unproven → production (fail-closed); deployment targets classify
  from the deployment's own record; domain/DNS/certificate writes
  are always live. This is the D-B switch semantics the amendment
  names.
- **Result delivery:** matches the read side's discipline — the
  apply result is shaped to identity fields only
  (`shapeApiWriteResult`), through the same scalar screen as the
  read projections; read-back verification (U8) re-reads through
  the matching GET when the response carries an `id` (same-template
  GET, or the collection child GET), otherwise `confirmed: null`;
  `inverse()` returns null — no undo for universal writes, and the
  preview says so.

## Verification against BATCH-U (evidence, this baseline)

| Design point | Shipped evidence |
|---|---|
| U1 tools/profiles | Registry entry above; write spec's `before` also refuses any non-`full` profile at the boundary |
| U2 snapshot-only | `validateRequest` before I/O; unknown op/parameter refused in words; suite: "refusals happen before provider I/O" |
| U3 confirm/dryRun + current object | `defineWrite` lifecycle + `preview()`; suite: no-confirm changes nothing |
| U4 spend table + unknown-op default | `src/vercel/spend-operations.js`; suite: an unlisted "purchase" operation treated as spend; spend journaled in the change log |
| U5 secret rule | `secretWriteOperation` class refusal + `screenBody` B5 scan; suite: secret operations refused; env create refused naming `vercel_env_set` (U7's worked example) |
| U6 production detection | `production()` from proven evidence; suite: production-classified write refused from a preview connection |
| U7 hand-built tools win | `handBuiltWrites` refusal naming the tool |
| U8 guards | Self-protection (suite: protected targets refused), profile guard, spend guard, change log, request key, read-back/`confirmed: null` (suite: delete with confirmed null when no read-back identity exists) |
| Amendment acceptance addition | An operation with no hand-built tool completes under the write contract — pinned in source by the fake-provider execution suite (a feature-flag write completing with read-back; provider failure surfacing as `outcome_unknown` with its failure detail). The **live** leg of that sentence remains owed (below) |

Suites run on this baseline (2026-10-31, this card):
`tests/unit/universal-write.test.js`,
`tests/unit/universal-read.test.js`,
`tests/unit/universal-discovery.test.js` — **64 tests, all passing**
(terminal output of the completed run), plus the catalog and
operation-ledger checks quoted above and the full `npm run check`
on the PR branch.

## The index correction (U-1 entry, `docs/pr-cards/work-index.json`)

AUD-BC deliberately left the D/E/U/R entries' *statuses* alone —
U-1's IN_PROGRESS encodes its acceptance lifecycle, and this card
does not flatten it: **the status stays IN_PROGRESS** because live
acceptance is genuinely still owed. What AUD-BC's own N-1/O-1
precedent corrects is a *falsified premise inside the entry*, and
U-1's revisit carries one. This PR:

- fills the `pr` record with the merged U-1 PRs the entry omitted:
  **#159, #162, #163, #164, #165** (slices U-1h–U-1l) and **#297**
  (U-1m), each proven in main's git log;
- rewrites the revisit `reason` to state the corrected facts with
  their dates (the write half is built; the stale sentence is named
  as superseded by this card) while keeping the still-true parts
  (acceptance unverified; Hub routing not a blocker);
- rewrites `nextAction` to the remaining live-acceptance legs only —
  the recorded 2026-10-27 build direction is discharged by U-1m,
  and the first live `vercel_api_write` call stands as what it has
  always been in this repo's rules: a separately authorized
  post-promotion probe against a disposable fixture, never part of
  a build card;
- refreshes `eligibilityCondition`, whose writes clause stated a
  pre-build precondition.

`docs/pr-cards/U-1.md` gains a dated AUD-BK addendum recording the
same verification, so the card file and the index agree.

## Not claimed

- **No live acceptance.** No live `vercel_api_write` call was made
  by this card (hard limit: no writes to real teams from a build
  card; the tasking for this card also bars live calls). VMCP-013
  closes in source on U-1m's evidence as re-verified here; its live
  leg joins U-1's existing acceptance queue.
- **No degraded verification.** The verification above ran complete
  (full universal suites + catalog + ledger + repo check). The one
  thing not exercised is the live provider, which is out of scope
  by rule, declared here rather than passed over.
