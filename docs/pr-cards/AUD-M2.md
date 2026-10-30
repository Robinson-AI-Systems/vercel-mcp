# AUD-M2 — Shape-gate refusal fingerprints + gate-necessity audit (VMCP-026 / A-1 follow-up)

**Naming:** this implements the audit pipeline's **AUD-M (proposed)** card (filed 2026-10-30 in the audit goal workspace after the AUD-K2 live closure re-run). It is filed in-repo as AUD-M2 because `docs/pr-cards/AUD-M.md` is already the VMCP-023/027 lifecycle-shapes card; nothing about that card changes here.

**Baseline inspected:** main `a5978eb` (AUD-Z). Predecessor: AUD-K2 (#277, the installation-aware probe this card makes diagnosable).

**Conviction (live, 2026-10-30 closure re-run).** AUD-K2's probe advanced the A-1 failure exactly one layer: the configuration READ now succeeds and the refusal is the probe's own shape gate — "Vercel answered the installation check in an unexpected shape" — but nothing the server keeps says WHICH predicate failed, so the live payload's disagreement with the documented variants could not be convicted from outside. Guessing the field would be the speculative-fix cycle the research-first rule exists to kill. Two defects, one root: the gates record no fingerprint of what they refused, and at least one hard predicate (`config.userId`) was never audited against its consumer.

## The fingerprint mechanism (the deliverable's core)

When `probeInstallationToken`'s shape gate refuses (`probeLeg: 'configuration'`), when the integration comparison is reached and fails (`'configuration_integration'`), and when the install-exchange validator refuses (`exchange_malformed`, including a non-JSON answer), the thrown error carries a **redacted fingerprint**: the NAMES of the failed predicates, the received object's field-name → JSON-type map (type words only: string/number/boolean/array/object/null/absent — an array carrying non-string elements names them, e.g. `array<number>`), and, for the probe, the integration-comparison outcome (`integrationIdMatch` as a failed-predicate name; `not-reached` in the fingerprint object when the gate fires first). **Never values** — id-shaped fields appear only as predicate outcomes and type words. Tests assert no fixture value string appears anywhere in a fingerprint.

**Recording + retrieval.** `handleIntegrationCallback` journals the fingerprint's one-line summary into the existing **change_log** via `db.recordChange` (tool name `vercel_integration_install`, dryRun false so it is visible by default), under the install's own account key: the exchanged team id for enrollment refusals; for exchange refusals, the redirect's team id when id-shaped, else the fixed key `integration-install`. The summary is laid out for the journal read's 160-char bound — failed predicate names first (truncation can never reach the conviction), then the type map with failed fields' types ahead of the rest. **Retrieval path:** the operator's existing connector → **`vercel_recent_changes`** on the account the install targeted (for the A-1 re-run, the authoring team — the operator seat's own account) shows the row; no new tool, no new read surface, no account-row requirement (change_log carries no FK, so a refusal for a not-yet-enrolled team is still recorded under its key). Journaling is best-effort — a journal failure never changes the install outcome or the page. The install result page is deliberately unchanged: the journal exists, so the fallback of printing predicate names to the installer was not needed (the AUD-M card's condition for that fallback).

## Gate-necessity audit (every predicate cites its consumer)

Configuration gate (`probeInstallationToken`):
- **id** — STAYS HARD. Consumed by the identity step: the record must be the very installation the exchange named (and the id stored for recheck's rebuild).
- **type** — STAYS HARD, decided with reasons: `type` is the resource-kind discriminator of the very endpoint the proof trusts; it vouches for the documented MEANING of every other consumed field (ownerId, teamId, scopes). A wrong or absent type leaves those fields' semantics unproven — unlike userId, it is not a value the proof merely reports, it is what makes the reported values mean what the proof assumes. Demoting it would let a differently-shaped resource pass on field-name coincidence.
- **integrationId** — STAYS HARD. Consumed by the immediate next check (this integration vs the configured client id).
- **teamId** (string-or-null) — STAYS HARD as a shape predicate. Consumed by the team check; null is its documented personal shape and is refused THERE as a team mismatch, never as a shape failure.
- **ownerId** — STAYS HARD. Consumed by the team check (`ownerId === teamId`).
- **scopes** (array of strings) — STAYS HARD. Consumed by scope derivation (`grantedScopes`, project limitation).
- **userId** — MOVED TO EVIDENCE. Its only consumer was the informational `installerMatchesConfiguration` flag. Absent or mistyped no longer refuses; the evidence records `null` unless both sides are strings (never a false mismatch).

Exchange validator (`exchangeInstallCode`):
- **access_token** — STAYS HARD. It is the credential handed to the store path.
- **token_type** (`Bearer`) — STAYS HARD, decided with reasons: the exchange answer is DEFINED as a Bearer-token response and the store path uses the value as one; a different grant type would be silently misused as a bearer credential. It guards a real misuse, no live evidence implicates it, and unlike user_id it has no evidence channel to demote to (the exchange result carries nothing downstream that could record it).
- **installation_id** (`icfg_` shape) — STAYS HARD. The probe's input and the stored identity recheck rebuilds from.
- **team_id** (null or non-empty string) — STAYS HARD. It is the routing branch itself (personal vs team).
- **user_id** — SPLIT. Hard when `team_id` is null: the personal-install proof is user-keyed (the identity cross-check consumes it). Evidence-only on a team install (its sole consumer there is the probe's installer evidence): absent/mistyped demotes to a null `userId`, enrollment proceeds, and the stored probe record shows `installerUserId: null` / `installerMatchesConfiguration: null`.

## Fakes and fixtures

The remodelled configuration fixture gains two evidence variants — `userId` **absent** and `userId` **mistyped** (42) — both proving the gate now passes a provable install end-to-end (enrollment succeeds; evidence flag null). Both FAIL against the pre-fix gate (verified with the source changes stashed: 1 failed each) and pass with the fix — the defect conviction. Refusal fixtures for genuinely unprovable shapes stand unchanged (wrong id/integration/team, removed/disabled configuration, malformed scopes) and gain fingerprint assertions: failed-predicate names present, the type map exact, and no fixture value anywhere in the fingerprint. New callback tests prove the journal row lands (account key, tool name, summary content and bound, no values), that an exchange refusal journals under the redirect team key, and that a successful install journals nothing.

## Boundaries

No behavior change beyond the above: scope derivation, storage shapes, IN-18 message meanings, and the user-facing refusal text are byte-identical; the demoted predicates are the only refusals removed. No tool surface changes — **TOOL-CATALOG: no note required and none taken** (no tool added, removed, or re-shaped; the fingerprint rides the existing `vercel_recent_changes` read and the change_log's tool-name field, the setup-page precedent). No `src/core/` change; no SQL change (change_log already carries the row shape; migrations none).

**Acceptance.** Unit-proven in this packet (below). Live closure rides the next bundled release: ONE Door-1 re-run by the coordinator — if it enrolls, A-1 closes and the fingerprint stands as the drift alarm; if it refuses, `vercel_recent_changes` on the authoring team names the failed predicate and the follow-up fix is a spec exercise.

**Status.** Built 2026-10-30 (this PR). Rides the nightly promotion per the owner's batching rule; the coordinator's standing release latitude (2026-10-30) permits release once merged.
