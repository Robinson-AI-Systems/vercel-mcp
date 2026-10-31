# AUD-AL — Files-create construction: documented preview request + auto-detection suppressor (VMCP-028's blocker, round 3)

**Baseline inspected:** main `8fb9e83` (AUD-AK, #341).
Dossier: `files-create-conviction-dossier-2026-10-31.md` in the
audit goal workspace (extends the round-1 and round-2 dev-preview
dossiers). Built dossier-first per the research-first rule; **no
live calls in this card** — the acceptance probe runs after the
nightly promotion, by the coordinator.

**The gap.** `vercel_deploy_create_from_files` cannot create a
deployment on an already-deployed project: the provider refuses
its `deployments_create` with HTTP 400 (four live reproductions:
two pre-AUD-AD with a resent settings payload, two post-AUD-AD
without — the last on 2026-10-31 ~00:58 MDT against promoted
build `8fb9e83`). That wall gates VMCP-028's delete probe and
VMCP-016's alias leg. AUD-AG's shape-fingerprint instrument read
the 2026-10-31 refusal back from the change log (id 90):
`failed=[400:bad_request]`, `projectSettings:absent`,
`target:string`, manifest shape exact.

**The verdict (dossier §5).** The fingerprint's code separates
only the already-cleared class (`missing_project_settings` is a
named code; tonight's is the generic `bad_request`, and the
auto-detection confirmation's code is documented nowhere), so no
single field convicts honestly. What convicts is the
**construction class**: this route's non-first construction is
the only create construction in the product that diverges from
the documented contract (pinned snapshot
`vendor/vercel-openapi/openapi-2026-10-11.json`, operation
`createDeployment`; the live REST reference of 2026-10-31 agrees)
on both of its create-shaping instructions at once — it requests
a preview with the literal `target: "preview"`, which the
documented request vocabulary (not defined / `staging` /
`production` / custom environment id) omits in favor of omission
("If omitted, the target will be `preview`"), and it is the only
create whose framework input is solely the uploaded tree,
dispatched without the documented `skipAutoDetectionConfirmation`
suppressor ("Use this to suppress that check in automated
pipelines" — no caller in the product sent it). Every proven
construction (seed, branch preview, git create) satisfies at
least one side of each pair.

**The change (`src/tools/deployment-file-create.js` only).**

1. **Preview is requested by omission.** When the caller's
   target is `preview`, the create body carries no `target`
   field — the documented preview request, producing exactly the
   deployment asked for. `production` is in the documented
   vocabulary and is sent verbatim. The caller's `target`
   argument, `verify()`'s read-back matching
   (`deploymentTargetMatches`: response `null` = preview),
   preview text, production classification and spend are
   unchanged.
2. **The route sends the documented suppressor.** The create
   dispatch carries `query: {skipAutoDetectionConfirmation: "1"}`
   (the snapshot's enum form) through the existing provider
   plumbing — uniform across this route's creates, first and
   non-first: the route is an automated pipeline by construction
   and its settings, when sent, are the project's own
   owner-reviewed record values. `before()` validates the exact
   dispatched query + body.
3. **The AUD-AG fingerprint stays truthful.** Its query slot now
   renders the actual dispatched query key names (the caller's
   keys plus the transport's `teamId`, sorted, names only —
   never values) computed from the params passed to
   `provider.write`, instead of asserting the constant `teamId`.

The seed, branch-preview, git-create and redeploy constructions
are untouched (proven routes stand); the AUD-AD
settings-only-on-first-deployment rule is untouched; the upload
leg, manifest and tool schema are untouched.

## Drift check

- One tool's request construction changes; the registry stays
  240, no tool is added/removed/renamed, and the caller-facing
  schema is byte-identical. `docs/TOOL-CATALOG.md` gains the
  AUD-AL note beside the AUD-AG one, and this card + a STATUS
  bullet land in the first commit, per checklist B.
- No secrets, no real identifiers: tests use the existing FAKE
  fixtures; the dossier and card carry shapes only, never values
  from the live probe beyond the already-journaled redacted
  fingerprint.
- Rides the nightly promotion; no daytime promotion, no live
  probe in this card.

## Acceptance

- `tests/unit/deployment-file-create.test.js`, AUD-AD behavior
  suite remodeled per dossier §6: the fake's create model now
  also refuses (400 `bad_request`) a non-first create carrying
  the refused construction — explicit `target: "preview"` in the
  body **and** no `skipAutoDetectionConfirmation=1` in the query
  (the combination the 2026-10-31 live probe dispatched; the fake
  claims nothing about either marker alone). Pre-fix code fails
  that fixture with `outcome_unknown` at `deployments_create`,
  HTTP 400, code `bad_request` — the live result in shape.
- Post-fix pins: a preview create on a deployed project applies
  with **no `target` in the body** and
  `skipAutoDetectionConfirmation=1` in the dispatched query; a
  production create keeps `target: "production"` verbatim and
  carries the same query; AUD-AD's settings assertions unchanged
  (echo only when `hasDeployments === false`).
- AUD-AG fingerprint suite updated to the new dispatched shape:
  a preview refusal journals `target:absent` and
  `query:skipAutoDetectionConfirmation,teamId`; the never-values
  assertions are unchanged and still pass.
- `npm run check` green at the exact head; local full test suite
  run before the push.
- Live acceptance (post-promotion, coordinator-run): files-create
  creates a true preview on a seeded project; then VMCP-028's
  delete-probe runbook and VMCP-016's branch-F alias leg execute.
  If the probe still draws a 400, the extended fingerprint —
  showing both class markers gone — starts the next dossier from
  the remaining surface (dossier §5, pre-registered).
