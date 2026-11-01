# AUD-BP — vercel_dev_preview_branch: apply() reads a key before() never returns (fix)

Filed from the 2026-11-01 post-promotion pack leg (e): VMCP-016 branch G
failed live twice, identically — `outcome_unknown`, failure code
`ERR_INVALID_ARG_TYPE`, the run created and then nothing: zero deployments,
an empty run-object inventory, and cleanup refusing ("write targets were not
identified", targets deriving from recorded objects of which there were
none). Diagnosis was convicted from source plus the live fingerprint before
this card was built (coordinator dossier, 2026-11-01); this PR is the fix.

## The defect

`src/tools/dev-preview-branch.js`:

- `before()` returns `{...b, body, ref: a.gitRef, sha: a.gitSha, org, repo}` —
  the commit is carried forward under the key **`sha`**. The `owned()` base
  object ({project, name, teamId, runId, existing}) has no `gitSha` key
  either.
- `apply()` called `preIntent(ctx, b, 'deployment', b.gitSha, {...})` —
  `b.gitSha` is **undefined**.
- `preIntent` (`src/tools/dev-preview-common.js`) computes
  `createHash('sha256').update(name)` — `.update(undefined)` throws a
  `TypeError` carrying code `ERR_INVALID_ARG_TYPE`, after `startRun` and
  before any provider call or intent record. The code discriminates against
  the neighbouring suspect: the plain `TypeError('No independently
  authenticated metered purchase grant')` in the same apply() carries no such
  code. Everything else in the flow already used the right key — the
  deployment body bakes `gitSource.sha` from `a.gitSha` in `before()`, and
  `preview()`, `record()` and the mutationId all read `b.sha`. The preIntent
  call was the single stale read.

## The fix

One line: apply()'s preIntent now hashes **`b.sha`**. Choice recorded: read
the value that exists rather than adding `gitSha: a.gitSha` to before()'s
return — that would carry the same commit under two keys (`sha` and
`gitSha`), recreating exactly the drift surface that caused this defect;
`sha` is the key every other consumer already uses.

## The fixture gap this closes (named)

`tests/unit/dev-preview.test.js` exercised `vercel_dev_preview_branch` only
on refusal paths, so **apply() was never executed by any test**:

- The production-mode test is refused inside `owned()` before before()
  composes anything.
- The "refuses costly/no-preview branch" test is refused twice over:
  `ai/agent-build` by the no-preview rule inside before(), and
  `feature/isolated` at preflight's purchase branch — because the shared
  fixture db defines **no `getPurchasePolicy`**, no owner policy can be
  read, no owner-word delegation is minted, and the tool's unbounded
  metered spend falls to the grant path, which refuses it.

Its three siblings in the same file (env, alias, bypass) each carry a full
positive apply test, and `planPreviewEnv` / `planPreviewAlias` are exported
and plan-tested directly; branch's before is inline in `defineWrite` and had
no positive driver at all. (The dossier's pre-filing hypothesis — a
hand-built `b` carrying a `gitSha` — is superseded by this stronger fact:
no fixture ever reached the line.)

The regression test drives the **real composition** end to end:
`dispatchReadOnlyTool` → `bindGuardedWrite` → the tool's own before()
composes `b` → apply() consumes it. Seams are the siblings': makeFakeVercel
provider, the fixture fake db, the loadToken mock — plus the owner-word
purchase seam from `tests/unit/deployment-git-create.test.js` (connection
`kind: 'connector'`; `f.db.getPurchasePolicy` →
`{grantRequired: false, budgetCents: null}`). It asserts: the result is
`applied` + `confirmed`; the intent object is recorded under the exact id
`intent-deployment-` + sha256(gitSha)[0:32] and marked `cleaned`; the
deployment object is recorded; and exactly one POST `/v13/deployments`
carries the exact gitSource `{type:'github', org, repo, ref, sha}` with
target `preview`. Negative control: with the one-line fix reverted, the new
test fails with `status: 'outcome_unknown'` — the live fingerprint.

## Dev-family sweep (same defect class)

Every `b.<field>` read in preview/targets/apply/verify of each defineWrite
tool in `src/tools/dev-preview-*.js`, checked against what its before()
(or plan function) returns, over the `owned()` base
{project, name, teamId, runId, existing}:

- **branch** — before returns {...base, body, ref, sha, org, repo}: every
  read resolves except `b.gitSha` (this card). FIXED.
- **alias** — planPreviewAlias returns {...base, deployment, alias}:
  b.alias, b.deployment, b.project, b.teamId, b.runId all resolve;
  preIntent hashes b.alias. Clean.
- **bypass** — before returns {...base, note}: b.project, b.name, b.runId,
  b.note, b.teamId all resolve; preIntent hashes a locally computed string
  id. Clean.
- **env** — planPreviewEnv returns {...base, planned, branch, priorCount}:
  b.planned, b.branch, b.priorCount, b.project, b.name, b.teamId, b.runId
  all resolve; preIntent hashes `v.key + '-' + (b.branch ?? 'all')`,
  strings it genuinely carries. Clean.
- **fetch** — read-only; no defineWrite before/apply composition (its
  bound object comes from dev-observe-common's ownerDeployment): outside
  the defect class, noted for completeness.

No sibling instance found; no other source file changed.

## Verification (PC bench, this branch)

- `tests/unit/dev-preview.test.js`: **14/14** (13 pre-existing + the new
  regression test), plus the negative control above.
- Dev family targeted run: **124/124** across 11 files (dev-preview,
  dev-runs, dev-observe, dev-sandbox, dev-sandbox-metered-approval,
  dev-test-webhook, dev-v4-native-provider, dev-v4-v5-bundle-ledger,
  dev-v4-v5-doors, dev-v4-v5-receipts, developer-handoff).
- Full `npm test`: **173 files, 1691 tests, all passed** (exit 0).
- `BASE_SHA=$(git rev-parse origin/main)` (= cf737ab) `npm run check`:
  **exit 0**.
- Pre-push conflict-marker grep
  (`git grep -n -E '^(<{7}|\|{7}|>{7})' -- .`): clean.
- First CI run at the initial head failed the `check` job on exactly one
  line — "Docs check failed: code changed but not docs/TOOL-CATALOG.md
  (DRIFT-PROTOCOL checklist B)": a `src/tools/` change requires the catalog
  note in the PR. The bench `npm run check` runs above were made
  pre-commit, when the committed BASE..HEAD range was still empty and the
  docs rule passed vacuously (the repo's known trap); CI, diffing the real
  committed range, caught it. The catalog note was added and the commit
  amended; the check was then re-run on the bench against the committed
  range (BASE_SHA=origin/main, HEAD = the amended commit): exit 0.

## Scope / catalog judgment

No tool added, removed or renamed; no schema, contract or behavior change
beyond the one corrected read. TOOL-CATALOG gains the dated AUD-BP note
(checklist B — a `src/tools/` change carries its catalog note; the note
itself records that no tool or described behavior changed); registry
unchanged (254 rows / 253 registered).

## Closure (not in this PR)

Live closure stays coordinator work after this fix promotes on the nightly
train: re-run VMCP-016 branch G end-to-end on the retained `rtc-git-fixture`
project, delete the fixture (the recorded commitment that transferred to
AUD-BP at filing), and disposition the orphaned run
run_20261101_vmcp016g. Listed, not claimed here.
