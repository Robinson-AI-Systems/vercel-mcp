# AUD-CC — Preview target judgments use the documented encoding (branch G, fifth leg)

Filed from branch G's continuation on the AUD-CB build
(2026-11-03): the branch preview finally applied and
confirmed (deployment READY, recorded in its run), and the
alias leg then refused it — "Only a READY, owner-scoped
preview deployment can be aliased."

## Root cause (convicted from the live read-back)

The deployment's provider read-back carries `target: null` —
the documented encoding ("null indicates a preview
deployment", stated in this repo's own AUD-H materials).
Four judgment points in the dev workflow still demanded the
literal `target === 'preview'` on provider read-backs, so
every real preview failed them:

- `vercel_dev_alias_preview`'s deployment proof (the live
  refusal above);
- `vercel_dev_create_bypass`'s isolation proof, which
  counted the run's own null-target preview as disqualifying
  traffic;
- the shared owned-deployment proof behind
  `vercel_dev_fetch_preview` (dev-observe-common);
- the integration surface's alias-routing verification,
  which could only ever report a real preview domain
  "unverified".

AUD-CA fixed the same judgment in the branch tool's
verify() through the shared `deploymentTargetMatches`
(src/vercel/deployment-target.js), which states the
encoding once; deployment-cancel and deployment-delete
already accept null-or-preview explicitly. These four
points were the remaining literal demands on provider
read-backs in the dev path. (dev-runs.js's `target` field
is a stored run record, not a provider read-back, and is
unchanged.)

## Fix

All four points judge through `deploymentTargetMatches`
(null or 'preview' confirms a preview; anything else does
not). No rule is weakened: a production or staging
read-back still refuses at every point; the bypass
isolation proof still refuses on any non-preview
deployment in the inventory.

## Fixture gap, named

The suites modeled deployment read-backs with the literal
target 'preview' — a shape the provider does not send for
previews. Remodeled to the documented null encoding at the
alias plan, the alias assign, the bypass isolation
inventory, and the fetch fixture. Negative control: with
the fix reverted, the remodeled tests fail across all four
surfaces (alias, bypass, fetch, integration verification).

## Acceptance

Unit proof in this PR; full suite and `npm run check` green
locally; CI `ci` + `release-policy` green at the exact
head. Live proof rides the promotion under the owner's
2026-11-03 release-now directive: branch G end-to-end —
seed a fresh isolated run, then preview → alias → bypass →
fetch → cleanup on it; the retained fixture and its earlier
runs are dispositioned on the record and the fixture
project deleted, as VMCP-016 recorded. No tool added,
removed or renamed; registry unchanged at 253.
