# SESSION-START — implement, then catch up released acceptance

## Count complete predefined batch subsections

The PR workload target is 2–5 whole predefined batch subsections on average,
using the existing roadmap/design IDs such as H-3 or B-5. Technical slices,
functions, tools, UI hookups, guards and packet checklist tasks are internal
implementation steps, not countable batch subsections. List the subsection IDs
and full scope before coding. Partial subsections count zero; count each once
when eligible engineering and required pre-merge proof are complete, with
external acceptance tracked separately. Use focused checks while building,
then the full required gates on the substantial assembled PR. See the governing
instructions' **PR workload is measured in predefined batch subsections** rule.

## Anti-stall recovery for an interrupted or red PR (2026-10-15)

1. **Snapshot once:** read current `main`, active PR head, checks, comments, and
   latest permanent handoff; reconcile concurrent commits before another push.
   If the last user turn ended, no work was running during that gap. Do not
   describe the prior chat's last plan as a completed action.
2. **Triaging CI:** collect the final evidence from *all* failed checks. Assign
   each failure to the violated contract/fixture/lint/work-index requirement
   and name its root cause. Fix the group in one focused correction cycle,
   preserve good security/provider assertions, and avoid CI-driven tiny PRs.
3. **No busy-wait:** one check-state fetch after push and one when results
   materially change is generally sufficient. Never issue consecutive
   identical-state CI polls while there is safe implementation, focused
   review, debugging or handoff work to do. Bounded waiting alone is not a
   batch subsection and not progress. Preserve at most two unmerged PRs;
   do not start a dependent successor until its prerequisite is merged.
4. **Escalation:** when a check repeats its failure, capture *new* diagnostics
   from the exact adapter/operation or focused fixture before the next push.
   When an external proof is absent, attempt authorized remedies, isolate only
   that operation, and continue independently eligible roadmap behavior.
   Do not weaken owner approvals, spend ceilings, preview/production isolation,
   mandatory test sets, reviews, or merge policies to clear CI.
5. **Recoverable state:** after each meaningful head or gate transition,
   checkpoint exact SHA, existing batch-subsection ID(s), what passed/failed,
   next tool action, and external/deployed acceptance separately in the current
   substantive PR/card. Tell the owner the specific finding during the session.
   A chat turn is not a background runner; re-enter from actual repository state.

## 0. Reconcile and recover

Read the governing instructions and the current permanent handoff, not historical
status entries as new work. Verify actual main, live, the READY production revision,
open/unfinished PRs, exact-head CI and unresolved reviews. Preserve concurrent work.
Recover your interrupted/red PR first; inspect all failures and batch their remedies.

## 1. Catch up released work before new implementation

Fetch main/live refs once. Independently verify production environment, source SHA,
READY state and origin through trusted deployment evidence. A schedule timestamp,
workflow success, matching branches or service self-report alone is insufficient.
Run `npm run session:status` for the compact queue; add `-- --deployed FULL_SHA
--state READY --latest-pr NUMBER` only with freshly verified observations. The command
is offline/read-only and never executes acceptance, releases or provider mutations.
Without a shell use the same ledger and GitHub compare/deployment evidence manually.

If main = live = READY production, catch up **every authorized pending live check**.
If they differ, still run tasks whose required revisions are included in production.
Missing/shallow ancestry needs an exact compare or targeted history fetch, not a guess.
Recheck BLOCKED tasks against current owner decisions; do not request approvals again.
A newly observed scheduled, delayed, recovery or separately authorized manual release
uses this same procedure. Do not wait for the nominal release time or initiate a release
just to finish a development batch. Follow the existing checked release policy.

## 1a. Choose a substantial outcome

Read the authoritative work index/roadmap and the highest-priority eligible card.
State its observable result and finite acceptance before editing. Read only its named
code seams, design sections and fixtures; reuse existing helpers and task/packet tools.
Group compatible adjacent roadmap slices into a complete usable workflow,
including callers, real integration and tests. Plan a suitable coherent PR
around 400–800 changed production lines plus tests; this is advisory and not a
reason to pad a smaller valid outcome or fragment a larger one. Explicitly
list included slice IDs and acceptance criteria before writing code. Larger
cohesive PRs require extra integration/risk/verification coverage. Preserve actual
migration ordering, risk isolation and every business/security/financial decision gate.
Do not revisit passing hardening without a demonstrated defect or approved requirement.

## 2. Finish the current roadmap outcome

Use the approved order, active card/packet and parent outcome from actual main.
Before coding, turn that outcome's remaining engineering into one finite checklist:
provider/domain behavior, callers/registry/doors or UI, failure/denial/replay paths,
fixtures and integration proof. Reuse the card; do not create another roadmap.
Complete that eligible integration before selecting later dependent units.
Helper completion, PR numbering and easier tickets do not establish outcome completion.

Investigate technical problems and inherited reviews in this unit; batch authorized
remedies rather than carrying implementable fixes as external acceptance. If an
essential owner-specific policy, fact or permission is missing, check recorded decisions
first, then ask the smallest precise question now with a recommendation and consequences.
Pause only its dependent path, record the answer and resume the same outcome/session.
Research public provider contracts independently; do not ask the owner to resolve them.
Where existing gates permit, continue safe configurable implementation while actual
activation/provider/professional acceptance remains separately restricted. Never invent
approval, widen permissions or mark unimplemented code as waiting for a release.

At handoff, name the same unfinished outcome unless its eligible engineering has proof.
Move to independent work only when the roadmap permits it; preserve genuine execution
limits, risk boundaries, approval gates and the existing release acceptance queue.

## 3. Build, verify, publish

Use focused behavioral tests/lint at meaningful seams while developing. Local commits
are recovery points, not reasons to run the entire suite or push after every small edit.
Before publishing the coherent tree, run all existing mandatory checks and applicable
unit/database/provider-shape/browser gates once. File changes invalidate affected proof.
On a shared limited runner, cap Vitest workers (for example `--maxWorkers=2`) and
run at most two full suites concurrently; preserve the same test selectors/coverage.
Batch known CI/review fixes; inspect all failed jobs before the next correction push.
While CI waits, advance the approved immediate successor; at most two unmerged PRs.
Follow existing REST/Sandbox fallbacks if local execution is unavailable; report actual
Actions evidence honestly. Merge only exact-head green checks plus required reviews.

### First-pass validation and review

Before the first publication of a coherent change, use the existing card/packet to
name each changed boundary, its proving test/fixture and the existing command that
checks it. Keep this compact; reuse the PR's verification section, not a new ledger.

- Trace inputs through the actual caller, helper/client, provider request and result.
  Verify method, path/version, scopes, query/body fields, pagination and response shape
  against the pinned schema/SDK or cited current provider contract **before** adapting
  fixtures. Test the captured outbound request; a permissive fake is not contract proof.
- Reuse realistic fixtures with required fields and relationships. Assert meaningful
  results, denied paths and applicable provider failures/ambiguous writes; prove no
  unintended call or replay. Never weaken a fake/assertion just to turn CI green.
- Search changed exports and data shapes for affected callers, fakes, DB adapters,
  catalogs and tests; update them together. Run existing repository/index/schema/catalog
  validators plus the affected behavioral tests before the full publication gates.
- Review the complete diff against the card and applicable security guide before
  opening the PR. Inspect inherited unresolved findings and all current review threads;
  record each fix or evidence-backed disposition under the repository's review rules.
  A reply alone does not resolve a finding; recheck reviews immediately before merge.
- When CI fails, collect every completed failing job/annotation and trace the root
  cause before one correction push. Reproduce with the smallest relevant existing
  command; retain a regression test for an actual behavioral defect. A repeated failure
  requires new diagnostic evidence, not another speculative fixture edit.

Record exact commands, results and unavailable checks truthfully in the PR. REST-only
sessions still inspect contracts, fixtures and the full diff before publication, then
use required exact-head Actions evidence for execution they cannot perform locally.
Do not invent commands, relax coverage or merge gates, or rerun unchanged passing checks
unless changes or new evidence invalidate them. Live proof remains in the release queue.

Use `npm run check` and affected unit tests. For provider request shapes run
`npx vitest run tests/unit/vercel-client.test.js tests/unit/openapi-validate.test.js
 tests/unit/openapi-snapshot.test.js` (one command); use `test:emulate` where it
covers the operation and `test:db` for DB changes. Pin operation versions.

**PR merge readiness and product acceptance are separate.** A safe implementation PR
may merge with deployment-dependent proof queued, when all pre-merge gates pass and
no explicit card/owner rule requires that proof before merge. Keep such a milestone
IN_PROGRESS/awaiting acceptance. An explicit pre-merge gate still blocks that PR; move
to independently eligible work. Never mark code/CI as deployed or real-provider proof.

## 4. Maintain one release acceptance queue

The marked JSON block in the authoritative status ledger is the running queue, not a
second roadmap. Preserve existing card IDs/evidence and reconcile older open obligations
into it before declaring the catch-up complete. Keep each task's priority, exact minimum
reviewed source revision, procedure, prerequisites, gates, last evidence and disposition.
`dependsOn` names acceptance tasks that must have recorded genuine PASSED evidence;
source implementation dependencies remain in the existing work index. Split broad seed
rows into exact scenario rows as fixtures/revisions are reconciled. No fake pass entries.
After every meaningful merge, add any new deployment-dependent checks in that PR; pin
its source commit, never a guessed future merge SHA. After a release, execute cleared
checks only when that source is in deployed ancestry. If a permitted squash/rebase
removed the pin, reconcile it to the independently verified merged implementation
commit before handoff; never mark it passed or repin to unrelated code.
Execute cleared checks promptly, record sanitized read/write/denial/readback/cleanup proof, and retain
failed/uncertain fixture recovery tasks. New changes, rollback, authorization or environment
changes reopen affected proof. NEVER copy credentials/private fixture IDs into the queue.

## 5. Checkpoint and finish

**Remaining-work visibility.** Run `npm run session:status` for current
roadmap counts and unfinished IDs in approved order alongside the separate
release acceptance queue. Counts describe the existing index/ledger's coarse
units; counts do not establish completed subsections or live acceptance.
Record actual completed slices and remaining engineering in existing cards
and handoffs; never promote an incomplete card to improve the numbers.
Follow the designated roadmap order rather than the milestone in an old handoff.

At each PR handoff record production additions/deletions (excluding tests,
docs, generated files, fixtures and formatting), completed slice IDs and
acceptance evidence. Evaluate 400–800 production lines and 2–5 complete batch subsections
per PR on rolling averages over the latest five merged implementation PRs;
unrecorded historical measurements stay unknown, never invented.


Keep a short progress note on interrupted branches: head, done/proof, one next action,
CI/review state, successor and exact blocker. Diagnose and attempt authorized remedies
before deferring; isolate the operation and continue approved independent work. Limited
release frequency is planned queued acceptance, never a project-wide stop.

Normal implementation sessions complete as many fully verified, cohesive roadmap
slices as fit a safe, recoverable chat context. A suitable PR may integrate
several adjacent small slices (typically targeting 400–800 changed production lines
plus tests), but contracts, review risk and end-to-end behavior determine size;
a complete smaller slice or a safe larger slice is legitimate. Session PR count is set only by the current owner prompt.
Do not count a passing helper as a completed outcome. After each verified
merge, checkpoint the exact head/CI/reviews, completed slices, implementation
and deployed/real-acceptance state, and one next action. Start another slice
only when the remaining context can support its implementation, review, CI
repair, merge and durable handoff; otherwise end at the clean checkpoint.
Persist unfinished work on its existing approved card, not only in chat.
Report completed roadmap slices and acceptance deltas, first-pass CI failures
and correction cycles, not PR count as a productivity metric.
This owner-requested repository optimization is scoped maintenance, not a product implementation batch. Preserve safety even when no further eligible work or an execution limit remains.
At completed-session end update status/cards/index, verify final main, leave a permanent
handoff on the final merged PR and automatically give a short continuation prompt:
repository + verified handoff + next outcome + queue pointer. Refer to the repository
for rules/order rather than recopying them. Preserve interrupted-session obligations.

## 6. Safety and specialized procedures

Governing instructions, existing PLAYBOOK/hosting rules, owner decisions and the card's
specific safety procedures remain binding. Reuse saved authorized developer connections.
Security, money-out approval, production activation, spend, isolation, exact fixture
cleanup, secret handling and all required local/Actions tests are unchanged.
