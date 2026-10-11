# START HERE — Robinson Vercel MCP

A hosted MCP server (Node 24, plain ES modules, Vercel serverless + Neon Postgres) that gives Chris's AI agents safe,
almost-complete control of his Vercel teams — for building, owning and operating. Same family and conventions as
`Robinson-AI-Systems/stripe-mcp` (the reference plan) and `Robinson-AI-Systems/google-workspace-mcp` (reused code is named
in `docs/designs/BATCH-A.md`). General-purpose across Chris's projects; apps that manage parts of their own Vercel setup
get a project profile (Batch P), the first being the Appliance Desk rental app (`docs/APP-NEEDS-APPLIANCE-DESK.md`).
Chris operates mostly from a phone; everything he reads must be plain language.

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

## Code map (target; confirm the actual path before editing)

`api/` Vercel functions (`mcp.js` connector, `oauth/*` login, `vercel/setup.js` token page, one-time secrets, pending
inputs and the protected-resources editor, `tools/*` HTTPS API, `contract.js` RTC manifest) · `src/core/`
contract-generic code (no Vercel imports; extracted later into `robinson-mcp-core`) · `src/vercel/` the only Vercel
client, operation table, OpenAPI index, production rules, spend table, shaping · `src/tools/` one module per area
(`projects.js`, `deployments.js`, `releases.js`, `env.js`, `domains.js`, `dns.js`, `registrar.js`, `protection.js`,
`firewall.js`, …) plus `self-guard.js`, `app-guard.js`, `production-guard.js`, `summaries.js`, `errors.js`,
`server.js`, `index.js` · `src/dev/` scenarios and build-failure rules · `src/data/dashboard-map.js` guided settings ·
`src/db.js` all SQL · `tests/unit|db|emulate|doors` · `scripts/` checks · `vendor/vercel-openapi/` Vercel's published
API description, dated snapshot.

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
