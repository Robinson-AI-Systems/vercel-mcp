# MASTER ROADMAP — the one handoff

## Maximum legitimate authority — owner-approved 2026-10-21

[MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) adds five indexed units CAP-1..CAP-5:
operation inventory; ordinary fullest authority; secure additional credential lifecycle;
advanced functional gaps; independent proof. **Reconciled 2026-10-30 (verdicts in
[MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md)): CAP-1 SUPERSEDED in purpose (a
generated operation ledger is the one unbuilt artifact — commission or waiver owed);
CAP-2 SATISFIED in source; CAP-3 SATISFIED in source for existing credential kinds;
CAP-4 SATISFIED in source except R-2's HTTP write-contract leg; CAP-5 OPEN by design
(two-tenant live acceptance).** Existing acceptance and unfinished original cards retain
priority. Named-tool counts do not establish provider API coverage. No runtime grant or
release change is implied.

**October 19 owner decisions (current):** Distribution, directory eligibility, publication applications and commercial launch strategy are the Robinson AI Systems organization's responsibility **outside this repository**. This server owns correct independent branding, direct MCP/provider authorization, specs, client interoperability and security only. No distribution milestone or owner input blocks Vercel MCP completion. [PRODUCT-AUTHORITY-AUDIT](PRODUCT-AUTHORITY-AUDIT.md) enumerates open engineering gaps. R-2 source-stage PR #219 implements public-client S256 PKCE, existing confidential OAuth compatibility, owner-configurable RTC read pass rates (120/min default; legacy 60/min preserved), branding and regression tests. Its source CI was green on `e43ad22ae9fedcfd79af4eaf9c1a06eda4306991` before this documentation reconciliation. **R-1/R-2 write-capable RTC, delegated paid authority and independent real client/provider acceptance remain unfinished.** Do not count R-2 complete based on a merged partial implementation. *(Superseded in part, 2026-10-31 AUD-AN: R-1W write-capable RTC passes and delegated paid authority shipped in source 2026-10-30; independent real client/provider acceptance has partially advanced — A-3/A-6/A-10/A-14/A-15 pass — and remains open as a program; R-2's separate HTTP write-contract leg is still open.)* Hub live connection is Hub-owned, not this server's completion gate.


## Gateway dependency correction — 2026-10-12

Standalone RTC conformance and direct authorized service acceptance are mandatory. **Owner 2026-10-19:** successful live Hub discovery, connection, OAuth orchestration, routing, relay or Sandbox acceptance is Hub-owned, not a Vercel MCP completion requirement. Shared core adoption is also optional. See HUB-COMPATIBILITY.md. Hub's H-series remains its own project.

Written 2026-10-10 for an empty repository. [STATUS](STATUS.md) holds current state; [PLAN](PLAN.md) holds acceptance.

## Owner-approved cross-cutting end-user authority correction (2026-10-17)

The October 17 owner clarification supersedes interpretations of $0, preview-only, mandatory owner-per-transaction and no-production **developer/acceptance instructions** as enduring customer restrictions. This does not authorize any builder to perform paid/live operations. The actual code paths listed in [END-USER-AUTHORITY](END-USER-AUTHORITY.md) remain a **completion obligation** under existing B/C/U, D/V, O/P/R and applicable other batches, not a newly claimed delivered phase. Reconcile them against actual account permission, user delegation and provider limits before claiming unrestricted end-user parity. V-4/V-5 source already merged in #216; finish the remaining R-1/R-2 authority and R-3 conformance, then the coherent shared customer-delegation seam and actual owner-authorized client/provider acceptance. No helper-sized credit or changes to other providers.

## What is next

**Current state (2026-10-31, AUD-AN):** the catalog build-out is complete — **240 of the 241 catalog tools are registered** (the one unbuilt row, `vercel_admin_overview`, is closed by owner ruling IN-16) and every batch A–X has shipped in source. What remains is not building: the live acceptance program ([STATUS](STATUS.md) carries the record), R-2's separate HTTP write-contract leg, R-3 conformance, the X-2 scratch run, and CAP-5/UA-18 two-tenant live acceptance. The independently hosted Vercel MCP project, dedicated Neon schema and owner token are already configured. Do not re-provision existing infrastructure.

**Rule:** session PR count/scope comes only from the current owner prompt,
never from a standing quota or PR numbering. Prioritize real acceptance and usable
capability; revisit blockers automatically when owner, dependency or
environment evidence changes. Preserve all independent owner approvals,
daily checked live promotion, disabled previews and $0 autonomous spend.
A-1 through A-6 and B-1 through B-8 are merged (B-8 completed #40). The official OpenAPI remains pinned to 2026-10-11.
Use [implementation guidance](implementation-guidance/README.md) for current helper paths, recipes and the B-8b worked
example when writing the JIT card. A dedicated hosted Vercel project, initialized Neon schema and verified encrypted owner team credential were confirmed on 2026-10-13; independently authenticated full client/provider acceptance is separately pending. Owner gates remain unchanged.

## Order and why

| Stage | Batches | Why in this place | Owner gate |
|---|---|---|---|
| 1 Foundation | A | Nothing works without it | IN-02/IN-03/IN-04 before A-5 can be tried for real |
| 2 Safety | B → C | Every later tool is built on the safety layer (production, spend, access, secrets, self-protection) and the context rules | IN-07 (protected list), IN-08 (answered 2026-10-17: the $0 default binds builders only; end-user delegation is remediation) |
| 3 Everyday building and running | D → E → V | Projects, deployments and releases, then variables, then the developer tools that make building any project on Vercel fast (previews per branch, env wiring, diagnosis, sandboxes, cleanup) | IN-09 ruled 2026-10-27 (production on; the switch is the user's); IN-13 answered 2026-10-17 (no artificial Sandbox quota) |
| 4 The rest of the platform | N → F → M | Domains/DNS/registrar, security and traffic, monitoring and integrations | IN-08 for real purchases (never in tests) |
| 5 Owner | O | Team, members, tokens, billing, admin reviews and every dashboard setting (the overview tool was closed by IN-16) | — |
| 6 Projects | P → W | Optional project profiles and readiness for any app (Appliance Desk first), then the one-sentence jobs | IN-11 (answered YES 2026-10-27: defer to the app's own release rule) |
| 7 Everything else | U → R | Universal access and independently accessible RTC 1 tool API; Hub optional | IN-10 answered 2026-10-19 (120/min default; owner selected per pass) |
| 8 Close-out | X | Undo, real-team smoke test and scratch run | IN-06 (answered YES 2026-10-27; fixture creation is the owner's step) |
| Production | GO-LIVE-CHECKLIST | Production stays on per the owner's ruling; the per-team switch is the user's, flippable by their agent with their approval | IN-09 (ruled 2026-10-27) |

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
| B Trust | B-1 safety + declarations · B-2 production guard · B-3 self-protection + profile hook · B-4 errors · B-5 shaping + secrets · B-6 profiles · B-7 check-writes · B-8 server tools | MERGED ×8 (#17–#40) |
| C Context | C-1 small results · C-2 listing modes + budgets | MERGED ×2 (#41–#46) |
| D Projects and deployments | D-1 projects/members/crons/Git · D-2 deployment reads/logs/checks · D-3 deployment changes · D-4 releases | IN_PROGRESS ×4 (source largely merged, live acceptance pending) |
| E Variables and config | E-1 project env · E-2 shared env + custom environments · E-3 Global Config · E-4 Global Config tokens + schema | IN_PROGRESS ×4 (source largely merged, live acceptance pending) |
| V Developer tools | V-1 runs/seed/cleanup · V-2 previews/env/aliases/bypass · V-3 logs/diagnosis/fetch/check · V-4 sandboxes · V-5 test webhooks | V-1/V-2/V-3 MERGED (#206/#207/#209); V-4/V-5 IN_PROGRESS (source merged #216, live acceptance pending) |
| N Domains | N-1 domains · N-2 DNS + certificates · N-3 registrar | MERGED in source (2026-10-30 build-out; live acceptance per STATUS) |
| F Security and traffic | F-1 protection · F-2 firewall · F-3 routes/redirects/cache | MERGED in source (2026-10-30 build-out) |
| M Monitoring and integrations | M-1 logs/analytics · M-2 drains/webhooks · M-3 integrations/storage · M-4 Blob files | MERGED in source (2026-10-30 build-out) |
| O Owner | O-1 team/security · O-2 members/access groups · O-3 tokens · O-4 billing/activity · O-5 admin reviews + dashboard map | MERGED in source (O-5's reviews shipped; the overview tool closed by IN-16) |
| P Project profiles | P-1 known_apps + Appliance Desk · P-2 readiness · P-3 project setup + draft | MERGED in source (2026-10-30 build-out) |
| W Workflows | W-1 … W-6 (`designs/BATCH-W.md` §4 table) | MERGED in source (2026-10-30 build-out) |
| U Universal | U-1 | MERGED in source (`vercel_api_write` built, PR #297) |
| R Hub-ready doors (RTC 1) | R-1 passes · R-2 HTTPS API, manifest, rate limit · R-3 conformance in CI | R-1/R-2 MERGED in source incl. R-1W write-capable passes (R-2's HTTP write-contract leg open); R-3 conformance open |
| X Close-out | X-1 undo · X-2 smoke + scratch run | X-1 MERGED (`vercel_undo_change`, PR #330); X-2 scratch run open |
