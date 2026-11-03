# AUD-CF — Preview fetch failures name their class (branch G, fetch leg)

Filed from branch G's fetch leg on the AUD-CE build
(2026-11-03): seed, bypass and ownership all proven, the
bypass issued and recorded — and the protected fetch of
the seeded preview failed twice with the tool's single
bucketed reason: "Preview fetch failed, redirected or
exceeded its bounded deadline", status null.

## Root cause

The fetch handler collapses every transport failure —
a protection redirect the bypass did not penetrate, a
connection that never opened, a timeout, a malformed
upstream status — into one indistinguishable row. The
two plausible live causes need opposite fixes (bypass
semantics at the edge vs the pinned-IP transport from
the serverless egress), and the tool as built cannot
tell them apart: another fixture-blindness variant, this
time in the tool's own observability. The guarded-write
executor learned this lesson in AUD-H (an outcome_unknown
that names nothing teaches the caller nothing); the
fetch result never did.

## Fix

Each failed fetch row now carries a coarse `failureClass`
— `redirect`, `timeout`, `invalid_status`, or
`connection` — classified from the errors the transport
already produces. Classes only: never an error message,
never a provider body, never the bypass value (the
existing `bypassValueReturned:false` contract is
unchanged). Successful rows are byte-identical to before.

## Acceptance

Unit proof in this PR (the redirect case and a new
dead-connection case pin their classes; both fail with
the fix reverted); full suite and `npm run check` green
locally; CI `ci` + `release-policy` green at the exact
head. Live proof rides the promotion under the owner's
2026-11-03 release-now directive: re-run branch G's
fetch on the seeded run — either it passes, or its named
class convicts the remaining transport defect on
evidence instead of another blind probe. No tool added,
removed or renamed; registry unchanged at 253.
