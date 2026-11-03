# AUD-CE — Bypass isolation proof stops counting the scratch project's own surface as live traffic (branch G, seventh leg)

Filed from branch G's bypass leg on the AUD-CD build
(2026-11-03): the seeded run was in place, AUD-CD had
landed, and the bypass plan still refused — "Protection
bypass is unsafe on a project with any live or unknown
traffic."

## Root cause (convicted from the live read-backs)

Two arms of the isolation proof counted the scratch
project's own fixture surface as live traffic:

- **Domains.** The provider assigns every project its own
  `.vercel.app` domain at creation. The seeded project's
  domain list (read live) contains exactly that
  auto-assigned domain — so the proof's "any domain
  disqualifies" arm fires on every real project ever
  seeded. The suite modeled the domain list empty.
- **Production designation.** The project record
  designates the promoted seed deployment as the project's
  production deployment (AUD-CD's promotion). The proof's
  "any production designation disqualifies" arm counted
  the run's own fixture as a live deployment.

Neither arm could ever pass live; the bypass leg of the
preview workflow was unreachable on a real seeded project.

## Fix

Both arms now apply the same equivalence AUD-CD settled:
the run's own fixture is not live traffic.

- A production designation disqualifies only when it is
  present and does not identify one of the run's recorded
  deployments (an unidentifiable designation still
  disqualifies — fail closed as before).
- A domain disqualifies only when it is not the project's
  own auto-assigned domain: a `vercel.app` apex, no git
  branch, its stem a prefix of the project name (the
  provider truncates long project names into the stem),
  and scoped to this project when the row carries a
  project id. A custom domain, a branch domain, or a
  foreign vercel.app name still disqualifies.

No other arm changes: naming, inventory completeness, the
AUD-CD deployment judgment, and the refusal text are
untouched.

## Fixture gap, named

The bypass suite modeled an empty domain list and no
production designation — shapes no seeded project has.
Remodeled to the live shapes (auto-assigned truncated
domain present; designation pointing at the run's own
deployment), plus a new refusal case pinning both
directions (a custom domain refuses; a designation
pointing outside the run refuses). Negative control: with
the fix reverted, the positive bypass test fails.

## Acceptance

Unit proof in this PR; full suite and `npm run check` green
locally; CI `ci` + `release-policy` green at the exact
head. Live proof rides the promotion under the owner's
2026-11-03 release-now directive: branch G completed —
bypass issued on the seeded run, the protected preview
fetched through it, both runs cleaned up, the retained
fixture deleted, and the earlier runs dispositioned on
the record, as VMCP-016 recorded. No tool added, removed
or renamed; registry unchanged at 253.
