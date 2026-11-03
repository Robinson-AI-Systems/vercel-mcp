# AUD-CD — A run's own promoted first deployment is its preview (branch G, sixth leg)

Filed from branch G's seeded run on the AUD-CC build
(2026-11-03): the seed applied and confirmed, recording its
project and deployment — and the alias leg refused the
seed deployment itself.

## Root cause (convicted from the live read-backs)

The provider promotes a project's first deployment to
production — for the seed's files deployment exactly as for
the branch route's git deployment. The seeded deployment's
read-back therefore carries `target: 'production'`, and
even AUD-CC's documented-encoding judgments (null or
'preview') refuse it. The bypass isolation proof counts it
as disqualifying live traffic for the same reason, and the
fetch/integration judgments fail identically.

The codebase already states the governing equivalence, in
the seed's own verify (src/tools/dev-runs.js): "The
provider promotes a project's first deployment to
production, so the fixture confirms on the promoted target
too — identity rides on the id, the run meta and the run's
own recorded objects." A deployment this run authored —
recorded active in the run and stamped with the run's
`rtc_run` meta when the read-back shape carries meta — is
the run's preview fixture, whatever target the provider
promoted it to. The alias, bypass, fetch and integration
judgments never adopted that rule.

## Fix

The four judgments accept a production target only under
the seed verify's exact conditions: the deployment is
recorded active in this run (proven by each caller as
before) and its meta names this run when the shape carries
meta. Everything else is unchanged:

- alias deployment proof and the shared owned-deployment
  proof behind fetch: preview encoding OR run-authored
  promotion;
- bypass isolation proof: a production deployment counts
  as safe only when its id is among the run's recorded
  deployments and its meta names this run; any other
  non-preview deployment still disqualifies the project,
  and the production-designation, domain and naming arms
  are untouched;
- integration alias verification: the same equivalence, so
  a run's own promoted deployment verifies instead of
  reporting unverified forever.

A production deployment this run did not author — another
run's meta, or one not recorded in the run — still refuses
at every point.

## Fixture gap, named

The suites modeled the seed/observe deployment read-back
as a plain preview. Remodeled to the live shape —
`target: 'production'` with the run's meta — at the
observe fixture (which now exercises the promoted clause
across the whole observe suite), the bypass isolation
inventory, and a new alias case that pins both directions
(own meta plans; another run's meta refuses). Negative
control: with the fix reverted, the remodeled tests fail
across the surfaces.

## Acceptance

Unit proof in this PR; full suite and `npm run check` green
locally; CI `ci` + `release-policy` green at the exact
head. Live proof rides the promotion under the owner's
2026-11-03 release-now directive: branch G completed on
the seeded run — alias, bypass, fetch, cleanup — then the
retained fixture and the earlier runs dispositioned on the
record and the fixture project deleted, as VMCP-016
recorded. No tool added, removed or renamed; registry
unchanged at 253.
