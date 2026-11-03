# AUD-CA — Branch preview: accept the provider's first-deployment promotion (branch G, third leg)

Filed from AUD-BZ's live proof (2026-11-03, build e94eb638):
with first-deployment settings finally sent, the retained
branch-G fixture's first deployment was created and reached
READY — while `vercel_dev_preview_branch` reported
`outcome_unknown` with failure `{code:
"response_shape_unverified", leg: "deployments_create"}` and
recorded nothing in the run.

## Root cause (convicted from the live response)

The provider PROMOTES a project's first deployment to target
production. The create response (and read-back) therefore
carries `target: "production"`, but the tool's create verifier
demanded `target === 'preview'` as part of attesting the
response — so it threw, the executor shaped the successful
create as outcome_unknown, and the `record()` call after it
never ran: a live, READY, authentication-protected deployment
orphaned from its run, invisible to the alias/bypass/cleanup
legs that read the run's recorded objects.

`vercel_deploy_create_from_files` settled this exact shape in
AUD-N: no target arm in the create verifier — identity only —
with verify() reporting the target honestly (a promoted first
deployment surfaces applied with confirmed:false, never
outcome_unknown). The branch tool never received the same
settlement.

## Fix

- The create verifier attests identity only (deployment id
  shape + project match), mirroring AUD-N; the deployment is
  recorded in the run as before.
- verify()'s read-back target check uses the shared
  `deploymentTargetMatches` (src/vercel/deployment-target.js),
  which states the documented encoding once: a preview
  read-back carries target null (or 'preview'); a promoted
  first deployment carries 'production' and honestly confirms
  false — the AUD-AL posture — while staying recorded.

## Fixture gap, named

The dev-preview suite modeled every create response with
target 'preview'. The new case models the live shape (create
response and read-back both target 'production') and pins:
applied, confirmed:false, deployment recorded in the run.
Negative control: with the fix reverted, exactly that case
fails (outcome_unknown, nothing recorded).

## Acceptance

Unit proof in this PR (dev-preview suite 20 tests); full suite
and `npm run check` green locally; CI `ci` + `release-policy`
green at the exact head. Live proof rides the promotion under
the owner's 2026-11-03 release-now directive: branch G run
end-to-end on the fixed build against the retained fixture
(preview → alias → bypass → fetch → cleanup → fixture
deleted, earlier runs dispositioned). No tool added, removed
or renamed; registry unchanged at 253.
