# START HERE — Vercel by Robinson AI Systems

**Product identity / live capability notice (2026-10-19):** **Vercel by Robinson AI Systems** is an independent, unofficial connector, not the official or Vercel-endorsed integration. The public technical MCP ID, `vercel_*` tool names and saved OAuth connections remain stable. Read `PRODUCT-AUTHORITY-AUDIT.md` for the authority verdicts. Service-owned remote HTTPS MCP is at `/api/mcp`; RTC manifest at `/api/contract`, pass HTTP API at `/api/tools` (read passes, and write-capable passes since R-1W); Hub is optional. Desktop and mobile compatibility depends on each coding-agent client's remote MCP/OAuth support; the owner's desktop connection is verified in use, and per-client acceptance is tracked in `CLIENT-CONNECTIONS.md` and `STATUS.md`. Prefer nonproduction and verified provider scope; do not paste credentials into chat. Do not mistake a successful OAuth screen, installed ChatGPT plugin or TEST whoami for true Vercel operations.


A standalone, hosted Node 24 / ESM Vercel MCP service using a dedicated Vercel deployment and Neon PostgreSQL. It already has broad provider-specific read and guarded-write code across projects, deployment, environment/configuration, team/security and developer tools; availability is **not** the same as fully delegated or real-world accepted behavior. Source-level direct MCP/RTC and the one OAuth sign-in are implemented — profile, mode and listing are derived at issuance, credential enrollment is a branch of the sign-in flow, and owner administration happens on the owner's own connection (the former owner setup page was deleted in the 2026-10-31 sign-in cleanup, AUD-AZ…AUD-AY); write-capable RTC grants (R-1W) and the customer spending/approval policy (IN-08 as ruled; OP-2) are implemented too. Independently tested mobile connections and the formal per-client matrix remain incomplete. Legacy developer-only restrictions must not become customer policy, but present safety guards cannot be bypassed. A separate verified V-1 native run-list read exists; acceptance verdicts are recorded in `STATUS.md` (2026-10-30 filings), and the two-tenant live leg (UA-18) remains open.

**Direct desktop/mobile setup and reconnect:** [CLIENT-CONNECTIONS](CLIENT-CONNECTIONS.md); the owner's desktop client is verified in use — other clients are verified per client, not by assumption.

## Read only what this work needs

1. Implementing a card: [SESSION-START](SESSION-START.md) (one page). Otherwise AGENTS — workflow and hard limits.
2. [STATUS](STATUS.md) — current head/state/next item.
3. [MASTER-ROADMAP](MASTER-ROADMAP.md) — order of batches and work coverage.
4. Next card, then its named design headings and code. If JIT, write the short card from the design first;
   [drift protocol](implementation-contracts/DRIFT-PROTOCOL.md) applies every time.
5. PLAN's acceptance for the batch and PLAYBOOK's verification commands.

For concrete files, mappings, tests and successor contracts, select one recipe from
[implementation guidance](implementation-guidance/README.md). It also maps remaining batches and works through B-8b;
these are execution aids, not prewritten distant cards or changes to the approved designs.

## Code map — current implemented locations

`api/`: standalone `mcp.js`, OAuth (authorize plus the enrollment branch) and well-known discovery, `vercel/connect.js` and `vercel/integration.js` (the two doors), RTC contract and scoped `tools/*`/result HTTP doors. `src/core/`: MCP/OAuth, profile-aware registry and write safety. `src/rtc/`: RTC manifest/HTTP pass dispatch. `src/tools/`: real registered project/deployment/config/security/team/universal/developer families, not the old placeholder modules. `src/vercel/`: provider client, pinned operations, ownership, sign-in/enrollment (`login.js`), spend and guard integration. `src/developer/` and `src/dev/`: developer/run behavior. `src/db.js`: Neon-shaped SQL and additive migration. `tests/unit/`, `tests/db/`, `tests/emulate/`: source/DB/HTTP emulator verification; no `tests/doors/` directory. `scripts/`: checks, release/acceptance tooling; `vendor/vercel-openapi/`: pinned provider schema. Read [ARCHITECTURE](ARCHITECTURE.md) for exact current boundaries.

## One authority per fact

| Fact | Authority |
|---|---|
| Workflow / hard limits | AGENTS; PLAYBOOK for command recipes |
| Current state / ordered work | STATUS / MASTER-ROADMAP / `pr-cards/work-index.json` |
| Remaining acceptance | PLAN |
| How each batch works | `designs/BATCH-*.md` (targeted headings); the card for exact execution |
| Every tool and its safety marks | TOOL-CATALOG |
| What each profiled app needs | `APP-NEEDS-<APP>.md` (first: APP-NEEDS-APPLIANCE-DESK), `designs/BATCH-P.md` |
| Owner-only inputs / production switches | OWNER-INPUTS / GO-LIVE-CHECKLIST |
| Runtime facts | code and tests; ARCHITECTURE updated as behavior ships |
| Research evidence | `audits/2026-10-10-research.md`, dated DECISIONS; never current instructions |

Preserve stable IDs (cards, `IN-xx`, decisions). Anything that could change production or spend money starts off.
Do not turn a plan or a passing test into a claim of production readiness.
