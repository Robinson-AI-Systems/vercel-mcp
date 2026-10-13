# MASTER ROADMAP — the one handoff

## Gateway dependency correction — 2026-10-12

RTC interface work and authorized nonproduction Hub route acceptance are independent of K-3 package adoption.
Follow current STATUS/index and service isolation/owner gates. Optional reuse must not block provider capability
or require replacing service-owned dispatch/state. Hub's H-1–H-3 work belongs in its repository.

Written 2026-10-10 for an empty repository. [STATUS](STATUS.md) holds current state; [PLAN](PLAN.md) holds acceptance.

## What is next

**Current user/developer outcome:** guarded owner team administration (O-1 profile, privacy/security and standard new-project authentication), then independent U-1 discovery and scope-verified reads based on merged C-2. D-1/D-2 code acceptance is complete but genuine hosted/provider/Hub acceptance remains pending. No vercel-mcp project appeared in the authorized provider inventory recheck. Re-enter D-2 when an authorized disposable deployment, custom HTTPS service and stored scoped account become available. O-1 SAML/auto-join, retention and directory mappings require lockout, destructive inventory and cost evidence; no unverified owner mutation.

**Rule:** five substantive PRs is a normal session boundary, not a
milestone-completion condition. Prioritize real acceptance and usable
capability; revisit blockers automatically when owner, dependency or
environment evidence changes. Preserve all independent owner approvals,
daily checked live promotion, disabled previews and $0 autonomous spend.
A-1 through A-6 and B-1 through B-8 are merged (B-8 completed #40). The official OpenAPI remains pinned to 2026-10-11.
Use [implementation guidance](implementation-guidance/README.md) for current helper paths, recipes and the B-8b worked
example when writing the JIT card. No live database, token or deployment is configured; owner gates remain unchanged.

## Order and why

| Stage | Batches | Why in this place | Owner gate |
|---|---|---|---|
| 1 Foundation | A | Nothing works without it | IN-02/IN-03/IN-04 before A-5 can be tried for real |
| 2 Safety | B → C | Every later tool is built on the safety layer (production, spend, access, secrets, self-protection) and the context rules | IN-07 (protected list), IN-08 (spend limit default) |
| 3 Everyday building and running | D → E → V | Projects, deployments and releases, then variables, then the developer tools that make building any project on Vercel fast (previews per branch, env wiring, diagnosis, sandboxes, cleanup) | IN-09 only to use production mode for real; IN-13 before V-4 merges |
| 4 The rest of the platform | N → F → M | Domains/DNS/registrar, security and traffic, monitoring and integrations | IN-08 for real purchases (never in tests) |
| 5 Owner | O | Team, members, tokens, billing, admin overview and every dashboard setting | — |
| 6 Projects | P → W | Optional project profiles and readiness for any app (Appliance Desk first), then the one-sentence jobs | IN-11 (Appliance Desk release rule) |
| 7 Everything else | U → R | Universal access; the contract doors Robinson's Toolkit (the hub) uses | IN-10 (pass rate limit) |
| 8 Close-out | X | Undo, real-team smoke test and scratch run | IN-06 |
| Production | GO-LIVE-CHECKLIST | Only after Chris enables production per team | IN-09 |

## Implementing agent — paste this

> Read `docs/SESSION-START.md`, STATUS and the next card (plus its resume note `docs/pr-cards/<ID>.progress.md` if
> present). Find the cited design headings and named code/tests in bounded sections. Run the drift protocol checklist A
> against latest main. If no card exists, write one short card from the approved design (`docs/pr-cards/README.md`) with
> exact current paths, production/spend/secret/guard boundaries, meaningful tests and completion evidence. Routine
> details are yours to implement; a missing production/spend/security/schema decision needs a reviewed amendment, not a
> guess. Implement a coherent unit, run the targeted checks, push once. While checks run, implement only the eligible
> immediate successor. Fix blocking findings in one patch, refresh exact-head gates, merge when authorized and green.
> Update the card, STATUS and `work-index.json` as if merged. Continue while eligible work exists; stop only for a real
> gate, with committed work and the exact next action.

## Work coverage

`docs/pr-cards/work-index.json` is the machine-readable list (`python3 docs/pr-cards/validate-index.py`). **JIT** =
covered by the approved design; write the card when its predecessor is real.

| Batch | Cards | Card status |
|---|---|---|
| A Foundation | A-1 repo, CI, checks · A-2 schema · A-3 login · A-4 Vercel client + OpenAPI snapshot · A-5 token store, setup page, one-time secrets, pending inputs · A-6 DEPLOY.md | A-1 MERGED (#1) · A-2 MERGED (#6) · A-3 MERGED (#7, #8) · A-4 MERGED (#12) · A-5 MERGED (#13/#14/#15) · A-6 MERGED (#16, subject to final CI) |
| B Trust | B-1 safety + declarations · B-2 production guard · B-3 self-protection + profile hook · B-4 errors · B-5 shaping + secrets · B-6 profiles · B-7 check-writes · B-8 server tools | JIT |
| C Context | C-1 small results · C-2 listing modes + budgets | JIT |
| D Projects and deployments | D-1 projects/members/crons/Git · D-2 deployment reads/logs/checks · D-3 deployment changes · D-4 releases | JIT |
| E Variables and config | E-1 project env · E-2 shared env + custom environments · E-3 Global Config · E-4 Global Config tokens + schema | JIT |
| V Developer tools | V-1 runs/seed/cleanup · V-2 previews/env/aliases/bypass · V-3 logs/diagnosis/fetch/check · V-4 sandboxes · V-5 test webhooks | JIT |
| N Domains | N-1 domains · N-2 DNS + certificates · N-3 registrar | JIT |
| F Security and traffic | F-1 protection · F-2 firewall · F-3 routes/redirects/cache | JIT |
| M Monitoring and integrations | M-1 logs/analytics · M-2 drains/webhooks · M-3 integrations/storage · M-4 Blob files | JIT |
| O Owner | O-1 team/security · O-2 members/access groups · O-3 tokens · O-4 billing/activity · O-5 admin overview + dashboard map | JIT |
| P Project profiles | P-1 known_apps + Appliance Desk · P-2 readiness · P-3 project setup + draft | JIT |
| W Workflows | W-1 … W-6 (`designs/BATCH-W.md` §4 table) | JIT |
| U Universal | U-1 | JIT |
| R Hub-ready doors (RTC 1) | R-1 passes · R-2 HTTPS API, manifest, rate limit · R-3 conformance in CI | JIT |
| X Close-out | X-1 undo · X-2 smoke + scratch run | JIT |
