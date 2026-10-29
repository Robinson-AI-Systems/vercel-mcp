# AUD-L — Deployment create: accept the documented in-progress response shape (VMCP-023, third delta)

Status: IMPLEMENTED 2026-10-28 (branch `ai/vivienne/aud-l-shape-list-legs`, base main `ed19e4c`) — VMCP-023 stays **open** until the re-probe passes live after release.

**Why this card exists:** the VMCP-023 closure re-probe ran live on the released AUD-J+AUD-K build (2026-10-28). The `missing_project_settings` 400 is gone — AUD-J's fix works at the request leg — and the failure moved to the create's response verification: `outcome_unknown` with failure detail `{"code": "response_shape_unverified", "leg": "deployments_create", "failureClass": "shape"}`. Read-back of the seed's project then showed `hasDeployments: true`: **the deployment was created at the provider; the tool rejected its own success.**

## Diagnosis (proven from the vendored OpenAPI snapshot)

`POST /v13/deployments`' documented 200 response is a `oneOf` of two shapes:

- the **full deployment object** (94 properties, incl. `projectId`) — the completed shape, identical in kind to a `deployments_get` response;
- an **in-progress shape** (10 properties; required: `aliasAssigned`, `duration`, `id`, `readyState`) returned while the deployment is still building — it carries `id` and `target` but **no `projectId`**, by design.

All three create tools — `vercel_dev_seed`, `vercel_deploy_create_from_files`, `vercel_deploy_create_from_git` — demand `row.projectId === <project id>` inside the create's `shapeResult`, so any create answered with the in-progress shape throws `response_shape_unverified` after the provider has done the work. That is the deterministic live behavior for file/git deploys that build asynchronously — which is to say, for real ones. The unit fakes model the create response on the full shape only (fixture blindness, sixth instance in this finding's family).

## Scope

**In:**
- The three create `shapeResult`s (dev-runs seed, deployment-file-create, deployment-git-create): `projectId` must match the expected project **when the response carries it**; when it is absent (the documented in-progress shape), the result rests on the deployment `id` pattern and the target match, both of which the in-progress shape does carry. No other check changes.
- **The proof is not weakened:** every one of the three tools' `verify()` already re-proves the created deployment by independent read-back (`deployments_get`, whose response is the full shape) including `projectId` equality — the durable identity proof lives there, per this server's doctrine that `confirmed` comes from read-back. The create response becomes what it should always have been: an identity *claim* the read-back then confirms.
- Tests: each create tool gains a case whose create response is the documented in-progress shape (valid `dpl_` id, `target: null`, `readyState: 'BUILDING'`, **no `projectId`**) and whose read-back returns the full shape — the write confirms end-to-end. Existing full-shape cases unchanged.
- Register amendment (AUD-L delta under VMCP-023), DECISIONS entry, STATUS entry, TOOL-CATALOG note.

**Out (non-goals):** the cleanup/list residual from the same probe round (VMCP-027 stays open; the run-object states recorded by the live cleanup are being read back to name its failing object before any fix is designed — a separate packet); the stranded re-probe run's unrecorded deployment (it exists at the provider but was never recorded into its run because the create's verification threw — its reconciliation is part of the closure protocol, decided with the VMCP-027 evidence, not improvised here); any change to `deploymentTargetMatches` or the id pattern.

## Acceptance

- **In-progress creates confirm:** against the fakes, all three create tools complete plan → confirm → verified read-back with a branch-0 create response.
- **No regressions:** `npm run check` green at the committed range; the full unit suite passes at the previous baseline plus this card's new tests.
- **Live acceptance (post-release, closes VMCP-023's create leg):** the re-probe seed (fresh requestKey) returns a verified deployment — read back through the MCP and independently — instead of `outcome_unknown`. VMCP-023 closes only when its cleanup leg also passes (tracked under VMCP-027).

## Builder guardrails (binding, restated)

- Builders spend $0; tests use fakes only; no real token is used and no live call is made by this card. The live acceptance is an owner-session step after release, on his word.
- No secret, team/project/deployment ID or provider body appears in the change; repo-filed documents withhold real IDs per the secret-scan policy.
- If live behavior contradicts this card or the filed finding, stop and file a dated amendment to VMCP-023; do not improvise a new rule.
