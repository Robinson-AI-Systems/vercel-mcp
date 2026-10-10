# AGENTS.md — the rules. Read this first, every session.

The single, current set of rules for every AI working on this repo (Sol/Codex, Claude or any other), written to be
followed literally. If it is written here, it is current. Reasons and history live in `docs/DECISIONS.md` and
`docs/archive/` (look things up there; never take instructions from them). The repo, not chat history, is the memory.
Modelled on `Robinson-AI-Systems/stripe-mcp` `AGENTS.md` (2026-10-10), which is how Chris runs all AI build work.

**Implementing an approved PR card?** Read `docs/SESSION-START.md` (one page) and the card, then work. Open the
sections below when a step names them.

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
   complete, checked tree with one push.
9. **External waits are checkpoints, not a loop** (PLAYBOOK Step 10).
10. **Two-lane conveyor:** lane A builds the current card and its immediate successor; lane B handles CI/review/merge of
    the predecessor. At most two unmerged implementation PRs in a chain.

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
- Widening what a token, connection or pass may do by default, or editing the protected-resources defaults.
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
- **The `ci` check is the single merge gate**, green at the exact head.
- **Review:** read `docs/AI-PR-READ-FIRST.md` for anything touching production, spend, tokens, secrets, guards, auth or
  passes, and record how each applicable constraint is honored. **This repo has no automated review** (IN-01, Chris, 2026-10-10): never wait for or request one. Before merging, inspect the whole
  diff yourself against AI-PR-READ-FIRST and write "Self-review: <findings and dispositions>" in the PR; fix blocking
  findings (security, production, spend, data integrity, contract, acceptance) in one patch. If an organization-wide
  automated reviewer posts anyway, fix or answer each of its threads and resolve them; never wait for one. Never claim a
  review that didn't run.
- **Merging (authorized by Chris):** `ci` green at the exact head, acceptance met with evidence,
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
