# AUD-AG — Files-create round 2: the create-refusal shape fingerprint (AUD-M2 instrument for the deployments_create leg)

**Baseline inspected:** main `f69d3d9` (AUD-AF, #287). Dossier:
`dev-preview-dossier-round2-2026-10-30.md` in the audit goal
workspace — written before code, per the research-first rule; it
extends round 1's `dev-preview-dossier-2026-10-30.md` to full-body
depth (exact dispatched body + value sources, field-by-field
against the pinned snapshot's POST /v13/deployments schema, the
same table for every other create route, non-body hypotheses
weighed).

**What round 1 left.** AUD-AD convicted the `projectSettings`
resend and shipped settings-only-on-first-deployment. The
2026-10-30 closure probe (~08:45 MDT, on the promoted build)
falsified its sufficiency **by experiment**: seed succeeded, then
`vercel_deploy_create_from_files` {target: "preview", files: [one
small index.html]} on the seeded (already-deployed) project planned
clean and confirmed into a **provider HTTP 400 at leg
`deployments_create`** — uploads succeeded, read-back proved
nothing was created, run cleaned. The settings variable is
eliminated; something else distinguishes file-create from every
working route.

**Why this card builds an instrument, not a fix.** The dossier's
full-body delta table leaves exactly two contract-visible
suspects, and outside evidence cannot separate them:

- **S-1, the framework auto-detection confirmation.** Both the
  pinned snapshot and the live REST reference document the class
  and its suppressor (`skipAutoDetectionConfirmation=1`, "use this
  to suppress that check in automated pipelines"); **no caller in
  this product sends it** (grep-proven). Post-AUD-AD, file create
  is the only create reaching the provider with no settings
  payload, no gitSource and no deploymentId — its sole framework
  input is the uploaded file tree. Not convicted: the documented
  trigger is a detection-vs-setting *difference*, and the probe's
  visible shapes (saved framework `null`; one static index.html)
  do not demonstrably differ.
- **S-2, explicit `target: 'preview'`.** The documented request
  vocabulary is omitted / `staging` / `production` / a custom
  environment identifier — "if omitted, the target will be
  `preview`". Not convicted: the same literal succeeds live via
  the seed (files × first) and branch previews (git × non-first),
  so convicting it needs a files-specific strict parse no contract
  text states.

The one datum that separates them — the provider's own error
detail — is discarded by design today: the client strips the
provider message, the AUD-H failure detail (`code`, leg, status)
reaches only the ephemeral tool result, and the guarded-write
executor journals **no change_log row at all** for an apply-path
`outcome_unknown` (audits exist for dry-runs and landed writes
only). Three live 400s therefore preserved nothing but "HTTP 400
at deployments_create". Per the dossier verdict, the honest build
is the missing instrument — the AUD-M2 pattern applied to the one
guarded-write family whose refusals are still opaque. Cleared by
the dossier and untouched: name/project form, manifest entry
shape (matches the documented `UploadedFile` exactly), meta
absence, teamId placement, upload registration (identical path to
the proven seed; the failure names the create leg).

## What ships

- **deployment-file-create.js** — `apply()` hoists the create body
  into one object (the same object is dispatched and fingerprinted,
  so the two can never drift) and wraps the `deployments_create`
  write: on any throw, `journalCreateRefusal()` best-effort writes
  one `change_log` row — `{account, mode, tool:
  'vercel_deploy_create_from_files', summary, dryRun: false,
  production: <target is production>}`, the AUD-M2
  `journalShapeRefusal` shape — then rethrows; the
  `outcome_unknown` result is byte-identical to before. The
  summary is the AUD-M2 grammar:
  `SHAPE-FP deployments_create failed=[<status|absent>:<code|absent>] types: projectSettings:<type> target:<type> files:array#<n> files[]:<subfield>:<type>,… name:<type> project:<type> meta:<type> query:teamId`.
  The verdict slot carries only AUD-H's already-caller-visible
  metadata (HTTP status; the error code admitted only under
  AUD-H's anchored pattern). The types are computed from the
  dispatched body: field names with `jsonTypeOf` type words (the
  tokens.js/integration.js helper, mirrored), the files array's
  cardinality (tool-bounded 1–4; round-1 staging ran 1-file and
  3-file manifests and the distinction was diagnostic), and the
  manifest entry's subfield name:type pairs. **Never values** — no
  file contents, digests, sizes, project/team/deployment
  identifiers, or provider message, excluded by construction.
  Ordering follows AUD-M2's truncation discipline (the
  recent-changes read returns `LEFT(summary, 160)`): verdict,
  then `projectSettings` and `target` (the S-1/S-2
  discriminators), then the files shape; constant fields trail.
  Upload failures keep their existing leg and journal **no**
  create fingerprint (no create was attempted); journaling
  failure is swallowed and never changes the outcome.

## Verification

- New suite block (6 tests) in
  `tests/unit/deployment-file-create.test.js`: a confirmed create
  refused 400 journals exactly one fingerprint row naming the
  dispatched shape (`projectSettings:absent`, `target:string`,
  `files:array#2`, the manifest entry shape) and the verdict
  (`400:bad_request`), with the project name, file contents,
  digests and provider message all asserted absent from the
  summary; a first-deployment refusal records
  `projectSettings:object`; a production-target refusal marks the
  row `production: true`; an upload-leg failure journals no
  fingerprint; a throwing journal leaves the `outcome_unknown`
  result unchanged; a successful create writes no fingerprint row.
  File suite 35/35. Full local check and CI at the exact head:
  recorded in the PR.

Rides the nightly promotion. The coordinator's next live attempt
(one files-create probe on the promoted build) reads the
conviction back through `vercel_recent_changes`: a code naming
the auto-detection confirmation convicts S-1 (fix: send the
documented suppressor on this route); a generic refusal beside
`target:string` focuses S-2 (fix: omit `target` for preview);
any other code names its own class. That fix is a follow-up card
with live evidence behind it. VMCP-028's closure probe and
VMCP-016's alias leg stay gated on it; no request shape changes
in this card.
