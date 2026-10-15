# AGENTS.md — the rules. Read this first, every session.

## Session entry and authority

“Do N bundles” starts the complete procedure in [docs/SESSION-START.md](docs/SESSION-START.md).
N sets new implementation workload only; acceptance, reconciliation, required checks,
reviews, merges, cleanup and permanent handoff remain session obligations. Project
instructions need only identify this repository and point here; keep workflow rules
in the repository. A push or met bundle count is not permission to omit closeout.
This owner-requested workflow-tooling repair is maintenance, not a product bundle.


## Owner-requested implementation detail — October 14, 2026

Read only the applicable subsection in [IMPLEMENTATION-DETAIL.md](docs/implementation-contracts/IMPLEMENTATION-DETAIL.md)
under **Concrete implementation contracts** before building remaining roadmap work.
It supplies concrete state/input/output, file-seam, failure/recovery and fixture
contracts for Sol 5.6. Existing approved scope, card/public schemas, owner inputs
and all security/CI/review/release gates remain authoritative. This is explicitly
requested design maintenance, not a product-completion PR. Do not re-request
general roadmap approval or convert these internal steps into batch subsections.

## Anti-stall execution contract — owner correction 2026-10-15

**A running CI job is not productive work, and a red job is not a stop condition.**
Do not repeatedly query the same check run without a changed result or an actionable
reason. After a PR push, check CI once; while jobs run, work on the next approved
independently eligible engineering/test/review seam without breaking the two-open-PR
limit. Return to CI when enough work/evidence exists or the result changes. Never
create an unrelated PR to look busy or leave a failing PR uninvestigated.

**Failure-resolution loop:** collect the complete job conclusions and all failing
test/check messages before changing code; distinguish actual contract, test-fixture,
integration, lint, and governance/index failures. Read the pinned provider schema
before changing a fixture. Reproduce with the smallest available focused check.
Apply one coherent correction set to the existing PR, verify locally where possible,
then run mandatory exact-head gates once. If the same failure repeats, add a
new diagnostic proving the failing boundary; do not make speculative pushes or
weaken safety assertions. A blocked resource does not block independent roadmap work.

**Interruption and visibility:** at each substantive tool/CI boundary, update the
current PR/card or permanent handoff with branch and exact head, subsection ID,
failure evidence, next concrete action, and what remains **unverified**. In an
interactive chat, give the owner a useful progress message rather than silently
polling. Once a chat turn ends, the agent is NOT still coding in the background:
on the next user message re-fetch the real branch, checks, reviews and concurrent
PRs and continue from that snapshot. Never claim asynchronous progress or future
delivery. Keep the owner's workload target and all actual merge/review/CI/security,
provider spending and release restrictions intact. Fold this guidance into the
current substantial implementation PR; do not make a docs-only PR.

## Crash-safe coding checkpoints — owner correction 2026-10-15

An agent must **not** keep a long implementation solely in chat context or unattached GitHub blobs. A blob-creation response is NOT a recoverable branch change. After assembling the first cohesive source files, immediately create a fast-forward branch commit and draft PR; keep subsequent work on that same PR. Before another large multi-file coding stage, commit the current coherent stage, update the PR with existing subsection IDs and remaining acceptance, and record the exact head. Never defer the entire branch commit until cards, tests, documentation and all optional polish are complete. Do not publish unfinished work as completed or merge a checkpoint merely to make it persistent.

**Checkpoint frequency by risk, not PR count:** commit promptly after a logically consistent source+test stage or whenever interruption risk rises (many remote tool calls, a long chat, context exhaustion, or a user interruption). Review current code and run focused tests before publication when a runner is available; draft checkpoints may be red and must be marked so. In a REST-only environment, let exact-head Actions show actual checks. Add remaining tests/docs to the same substantive PR; an early draft is NOT an extra batch subsection or completed bundle. If a tool call takes time, give one useful status update and do not poll unchanged check state. Always prioritize restoring a durable draft branch over writing another large uncommitted module.

**Resume contract:** on any new user interruption, re-fetch branch and open PRs, find the last actual commit (not a blob SHA or an unsubmitted tool plan), reconcile loose blobs only when verified, and continue the existing approved subsection. Do not assume any source authored only in the previous chat exists in the repository. Do not ask the owner to repeat known instructions. Preserve all checked CI/review, security, provider, billing and release gates. This instruction is included in the next substantial implementation PR, never a documentation-only PR.

## Session PR count comes from the current owner prompt

There is no repository-default session PR count, upper quota or PR-number
alignment target. Follow the count or scope in the current owner prompt for that
session only; do not carry it into later sessions. If no count is specified,
continue the approved ordered work within a safe, recoverable context budget.
Keep checkpoints, complete coherent PRs and preserve all required gates.
The rolling sample used for per-PR workload statistics is not a session quota.

## PR workload is measured in predefined batch subsections — owner clarification 2026-10-14

**Bundle, card and PR boundaries — owner alignment 2026-10-15.** A card defines
approved subsection scope; it is not automatically a PR or bundle boundary.
A bundle is a coherent usable implementation outcome, normally averaging 2–5
fully completed existing subsections and 400–800 meaningful production-code
lines (tests/docs/generated/formatting excluded). Select the related cards and
full acceptance before coding. One substantial subsection can qualify when its
full workload naturally warrants it; merely finishing a smaller card does not
make it a bundle. Larger coherent outcomes are allowed when reliably reviewable.
There is no 500/800-line ceiling, file-count ceiling, one-migration quota or
blanket one-risk-area rule. Related migrations may share a PR with explicit
ordering, upgrade/restore proof and safe rollout. Keep every distinct risk,
permission, confirmation and provider boundary independently enforced/tested;
shared delivery never combines or relaxes those controls. Split delivery only
for a concrete migration, dependency, safety or reviewability reason; record
that reason and the unfinished integration. A bundle spanning PRs counts once
when its intended outcome is fully implemented, verified and merged. Keep measuring the existing rolling per-substantive-PR workload averages even
when a bundle spans PRs; explain smaller justified deliveries rather than hiding
them in bundle totals. The current
owner prompt sets bundle count, never a standing repository quota. These rules
supersede older numeric/grouping restrictions in recipes or example cards.


**The countable work unit is a predefined batch subsection** in the authoritative
approved roadmap/design, such as H-3, H-4 or B-5 (use this repository's actual IDs).
The target is **2–5 fully completed batch subsections per substantive PR on
average**, alongside the existing 400–800 production-line average. Prefer the
substantial end when related work safely supports it. This does not redefine
“slice”: a technical slice may be a useful internal implementation step, but it
is not the unit used to satisfy the PR workload target.

**Freeze the counting boundary before coding.** List the existing batch-subsection
IDs and their full scope/acceptance in the PR. A function, endpoint, tool, UI
hookup, guard, helper, test or checklist item is work WITHIN that subsection.
Internal packet tasks, new JIT cards, subcards, commits and local checkpoints do
not create additional countable subsections. Do not subdivide, rename or relabel
work to increase the count. A partial subsection counts as ZERO completed
subsections; keep its remaining engineering against the same ID. Across PRs,
count each subsection once, when its full eligible engineering and required
pre-merge proof are complete. Keep external acceptance separately open where
existing rules permit; never hide unfinished engineering in that queue.

**Build a substantial coherent PR.** Group related whole batch subsections.
If one whole subsection naturally requires about 600 production lines, one is
a legitimate boundary. Larger coherent work is allowed when manageable. Never
pad code, combine unrelated risks, or claim completion with engineering missing.
The existing workload averages apply to these predefined subsections, not to
smaller technical slices, packet tasks or individual functions.

**Validate the assembled workload.** During implementation run focused tests
and lint at meaningful changed seams. A local check/checkpoint is not a PR
boundary. Assemble related subsection work before running the full required
publication checks, security/CI/review and applicable database/browser suites
on the coherent PR. Fix failures together; repeat checks when code changes or
new evidence warrants it. Do not rerun every broad suite and rewrite full
handoffs after every helper. Every existing mandatory gate remains binding.

Older references to “2–5 slices” or “completed slices” as a PR workload metric
mean **2–5 predefined batch subsections**. Technical slices and execution-packet
tasks retain their ordinary use as internal implementation aids; their count
does not establish completed batch subsections.


## Original Toolkit is reference-only — owner clarification 2026-10-14

`Robinson-AI-Systems/robinsons-toolkit-mcp` is the historical capability reference,
not an active implementation/deployment target. The standalone custom MCP servers
and optional `robinsons-toolkit-hub` replace it. Do not maintain/rebuild the original,
resume its recovery PRs, synchronize implementations back to it, or require a bridge.
Preserve its code/history for coverage and behavioral research. When the owner chooses a new provider MCP, its implementing agent inventories the
relevant legacy tool names, families, workflows and intended behavior, reconciles them
with current provider contracts, and tracks coverage in THAT project's cards/index.
The Hub stays provider-agnostic: discover/connect/authorize/route/read results for
new contract-compatible MCP servers without provider-specific handlers or a fixed
family list. Future services and legacy catalog parity are not Hub completion gates.
Do not copy provider capabilities into the Hub or start speculative server projects.
Mapped/planned is not implemented or accepted. Service autonomy and all existing
provider/security/owner gates remain binding.


## Efficient release-aware execution — owner instruction 2026-10-14

[SESSION-START](docs/SESSION-START.md) is the consolidated session procedure;
`npm run session:status` prints the read-only release acceptance queue and remaining-roadmap summary.
Its workflow/cadence/merge-versus-live-proof rules supersede older conflicting procedural
wording below, but never override explicit safety or pre-merge owner/card gates.
Use substantial cohesive outcomes; numeric production-line targets are advisory rather
than artificial hard caps. Full mandatory checks run before publication, with focused
checks during development. Product acceptance stays open until real evidence passes.
The owner explicitly authorized this cross-repository guidance/tooling optimization;
routine implementation sessions still prohibit filler/documentation-only PRs.

## Roadmap-throughput and context-safe execution — owner correction 2026-10-14

**Completion outranks PR count.** The goal is completed, usable, safely proven product
functionality, not GitHub activity. Each PR must integrate at least one whole eligible
roadmap slice; package multiple adjacent small slices from the same approved parent
outcome when their contract, risk, callers, integration and tests belong together.
Target **400–800 changed production-code lines per substantive PR on average**
and **2–5 fully completed predefined batch subsections per substantive PR on average**,
measured over the latest five merged implementation PRs when available.
These are planning averages, not hard bounds or a reason to pad code, split
coherent outcomes or bundle unrelated risks. Count production source changes
only, excluding tests, documentation, generated files, fixtures and formatting.
Record actual source additions/deletions and completed slice IDs with their
acceptance evidence in each PR/handoff. Missing historical measurements stay
unknown. A helper is not a completed slice; eligible engineering and pre-merge
checks must be finished. Deployed/provider acceptance remains separately open.
Explain legitimate smaller safety fixes and larger inseparable outcomes.

**Session scope follows the current owner prompt.** Do not invent small PRs
or pad changes to satisfy a number. Spend the chat's usable context
on complete outcomes; after each merged PR, preserve an exact recoverable
checkpoint (branch/head, card/slice coverage, focused and CI proof, open review,
deployed/live versus source, pending acceptance and next action). Before starting
another work unit, assess whether the remaining chat context can support its
implementation, corrections, tests, merge and handoff. If not, finish a clean
checkpoint instead of beginning work likely to be abandoned. Never use a
continuation prompt instead of completing currently feasible work.

**Remaining-work visibility.** Run `npm run session:status` for current
roadmap counts and unfinished IDs in approved order alongside the separate
release acceptance queue. Counts describe the existing index/ledger's coarse
units (including separately listed planned/blocked/optional work), not proof of completed subsections, time estimates or live acceptance.
Record actual completed slices and remaining engineering in existing cards
and handoffs; never promote an incomplete card to improve the numbers.
Follow the designated roadmap order rather than the milestone in an old handoff.

**Adaptive CI budget and measurement.** Validate focused behavior at meaningful
code seams, run required complete gates on the final coherent tree and fix all
reported failures in one root-cause-informed correction cycle where possible.
If repeated CI fixes occur, investigate contract/test drift and reduce the
*next* PR's risk surface; do not silently split the current work to manufacture
success. Track complete slices/outcomes, real acceptance closed, remaining
work, first-pass CI failures, correction pushes and actual review overhead.
Lines of code and merged PRs are diagnostic statistics, not progress scores.
Every safety, money-out, service autonomy, release and approval gate remains.

## Mobile and tool-unavailable connection recovery

Before treating absent private-plugin tools as an acceptance blocker, follow
`docs/pr-cards/DEVELOPER-CONNECTION.md` → **Agent connection recovery when private plugin tools are absent**.
Use this repository's own saved native OAuth connection through an authorized HTTPS-capable
runner; identify its exact origin and service identity, then run purpose-specific acceptance.
The owner's phone is not the execution runner. Missing tools in one chat do not establish
expired provider authorization. Keep the protected checkpoint single-runner and preserve
all operation, provider, production, spending and isolation gates.


## Product, builder and acceptance boundaries — owner correction 2026-10-13

This repository builds a full independently usable custom MCP integration. Do not narrow
its production tool catalog, implemented operations or runtime profiles to match a temporary
coding-agent test grant. The implementing agent is a separate principal: renewable developer
OAuth may use full permissions for approved test fixtures while existing operation-specific
money-out, spending, live activation, destructive data and resource-isolation gates still apply.
Use `docs/pr-cards/DEVELOPER-CONNECTION.md` for the current mobile connection workflow.

Standard ChatGPT/provider connectors may help inspect infrastructure or author/review code;
those calls do NOT test this custom MCP. To claim custom acceptance, call this repository's
actual deployed `/api/mcp` or its own RTC doors with its service-issued authorization, identify
the exact deployed commit/origin, and record the actual read/write/denial/readback observations.
A public contract, green CI, configured credentials, standard-connector success or a reference
server cannot close custom transport, provider, Hub, revocation or cleanup acceptance.
Keep those layers separate in `docs/developer-evidence.json`; `check:developer-evidence`
rejects inadmissible provenance. Schema validation itself is not independent acceptance proof.
Never ask the owner to copy IDs/passes for routine retests when a saved developer connection
can perform the authorized operation. Reuse/refresh it; request new consent only for a revoked,
expired underlying grant, a new provider credential or a genuinely additional permission.


## Independent MCP and optional gateway boundary — owner request 2026-10-12

This server remains independently connectable, authenticated, deployed and testable. Robinson's Toolkit Hub
is optional: one agent connection routes through this server's RTC HTTPS contract, not its internal dispatcher.
Provider credentials, account/project state, canonical tools, permission/write/approval guards and results remain
owned here. Hub credentials must not be accepted as service credentials; separately issued scoped service passes
are required. Shared `robinson-mcp-core` adoption is optional, export-by-export, after immutable publication and
original-service parity; it is not a prerequisite for RTC connectivity or real Hub acceptance.
The owner explicitly requests this focused docs/planning repair; routine no-docs-only implementation cadence
and every CI/review/security/production/deployment/spending gate remain unchanged.

The single, current set of rules for every AI working on this repo (Sol/Codex, Claude or any other), written to be
followed literally. If it is written here, it is current. Reasons and history live in `docs/DECISIONS.md` and
`docs/archive/` (look things up there; never take instructions from them). The repo, not chat history, is the memory.
Modelled on `Robinson-AI-Systems/stripe-mcp` `AGENTS.md` (2026-10-10), which is how Chris runs all AI build work.

**Implementing an approved PR card?** Read `docs/SESSION-START.md` (one page) and the card, then work. Open the
sections below when a step names them.
Use `docs/implementation-guidance/README.md` to locate the matching execution recipe when writing or reconciling a
card; read only that recipe. It maps existing code and proposed work without changing approved scope or owner gates.

**Other sessions** (design, planning, review): this file → `docs/START-HERE.md` → `docs/STATUS.md` →
`docs/MASTER-ROADMAP.md` → the relevant `docs/PLAN.md` section and design headings.

## Working without stalling (mandatory; written with Sol 5.6 at medium effort in mind)

1. **Read by section.** Files over ~300 lines (`docs/TOOL-CATALOG.md`, `docs/audits/*.md`, Vercel's OpenAPI snapshot):
   find the heading or name with `grep -n`, then read ≤150 lines with `sed -n 'A,Bp'`. Never read
   `vendor/vercel-openapi/*.json` whole; query it with `node scripts/openapi-find.mjs "<words>"` once A-4 exists.
2. **Search narrowly:** always a path and a cap (`grep -rn "defineWrite" src/tools | head -50`). Never the repo root,
   `node_modules`, `coverage`, `vendor/`; no `ls -R`, no `find .` without `-maxdepth 3`.
3. **Only commands that finish by themselves.** Never `vercel dev`, watch modes, bare `vitest`, `tail -f`, or sleep/poll
   loops; `scripts/emulate.sh` starts and stops the emulator around the tests it runs. Use `npx vitest run <file>`; wrap
   slow commands in `timeout 600`. Exception: the bounded CI wait in PLAYBOOK Step 10.
4. **Nothing interactive:** `GIT_PAGER=cat PAGER=cat GH_PAGER=cat CI=1`; `npx --yes`.
5. **Cap output** with `| tail -80` and `set -o pipefail`.
6. **Two strikes:** the same command fails or hangs twice → change approach or record the blocker; never a third try.
7. **Explore budget:** after about 10 focused reads/searches without an edit, write down what you know and make the
   smallest justified edit with its test — or report a true blocker. Never guess unsafely to save a read.
8. **Checkpoints:** one coherent work unit with its tests → local commit → update the card's resume note. Publish the
   complete, checked tree with one push (a turn that must end pushes what it has with an exact resume note; no-shell workspaces push each slice — SESSION-START §6).
9. **External waits are checkpoints, not a loop** (PLAYBOOK Step 10).
10. **Two-lane conveyor:** lane A builds the current card and its immediate successor; lane B handles CI/review/merge of
    the predecessor. At most two unmerged implementation PRs in a chain.
11. **Finish before starting.** Every session begins with `docs/SESSION-START.md` §0: an open PR of yours with red CI
    is the current task — fix it before any new card.
12. **Problems are not blockers.** Red CI, lint, failing tests, wrong parameters, conflicts and unclear code are yours to
    fix; stop only for a hard limit or an owner decision the current step needs (SESSION-START §6).
13. **Focused tasks, then a recovery point.** Run affected tests/lint at meaningful seams within the predefined batch subsection; checkpoint the exact next action after a push, then continue required CI/review/merge and session obligations.
14. **GitHub REST testing when no local runner (permanent owner instruction).** In a GitHub-connector-only or
    terminal-less environment, use the **GitHub REST route** to perform verification on GitHub Actions runners.
    Commit the tested slice to an `ai/*` branch, open a draft PR, and use REST to inspect the exact-head
    `check`, `unit`, `db`, `emulate`, and aggregate `ci` results. Retrieve job logs and check-run
    annotations through REST; fix failures on the branch, let each run finish before a new push, and merge only
    when both required exact-head `ci` and `release-policy` checks are green. This is remote CI testing, **not** locally executed tests:
    never claim otherwise, never skip tests for lack of a shell, and do not require Chris's PC. See
    `docs/SESSION-START.md` §6 and `docs/PLAYBOOK.md` Step 4b for the REST workflow.

15. **Session close-out.** When the current owner-requested scope is complete,
    verify actual main, merged PR heads, CI conclusions and review disposition;
    deliver the outcome and compact continuation prompt. Report pending checks
    and exact recovery honestly. Never silently wait or claim a pending check passed.

## What this is

**Robinson Vercel MCP** is a hosted MCP server (Vercel + Neon) that lets Chris's AI agents operate his Vercel teams
safely: projects, deployments, previews, promotions and rollbacks, environment variables, domains and DNS, certificates,
the domain registrar, deployment protection, firewall, routing, logs and observability, drains and webhooks,
integrations and storage, team members, tokens, billing and usage — and, through universal tools, every other Vercel API
operation. It is a **general, powerful tool for developers and account owners alike**: any agent should be able to use
it freely on whatever Chris is working on — building for a client, building for himself, or setting up and running his
own Vercel team. It covers **building with Vercel** (preview per branch, preview env wiring, build diagnosis, log tail,
sandboxes, runs and precise cleanup — Batch V), **owning and administering the team** (admin overview, members and
roles, security, tokens, billing and usage, every dashboard setting through real tools or guided settings — Batch O) and
**day-to-day operation** (everything else). An app that manages parts of its own Vercel setup can optionally get a
**project profile** (Batch P) so the server never fights it. Real projects such as Appliance Desk are used only as
**completeness checks** ("can it do everything this needed?"), never to narrow the design. It is reached through a
Claude connector and a plain HTTPS API, and it follows the **Robinson Tool Contract** (RTC 1) so that **Robinson's
Toolkit** (`Robinson-AI-Systems/robinsons-toolkit-hub`, the hub) can combine it with Chris's other servers. It is a
clear superset of the official Vercel connector for Chris's needs (`docs/audits/2026-10-10-research.md` §3).
**Chris is not a developer:** every update, question or PR summary for him is plain English — what changed, how it was
verified, what he must decide, what is next.

## Priorities (higher wins)

1. Production safety, spend safety and security. 2. Correctness. 3. Low cost for the agents that use it (context and
tokens). 4. Simplicity. 5. Features.

## Definition of Done (non-negotiable)

1. No placeholders, stubs, TODO-as-implementation, or mock data presented as real. A tool either calls the real Vercel
   operation it claims to, or it does not exist.
2. Tests exercise real behavior: every write tool passes the eight write-contract checks (`docs/designs/BATCH-B.md` §3);
   every request shape validates against the vendored OpenAPI snapshot; core areas also pass against `emulate`;
   database code passes against throwaway Postgres.
3. CI green: secret scan, docs check, index validation, lint, write-safety, token budgets, unit, database, emulate.
4. The card's acceptance (from `docs/PLAN.md`) checked item by item with evidence (test names, CI run).
5. `docs/STATUS.md` updated.

If something isn't finished, say so and record it in STATUS. Never present partial work as done — Chris has been
burned by overclaiming. A passing typecheck, a screenshot or a plan is not evidence a feature works.

## Hard limits — stop and ask Chris first

- Using a real Vercel token from tests or scripts, except the read-only smoke test and the scratch-project run of X-2
  that Chris set up (IN-06).
- Any write to a real Vercel team outside that scratch project — above all a **production** deployment, promote,
  rollback, production variable, domain, DNS, firewall or protection change.
- Buying anything: domains (purchase, renewal, transfer), credits, add-ons, seats, Marketplace plans, plan changes,
  Vercel/Neon plans. Tests use fakes only.
- Putting any secret (Vercel token, environment variable value, bypass secret, webhook secret, passphrase, encryption
  key, pass, GitHub token, database URL with a password) in code, docs, tests, logs, PR text or a tool result. Fake
  values only: `vcp_FAKE…`, `vercel_blob_rw_FAKE…`.
- Changing anything outside this project: the Appliance Desk repo or its Vercel/Neon projects, the Stripe MCP, the
  Google Workspace MCP, Robinson's Toolkit, other Vercel/Neon projects. Reading them for reference is fine.
- Changing resources a profiled app owns (Appliance Desk today), outside a test fixture.
- Widening what a token, connection or pass may do by default. IN-07 separately authorizes owner-authenticated removal of project exclusions; never weaken token integrity or high-risk operation approvals.
- Making this server depend on Robinson's Toolkit (the hub). It must stay **fully usable on its own** — connector,
  HTTPS API and passes — whether or not the hub ever exists.
- Committing directly to `main`.

## Scope and owner decisions

Build the full selected approved card or related cards for the current bundle. Other ideas go in `docs/ROADMAP.md` and your report — don't build them
unasked. Owner decisions live in `docs/OWNER-INPUTS.md` with stable IDs (`IN-xx`); check there first and ask only for
what the current card needs. Build what doesn't depend on a missing answer; keep the dependent behavior off.

**Configurable by default.** Limits, thresholds and defaults (daily spend limit, sandbox minutes, pass lifetime, rate
limit, result size cap, seat price, cost target, protected resources, profile contents) are stored settings with a
sensible starting value, explained in plain words in the tool description or setup page. Money is shown in dollars and
cents; stored in integer cents. Times stored UTC, shown America/Denver.

## How work is organized

- **Approved designs, just-in-time cards.** Implement only approved scope (`docs/designs/BATCH-*.md`, `docs/PLAN.md`).
  The implementing model writes the short cards selected for the current bundle (and its immediate successor when useful) from the
  approved design and actual code (`docs/pr-cards/README.md`). A missing card means write it, not stop. Production,
  spend, secrets and guards follow the design's contract; if it can't work, propose a dated amendment and get it
  reviewed.
- **Drift and reconciliation** (`docs/implementation-contracts/DRIFT-PROTOCOL.md`): checklist A before each PR, B inside
  each PR written as if it had already merged, C when a batch finishes.
- **PR boundary:** follow the bundle/card/PR rule above and PLAYBOOK Step 3a. Related whole
  subsections may share a PR; no line/file ceiling, one-migration quota or blanket one-risk-area rule
  forces fragmentation. Document a concrete migration/dependency/safety/reviewability reason to split.
- **Model:** whichever model Chris selected does the work. Sol 5.6 is the routine implementer: light effort for an
  already-tested pattern (a new read tool), medium for the safety layer, guards, production, spend, tokens, passes, or
  anything unfamiliar. A missing decision is never solved by guessing.
- **Branches:** `ai/<tool>/<topic>` from current `main`, or from the unmerged predecessor's branch when stacking.
- **Use the web** for current Vercel API facts (the REST reference, the changelog, the limits page) and MCP spec
  details; cite them in the PR.

## Verify, push, review, merge (details: PLAYBOOK Steps 4–9)

- **Before pushing:** `npm run check` and the card's targeted tests. Never `--no-verify`.
- **One push per CI cycle.** After a red run, read all failures, reproduce locally, fix them all, push once. "Flake" is
  not a cause; never skip, weaken or quarantine a test.
- **Both `ci` and `release-policy` are merge gates**, green at the exact PR head.
- **Review:** read `docs/AI-PR-READ-FIRST.md` for anything touching production, spend, tokens, secrets, guards, auth or
  passes, and record how each applicable constraint is honored. **This repo has no automated review** (IN-01, Chris, 2026-10-10): never wait for or request one. Before merging, inspect the whole
  diff yourself against AI-PR-READ-FIRST and write "Self-review: <findings and dispositions>" in the PR; fix blocking
  findings (security, production, spend, data integrity, contract, acceptance) in one patch. If an organization-wide
  automated reviewer posts anyway, fix or answer each of its threads and resolve them; never wait for one. Never claim a
  review that didn't run.
- **Merging (authorized by Chris):** `ci` and `release-policy` green at the exact head, acceptance met with evidence,
  self-review written → merge with the expected-head SHA. Stacks merge bottom-up, retargeting each PR to `main` first.
  Merging never covers a hard limit.
- **Security, production or spend hole already on `main`:** fix it immediately in its own PR.

## Where the rules live (one source of truth each)

| Topic | File |
|---|---|
| Starting a card session; resume note | `docs/SESSION-START.md` |
| Step-by-step procedure and testing | `docs/PLAYBOOK.md` |
| Every tool: name, purpose, safety, audience, profile | `docs/TOOL-CATALOG.md` |
| Project profiles (what each app needs from Vercel) | `docs/APP-NEEDS-APPLIANCE-DESK.md` (first profile), `docs/designs/BATCH-P.md` |
| Runtime facts (env vars, tables, infra) as built | `docs/ARCHITECTURE.md` |
| Remaining acceptance | `docs/PLAN.md` |
| Approved designs (how) | `docs/designs/BATCH-*.md` |
| Approved subsection scope and selected bundle acceptance | `docs/pr-cards/<ID>.md` (wins over the design where they differ) |
| Current state and next item | `docs/STATUS.md`, `docs/MASTER-ROADMAP.md`, `docs/pr-cards/work-index.json` |
| Owner decisions | `docs/OWNER-INPUTS.md` |
| Dated decisions and reasons | `docs/DECISIONS.md` |
| Ideas not being built | `docs/ROADMAP.md` |
| Go-live switches | `docs/GO-LIVE-CHECKLIST.md` |
| What Chris can ask for | `docs/OWNER-GUIDE.md` |
| Production/spend/secret constraints for PRs | `docs/AI-PR-READ-FIRST.md` |
| The contract every Robinson server follows | `Robinson-AI-Systems/robinsons-toolkit-hub` `docs/CONTRACT.md` (RTC 1) |
| Research: API, old toolkit, official connector, credentials, testing | `docs/audits/2026-10-10-research.md`; every prior tool name mapped: `docs/audits/2026-10-10-prior-tools.md` |
| Retired documents (reference only) | `docs/archive/` |

## Engineering rules for every change

- **Code and tests change together.** Every write tool is built with `defineWrite` and passes the write-contract helper
  through every door this server has (MCP, `vercel_call`, HTTPS API). Contract-generic code lives in `src/core/` and
  imports nothing Vercel-specific, so the hub can extract it into `robinson-mcp-core`.
- **Vercel only through `src/vercel/client.js`** and its operation table `src/vercel/operations.js` (each operation's
  path version pinned and present in the vendored OpenAPI snapshot). Never call an undocumented endpoint; never move a
  path version or the snapshot outside its own card. The one exception is Blob files, which go through the pinned
  official `@vercel/blob` package in `src/vercel/blob.js` (`docs/designs/BATCH-M.md` M6).
- **Every tool name starts with `vercel_`** (`docs/TOOL-CATALOG.md` "Naming").
- **No secret ever returned:** environment variable values of any type, tokens, bypass secrets, webhook secrets, Global
  Config tokens, transfer codes, passes. Created secrets go to the one-time-secret page; secret inputs come from the
  setup page (`pending_inputs`) or are generated on the server.
- **Production is explicit:** a preview connection never changes production; production writes need a production
  connection and `confirm` (`docs/designs/BATCH-B.md` B2).
- **Small results:** every read tool takes `fields` and `detail`; nothing over 8 KB returned without a handle; listing
  descriptions ≤160 characters (`docs/designs/BATCH-C.md`).
- **Database changes are additive** (`IF NOT EXISTS`); previews share the production database.

## CI

The repository may be public: anything committed is public forever. CI runs on every PR: secret scan, docs check,
index validation, lint, unit tests, database tests on throwaway Postgres, `emulate` tests, token budgets.
`.github/workflows/ci.yml` keeps `permissions: contents: read`, uses no repository secrets, never
`pull_request_target`, never echoes environment values. Never commit Vercel team, project or deployment IDs, Neon IDs,
or URLs with credentials.

## How to run things

```bash
npm ci
npm run check                                     # quick gate: secrets, docs, index, lint, catalog, write-safety, core-imports, budgets
npx vitest run tests/unit/<file>.test.js          # one unit file
npm run test:db -- tests/db/<file>.test.js        # throwaway Postgres (scripts/local-postgres-test.sh)
npm run test:emulate -- tests/emulate/<file>.test.js   # against Vercel Labs' emulate (scripts/emulate.sh starts it)
node scripts/openapi-find.mjs "create deployment" # look an operation up in the vendored snapshot (after A-4)
python3 docs/pr-cards/validate-index.py
```

## Ending a session

1. `docs/STATUS.md`: merged, in progress (branch, PR, head SHA, CI run), blocked and why, next.
2. `docs/DECISIONS.md` entry for any design decision; `docs/ROADMAP.md` for out-of-scope finds;
   `docs/GO-LIVE-CHECKLIST.md` for any new switch, token or owner step.
3. Report to Chris in plain English: what changed, how it was verified, what he needs to decide (`IN-xx`), what is next.

## Cohesive PR throughput (mandatory from D-1 security close-out)

- Group adjacent operations **by safety boundary and reusable implementation pattern**, not one PR per endpoint. Prefer a complete related read family or a compatible set of guarded settings mutations with shared before/read-back fixtures. Never group destructive, owner-only, paid or production-sensitive changes with an unrelated operation merely to hit a size target.
- Target approximately **450–800 changed production-code lines** only when the unit genuinely warrants them. The bundle/card/PR rule above controls grouping; retain all actual independent safety and migration-order proof. No padding, placeholders, invented endpoints or empty PRs. Each PR must carry a substantial coherent workload and pass its quality gates.
- Within a group, reuse authorization, input validation, provider calls, independent read-back, replay and test fixtures. A guarded handler must use `bindGuardedWrite` around the matching `defineWrite`; no caller-written contract literal can authorize the registry. Transport replay identities must distinguish operation plus stable mutation parameters/discriminator.
- Run focused tests once per cohesive group, consolidate related fixes before each CI push, and avoid duplicate discovery/commits. Never skip exact-head CI or defer a security review finding. See `docs/implementation-guidance/RECIPES.md` §7 and the grouped D-1 card. If REST-only, use the Actions CI fallback unchanged.

## REST-only interruption recovery (2026-10-12; mandatory)

When a connector call disconnects, tool context is interrupted, or a session stops mid-PR, **do not restart from the original task or infer that a write failed**. Use the exact `ai/*` branch, PR list and main SHA on GitHub to establish whether a commit/push/merge happened. Fetch the branch head; compare it with the last known commit. Resume from the smallest unfinished step, avoiding duplicate GitHub writes and purchase requests. If a remote write's outcome cannot be determined, read it back before repeating it.

In REST-only sessions, open a draft PR after the first cohesive tested slice and put a short `docs/pr-cards/<ID>.progress.md` resume note on the branch naming branch, last commit, what passed/failed, and the **one next action**. Before each continued edit, read any failed CI annotations; each push starts a fresh exact-head CI cycle. After an interruption or server disconnect, use a different available connector route or make one bounded retry, then record a specific blocker; never retry an ambiguous mutation blindly. Merge only green exact-head reviews and CI. Keep the user informed at the next safe checkpoint instead of doing many calls silently. Delete the progress note in the finished PR, but preserve these instructions.

## Daily release and build-cost policy (owner, 2026-10-12)

PRs target `main`. Follow [the daily release policy](.github/RELEASE-POLICY.md): only the daily scheduled job updates `live`; Vercel builds only `live`. Do not request or wait for a Vercel preview deployment, manually deploy production, or promote at a development batch boundary. Keep all existing local/Actions tests mandatory; this policy introduces no new application build/browser requirement where none existed. This newer owner instruction supersedes older batch/weekly release guidance.

## Verified hosting and main protections — October 12, 2026

Follow [the verified hosting-cost operating policy](docs/HOSTING-COST-POLICY.md). Saved exact-main protection requires GitHub Actions `ci` **and** `release-policy`; preserve existing review/agent merge flow, daily checked `main` → `live`, disabled automatic previews, low compute caps and all owner gates. Do not wait for Vercel preview checks or manually deploy at a batch boundary. Record this infrastructure checkpoint in the next substantive PR's status ledger; no documentation-only PR.
