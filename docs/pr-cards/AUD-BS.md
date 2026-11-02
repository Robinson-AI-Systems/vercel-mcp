# AUD-BS — Branch preview supplies projectSettings for settings-less projects (fix)

Filed from the 2026-11-02 post-sitting queue: with AUD-BP verified
fixed live, VMCP-016 branch G advanced one layer and stopped at
the provider write — `vercel_dev_preview_branch` confirm answered
`outcome_unknown`, failure `{code: "missing_project_settings",
leg: "deployments_create", failureClass: "http_status", status:
400}`. Read-back: run run_20261101_vmcp016g holds ONE intent
object and NO deployment (safe state); the fixture project reads
framework null, every build field null, git-linked, never
deployed. The create body carried no `projectSettings`.

## Dossier — the documented create contract (extracted before building)

Source: the pinned snapshot `vendor/vercel-openapi/openapi-2026-10-11.json`,
`POST /v13/deployments` (operationId `createDeployment`), read
2026-11-02 before any code was written.

- Body: only `name` is required overall. `projectSettings` is
  described verbatim: "Project settings that will be applied to
  the deployment. **It is required for the first deployment of a
  project** and will be saved for any following deployments."
  `additionalProperties: false` on the settings object.
- Fields (all optional inside the object): `buildCommand`,
  `commandForIgnoringBuildStep`, `devCommand`, `framework`,
  `installCommand`, `nodeVersion`, `outputDirectory`,
  `rootDirectory`, `serverlessFunctionRegion`,
  `skipGitConnectDuringLink`, `sourceFilesOutsideRootDirectory`.
  The command/directory fields are nullable strings — the
  snapshot's own descriptions state null means the value is
  automatically detected.
- `framework` enum: 80+ preset slugs (`nextjs`, `vite`, `astro`,
  …) **plus `null` itself** — null is a documented enum member
  and means no framework is selected. **`other` is NOT in the
  enum** (confirmed in the snapshot; a live preflight refusal on
  2026-11-02 said the same), so no honest catalog warm-up value
  exists for a bare static repo, and none is invented here.
- `nodeVersion` enum: `24.x` … `8.10.x` (not nullable).

Shape map — code assumptions audited against this contract:

| Surface | Assumption before AUD-BS | Contract verdict |
| --- | --- | --- |
| `src/vercel/project-settings.js` `deploymentProjectSettings()` | Echoes the project record's six fields (build/dev/install commands, framework, output/root directories), null where unset | Matches: every echoed field is in the documented set and nullable; framework null is an enum member |
| `vercel_deploy_create_from_files` (AUD-AD) | Sends settings ONLY when `row.hasDeployments === false` | Matches "required for the first deployment"; resending on later deployments was the convicted 2026-10-30 400 |
| `vercel_dev_preview_branch` | Never sends settings | The gap: a first git-source deployment of a settings-less project is exactly the documented required case → live 400 `missing_project_settings` |


## Fix

- `src/tools/dev-preview-branch.js` — `before()` already reads
  the project record via `projects_get`. When the record's
  documented `hasDeployments` flag is exactly `false`, the
  deployment body now carries
  `projectSettings: deploymentProjectSettings(row)` — the shared
  helper in `src/vercel/project-settings.js` that already states
  this shape once for the seed and files-create routes, echoing
  the record's own stored fields unchanged (for the retained
  fixture: all null — provider auto-detects; framework null
  selects no framework, the honest value for a record that
  carries none). When the project has deployments (or the flag
  is absent), the body is byte-for-byte today's: the provider
  inherits its saved settings (AUD-AD's rule — restating them
  was the convicted 2026-10-30 refusal). The body still passes
  `validateRequest('deployments_create', …)` in `before()`, so
  the new field is checked against the pinned snapshot on every
  plan.

## Fixture gap, named

The dev-preview suite's project record carried no
`hasDeployments` flag at all, so no test could observe the
first-deployment branch of the create body — the same blindness
class as AUD-BP's hand-built bound object. The three new cases
in `tests/unit/dev-preview.test.js` drive the real
`before()` → `apply()` composition with records in the three
states that matter: never deployed with all-null fields (the
live fixture's exact shape — body carries all-null settings),
never deployed with stored fields (body echoes them), and
already deployed (body carries no `projectSettings` key at all).
Negative control: with the fix reverted, exactly the two
first-deployment cases fail (17 tests: 2 failed, 15 passed);
the already-deployed case passes both ways, pinning unchanged
behavior.

## Acceptance

This PR proves the fix at fixture level only: the create body
carries contract-valid `projectSettings` exactly when the
record proves a first deployment, and is unchanged otherwise.
Branch G's live end-to-end re-run (preview → alias → bypass →
fetch → cleanup → fixture deleted, run run_20261101_vmcp016g
dispositioned) waits for the promotion that carries this fix
and is listed, not claimed. No tool added, removed or renamed;
registry unchanged at 253. Batches with the release train.
