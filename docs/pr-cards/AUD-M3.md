# AUD-M3 — The configuration `type` predicate becomes conditional evidence (VMCP-026 / A-1, fingerprint-convicted follow-up to AUD-M2)

**Baseline inspected:** main `f802d00` (AUD-M2, #280). Predecessor: AUD-M2 (shape-gate refusal fingerprints + gate-necessity audit).

**Conviction (live, 2026-10-30 ~07:04 MDT).** AUD-M2 shipped in the owner-ordered daytime release (live `f802d00`, production deployment READY at that head) and the coordinator ran the single Door-1 closure install once. It refused again at the installation probe's shape gate — and this time the journal AUD-M2 built named the exact field. The redacted fingerprint, verbatim from the `vercel_integration_install` change_log row the operator read back through `vercel_recent_changes`:

```
SHAPE-FP configuration failed=[type] types: type:absent id:string integrationId:string teamId:string ownerId:string userId:string scopes:array
```

The LIVE configuration record **omits `type` entirely**; every other gate field is present and correctly typed. The vendored OpenAPI snapshot lists `type` (enum `integration-configuration`) in all three documented response variants — the live API disagrees with its own documentation. AUD-M2's necessity audit kept `type` hard as the resource-kind discriminator that "vouches for the documented meaning of every other consumed field"; the live record refutes the premise. The proof's identity leg already rests on three legs that do not involve `type`: (a) the configuration is read **by the exchange's own `installation_id`**, (b) `config.id === installationId`, (c) `config.integrationId` must equal the integration's configured client identity. A discriminator field the provider does not send cannot vouch for anything; keeping it hard refuses every genuine install, forever, on a field that carries no proof weight. (The callback's live configuration id is deliberately NOT recorded here — real ids never enter tracked files; the fingerprint carries no values by design, which is what makes it safe to file verbatim.)

## The fix

In `probeInstallationToken` (`src/vercel/tokens.js`) the `type` predicate leaves the outright hard gate and becomes **conditional**:

- **Absent** (`undefined`) → the proof proceeds. The live shape.
- **Present** → must equal `'integration-configuration'`. A present-but-wrong value (any other string, `null`, a mistyped value) means the record is a different resource kind than the endpoint promised, and the refusal stands: same probe leg (`configuration`), same IN-18 message, and the fingerprint still journals `failed=[type]` — the AUD-M2 content tests for a type refusal keep passing.

**Evidence slot.** The outcome is recorded as `configurationType` — `'integration-configuration'` when the field is present, `'absent'` when it is not — on the probe's returned `installation` record, persisted by `storeInstallationToken` into the stored probe record beside `configurationStatus` and `installerMatchesConfiguration`. That is the slot family every other configuration-derived posture already rides (status, project selection, granted scopes, installer match), so enrollment read-backs and recheck rebuilds see one consistent evidence shape; a dedicated new field on the account row would have duplicated what the probe record already carries.

## Other-consumer verification (the fix covers every path)

- A tree-wide search for readers of the configuration's `type` across `src/` finds exactly one: the gate predicate itself. `installationLabel` reads only the team read; `storeInstallationToken` reads only the probe result's derived fields. Nothing else consumes `config.type`.
- **Recheck:** `recheckStoredToken` routes integration-sourced team rows through this same `probeInstallationToken` (its identity inputs rebuilt from the stored installation id + configured client id), so the one predicate change covers the recheck path identically — no second fix, verified by the standing recheck test now running against the type-absent canonical fixture.
- **Exchange validator:** `exchangeInstallCode` (`src/vercel/integration.js`) validates `body`, `access_token`, `token_type`, `installation_id`, `user_id`, `team_id` — it has **no** configuration `type` predicate (verified by reading the validator). Confirmed and left untouched.

## Fixtures — remodelled from the live record

Per the research-first rule (spec PLUS live-captured shape), the canonical team-install configuration fixture in `tests/unit/integration-install.test.js` is remodelled to the fingerprinted live shape: `type` **absent**, the other gate fields present as fingerprinted. Every happy-path enrollment, callback and recheck test now exercises the live shape. Kept variants:

- **type-present-correct** — enrolls; evidence records `'integration-configuration'`.
- **type-present-wrong** — refuses (leg `configuration`, fingerprint `failed=[type]`, no value anywhere in the fingerprint).
- **type-null** — refuses as shape (present, not the documented kind).
- AUD-M2's **userId-absent / userId-mistyped** fixtures stand unchanged and still enroll with evidence null.
- The AUD-M2 fingerprint-content test (scopes/teamId broken) keeps its exact original type map: its override now names the documented `type` explicitly, since the canonical fixture no longer carries it — that test models the full documented-shape record, and its assertions are byte-identical.

**Defect conviction.** With only `src/vercel/tokens.js` stashed (pre-fix gate) against the remodelled fixtures, the focused file fails **24 of 45** — every enrollment through the live shape refuses at the gate, and the run's own fingerprint line reproduces the live conviction (`failed=[type,scopes] types: type:absent …`); the AUD-M3 type-present test also fails pre-fix on the missing `configurationType` evidence. The present-but-wrong and null-type refusal tests pass on both trees (unchanged behavior). With the fix: **45/45** in the focused file.

## Boundaries

No behavior change beyond the one predicate: scope derivation, storage shapes (one additive evidence field on the probe record), IN-18 message text, and every other gate predicate are byte-identical. **TOOL-CATALOG: no note required and none taken** — no tool added, removed, or re-shaped; the change is inside the enrollment probe. No `src/core/` change; no SQL change; no release-policy or promotion-machinery change.

**Acceptance.** Unit-proven in this packet. Live closure is the coordinator's single Door-1 re-run after the 2026-10-31 00:01 promotion carries this build: enrollment on the authoring team closes A-1; a further refusal would journal its own fingerprint and name the next field.

**Status.** Built 2026-10-30 (this PR). Rides the 2026-10-31 00:01 scheduled promotion with the rest of the train; no daytime release is requested for it.
