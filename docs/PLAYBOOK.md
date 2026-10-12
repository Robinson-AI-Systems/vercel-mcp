# PLAYBOOK — how to deliver one PR card, step by step

The rules are in `AGENTS.md`; the short start is `docs/SESSION-START.md`; the work is the card in `docs/pr-cards/`.
Same procedure as the Stripe MCP's PLAYBOOK, adapted to this repo (no Next.js, no browser tests; Vercel instead of
Stripe; `emulate` instead of `stripe-mock`).

## Step 0 — Orient (minutes, not a reading session)

1. `git fetch origin && git status -sb`. Resume the branch/PR in `docs/STATUS.md` (and the card's resume note) before
   starting anything new. Never discard local work.
2. Read the card. If the roadmap row says JIT, write the card first from the design and current code
   (`docs/pr-cards/README.md`). A missing card is work, not a reason to stop.
3. Read only what the card names, a section at a time.
4. Check `docs/OWNER-INPUTS.md` only for inputs this card needs. Build what doesn't depend on a missing answer; keep
   the dependent behavior off; list the ID.

## Step 0b — Drift check (every card)

`docs/implementation-contracts/DRIFT-PROTOCOL.md` checklist A before coding; B inside the PR; C at batch end.

## Step 1 — Branch

`git checkout -b ai/<tool>/<topic>` from current `main` — or from the unmerged predecessor's branch when stacking.
At most two unmerged implementation PRs in one chain.

## Step 2 — Inventory before coding

`grep` the area (`src/tools/<area>.js`, `src/vercel/`, `tests/unit/<area>*`). Reuse existing helpers (`defineWrite`,
`guard`, `gone`, `summaries`, `paginate`, `isLiveProject`, write-contract helper). For a new Vercel call, look the
operation up in the snapshot first: `node scripts/openapi-find.mjs "add project domain"` (built in A-4) and the official
reference page (`https://vercel.com/docs/rest-api/...`); add it to `src/vercel/operations.js`; cite the reference URL in
the PR.

## Step 3 — Implement in ordered commits

One work unit = one local commit. Inside it: (1) additive SQL + `docs/ARCHITECTURE.md` table row if the database
changed; (2) the tool module with its unit tests **in the same commit**; (3) its request-shape test (and `emulate` test
where `emulate` covers the operation); (4) registry metadata (`area`, `profiles`, `audience`, `writes`, production /
spend / access / secret declarations, `targets`) and TOOL-CATALOG marks.

While implementing:
- Every write tool: `defineWrite` with `plan` (reads the target from Vercel first), `apply`, `readAfter`, `verify`,
  `production`, `targets`, `spend` when `$`, `access` when `A`, `secretOut`/`secretIn` when `1x` or a secret input,
  `inverse` when it has a clean opposite.
- Every read tool: a summary mapper (or an existing one) and the default page size of 20.
- No mock data, stubs returning success, or TODO-as-implementation.
- **Ripple check:** `grep -rn "<changed export>" src tests | head -50` and update every affected fake and test in the
  same commit.

### Step 3a — PR size

**Group work before writing code:** a PR should deliver a coherent set of compatible operations sharing the same risk domain, scope, validation, replay and independent read-back rules. Combine their tests into reusable fixtures. Aim for ~450–800 actual production lines when warranted; the hard ~800-line cap, ~15 production-file target, at-most-one-migration and one-risk-area limit remain authoritative. Never add filler, invent scope, or bundle unrelated owner/destructive/spend gates to increase line count. See `docs/implementation-guidance/RECIPES.md` §7.


About 500 production lines (tests/docs not counted), about 15 production files, hard stop ~800 lines, at most one
migration, one risk area (tokens / production / spend / guards / tools-of-one-area / doors). Measure before opening:

```bash
git diff --shortstat origin/<base>...HEAD -- api src scripts ':!**/*.test.*'
git diff --name-only origin/<base>...HEAD -- api src scripts | wc -l
```

## Step 4 — Verify before pushing

### 4a. The quick gate (every push)

`npm run check` = secret scan (`scripts/check-secrets.mjs`, every tracked file; fails on anything shaped like a real
Vercel token (`vcp_…`, `vci_…`, `vca_…`, `vercel_blob_rw_…`), Stripe key, webhook secret, GitHub token, real-length
`team_`/`prj_`/`dpl_` ID or connection string with a password — fake values contain `FAKE`), docs check
(`scripts/check-docs-updated.mjs`; locally it compares with `origin/main`), index validation
(`docs/pr-cards/validate-index.py`), lint, catalog consistency (`scripts/check-catalog.mjs`), write-safety
(`scripts/check-writes.mjs`), core-imports check (`scripts/check-core-imports.mjs`), token budgets
(`scripts/check-budgets.mjs`). Never `--no-verify`. A new file is scanned only once it is tracked: `git add` first.

### 4b. Add the checks your change needs

| You changed | Run |
|---|---|
| Any tool | `npx vitest run tests/unit/<area>.test.js tests/unit/write-contract.test.js` |
| A Vercel call | `npx vitest run tests/unit/request-shapes.test.js` (validates recorded requests against the snapshot) and, when `emulate` covers it, `npm run test:emulate -- tests/emulate/<area>.test.js` (`scripts/emulate.sh` starts `emulate@<pinned>` on `localhost:4000` and stops it) |
| SQL / `src/db.js` | `npm run test:db -- tests/db/<file>.test.js` (`scripts/local-postgres-test.sh`: disposable **localhost** Postgres, never Neon). If no Postgres binaries exist in your workspace, push and let CI run it; say so in the PR |
| A door (HTTPS API, `vercel_call`) | `npx vitest run tests/doors/` |
| Listing or descriptions | `node scripts/check-budgets.mjs --print` |

**GitHub REST testing fallback (mandatory without a local runner).** When this environment has no terminal,
use a draft PR and the GitHub REST API instead of pretending the commands above ran locally. For the exact
branch head, query `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` and inspect
`/actions/runs/{run_id}/jobs`, `/actions/jobs/{job_id}/logs`, and
`/check-runs/{check_run_id}/annotations` for failures. Run real unit, disposable Postgres and emulator
tests through the existing GitHub Actions workflow; do not substitute a mocked pass, bypass checks, or
ask Chris to use his PC. A code fix means a new commit and new full exact-head CI run. Do not push while
the previous CI cycle is running. Say clearly in the PR that tests ran in GitHub Actions, not locally.

### 4c. Registries that break CI when you forget them

`src/tools/index.js` module list · `src/vercel/operations.js` · TOOL-CATALOG row · `profiles` metadata ·
`src/vercel/spend-operations.js` (spend tools) · `src/vercel/hand-built-map.js` (after U-1) · `known_apps` seed (P-1) ·
`src/data/dashboard-map.js` (guided settings) · `work-index.json`.

## Step 5 — Pushing and CI

1. **Push once per CI cycle, and never while your PR's CI run is still in progress** (SESSION-START §6 "CI cadence"):
   wait for every job, collect all failures, fix them together, then push.
2. **After a red run:** read all failures, reproduce each locally with 4b, fix every failure, push once.
3. **Is it mine?** If the same test is red on `main`, it isn't: port the fix or make a tiny separate fix PR.
4. **Same failure twice:** reproduce locally. **Third red run:** evidence-based diagnosis before any further push.
5. "Flake" is not a cause. Never skip, retry-loop or quarantine.
6. Put "CI runs used: N (red: R, cancelled: C)" in the PR description; C should be 0 — a cancelled run means a push
   arrived during a run.

**When `main` moves while your PR is open:** sync once at the PR boundary with `git merge origin/main` — never rebase a
pushed branch. Conflicts in STATUS, MASTER-ROADMAP or `work-index.json`: keep both sides, re-run the validator.

## Step 6 — Docs as if merged, then open the PR

Open it with the REST API (GraphQL `gh pr …` commands are blocked in Claude Code sessions):

```bash
git fetch origin main && git push -u origin HEAD
GH_PAGER=cat gh api repos/Robinson-AI-Systems/vercel-mcp/pulls -f title='<type>: <plain description>' \
  -f head="$(git branch --show-current)" -f base=main -F body=@/path/to/pr-body.md --jq '.number, .html_url'
# later edits: gh api -X PATCH repos/Robinson-AI-Systems/vercel-mcp/pulls/<n> -F body=@/path/to/pr-body.md
```


DRIFT-PROTOCOL checklist B (CI checks it): card `MERGED (#n)`, STATUS names the next card, `work-index.json` status,
TOOL-CATALOG marks for built tools, ARCHITECTURE for env vars/tables, GO-LIVE-CHECKLIST for new switches,
OWNER-INPUTS for new questions, DECISIONS for decisions. PR title `<type>: <plain description>`. Description in plain
English: what Chris can now ask for; acceptance with evidence; owner decisions (IN-xx or none); review dispositions;
what is not included; CI runs used. Delete the resume note in the final commit.

## Step 7 — Review

1. Production, spend, tokens, secrets, guards, auth, passes: re-read `docs/AI-PR-READ-FIRST.md` and write one line per
   applicable constraint in the PR.
2. Freeze scope. There is no automated review in this repo (IN-01): inspect the whole diff yourself against
   AI-PR-READ-FIRST, write "Self-review: …" with every finding and its disposition, and fix all blocking findings in one
   patch. If an organization-wide automated reviewer posts anyway, fix or answer each thread and resolve it.
3. Resolve a thread only after verifying the fix at the exact head.

## Step 8 — Preview

Once the Vercel project exists (IN-02; until then skip this step and say so in the PR), Vercel builds a preview of this
server per branch. Previews share the production database, so they must never enable
production mode: `api/vercel/setup.js` and the login page treat `production_enabled` as false on non-production
deployments (A-5, A12). For a card that changes a door or login, open the preview's home page and confirm the tool
counts shown match the PR. Never point a preview of this server at a real team's production.

## Step 9 — Merge (authorized when all are true)

`ci` green at the exact head; acceptance met with evidence; self-review written. Merge with the expected-head SHA (merge
commits): `GH_PAGER=cat gh api -X PUT repos/Robinson-AI-Systems/vercel-mcp/pulls/<n>/merge -f sha=<head-sha>
-f merge_method=merge`. Then check once that the push-to-`main` run is green (Step 10 command with the merge SHA). Stacks merge bottom-up, retargeting each PR to `main` first. After the lower PR merges, sync the successor
once onto final `main`.

## Step 10 — Waiting and stopping

- External waits are checkpoints: check once, act on anything new, then build the immediate successor.
- A quiet bounded CI wait is allowed: one check per command, `sleep 60` at most between checks, about 15 minutes in
  total; still pending after that means "pending" — record it in STATUS and do other work. One check:

  ```bash
  sleep 60; GH_PAGER=cat gh api "repos/Robinson-AI-Systems/vercel-mcp/commits/<head-sha>/check-runs" \
    --jq '.check_runs[] | "\(.name) \(.status) \(.conclusion) \(.html_url)"'
  ```

  The checks are `check`, `unit`, `db`, `emulate` and the gate **`ci`**. Merge only when `ci` is `completed success`
  at the exact head SHA. Red: open the failing job's log
  (`gh api repos/Robinson-AI-Systems/vercel-mcp/actions/jobs/<job-id>/logs | tail -80`), fix every failure, push once.
- Before ending a turn: commit, update the resume note and STATUS (exact head, pending gates, next action), and tell
  Chris in plain English.

## If you get stuck

- Same failure after two focused attempts: stop editing, inspect the evidence, change the hypothesis.
- Vercel refuses something the design assumed (an operation, a parameter, a plan-gated feature): don't improvise. Record
  what Vercel answered (against `emulate` or the reference), propose a dated amendment, continue other work.
- Docs contradict code: tests are the truth for behavior, AGENTS for rules, PLAN for scope, card and design for how.

## Mandatory five-PR session handoff

After the fifth verified merge, perform `docs/SESSION-START.md` §7 **before any other action**. A pending
post-merge workflow is reported accurately in the same response with its run URL and recovery instruction; the
handoff prompt is not contingent on a background wait. Never start the sixth PR to repair a missing handoff.
