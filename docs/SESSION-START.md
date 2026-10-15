# SESSION-START — reconcile, accept released work, implement, close out

## Autonomous execution contract

“Do N bundles” authorizes continuing the full documented process without routine
permission stops: reconcile → perform eligible acceptance → implement → verify →
review/merge → cleanup/handoff → next outcome until N and eligible obligations are
satisfied. Checkpoints preserve progress; they do not end otherwise feasible work.

On a terminal failure, diagnose and repair; on green CI, handle reviews and merge
when authorized. During pending CI, do useful independent scoped work, then recheck
at a meaningful transition. Repeated unchanged results require a different action,
not a busy loop. Never silently stop or imply background execution after a turn ends.

Before a blocker can justify stopping, identify its exact error/evidence, investigate
its cause, check already-recorded decisions and attempt authorized remedies. Isolate
one blocked operation and continue independently eligible work. If nothing authorized
can proceed, explain to the owner: what is blocked, why, what was tried, what specific
input/permission/resource or fix you believe would unblock it, and your recommended
next action. Ask genuinely missing owner input promptly while independent work proceeds.
An actual execution limit gets an explicit incomplete recoverable checkpoint, never
a completion claim. Preserve every real safety, spending, release and approval gate.


## Bundle target and delivery boundaries — product completion correction 2026-10-15

“Do N bundles” sets substantial NEW completion workload inside the approved plan.
It starts the repository's WHOLE workflow, not just coding. Perform every currently
eligible authorized session obligation in its existing priority/dependency order:
acceptance catch-up, unfinished/concurrent work, verification, reviews, safe merges,
authorized release procedures, cleanup and permanent records. Reaching N never
excuses another ready obligation. Preserve every actual gate and release restriction.

Default ENGINEERING bundles retain the normal guide: 2–5 complete original batch
subsections and 400–800 meaningful production lines, excluding tests/docs/generated
or mechanical churn. Larger coherent work and substantial single-subsection exceptions
remain valid. Small helpers/remainders contribute to the same bundle; no padding,
recounting old code, invented subcards or repeated full publication per helper.

When eligible code work is exhausted, do not invent features to create more lines.
A COMPLETION bundle may instead finish substantial previously unmet original
configuration, integration, deployment verification or real acceptance criteria,
possibly with zero production lines. A checklist, audit, repeated permission-denied
probe, isolated read, waiting or reused pass counts zero. New genuine evidence and
substantive workload review are required. Acceptance remains mandatory regardless of
whether it counts: count a substantial outcome once only if explicitly planned as a
completion bundle, then handle ALL other ready obligations too. No double credit.

Resolve uncertain original criteria once against actual source/callers/tests and
retain exact evidence in the existing card/status. A MERGED label or zero-ahead
candidate branch does not prove real acceptance; it also does not justify rewriting
working code. Reopen affected criteria only for relevant changes/failure evidence.
Date/professional/provider gates restrict their named real operation, not eligible
design, inactive implementation or synthetic proof. Never call missing code external.
Only dependencies already designated optional are optional; actual prerequisites and
publication gates remain binding. No new phase/scope request until the approved
requirements and current blockers have been concretely reconciled.

### Freeze one finite outcome, then compare

Use the existing selected execution card, not another roadmap. Preserve one fenced
`json` object between `<!-- bundle-plan:start -->` and `<!-- bundle-plan:end -->`.
Common fields: `baseRevision` (full current HEAD), `outcome`, `integrationBoundary`,
`newEngineering`, `estimatedProductionLines`, `relatedWorkDecision`, `subsections`.
Each subsection names its existing `id`, full original `acceptance` strings and
`remainingEngineering` strings. ENGINEERING is the default; keep its existing scope,
whole-subsection, focused-development/full-publication and independent review rules.

For `workKind: "COMPLETION"`, state explicitly when no code is needed in
`newEngineering`; `estimatedProductionLines` may be 0. Each subsection has
`remainingEngineering: []`, a nonempty `remainingWork` list, and `acceptanceTasks`
listing its precise EXISTING queue IDs. The plan also has root `acceptanceTasks`
listing their distinct union. These mappings preserve the full original outcome;
they do not create or approve scope. Existing authorizations are checked per operation.

Run `npm run session:bundle -- --card docs/EXISTING-CARD.md`, commit that local plan
before the work and retain its SHA. This is a checkpoint within the substantive
outcome PR, not a separate planning PR, permission stop or new owner burden.
Already-started sessions keep honest transition evidence; never invent past plans.

Delivery JSON has `subsections` with identical IDs, `criteria` entries in original
order (`criterion` exact original text, `evidence` concrete proof), and explicit
`remainingEngineering` lists. COMPLETION also has `remainingWork` per subsection.
Include actual `productionAdded`, `productionRemoved`, `newEngineering`,
`planComparison`, `relatedWorkDecision` and `decision`. Use `CONTINUE` if incomplete;
`SUBSTANTIAL` when at guide; otherwise `SUBSTANTIAL_EXCEPTION` with concrete
`exceptionEvidence` of substantial NEW work. Zero-code completion requires that
explicit substantive review. Never rewrite the plan around a smaller delivery.

Commit sanitized actual acceptance results in the existing permanent ledger, then run
`npm run session:bundle -- --card docs/EXISTING-CARD.md --planned-at FULL_SHA
--report /tmp/bundle-delivery.json`. COMPLETION verifies each selected task changed
from not-passed at baseline/planning to PASSED in committed HEAD, with new evidence
and unchanged source pin, requirements, prerequisites and approvals. Existing approved
IDs must be approved at baseline and delivery; optional/planned/proposed work cannot
become authorized by changing its label. Pending dependencies refuse completion.
Uncommitted claims, old passes and merely accessing a checklist cannot satisfy it.

Publish real evidence through the normal PR/CI/review gates; a substantial genuine
acceptance artifact may be the outcome without application-code changes. This permits
evidence publication, not filler documentation-only PRs. Rerun comparison on actual
merged main at closeout. Rechecking one claim never creates another bundle. Keep
counts/proof in the existing card/handoff, all N outcomes distinct. The helper is
accounting only: not permission, truth attestation, CI/review or a bundle certificate.

The owner may instead request “Finish the approved project.” Then original product
completion criteria set the target; do not manufacture a bundle count. Continue
through eligible obligations and ask exact missing owner input in the active chat.
If N cannot be met, continue independent authorized work, then report incomplete
with each investigated blocker, attempted remedy, responsible party, exact needed
action and re-entry trigger. A clean checkpoint, elapsed minutes, main ahead of live
or inability to find 400 lines is not a blocker. Keep actual execution-limit recovery
checkpoints and every security, spending, activation, production and fixture safeguard.
This owner-requested workflow maintenance claims zero product bundles.

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

### Durable work before long tool chains (2026-10-15)

GitHub blob SHAs and text written in chat are **not recoverable implementation** until linked into a committed branch. After the first cohesive source+test stage, fast-forward commit to the active implementation branch and open a draft PR. On long REST-only sessions, commit each coherent work stage before issuing another long sequence of file edits. Never defer the first commit until all tests/cards are complete. Draft PR checkpoints do not count as completed subsections, bypass CI/reviews, or authorize provider writes. On resumed chats, inspect the real commit/PR first; only reuse unattached blobs after verifying them. Leave actual passing evidence and remaining work on the active card/PR. Avoid no-op CI polling and make progress against the same outcome.

## 0. Reconcile and recover

Read the governing instructions and the current permanent handoff, not historical
status entries as new work. Verify actual main, live, the READY production revision,
open/unfinished PRs, exact-head CI and unresolved reviews. Preserve concurrent work.
Recover your interrupted/red PR first; inspect all failures and batch their remedies.

**Prepare once, then implement.** Run `npm run session:prepare` during startup to
consolidate local Node/dependency, container-memory and disposable-Postgres route
diagnosis. It runs no tests, installs nothing and grants no provider authority.
Use an existing supported runner/required exact-head CI for unavailable local modes;
missing local infrastructure blocks only that local proof. Preserve normal CI.
Do not keep cycling production build flags, substitute a dev-server result, provision
paid capacity, or ask the owner to perform a task the authorized runner can do.


## 1. Catch up released work before new implementation

Fetch main/live refs and independently verify the actual serving production origin,
source SHA and READY state. Workflow success, branch equality or a service self-report
alone is insufficient. Run `npm run session:status -- --deployed FULL_SHA --state READY`
with those observations, or use the same ledger and exact GitHub compare/deployment
evidence manually when no shell is available. The command is read-only: it does not
execute acceptance, release software or authorize provider operations.

Evaluate EACH outstanding check against its required revision in deployed ancestry.
Main/live equality is never a global acceptance prerequisite. Perform every currently
eligible authorized check before selecting new implementation; recheck BLOCKED rows
against current decisions and attempt authorized remedies. Defer only the affected
check with its exact missing prerequisite, investigated remedy and next action.
Missing history means fetch/compare that revision; it does not mean “not released.”
Preserve valid evidence until relevant changes invalidate it. Reading the queue or
observing a release is not acceptance execution. Preserve fixture and cleanup gates.

Reconcile all outstanding queue rows, including rows hidden by an output limit, in
the existing ledger/handoff. Before new implementation and final reporting, validate
that accounting with `npm run session:status -- --deployed FULL_SHA --state READY
--acceptance-review /tmp/acceptance-review.json`. This temporary sanitized extract
is not a second ledger and must not contain secrets, provider bodies or private IDs.
It contains the printed `snapshot` digest, `deployed`, `deploymentState`, and `tasks`; every outstanding task needs
`id`, `requiredRevision`, current planner `disposition`, `outcome` and `evidence`.
Use `PERFORMED` with `result: PASS|FAIL` (and `nextAction` for FAIL), or `DEFERRED`
with `prerequisite`, `remedy` and `nextAction`. Existing recorded passes need no
retyping; optional `REUSED` entries reference their evidence. The checker requires a verified READY deployed revision and rejects
omissions or changes to any queue field via the snapshot digest; it cannot attest evidence truth or grant permission.
Without a shell, put the same item-by-item accounting in the permanent handoff.
Record actual results in the existing ledger; rerun the extract after ledger changes.
An inaccessible deployment/evidence source requires investigation and a specific
checkpoint, not fake observations or a project-wide stop.

Recheck at observed releases/configuration changes, after meaningful merges, and
before final handoff. A scheduled, delayed, recovery or separately authorized manual
release uses the same per-check procedure. Follow the checked release policy; never
initiate a release just to finish a development bundle.

### Recognize and escalate a release dependency — owner October 15

After independently verifying deployed READY/source and fetching required history,
identify each check whose required source is on reviewed main but absent from live.
`session:status` emits RELEASE NEEDED only for that confirmed source gap; unknown
history requires investigation, and source already in live requires deployment/build
follow-up rather than another release. Other permission/fixture gates remain separate.

Alert the owner in the active chat when a release is needed to advance approved
completion. Before requesting approval, prepare the exact main SHA, required green
checks/reviews, source/live/deployed comparison, affected task IDs, remaining non-release
prerequisites, standard checked release route and post-deployment acceptance steps.
Explain whether the next scheduled release can clear it or a manual release would
unblock work sooner. Request explicit approval for that concrete manual release;
Do N bundles and permission to ask are NOT permission to release. Do not weaken
frequency/checked promotion policy or trigger a release merely to satisfy N.
Continue independent eligible work while waiting. After an authorized release,
verify actual serving READY/source and immediately reassess/run newly eligible
acceptance; never stop at a green release workflow alone.

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
On a shared LOCAL sandbox runner, cap Vitest workers (for example `--maxWorkers=2`) and
run at most two full suites concurrently; preserve the same test selectors/coverage.
Batch known CI/review fixes; inspect all failed jobs before the next correction push.
While CI waits, advance the approved immediate successor; at most two unmerged PRs.
Follow existing REST/Sandbox fallbacks if local execution is unavailable; report actual
Actions evidence honestly. Merge only exact-head green checks plus required reviews.


**Parallel CI is a maintained contract.** Independent verification families run as
sibling jobs; only actual setup/migration/seed and within-scenario state dependencies
remain ordered. Separate SQL jobs get separate disposable databases. Local shared
sandbox worker limits do NOT serialize isolated GitHub jobs. Preserve each existing
required aggregate check name, all family results, immutable dependency pins,
assertions, skip checks and read-only/no-secret rules. The CI layout guard rejects
accidental family chains, missing aggregate inputs, collapsed/serialized matrices
and missing/increased job timeouts. Do not add `needs` merely to save an install.

Timed root test/build phases use `scripts/ci-phase.mjs` with a 180-second feedback
budget and emit measured timing. Command failure or budget excess fails; normal
job timeouts remain separate safety bounds, not desired feedback durations. When
a phase grows, inspect code/fixture/runner timing and fix demonstrated slowdown or
split independent test files/cohorts into parallel jobs/shards while proving full
coverage and isolation. Do not raise the budget/timeout, skip assertions, loosen
performance thresholds or rerun blindly. A measured runner anomaly can use the
existing controlled same-head rerun policy, retaining the original failure. Compare
critical-path wall time (parallel jobs overlap), not a sum of all runner minutes.

### First-pass validation and review

Use the existing selected card/packet as ONE consumer checklist throughout the
bundle: changed symbol/contract -> actual callers -> persistence/provider -> full
fixture -> positive/denied/recovery proof -> focused command. Resolve original
requirements and recorded owner decisions once at the relevant revision; revisit
only changed boundaries or new failure evidence. No repeated whole-repo audit.
Prepare a complete realistic fixture early (identities/roles, required fields, exact
amounts/IDs, state transitions and recovery). Exercise the smallest existing route
through the actual handler/form control before the broad publication cycle. A
reference fake's success does not prove the actual service adapter; validate the
pinned boundary, method/args/receipt shape and real adapter together.

At the stable local pre-publication checkpoint, run
`npm run session:prepare -- --publish`: it fetches current main and predicts textual
merge conflicts without moving your branch/worktree. Resolve conflicts and review
changed shared contracts/fixtures BEFORE spending a publication CI cycle. A clean
prediction is not semantic compatibility or permission to merge. Reconcile again
only when main/your relevant inputs actually change, not in a status-check loop.
Batch independent reads, collect all completed failures, make one related correction,
and consolidate existing documentation once before publication. Use small job/status
metadata while CI is pending; inspect failed logs after completion. Reuse valid
evidence and record exact phases/timings where observable, with overlaps/unknown
time explicit rather than invented coding or idle durations.

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

Before reporting session completion, reconcile the acceptance queue again against
actual deployment and finish its accounting above. Report performed checks/results,
reused proof and each deferred check's exact prerequisite/remedy/next action, alongside
bundle outcomes, subsection IDs, merged PRs, checks/reviews and cleanup. Update existing
status/cards/index and the permanent merged-PR handoff. Reaching N bundles or pushing
a checkpoint does not complete the session while eligible obligations remain.
An actual execution limit requires an explicit incomplete, recoverable handoff.


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

When the current owner specifies N bundles, continue toward that target under
the evidence-backed blocker/limit rule above. Without a specified target, use the
available recoverable context for complete approved outcomes. A suitable PR may integrate
several adjacent small slices (typically targeting 400–800 changed production lines
plus tests), but contracts, review risk and end-to-end behavior determine size;
a smaller complete subsection contributes toward the planned substantial bundle; a larger coherent bundle is legitimate. Session PR count is set only by the current owner prompt.
Do not count a passing helper as a completed outcome. After each verified
merge, checkpoint the exact head/CI/reviews, completed slices, implementation
and deployed/real-acceptance state, and one next action. Continue the planned bundle after checkpoints. A demonstrated execution limit
requires an explicitly incomplete handoff with exact recovery action; a clean
checkpoint or speculative context concern does not establish bundle completion.
Persist unfinished work on its existing approved card, not only in chat.
Report completed roadmap slices and acceptance deltas, first-pass CI failures
and correction cycles, not PR count as a productivity metric.
Historical maintenance notes do not redefine the current owner request. Follow its actual scope/target; preserve safety and report genuine execution limits with concrete evidence.
At completed-session end update status/cards/index, verify final main, leave a permanent
handoff on the final merged PR and automatically give a short continuation prompt:
repository + verified handoff + next outcome + queue pointer. Refer to the repository
for rules/order rather than recopying them. Preserve interrupted-session obligations.

## 6. Safety and specialized procedures

Governing instructions, existing PLAYBOOK/hosting rules, owner decisions and the card's
specific safety procedures remain binding. Reuse saved authorized developer connections.
Security, money-out approval, production activation, spend, isolation, exact fixture
cleanup, secret handling and all required local/Actions tests are unchanged.
