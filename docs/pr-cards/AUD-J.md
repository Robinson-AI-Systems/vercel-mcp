# AUD-J — First deployments carry projectSettings (VMCP-023, second delta)

Status: IMPLEMENTED 2026-10-28 (branch `ai/vivienne/aud-j-seed-project-settings`, base main `9567543`) — VMCP-023 stays **open** until its acceptance probe passes live (the seed → deploy sequence completing on the team seat, after release, with a fresh requestKey).

**Why this card exists:** AUD-H's fixes were released and the VMCP-023 closure probe ran live on 2026-10-28. The probe passed the legs AUD-H repaired — the seed's project was created, its files uploaded (the upload-guard defect is proven fixed live) — and then failed one leg deeper, at `deployments_create`, with the outcome's own new legibility naming it exactly: `{"code": "missing_project_settings", "leg": "deployments_create", "failureClass": "http_status", "status": 400}`. That code appears nowhere in this repository: it is the provider's own error, surfaced verbatim by AUD-H's failure detail. This card is the fix for that leg.

## Diagnosis (2026-10-28, live probe + vendored OpenAPI snapshot + source)

One defect, proven from the platform's own documentation:

- **D-A (proven — a first deployment must carry its project settings).** The vendored snapshot's `createDeployment` body documents `projectSettings` as: *"Project settings that will be applied to the deployment. It is required for the first deployment of a project and will be saved for any following deployments."* The seed creates a bare project (`projects_create` with `{name}`, plus `framework` only when the scenario declares one) and immediately deploys files to it — by construction always a **first deployment** — with a body of `{name, project, files, target, meta}` and no `projectSettings`. A project created that way holds no saved settings at the provider, so the create is refused: HTTP 400, provider code `missing_project_settings`. This leg was unreachable at S7 (AUD-H's D-C upload guard killed the seed before any upload) and unreachable in AUD-H's tests (the fakes modeled the create as unconditionally successful — the fixture-blindness pattern again, this time about a documented request requirement rather than a response shape).
- **Sibling exposure (same segment, assessed here).** `vercel_deploy_create_from_files` sends the same settings-less body. Against a user's existing project — which carries saved settings from any earlier deployment or dashboard setup — the provider is satisfied; against a **never-deployed, settings-less project** (for example one just created through `vercel_project_create`) the same 400 waits. The tool already reads the project record pre-dispatch, so the cure is in reach without new reads: echo the record's own stored settings fields back in the create body. Echoing is safe for configured projects — the values sent are the values already saved — and gives a settings-less project its record's values (nulls = provider auto-detects) as its first saved settings.

## Scope

**In:** one shared helper (`src/vercel/project-settings.js`) stating the `projectSettings` shape once — the six settings fields (`buildCommand`, `devCommand`, `framework`, `installCommand`, `outputDirectory`, `rootDirectory`), each nullable, null = provider auto-detects (for `framework`, null = no framework selected). `vercel_dev_seed`: the create body (in `before`'s pinned validation and in `apply`) carries settings derived from the scenario — the fixture's declared `framework`, nulls elsewhere. `vercel_deploy_create_from_files`: the create body (validation + dispatch) carries settings echoed from the project record read in `before` (`checkProject` now also returns the row). Unit tests: the seed tests assert the exact settings object on the recorded create call for a null-framework scenario and for `nextjs-hello`; the pinned-shape validation test carries the settings; the from-files tests assert the echo from a configured record. Register amendment, DECISIONS entry, STATUS entry and a TOOL-CATALOG note recording the diagnosis.

**Out (non-goals):** `vercel_deploy_create_from_git` — not assessed for this requirement: its create carries a `gitSource` against a git-linked project (a different provisioning route) and no live failure evidence names it; if a first git deployment to a settings-less project ever returns the same 400, the same echo applies and a dated amendment to VMCP-023 should say so. Any change to the projects_create body (the seed's project creation is not the failing leg; the settings belong to the deployment, per the provider's own model — they are "saved for any following deployments" by the create that carries them). Replay/claim semantics, confirmation, purchase policy, production rules: untouched. The live re-probe itself (post-release, owner-session step).

## Build notes

- The helper normalizes `undefined` to `null` field by field; it never invents a value. The seed passes exactly `{framework: fixture.framework}`; the file tool passes the project record itself as the source.
- `before` and `apply` use the identical settings object (computed in `before`, carried on its result), so what validation pins is what dispatch sends — the same discipline as the file manifest.
- No new provider reads: the seed knows its scenario; the file tool's identity read already returns the record.

## Acceptance

- **Request shape:** against the fakes, a confirmed seed's recorded `POST /v13/deployments` body carries `projectSettings` with the scenario's framework (`null` for `static-site`, `"nextjs"` for `nextjs-hello`) and nulls elsewhere; a confirmed from-files create echoes a configured record's fields exactly (`framework` + `buildCommand` proven, the rest null).
- **No regressions:** `npm run check` green at the committed range; the full unit suite passes at the baseline count plus this card's new tests (1038 + 3 = 1041 expected: two seed scenarios + one from-files echo; the pinned-shape test is updated in place).
- **Live closure probe (post-release, closes VMCP-023):** the seed → deploy sequence completing on the team seat with a **fresh requestKey** (the 2026-10-28 probe's key is durably claimed by its failed run, which the dev cleanup reconciles), the deployment read back READY through the MCP and independently, and the scratch project deleted with the deletion verified (rtc-scratch discipline). Until it passes, VMCP-023 stays open.

## Builder guardrails (binding, restated)

- Builders spend $0; tests use fakes only; no real token is used and no live call is made by this card. The live re-probe is an owner-session step after release, on his word.
- No secret, team/project/deployment ID or provider body appears in the change; repo-filed documents withhold real IDs per the secret-scan policy.
- If live behavior contradicts this card or the amended finding, stop and file a dated amendment to VMCP-023; do not improvise a new rule.
