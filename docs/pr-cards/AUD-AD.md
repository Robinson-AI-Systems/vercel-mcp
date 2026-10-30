# AUD-AD — File-create: projectSettings only on a project's first deployment (dev-preview construction; VMCP-028 gate)

**Baseline inspected:** main `e231bac` (AUD-AC, #284). Dossier:
`dev-preview-dossier-2026-10-30.md` in the audit goal workspace
(documented contract from the vendored snapshot AND the live REST
reference, the five-caller body comparison, the record-a-preview
consumer map) — written before code, per the research-first rule.

**Conviction (live + code, 2026-10-30 staging).** The dev-preview
family cannot produce a true preview by any product route. The seed's
first deployment is provider-promoted to production (platform rule:
a project's first deployment is always production — the seed's
`verify()` accepting it is correct). The second-deployment route,
`vercel_deploy_create_from_files` with `target: "preview"` against a
seeded project, returned provider **HTTP 400** at the
`deployments_create` leg twice (3-file and 1-file manifests;
read-back proved nothing was created). Redeploy inherits the
production target; branch previews need a git-linked project.

**The dossier's verdict.** The vendored snapshot and the live REST
reference agree on the whole contract (create stays at `/v13` in
both). `projectSettings` is *"required for the first deployment of a
project and will be saved for any following deployments"*; omitting
it later inherits the saved settings (the same operation's redeploy
rule: inherited unless explicitly overridden). Enumerating every
`deployments_create` caller: the seed sends scenario-built settings
on first deployments only; git create, branch previews and redeploy
all **omit** settings and are the proven shapes; file-create was the
**only** caller resending settings — the project record's stored
fields, echoed — on a non-first deployment, and the only one that
400s. No single echoed field is contract-illegal (the helper projects
the record onto the legal six-field subset; both framework enums are
identical, 75/75; local AJV passes — proven by the dispatch itself).
The echo is convicted in its role: a resent settings payload is the
sole body difference from every proven route and the only input that
can draw a settings-side refusal (the documented
auto-detection-confirmation 400 class is defined over settings
divergence). Which echoed value diverged on the seeded project
cannot be named from outside — the provider's error text is screened
— and the fix does not depend on it.

## What ships

1. **`deployment-file-create.js` (the only production change):**
   `before()` already holds the project record from its identity
   check; that record's documented `hasDeployments` boolean is the
   firstness proof (the same signal `project-settings.js` and
   `project-delete.js` read). The echoed `projectSettings` are sent
   **only** when `row.hasDeployments === false` — this create IS the
   first deployment, the AUD-J `missing_project_settings` guard
   unchanged. Otherwise (`true`, or the flag absent — no proof of
   firstness) the body omits `projectSettings` in both the validated
   `before()` body and the `apply()` body, and the provider inherits
   the saved settings. Effective settings are identical either way —
   the saved copy IS the record's values; they are no longer
   restated. `verify()`/`deploymentTargetMatches` untouched (a
   promoted first deployment still honestly reads back
   `confirmed: false` on an applied create; that posture predates
   this card).
2. **Fixtures remodelled** (`deployment-file-create.test.js`): a
   provider-behavior wrapper around the shared fake encodes the
   documented settings rules — first deployment without settings →
   400 `missing_project_settings`; non-first create WITH a settings
   payload → 400 (the convicted behavior class and status; the fake
   does not invent a provider code, since the live one was screened);
   non-first without settings → created; first with settings →
   created and promoted. The AUD-J echo test is pinned to the
   first-deployment case (`hasDeployments: false` on the configured
   record). The old fixtures were the blindness: a settings-less
   record (echo = all nulls) against a fake that accepted any body.

## Evidence

- Defect conviction, pre-fix: against the remodelled fake, the three
  deployed-project tests fail with the live result verbatim —
  `{status: 'outcome_unknown', confirmed: null}` (the fake's 400 at
  the create leg) — for preview, production, and flag-absent records;
  the first-deployment echo test passes pre-fix (the echo existed).
- Post-fix: the full file is green (29 tests); preview and
  production creates on a deployed project apply with **no**
  `projectSettings` key in the recorded create body; the
  first-deployment create still carries the exact echoed settings
  object; production-target outcome is unchanged.
- Full local verification: commit, then
  `BASE_SHA=$(git rev-parse origin/main) npm run check` + full unit
  suite (counts in the PR). No live calls were made.

## What this does NOT close

- **VMCP-028** unblocks: `deploy_delete`'s `prove()` consumes the raw
  deployment read, not run records — the staging runbook's branch (a)
  now executes mechanically (seed → files-create preview → cancel →
  delete → 404 read-back) on the promoted build.
- **VMCP-016 fetch leg stays gated, by design, on an owner
  decision:** alias/fetch/bypass consume run records, file-create has
  no run surface (no `runId` in its schema, nothing recorded), and no
  mechanism exists to enroll its deployments in a run — building one
  is a new surface. The alias leg is provable post-release via the
  catalog route (staging branch F); the fetch leg needs the
  git-linked scratch fixture (branch G, recommended) or a
  bypass-isolation change. Recorded in the dossier, §3.

**Self-review:** diff inspected against `docs/AI-PR-READ-FIRST.md`;
one guarded write's request body narrows to the documented shape —
no new tool, argument, spend path or production surface (production
creates follow the same omission rule and their outcome is pinned by
test). The one behavior change — settings inherited rather than
restated on deployed projects — is the card's purpose, is the shape
of every other create caller, and cannot alter effective settings.
