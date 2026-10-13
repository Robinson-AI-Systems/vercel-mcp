# AGENTS.md — the rules. Read this first, every session.

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
13. **Thin slices, then a recovery point.** Run each slice's tests and lint before writing the next (≤ ~150 lines between
    runs); end every turn right after a push whose resume note names the exact next action.
14. **GitHub REST testing when no local runner (permanent owner instruction).** In a GitHub-connector-only or
    terminal-less environment, use the **GitHub REST route** to perform verification on GitHub Actions runners.
    Commit the tested slice to an `ai/*` branch, open a draft PR, and use REST to inspect the exact-head
    `check`, `unit`, `db`, `emulate`, and aggregate `ci` results. Retrieve job logs and check-run
    annotations through REST; fix failures on the branch, let each run finish before a new push, and merge only
    when both required exact-head `ci` and `release-policy` checks are green. This is remote CI testing, **not** locally executed tests:
    never claim otherwise, never skip tests for lack of a shell, and do not require Chris's PC. See
    `docs/SESSION-START.md` §6 and `docs/PLAYBOOK.md` Step 4b for the REST workflow.

15. **Mandatory five-merge close-out (never stall after the fifth merge).** Immediately after a session's fifth
    successful merge, run the close-out checklist in SESSION-START §7. Verify the exact main SHA, five merged
    PR numbers and exact heads, all five post-merge CI check conclusions, zero remaining session PRs,
    and every review thread resolved. Then deliver the plain-English outcome and the compact copy-ready
    next-session prompt in the **same reply**. Do not start a sixth PR. If GitHub CI is pending or an
    API call is blocked, give the exact verified state and recovery action in the handoff now;
    never silently wait or report pending checks as passed.

## Outcome-first milestone delivery and continuation (permanent)

Every session begins by verifying live `main`, concurrent branches/open PRs,
review threads, exact-head CI, owner answers and `docs/pr-cards/work-index.json`.
Resolve demonstrated security/correctness/CI defects first. Select the
**highest-priority eligible capability milestone** with explicit user-facing
behavior and finite acceptance, not a count of PRs. Plan cohesive substantive
PRs that materially deliver that outcome and satisfy the existing risk/size
limits; five merged PRs are a normal **batch boundary**, never completion
evidence or a reason to invent work. Stop earlier only for a real external
gate, exhausted safe eligible work, or an explicit instruction; record why.

Track separately **implemented code**, **local/CI tests**, **deployed HTTPS
verification**, **authenticated custom-MCP acceptance**, and real Toolkit Hub
**direct, private relay, Sandbox and revocation** runs when applicable.
Passing mocks, reference conformance, build/configuration checks or ordinary
provider connectors is not deployment/connected evidence. Do not close a
milestone without its *actual* required acceptance; however, continue
approved independent work while an external acceptance gate is pending.

Every handoff and copy-ready next-thread prompt must name the actual
verified `main` SHA, merged PRs, current milestone and outstanding criteria,
next **eligible** action, due/deferred items and objective blockers. Direct
the successor to this repo's authoritative workflow, cards and final PR's
permanent handoff instead of repeating all rules. Tell them to recheck newly
answered owner input, dependency merges and changed environments, preserve
review/CI/hosting/production/spending gates, normally perform the next
five-PR outcome-based batch and produce the same compact prompt. Keep
detailed history/evidence in repo, not in an oversized continuation prompt.
Do not create a separate documentation-only PR to maintain this workflow.

## Scoped blockers are problems to solve, not permission to stop (permanent owner directive, 2026-10-12)

A blocker affecting one tool, operation, acceptance item, environment or milestone is **not a whole-project blocker**.
Before declaring any work blocked, identify the failing contract and investigate its root cause: reproduce or inspect
the defect, check CI logs, code, OpenAPI/provider mappings, configuration, dependencies, stale documentation,
hosting limits and **owner decisions already answered**. Attempt every authorized repair and complete every eligible
implementation/test step. Never convert an engineering defect into an unanswered owner question.

Only after attempted remedies may a remaining unmet requirement be classified as a genuine external gate
(permission, secret/credential, paid resource, unavailable provider evidence, owner approval or external deployment).
Record its exact scope, root cause, attempts, independent evidence, dependency, next executable action,
owner and re-entry condition in the existing work index/STATUS; never bypass security, spend, data integrity,
owner approval, or assert fabricated connected acceptance. **Isolate that operation**, enumerate the
remaining roadmap/dependencies, and immediately progress the highest-priority approved independent task
(including approved read-only exceptions). Do not let one unverified endpoint freeze D-1/D-2 or unrelated cards.
Recheck triggers at each PR boundary, session start and whenever environment/owner/dependency evidence changes;
return newly eligible work to active implementation automatically.

Five substantive merges remain the normal batch boundary, counting already merged PRs; neither pad with
unrelated tasks nor stop early merely because a preferred acceptance step is externally gated. An early stop
requires concrete evidence that *all* safe eligible work has been exhausted or a specific execution limitation,
including what was attempted and the smallest external action truly needed. Future continuation prompts
refer back to this authoritative rule and identify the next concrete outcome, unverified acceptance and due
re-entry triggers, not just a PR quota.

## Owner-assisted blocker recovery and PR alignment — permanent 2026-10-13 directive

The normal session batch is five **substantive** merged PRs. When resuming at an
unaligned PR number, adjust the current batch to finish on the next PR-number
multiple of five (e.g. latest #158 → target #160); subsequent sessions finish
at #165, #170, etc. Recheck actual numbering and concurrent PRs. Never pad,
fragment work or relax acceptance/review gates to achieve numerical alignment.

A missing owner-only credential, pass, permission, approval or external
verification is not permission to silently end the session. First investigate
the actual failure; attempt authorized code/configuration/API/CI repairs,
inspect decisions and existing credentials, and complete independent eligible
roadmap work. When progress still requires the owner, **ask in this same
conversation** with an exact, plain-English, least-privileged action: where to
click/configure, how to confirm, why it is needed, the affected PR/acceptance
gate, and whether it entails secrets, spending, elevated access or production.
Never ask for passwords, passes or tokens in chat. Clearly label what the
agent can repair itself. After the owner completes the action, reverify and
**resume this same session**, keeping completed work. Do not issue a premature
continuation prompt as a substitute for an actionable owner request.

When no authorized independent work remains, give an "Action Required to Resume"
report with actual merged/open PR count and target, exact blocker and observed
evidence, exact owner action, and immediate verification/implementation on
re-entry. Only normal-close and issue a compact next-session prompt after the
assigned work is complete, the owner explicitly says stop, or work is truly
impossible and the owner declines/cannot supply the required action.
All next-session prompts must preserve the five-substantial-PR normal batch,
multiple-of-five ending, scoped investigation/independent work, direct owner
escalation and same-conversation recovery. Never fabricate provider,
deployment, release, authenticated routing or revocation acceptance.

## Blocked work must return to the roadmap (all future cards)

A blocked or incomplete card is **not** postponed indefinitely. Before switching to another
card, put a machine-validated `revisit` entry in `docs/pr-cards/work-index.json`:
reason, exact owner/dependency/external trigger, named next implementer, next action,
and a concrete checkpoint (normally the next substantive PR/session start).
The matching STATUS/owner-input rows must identify what is actually answered,
what code is finished, what is intentionally unsupported, and what still lacks
external acceptance. Answered owner decisions **must never remain listed as a
current owner-input blocker**; resume the applicable card or preserve its verified
remaining work with an explicit checkpoint. Do not clear a card merely because
an owner approved a policy. Do not defer indefinitely by inventing hardening PRs.

Before picking a new feature, reconcile the work queue against the owner-input
ledger and the predecessor handoff; follow a documented read-only early-start
exception when a separate owner-only gate blocks writes (D-2 after D-1 is the
current example). `npm run check` enforces revisit records and rejects stale
owner-blocked classifications. Never weaken production, spending or data guards
to satisfy the queue.

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

Build what the current card asks, completely. Other ideas go in `docs/ROADMAP.md` and your report — don't build them
unasked. Owner decisions live in `docs/OWNER-INPUTS.md` with stable IDs (`IN-xx`); check there first and ask only for
what the current card needs. Build what doesn't depend on a missing answer; keep the dependent behavior off.

**Configurable by default.** Limits, thresholds and defaults (daily spend limit, sandbox minutes, pass lifetime, rate
limit, result size cap, seat price, cost target, protected resources, profile contents) are stored settings with a
sensible starting value, explained in plain words in the tool description or setup page. Money is shown in dollars and
cents; stored in integer cents. Times stored UTC, shown America/Denver.

## How work is organized

- **Approved designs, just-in-time cards.** Implement only approved scope (`docs/designs/BATCH-*.md`, `docs/PLAN.md`).
  The implementing model writes the card for the current unit (and its immediate successor when useful) from the
  approved design and actual code (`docs/pr-cards/README.md`). A missing card means write it, not stop. Production,
  spend, secrets and guards follow the design's contract; if it can't work, propose a dated amendment and get it
  reviewed.
- **Drift and reconciliation** (`docs/implementation-contracts/DRIFT-PROTOCOL.md`): checklist A before each PR, B inside
  each PR written as if it had already merged, C when a batch finishes.
- **PR size:** about 500 production lines and 15 files, hard stop ~800 lines, at most one migration, one risk area
  (PLAYBOOK Step 3a).
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
| Exactly what one PR builds | `docs/pr-cards/<ID>.md` (wins over the design where they differ) |
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
- Target approximately **450–800 changed production-code lines** only when the unit genuinely warrants them. The existing ~800-line hard stop and one-risk-area/migration constraints in PLAYBOOK still win. No padding, placeholders, invented endpoints or empty PRs. Five PRs means five quality gates, not five tiny features.
- Within a group, reuse authorization, input validation, provider calls, independent read-back, replay and test fixtures. A guarded handler must use `bindGuardedWrite` around the matching `defineWrite`; no caller-written contract literal can authorize the registry. Transport replay identities must distinguish operation plus stable mutation parameters/discriminator.
- Run focused tests once per cohesive group, consolidate related fixes before each CI push, and avoid duplicate discovery/commits. Never skip exact-head CI or defer a security review finding. See `docs/implementation-guidance/RECIPES.md` §7 and the grouped D-1 card. If REST-only, use the Actions CI fallback unchanged.

## REST-only interruption recovery (2026-10-12; mandatory)

When a connector call disconnects, tool context is interrupted, or a session stops mid-PR, **do not restart from the original task or infer that a write failed**. Use the exact `ai/*` branch, PR list and main SHA on GitHub to establish whether a commit/push/merge happened. Fetch the branch head; compare it with the last known commit. Resume from the smallest unfinished step, avoiding duplicate GitHub writes and purchase requests. If a remote write's outcome cannot be determined, read it back before repeating it.

In REST-only sessions, open a draft PR after the first cohesive tested slice and put a short `docs/pr-cards/<ID>.progress.md` resume note on the branch naming branch, last commit, what passed/failed, and the **one next action**. Before each continued edit, read any failed CI annotations; each push starts a fresh exact-head CI cycle. After an interruption or server disconnect, use a different available connector route or make one bounded retry, then record a specific blocker; never retry an ambiguous mutation blindly. Merge only green exact-head reviews and CI. Keep the user informed at the next safe checkpoint instead of doing many calls silently. Delete the progress note in the finished PR, but preserve these instructions.

## Daily release and build-cost policy (owner, 2026-10-12)

PRs target `main`. Follow [the daily release policy](.github/RELEASE-POLICY.md): only the daily scheduled job updates `live`; Vercel builds only `live`. Do not request or wait for a Vercel preview deployment, manually deploy production, or promote at a development batch boundary. Keep all existing local/Actions tests mandatory; this policy introduces no new application build/browser requirement where none existed. This newer owner instruction supersedes older batch/weekly release guidance.

## Verified hosting and main protections — October 12, 2026

Follow [the verified hosting-cost operating policy](docs/HOSTING-COST-POLICY.md). Saved exact-main protection requires GitHub Actions `ci` **and** `release-policy`; preserve existing review/agent merge flow, daily checked `main` → `live`, disabled automatic previews, low compute caps and all owner gates. Do not wait for Vercel preview checks or manually deploy at a batch boundary. Record this infrastructure checkpoint in the next substantive PR's status ledger; no documentation-only PR.
