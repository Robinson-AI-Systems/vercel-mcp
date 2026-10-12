# SESSION-START — one page to begin (or resume) an implementation session

For Sol 5.6 (or any model) implementing a PR card. Read **this page and your card**, then work. Open other rule files
only when a step below names them, a section at a time. `AGENTS.md` still governs; this page is its short form.

## 0. First thing, every session: finish what is already open

Your session can end at any moment (the chat stops between actions), so the next session starts here, not at a new card.

1. `R=$(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')` then
   `gh api "repos/$R/pulls?state=open" --jq '.[]|select(.head.ref|startswith("ai/<tool>/"))|"\(.number) \(.head.ref) \(.head.sha)"'`
   with `<tool>` = your own branch prefix (`sol`, `gpt6`, `claude` …). **Yours** = branches under your own prefix,
   including ones a previous session of yours opened (one agent that used several prefixes, e.g. `sol` and `gpt6`,
   checks each). Another agent's PR is not yours: leave it alone unless Chris asks.
2. For each of your open PRs, first fetch its exact head — `git fetch origin <branch> && git checkout -B <branch>
   FETCH_HEAD`, confirm `git rev-parse HEAD` equals the PR's head SHA — and read its resume note (§4). Then check `ci`
   at that head
   (`gh api "repos/$R/commits/<sha>/check-runs" --jq '.check_runs[]|"\(.id) \(.name) \(.conclusion)"'`).
   - **Red → that is your task now.** Read every failure (job logs may not download; use
     `gh api "repos/$R/check-runs/<id>/annotations"`), reproduce locally, fix all of them, push once, re-check.
   - **Green and acceptance met → bring it up to date, then merge** (PLAYBOOK Steps 5 and 9): if
     `gh api "repos/$R/compare/main...<sha>" --jq .behind_by` is above 0, `git fetch origin main && git merge origin/main`,
     run the checks, push, and merge only when `ci` and `release-policy` are green at that new head. **Pending →** build the next slice meanwhile.
   - Review threads open → fix or answer each, then resolve.
3. Continue from the resume note's "Next step". Only when nothing of yours is open: §1 and the next card.

## 1. Find your place (2 minutes)

Work happens in whatever workspace you were given (a cloud agent workspace, a Vercel Sandbox, a laptop). Code reaches
GitHub only as git commits pushed to an `ai/*` branch. Never copy source files through tool output.

1. `git fetch origin && git status -sb && git log --oneline -5`; `npm ci` once per checkout (Node 24 in CI; Node 22+
   works locally — npm only warns about `engines`). Sanity: `npm run check && npm test` should pass on a clean `main`.
2. `sed -n '1,40p' docs/STATUS.md` → the **Next** section names the card.
   **Before selecting that card**, inspect every IN_PROGRESS/BLOCKED entry with
   `revisit` in `docs/pr-cards/work-index.json` and cross-check the current
   `docs/OWNER-INPUTS.md`. An answered owner decision is a resume trigger,
   not permission to leave its card parked. Execute the earliest due substantive
   action or record a specific still-open acceptance gate and the next checkpoint.
   Check documented read-only dependency exceptions before assuming a blocked
   write card also blocks independent reads; run `node scripts/validate-work-queue.mjs`.
3. Resume note? `ls docs/pr-cards/*.progress.md 2>/dev/null` — if your card has one, continue from its "Next step".
   Do not restart work it lists as done.
4. Read your card (`docs/pr-cards/<ID>.md`). If the roadmap says JIT (no card yet), write it first from the design
   (`docs/pr-cards/README.md`, 40–100 lines). Read only what the card's "Read only these" list says.
   Select the matching [implementation recipe](implementation-guidance/README.md); copy exact current interfaces,
   mappings, fixtures and commands into the card. For B-8b use its worked example; later work uses one remaining-map
   row. Recheck the baseline and keep proposed paths separate from existing code; do not read the whole guide.

## 2. Never do these without Chris (AGENTS "Hard limits")

A real Vercel token in tests or scripts (except the X-2 smoke/scratch run); any write to a real team outside the scratch
project, above all production; buying anything (domains, credits, seats, add-ons, plans); a secret anywhere in code,
docs, tests, logs, PR text or tool results; changing the Appliance Desk repo or other projects; changing app-owned
resources; widening default token, connection or pass permissions or the protected-resources defaults; committing to
`main`; skipping, disabling or weakening tests.

## Grouping rule before selecting the next card

Select one cohesive, safety-compatible slice of related operations (not routinely one endpoint per PR). Follow AGENTS "Cohesive PR throughput", `docs/implementation-guidance/RECIPES.md` §7 and the current card. Target ~450–800 real production lines only when justified; preserve all hard caps, risk splits, owner gates, mandatory tests and exact-head CI. Reuse the `defineWrite`-bound handler, transport replay and shared fake-provider fixtures introduced by #56. Record operation mappings before editing; prefer one complete candidate and a reviewed CI cycle over per-endpoint pushes.

## 3. The work loop

1. Branch `ai/<tool>/<topic>` from latest `main` (or the card's base).
2. Drift check: `docs/implementation-contracts/DRIFT-PROTOCOL.md` **checklist A** (table in the PR, card corrected
   first).
3. Build one work unit → its tests → run them (`npx vitest run <files>`; `npm run test:db -- <file>` when it touches
   SQL; `npm run test:emulate -- <file>` when it adds or changes a Vercel call `emulate` covers) → `npm run check` →
   **commit locally** → update the resume note (§4). Repeat. Red → fix one failing file at a time, then the full check once.
4. **Code first, then docs.** In an implementation PR, edit only the docs checklist B names.
5. When the card is complete: update the docs **as if this PR had already merged** (card `MERGED (#n)`, STATUS,
   `work-index.json`, TOOL-CATALOG marks, ARCHITECTURE when infra changed — checklist B), push once, open the PR,
   then follow PLAYBOOK Steps 5–9: open the PR with the REST command in Step 6 (never `gh pr …`), check CI with
   the one-check command in Step 10 (bounded, ~15 min), merge with the expected-head SHA (Step 9) when both **`ci`** and **`release-policy`** checks are green at the exact head.

## 4. Resume note — so stopping never loses your place

Keep `docs/pr-cards/<ID>.progress.md` (≤20 lines) on your branch and update it after every commit:

```
Card: B-1 · Branch: ai/sol/b-1-safety · Last commit: <sha> <subject>
Done: 1 production declaration (tests pass) · 2 spend line and limit
Next step: 3 read-back verify — write verify() for the sample PR tool, then its unit test
Blocked: none
```

Delete it in the card's final commit.

## 5. Anti-stall rules (AGENTS "Working without stalling" — mandatory)

- Files over ~300 lines by section only (`grep -n` the heading, then `sed -n 'A,Bp'`, ≤150 lines). Never read
  `vendor/vercel-openapi/*.json` whole; query it with `node scripts/openapi-find.mjs "<words>"` once A-4 exists.
- Every search has a path and `| head -50`. Only commands that finish by themselves; `timeout 600` for slow ones.
- Pipe long output through `| tail -80`. Same command fails twice → change approach or record the blocker.
- After ~10 reads/searches without an edit, make the smallest next edit.
- CI and reviews: check once, act on what is new, then do other work. No automated reviewer is expected (IN-01).
- No local Postgres? `npm run test:db` exits 2 and says so; push and let CI's `db` job run it (say so in the PR).

## 6. Keep moving: problems are not blockers

| Engineering problem — **fix it yourself, never stop** | Real blocker — stop and ask Chris |
|---|---|
| Red CI, lint errors, a failing or outdated test, a wrong API parameter, a merge conflict, a failure that "looks flaky", unclear existing code, a missing card (write it), docs that disagree with code, a card that is too big (split it and record the split) | A hard limit (§2); an owner decision (`IN-xx`) the **current step** truly needs; a design that cannot work (write a dated amendment, then continue other work while it waits) |

**Validate in thin slices.** Write the smallest piece plus its test, then run that test and lint the files you touched
(`npx vitest run <file>`, `npx eslint <files>`) **before** writing the next piece. Never write more than about 150
production lines without running tests. Look up every external API parameter before coding it — in the vendored API description
(`node scripts/openapi-find.mjs "<words>"` once it exists), or, for calls the design routes through a pinned official
package instead, in that package's types and documentation — a wrong parameter is the most common CI failure.
Run the full `npm run check` and `npm test` before every push: CI should only confirm what you already know.

**No local shell or test runner? Use GitHub REST (standing owner instruction).** Do not stop, ask Chris to run
tests, or claim local execution. Commit through the GitHub REST connector on an `ai/*` branch; open a **draft**
PR to trigger CI. For its **exact head SHA**, inspect REST `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`,
`GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`, the job log endpoint
`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`, and
`GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations` as needed.
Use the `check`, `unit`, `db`, `emulate`, and aggregate `ci` jobs as the remote test runner.
Wait for all jobs to finish before pushing fixes; diagnose every failure via logs/annotations, fix it, then
verify the new exact head. Label results **GitHub Actions CI**, not local tests. Never merge without green
required checks. Follow PLAYBOOK Step 4b and Steps 5–9; this is a permanent fallback for this environment.

**CI cadence: one complete run per fix batch.** Every push starts a full CI run, and that is intended: the merge gate
must be green at the exact head, because a fix in one place can break another. So make each run count:
- **Never push while your PR's CI run is still in progress.** Wait for every job to finish (PLAYBOOK Step 10's bounded
  wait; build the next slice locally meanwhile), collect **all** failures, fix them together, then push once.
- Run the checks locally first whenever you can (`npm run check`, `npm test`, and the db/mock tests the change touches),
  so CI confirms rather than discovers.
- "Re-run failed jobs" on GitHub is only for an infrastructure hiccup with no code change (a runner or network error);
  any code change gets a full run.

**Leave an exact recovery point.** Never end a turn with a plan, a promise ("I'll now …") or a summary while work
remains. End every turn right after a push whose resume note's "Next step" is the exact next action — a command or a
file and function, e.g. "CI red at 8adb4bf: `tests/unit/billing.test.js` expects old message; update it, then lint
`src/tools/billing.js`".

**Stopping** happens only for a real blocker. Before stopping: update the resume note and `docs/STATUS.md`, then
commit and push them with the work, and say in one plain-English paragraph what is done and exactly what Chris needs to decide.

## Restart message for Chris to paste when a session stops

> Continue the Vercel MCP work. Read `docs/SESSION-START.md` and do §0 first: finish any open PR of yours (fix red
> CI, then merge) before starting the next card. Then keep going card after card; stop only for a real blocker (§6).

## 7. Mandatory session close-out after the fifth merge

Do this immediately, before any more development or tool exploration. This applies to REST-only sessions too.

1. Fetch the live `main` ref and record its exact commit SHA. Verify the five session PRs are **merged**
   (not merely closed), including their exact last head SHAs and merge commits.
2. For that new main SHA, retrieve the post-merge `push` workflow run and its individual `check`, `unit`,
   `db`, `emulate` and aggregate `ci` conclusions. Do not confuse PR-head CI with post-merge CI.
3. List open PRs and the five PRs' review threads; any unresolved thread must be handled or reported precisely.
4. Immediately send the user the final count, commit SHA, exact CI results, unresolved/owner gates, next card,
   and a **short, copy-ready continuation prompt** pointing to repository documentation. Stop at five merges.
5. If a check is pending, an endpoint unavailable or the session cannot finish: state exactly which SHA, PR,
   check or review is unverified and how the next session should recover. Do not claim a successful five-PR
   session, quietly disappear, or postpone the handoff waiting for a check to finish.
