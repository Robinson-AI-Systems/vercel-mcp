# AUD-D — Stored-result symmetry: writes and previews get the stored-handle fallback (D-D)

Status: APPROVED — audit pipeline S5 packet (filed 2026-10-27). Design: `docs/designs/BATCH-C.md`, 2026-10-27 amendment **D-D**. Audit: VMCP-008, VMCP-010, VMCP-011 in `docs/MCP-AUDIT-2026-10-27.md`. Registered as a revisit on card C-1 (the result-shaping owner).
Baseline inspected: main `1f7859ce0dc3dda35f6298106c7e4d6635c8465b`. Prerequisites: C-1 MERGED; sequence after AUD-A2 (shared `src/core/write-preflight.js` seam — see Done when). Migration: none (the result store exists). Subsection mapping: behavior completion inside the predefined C-1 subsection under the D-D amendment — not a new batch subsection, no new acceptance unit. Workload: medium (result pipeline + preflight).

## Read only these
- `docs/designs/BATCH-C.md`: the D-D amendment in full; C1–C5 (the shaping contract).
- `src/vercel/result-delivery.js` (whole file): `shapeMcpResult` stores oversized **read** results via `db.putResult` and returns a `res_…` handle; the write branch (`if (!readOnly)`) bypasses storage and calls `shape()` directly.
- `src/core/write-preflight.js`: `safeShape` re-shapes the preview and **throws** above 8,192 bytes → the top-level refusal “Could not safely preview or classify the change” (~line 39).
- `src/tools/globalconfig-common.js`: `output()` (line ~9) applies `compact(x)` directly, bypassing the shared delivery path.
- `src/db.js`: `putResult` / result-store accessors as used by `result-delivery.js`.
- `src/tools/server.js`: `vercel_get_result` (the fetch door — expect no change; verify it is shape-agnostic).
- Tests: `tests/unit/result-delivery.test.js`, `tests/unit/result-shape.test.js`, `tests/unit/result-rules.test.js`, `tests/db/result-store.test.js`, `tests/helpers/write-contract.js`.

## Drift check A
| Expected (design) | Actual at baseline | Consequence |
|---|---|---|
| Symmetry: any oversized result is stored + handled, read or write | Executed audit probe: an oversized guarded **write** threw `RangeError` *after* the provider write landed; reads store fine | The write branch gains the same stored fallback; the receipt + handle shape is the contract |
| The 8 KB preview ceiling bounds display, not existence | `safeShape`'s throw refuses the whole change at preview time | Previews store + reference instead of refusing; secret-stripping stays a hard refusal |
| Every tool family flows through the shared shaping path | `globalconfig-common.js` `output()` self-shapes with `compact()` | That family (and any sibling found) routes through the shared delivery; the packet names the grep that proves none remain |

## Scope
**In:** the write branch of `shapeMcpResult` (store oversized write results; return the verified receipt + handle); `write-preflight` stored previews (preview reference instead of refusal when shaping succeeds but exceeds the display bound); routing self-shaped families through `shapeMcpResult`; tests reproducing the audit's three executed probes.
**Out (non-goals):** raising or removing the 8 KB display bound; changing what verification means (the write executor's read-back `verify()` is upstream and untouched); result-store retention/TTL changes; new fetch tooling (`vercel_get_result` already serves handles); compact/catalog membership (AUD-C).

## Build contract
- `src/vercel/result-delivery.js`: when a write result exceeds `MAX_INLINE`, store it exactly as the read branch does (`db.putResult` with handle, `expiresAt`, count, preview) and return `{ ...receipt, resultHandle: 'res_…', note: … }` where `receipt` is the write's own verified summary (tool, target, change-log id) — never the raw oversized payload. A storage failure on this path returns the executor's `outcome_unknown` honesty shape, not a throw after dispatch.
- `src/core/write-preflight.js`: `safeShape` distinguishes *cannot shape safely* (secret-bearing or unshapable → today's refusal, unchanged) from *shaped but large* (store the shaped preview via the result store and return its reference in the preview result). The 8,192-byte constant stays as the inline display bound.
- `src/tools/globalconfig-common.js`: `output()` delegates to the shared delivery path used by other families (same arguments the family's handlers already produce); audit the repo for other direct `compact(` result paths in `src/tools/` and route or explicitly justify each in the PR.
- No change to read-path behavior: existing stored-read tests pass unmodified.

## Ordered steps
1. Write-branch stored fallback + receipt shape; unit tests in `result-delivery.test.js` mirroring the read tests.
2. Preflight stored preview; preflight/write-contract tests.
3. globalconfig routing + the repo-wide grep proof in the PR body.
4. Full gates (below).

## Acceptance (design D-D, verbatim — the audit's executed probes as tests)
- The oversized-write probe (synthetic guarded write whose result exceeds the cap, provider fake records the call) returns a verified receipt plus a `res_…` handle instead of throwing; `vercel_get_result` on the handle returns the full stored result.
- A change whose *preview* exceeds 8 KB completes preview with a stored preview reference instead of the “Could not safely preview” refusal; a preview containing a secret-shaped value still refuses.
- A globalconfig read/write with oversized output returns the same stored-handle contract as every other family.
- Plus: no regression in `tests/unit/result-*.test.js`, `tests/db/result-store.test.js`, or the write-contract suites; `npm run check` green.

## Builder guardrails (binding, restated)
- Builders spend $0; provider fakes only; no live writes outside the X-2 scratch rules (IN-06); fake secrets only (`vcp_FAKE…`) — including in oversized-payload fixtures, which must use fake bulk, never copied real payloads.
- Never fix an oversized-result failure by truncating silently or by raising the cap: storage + handle is the designed answer (BATCH-C C1).
- Do not weaken the executor's verify/read-back or the `outcome_unknown` contract to make the write path simpler.
- If code contradicts this packet or D-D, stop and file a dated design amendment; do not improvise a new rule.

## Stop and ask
- A tool family whose results cannot pass through the shared path without changing its public result shape for *inline-sized* results: stop for that family, record it, ship the rest.
- The result store cannot accept write-sized payloads within its existing limits: stop — that is a storage-design question for a dated amendment, not a silent cap raise.

## Done when
- Acceptance above is green with `npm run check`, `npm test`, `npm run test:db` for the result-store suite, and exact-head `ci` + `release-policy`.
- STATUS, this card and the C-1 index revisit are reconciled in the implementing PR. Sequencing: AUD-A2 also edits `src/core/write-preflight.js` (purchase branch); land AUD-A2 first and rebase this packet onto it — one writer at a time on that file. VMCP-008/010/011 close only at S7.

## Implementation evidence (S6, 2026-10-28)

- Drift check re-run against current main `eecda92` (all sibling packets merged: AUD-C #228, AUD-F #229, AUD-A1 #230, AUD-B #232, AUD-E #233, AUD-A2 #234 + corrections #235/#236; zero open PRs): the packet's table holds in full. AUD-A2's write-preflight additions (`isOwnerConnection`, `purchaseDisclosure`, the purchase branch) are disjoint from `safeShape`. `db.putResult`'s existing 1 MB cap accepts write-sized payloads, so the storage stop-and-ask did not trigger; `vercel_get_result` verified shape-agnostic, unchanged. Measured baseline at `eecda92`: `npm run check` green; unit suite 1010 passed / 0 failed across 116 files.
- Write branch (`src/vercel/result-delivery.js`): `shapeStoredWriteResult` tries the normal presentation; on `RangeError` only, it stores each text part's parsed body via `db.putResult` (account + `connection.resultOwner`, summary `"<tool>: N saved record(s)"`) and returns the verified receipt — `status`/`confirmed`/`mode`/`requestKey` from the write's own result (the requestKey is the change-log lookup key), a `targets` summary only when its JSON fits 500 bytes, `tool`, `resultHandle`, `expiresAt`, `count`, and the note naming `vercel_get_result`. A missing store or a `putResult` failure returns the executor's `outcome_unknown` shape (confirmed: null) instead of throwing; non-`RangeError` shaping failures still throw, exactly as on the read branch. Read-path behavior is byte-for-byte unchanged (its tests pass unmodified).
- Previews/targets (`src/core/write-preflight.js`, `src/core/write.js`): new exported `safeShapeStored(ctx, value, label)` — shapes through `ctx.shape` + `compact` at the store's 1 MB cap (a size-only `RangeError` from the shaper is re-shaped at that cap, because the real write contexts use `compact` itself as the shaper); returns the value when it fits 8,192 bytes; stores and returns the read path's stored-receipt shape when it does not; throws the original `safeShape` error when unshapable or when no usable store is on the context. `writePreflight` uses it for the preview summary; the executor's audit base uses it for `targets`. `safeShape` itself, `verify()`, and the replay 8 KB bound are untouched.
- Globalconfig (`src/tools/globalconfig-common.js`, `src/tools/globalconfig-schema.js`): `output()`, the `safeItems` per-item shape, and the nested schema-definition shape now use `compact(x, RESULT_STORE_CAP)` (1 MB, exported from globalconfig-common) so the shared delivery path — not the handler — decides inline vs stored. Grep proof (run 2026-10-28 over `src/tools/`): the only remaining direct `compact(` result shapes are the guarded-write output functions (e.g. `globalconfig-tokens.js` revoke output) over executor results already bounded by `safeShape`, and the `shape: compact` context fields that feed `safeShape`/`safeShapeStored` — both justified in the PR body.
- Tests: 16 new — `tests/unit/result-delivery.test.js` (+5: oversized write receipt + handle with intact stored body; the audit's 300-record probe payload paged via `vercel_get_result`, same bearer only; storage-failure and no-store `outcome_unknown`; small write inline/unstored; production-banner receipt), new `tests/unit/write-stored-preview.test.js` (7: oversized preview dry-run + confirmed apply with stored references, oversized targets referenced in the audit row, cyclic preview refusal, throwing preview refusal, no-store refusal preserved, small preview unchanged), new `tests/unit/globalconfig-delivery.test.js` (4: `output()` oversized no-throw, stored-handle contract with same-bearer fetch/other-bearer refusal, byte-identical inline output, credential redaction at the store cap). No existing expectation changed.
- Verification (local, this branch): `npm run check` green; full unit suite **1026 passed / 0 failed across 118 files** (1010 baseline + 16 new / +2 files). The db result-store suite could not run locally (no local Postgres in the build VM; the repo's `test:db` script defers to CI) — no db code or store schema changed, so the CI db job is that leg's proof. Guardrails honored: fakes only, fake secrets only (`vcp_FAKE…` in fixtures), no live writes, $0 spent, rtc-scratch untouched. **VMCP-008/010/011 close only at S7 live verification.**
