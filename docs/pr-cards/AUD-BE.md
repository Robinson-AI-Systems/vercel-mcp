# AUD-BE — CAP-1's generated operation ledger, built on commission

**Baseline inspected:** main `f95d79f` (AUD-BC, #374).
**Commission:** Chris, 2026-10-31 — CAP-1's one unbuilt artifact is
commissioned, waiver declined (the AUD-BC card had left CAP-1
APPROVED and unresolved for exactly this owner decision).
**Implements:** CAP-1's ledger artifact only. CAP-1's verdict
stands as recorded — SUPERSEDED in purpose (#337 reconciliation);
this card builds the artifact the verdict named, it does not
re-open the inventory program.

## Spec extraction (from the repo's own records; no CAP card files exist)

- `docs/designs/MAXIMUM-AUTHORITY.md` §CAP-1 (lines 33–53):
  "Create one machine-readable row per method/path/version or
  equivalent documented workflow, linked to current official
  schema/reference revision and checked date. Record operation
  key/family/host/version, supported/unsupported/unknown per
  credential kind, permissions/roles/entitlements, user/resource
  scope, source handler or missing engineering, exact
  request/response tests, side effects, owner unit/dependencies
  and live proof." Acceptance: "reproducible current-interface
  enumeration; duplicate/orphan/missing-row validation; every
  operation disposition and credential uncertainty visible;
  generated family gap report; source and live evidence
  separately pinned; no invented percentage." Scope includes
  "documented official SDK-only interfaces (including Blob)".
- `docs/designs/MAXIMUM-AUTHORITY.md`, Reconciliation 2026-10-30:
  "That ledger artifact was never generated… it is recorded here
  as the program's one unbuilt artifact, for an explicit future
  commission or waiver rather than a silent drop." PR #337's own
  body names it "a generated machine-readable operation ledger"
  and names the living record it is generated from:
  `src/vercel/operations.js`, `docs/TOOL-CATALOG.md`, the vendored
  OpenAPI snapshot and the per-batch dossiers.
- `docs/PLAN.md:114`: "the generated operation ledger is the one
  unbuilt artifact (commission or waiver owed)".
- `docs/UNIVERSAL-IDENTITY-HANDOFF.md` (CAP-1 row): the unit's
  deliverable is "Operation/credential inventory and reproducible
  gap validator" — i.e. the ledger plus its validation, not a
  prose inventory.

## Drift check A — card assumptions vs actual at baseline

| Assumption | Actual at `f95d79f` | Kind | Correction / test |
|---|---|---|---|
| Snapshot is the enumeration source | 451 operations / 327 paths, pinned `openapi-2026-10-11.json`, SHA-256 `af1db6e9…` in `OPENAPI_SNAPSHOT` (`src/vercel/client.js`) and `vendor/vercel-openapi/SOURCE.md`; `apiIndex()` already enumerates it and throws on duplicate operationIds | — | Generator imports `apiIndex()`/`apiMetadata()`; never re-parses the JSON by hand |
| OPS table joins the snapshot | 193 OPS entries → 188 distinct snapshot operations, **0 orphans** (measured) | Mechanical | Join by method+path; validator fails on any future orphan |
| Hand-built coverage is recorded | `src/vercel/hand-built-map.js`: 74 operationIds → tool names, all present in the snapshot | — | Imported as the `hand_built` evidence |
| Universal doors classify the rest | Reads: audited allowlist in `src/vercel/api-read-policy.js` (10 flag operations); secret reads refused. Writes: `parseApiWrite` classifies every documented write (hand-built wins, credential-returning refused, spend/access classified) | Mechanical | One additive export (`auditedReadOps`) so the generator reads the allowlist from its source instead of copying it |
| Two OPS keys have no caller | `firewall_config_get_version`, `registrar_contact_schema` — no string reference outside `operations.js` (measured over `src/`) | Finding | Surfaced in the gap report as undispatched-table findings; not silently treated as dispatched |
| Sandbox fs/logs bypass the OPS table | `src/vercel/sandbox-binary.js` builds literal URLs for POST `…/fs/read`, POST `…/fs/write`, GET `…/cmd/{cmdId}/logs` | Mechanical | Pinned `dedicated_transport` evidence set in the generator, citing that file |
| Blob files are SDK-only | No snapshot rows for Blob file CRUD; `blobOps()` in `src/vercel/blob.js` wraps `list/head/put/del` of pinned `@vercel/blob@2.8.2`, tools `vercel_blob_list/head/put/delete` | — | Four SDK rows, `source: 'sdk'`, exactly CAP-1's "SDK-only interfaces (including Blob)" scope |
| Snapshot credential evidence | Global security `[]`; every operation declares `security`: 412 × `bearerToken`, 39 × none-required, 0 × `oauth2` (scheme defined, never declared) | — | Per-row credential values are computed from the declaration, never assumed |

## Build contract

**Generated artifacts (committed, check-enforced):**
- `docs/operation-ledger.json` — one row per snapshot operation
  (451) plus the SDK rows (4). Header pins the snapshot file,
  date, SHA-256 and operation count; rows are sorted by
  operation key so regeneration is byte-stable.
- `docs/OPERATION-LEDGER.md` — the generated family gap report:
  per-family disposition counts with the snapshot denominator
  stated (no percentage of anything beyond the pinned snapshot),
  the missing-engineering lists (documented-only reads,
  credential-refused operations), deprecated operations, the
  undispatched-OPS findings, the SDK section, and the named
  undetermined fields below.

**Row fields** (REST rows): `operation`, `method`, `path`,
`version` (path prefix or null), `family` (first snapshot tag),
`tags`, `summary`, `host`, `deprecated`, `credentials`
(`bearerToken`/`oauth2`: `documented` | `not_documented`;
`integrationInstallation`/`resourceSpecific`: `unknown` — see
gaps; `noneRequired` from an empty security declaration),
`scope` (`teamIdQueryParam` from the snapshot; `opsTeamScoped`
where the OPS table pins it), `sideEffects` (`changes` — method
rule with the OPS `readOnly` override; `spends` —
`spendOperation()`; `credentialReturn` — the secret classifiers),
`implementation` (`disposition`, `opsKeys`, `handBuiltTool`,
`dispatchFiles`, `requestValidation`:
`pinned_table` | `universal_at_call` | `none`), `tests`
(`requestShape` mirrors `requestValidation`; `response`:
`not_recorded`), `permissions: 'unknown'`, `ownerUnit: null`,
`liveProof: 'not_recorded'`.

**Dispositions** (precedence top-down, each naming its evidence):
`hand_built` (hand-built map) → `operations_table` (OPS join) →
`dedicated_transport` (sandbox-binary set) → `credential_refused`
(the universal doors refuse credential-returning operations and
no hand-built route exists) → `universal_read_audited` /
`universal_write` (the Batch U doors' own classification) →
`documented_only` (a documented read no audited policy covers
yet — the missing-engineering class).

**Code:**
- `scripts/operation-ledger.mjs` — `buildLedger()`,
  `validateLedger()` (duplicate/orphan/missing-row validation
  per CAP-1's acceptance + drift comparison), `renderGapReport()`.
- `scripts/generate-operation-ledger.mjs` — writes both artifacts.
- `scripts/check-operation-ledger.mjs` — regenerates and compares;
  wired into `npm run check` after the catalog check, the
  repo's existing generated-artifact discipline (check-catalog
  pattern: pure exported functions + CLI main).
- `src/vercel/api-read-policy.js` — one additive export,
  `auditedReadOps`, so the allowlist has one source of truth.
- `tests/unit/operation-ledger.test.js` — builder invariants,
  anchor rows for every disposition, tamper/drift detection.
- No wall-clock date in either artifact: CAP-1's "checked date"
  is the snapshot's own (2026-10-11, in the header); a dated
  artifact could never regenerate byte-identically, which would
  defeat the drift check that makes the ledger trustworthy.

## Named gaps — what the records do not determine (built as recorded unknowns, not invented)

- **Permissions/roles/entitlements per operation** — no repo
  source or snapshot field records them → every row carries
  `permissions: 'unknown'`; a future card with a sourced
  entitlement table can fill them.
- **Owner unit per operation** — the per-batch dossiers are
  prose and TOOL-CATALOG sections are functional families, not
  units → `ownerUnit: null`. (CAP-4 said "using the operation
  ledger"; the handler/tool linkage is the machine-usable part
  and is recorded.)
- **Response tests per operation** — request shapes are
  validated against the snapshot (pinned table / at call), but
  no per-operation response-test record exists →
  `tests.response: 'not_recorded'`.
- **Live proof per operation** — CAP-5's track by design →
  `liveProof: 'not_recorded'` on every row; the gap report
  states source parity only, with its denominator, and claims
  no live parity.
- **Integration-installation credential support per operation** —
  the snapshot's `bearerToken` does not distinguish personal,
  team or installation tokens → `unknown` per row;
  `resourceSpecific` is `unknown` on REST rows and `documented`
  on the SDK rows, whose store read-write token is the route.

## Catalog judgment (drift checklist B)

No tool is added, removed or changed; `src/tools/` is untouched,
so `docs/TOOL-CATALOG.md` is not owed (the docs check's own
rule). The ledger is a docs/scripts artifact surface — a
generated report over the catalog's operation substrate, not a
catalog change.

## Named tests

- `tests/unit/operation-ledger.test.js` (new): census sums to
  451 + 4; unique operation keys and method+path pairs; every
  OPS key resolves (no orphans); every hand-built operationId
  present; anchor rows per disposition; `validateLedger`
  passes a fresh build and fails a tampered one.
- `npm run check` (full gate, exit code read directly) — now
  including the ledger check and `validate-index.py` over the
  CAP-1 entry update.
- Focused neighbors: `tests/unit/api-write-policy.test.js` /
  universal-door suites re-run for the additive export.

## Work-index update (CAP-1, on merge evidence)

CAP-1 → `status: MERGED`, `pr: [<this PR>]`, readiness unchanged
(`WRITE_CARD_AT_START` — `docs/pr-cards/CAP-1.md` does not exist;
the CAP-2/3/4 shape from AUD-BC), plus a V-1-shaped `revisit`
naming what this card discharged (the ledger artifact) and what
remains (nothing of CAP-1's own; live proof is CAP-5's track).
The #337 verdict text in PLAN/MAXIMUM-AUTHORITY is history and
is not rewritten.

## Done when

Both artifacts are generated and committed; the check fails on
a hand-tampered ledger and passes on the tree; `npm run check`
is green; CI (`ci` + `release-policy`) is green at the exact
head; the CAP-1 index entry reads as above; STATUS carries the
bullet. No promotion, no live calls — the ledger rides the
nightly train like every other card.
