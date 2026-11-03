# AUD-BZ — First-deployment proof from the deployment inventory (AUD-BS live failure)

Filed from AUD-BS's live re-proof (2026-11-03, after PR #411
promoted): branch G's confirm against the retained fixture still
answered `outcome_unknown` with failure `{code:
"missing_project_settings", leg: "deployments_create",
failureClass: "http_status", status: 400}` — on a fresh run as
well as the retained one. The AUD-BS fix never fired live.

## Root cause (convicted from the live record)

AUD-BS keys the first-deployment decision on the project record's
documented `hasDeployments` flag being exactly `false`. The live
record for the retained fixture (`rtc-git-fixture`,
the retained fixture project) does not carry the flag at all —
this server's own project read-back shapes it null, with the
code's own comment: "The Vercel SDK/project body may omit these
fields; null is unknown." So `row?.hasDeployments===false` is
false, the create body omits `projectSettings`, and the provider
refuses exactly as before the fix. The AUD-BS unit tests modeled
the record WITH the flag present — the fixture-blindness class
again: the modeled record was not the live record.

## Fix

One shared proof, stated once in `src/vercel/project-settings.js`
beside the shape it gates:

- `isFirstDeployment(client, projectId, row)` — the flag answers
  when present (`false` → first, `true` → not). When the flag is
  absent, the proof comes from the provider's own deployment
  inventory (`deployments_list`, limit 1): empty list → first
  deployment; non-empty → not. An inventory that cannot be read
  proves nothing and throws — guessing either way re-creates one
  of the two convicted 400s (missing settings on a first create,
  or the AUD-AD resend refusal on a deployed project).
- Both create routes that keyed on the flag alone now use it:
  `vercel_dev_preview_branch` (AUD-BS's subject) and
  `vercel_deploy_create_from_files` (AUD-AD's route, same latent
  defect — its flag-absent behavior was a pinned "treat as
  deployed", which is the wrong answer for a genuinely new
  project whose record omits the flag).

## Fixture gap, named

Both suites' fakes modeled the flag as always present. The
remodeled fakes now include the live shape — a record with NO
`hasDeployments` key — in both directions: flag-absent with an
empty inventory (settings sent; the branch-G fixture's exact
shape) and flag-absent with a non-empty inventory (no resend).
The files-create behavior fake's provider simulation now derives
"first" from the flag OR the empty inventory, matching the
documented provider rule. Negative control: with the fix
reverted, exactly the two flag-absent/empty-inventory cases fail
(one per route); the non-empty cases pass both ways, pinning
unchanged behavior.

## Acceptance

Unit proof in this PR (dev-preview suite 19 tests, files-create
suite 36 tests); full suite and `npm run check` green locally;
CI `ci` + `release-policy` green at the exact head. Live proof
rides the promotion that carries this fix, per the owner's
2026-11-03 release-now directive: branch G end-to-end against
the retained fixture and retained run (preview → alias → bypass
→ fetch → cleanup → fixture deleted, run
run_20261101_vmcp016g dispositioned). No tool added, removed or
renamed; registry unchanged at 253.
