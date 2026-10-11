# STATUS — current work, blockers and next action

Updated 2026-10-11. **A-1 foundation, A-2 schema (PR #6), A-3 OAuth/MCP endpoints (PRs #7/#8), and A-4 official API transport (PR #12) and A-5 owner setup (PRs #13–#15) are implemented, with all five post-merge CI checks green on `main`.** No real Neon database has been created or initialized, no Vercel token has been added, and nothing is deployed or live.

## Next

- **D-1f guarded empty-project creation (#52):** signed server-scope stored credential, pre-create existence check, explicit preview confirmation, parent project target self/app guards, double-scope durable replay, real POST /v11/projects, and independent GET read-back. Does not attach Git, env variables, deployments or spend. Next D-1 settings mutation and member roles; no live activation.

- **D-1e guarded-provider transport and mandatory session handoff (#51):** independent logical/transport replay keys, server-selected credentials, fail-closed write binding, explicit routine-write profile metadata and immediate five-merge close-out. The general gateway has no project mutation published yet. Next: independently test and register project creation with `defineWrite`, followed by project and member changes. Production remains inactive.

- **D-1d cron schedule read (#50):** read project `crons.definitions` (not a fabricated array), return only route/schedule/source and UTC schedule with January/July Denver DST examples for simple daily expressions. No job invocation, URL query or secrets, cross-project access blocked. Missing definitions reported unavailable rather than empty. Project alias and cron-count projection corrected. D-1 remains IN_PROGRESS; next guarded project/member/cron/Git mutations, no owner/production changes.

- **D-1c Git discovery (#49):** pinned-schema compatibility normalizer strips invalid untyped nullable annotations and exact duplicate oneOf alternatives without removing allowed-type constraints, with a narrow Git namespaceId union compatibility rule that retains established request coercion;  provider-approved namespace and repository reads, server-stored credentials, per-token exception only for the Vercel Git namespace endpoint (no unsupported teamId), team injection on repo search, sanitized outputs, scope denial and request-shape tests. D-1 IN_PROGRESS; next crons. No owner/production gate changes.

- **D-1b member and cursor reads (#48):** authenticated project member/role list, server-selected team and strict project-only account restriction, safe summaries, bounded pagination inputs and project-list cursor continuation. Fake HTTP, malformed input and scope denial regressions; offline only. D-1 remains IN_PROGRESS; next cron and Git discovery.

- **D-1a project reads (#47):** server-selected encrypted credential binding and two verified read-only project operations (team list/single project), fail-closed project-account isolation, bounded response fields, fake REST tests, and no provider writes. D-1 remains IN_PROGRESS; next project member, cron and Git reads.

- **B-1 through B-7 merged (#17–#23):** guarded write architecture, owner production approval, self-protection, safe errors/output, profiles, and catalog-enforced write-safety CI.
- **B-8a verified merged (#24):** main `fad643a011171fee5766be9d05c0e4aa602e9ba9`, all five post-merge CI checks passed. Three read-only server tools (connections, recent changes, guided dashboard directions), scoped queries and token expiry warnings. All offline/test-only.
- **B-8b owner administration built in #26–#35:** scoped read/recheck and account isolation; local owner-only default selection (#30), exact spend limits (#31), serialized connector revoke (#32); encrypted single-use requests (#33), owner review (#34), and independently authenticated local application (#35). These are server-side, offline-tested capabilities, **not live operations**.
- **B-8 completed (#24, #26–#40):** all named MCP owner-account tools now register safely as production/full-profile guarded **approval requests only** (#37–#40). Confirmed issuance returns an encrypted, tenant/action/target-bound ten-minute reference with `confirmed:false`, durable replay and independent inspection. Actual account changes still require a separately authenticated setup session, CSRF, a fresh passphrase, owner confirmation, atomic SQL safety and verified read-back (#30–#35). Current enabled door is MCP; meta dispatch/HTTPS remain future C-2/R-2 and must inherit the same guarded registry. **Next: C-1** summaries, fields/detail, scoped result handles and annotations, then C-2. IN-07/IN-08 remain open; default spending is $0 and production inactive.
- **C-1a scoped result-storage foundation (#41):** per-bearer opaque owner identity, sanitized bounded result table and scoped SQL read-back with ≤100 expired-row cleanup. No MCP retrieval exposed yet. Next central C-1 projection and display/retrieval before C-1 completion.
- **C-1b view rules (#42):** explicit safe provider summaries, nested fields projection with unknown-path reporting, full/summary views and secret-key omission even for full env results. Next integrate 8 KB handles/metadata into the MCP door.
- **C-1 completed (#41–#43):** per-bearer result ownership, bounded sanitized storage, reusable summaries/fields/detail, read-only paged `vercel_get_result`, and centrally advertised read view/annotations. Next C-2 compact/catalog discovery and wrapped meta dispatch; no production activation.
- **C-2a compact discovery (#44):** profile-authorized catalog/compact listing, `vercel_search_tools` and `vercel_describe_tool` with strict validation and exact schema disclosure only to eligible callers. Next C-2 wrapped `vercel_call`/read-only `vercel_batch` and token budget hardening; C-2 IN_PROGRESS.
- **C-2c budget close-out (#46):** pinned gpt-tokenizer 3.4.0 replaces character-count approximation. The exact MCP-advertised compact and everyday catalog shapes, every registered schema and all description lengths are enforced with planted failing fixtures. C-2 and Batch C complete; next D-1 project/Git/crons provider reads and guarded writes. No live resources or owner gates changed.\n- **C-2b wrapped meta calls (#45):** `vercel_call` delegates only to the existing scoped/guarded dispatcher and `vercel_batch` rejects any mixed/hidden/write input before executing up to ten read calls. C-2 budget enforcement subsequently completed in #46. Production and owner approvals unchanged.
- **Not activated:** no Neon instance initialized, real Vercel token set, or server deployed. Owner inputs IN-07/IN-08 and all live change approvals remain outstanding.

## What works today (A-1)

| Command | What it proves |
|---|---|
| `npm run check` | secret scan of every tracked file, docs reconciliation, work-index validation, lint, catalog consistency (236 tools), write-safety, core-imports, token budgets |
| `npm test` | unit suite: fake Vercel API, registry, every check script against planted violations, db contract on the fake |
| `npm run test:db` | the db contract on throwaway Postgres (CI service; locally a disposable cluster from local binaries) |
| `npm run test:emulate` | Vercel Labs' `emulate` 0.12.1 started on localhost, Vercel-shaped reads answered, stopped afterwards |

CI (`.github/workflows/ci.yml`): jobs `check`, `unit`, `db`, `emulate`; the aggregate job **`ci`** is the single merge
gate and fails unless all four succeeded. Proof it turns red: [run 38077445050](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38077445050) — a deliberately failing unit
test made `unit` and `ci` red while `check`, `db` and `emulate` passed; the test was then removed. Final green run:
linked in PR #1.

## Environment

- Repo: `Robinson-AI-Systems/vercel-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; CI must be green at the exact head before merge.
- Vercel project, Neon database and Vercel tokens for this server: not created yet (IN-02, IN-03, IN-04). Not needed
  until A-5 is tried for real.

## Recent merges and implementation checkpoints (newest first)

**2026-10-11 — B-8b local owner default-account setting (#30 merged):** production-server-only owner setup form, signed session + CSRF + fresh passphrase + explicit confirmation. A single SQL statement changes the global default and writes safe audit; read-back required to claim success. Unit tests for owner security and disposable-Postgres tests for missing target, concurrent selections, one default, unchanged credentials/connector settings. No MCP owner write or provider mutation, B-8 remains IN_PROGRESS.


**2026-10-11 — B-8b owner boundary design (#29, pending CI/merge):** reviewed trust boundary for locally authenticated owner-only default selection, future targeted revocation/spend and concurrency/audit requirements. No code/DB mutation, no MCP write exposure or live resources. Next safe slice: implement default selection in the existing owner setup form with offline DB/unit evidence.


**2026-10-11 — B-8 account-list isolation (#28, pending CI/merge):** connector-scoped account lookup replaces global enumeration for `vercel_list_accounts`. Owner web panel retains authenticated global listing. Disposable Postgres test checks safe columns, tenant filtering and missing account; unit tests reject forged selector and verify no cross-account data. No owner operations enabled, B-8 still IN_PROGRESS.


**2026-10-11 — B-8b authenticated owner panel (#27, pending CI/merge):** recheck current stored token by owner-selected account on existing authenticated setup form, after session and CSRF validation; block unknown targets and sanitize provider failures; no credential replacement, approval, money, profile or database writes. Unit tests of forged session/CSRF/account, safe response and errors. B-8 remains IN_PROGRESS.


**2026-10-11 — B-8b token read recheck (#26, pending CI/merge):** encrypted stored credential loaded only inside service; three bounded GETs, stored-team/project binding, fail-closed incomplete pages and wider visibility, no persisted metadata, no write/owner permissions granted. Unit regressions for invalid caller inputs, error cases, tenant isolation, zero mutations. B-8 remains IN_PROGRESS; next mutation requires reviewed owner identity/concurrency policy.


**2026-10-11 — Implementation guidance:** added current-code locators, reusable execution recipes, remaining-work map
and a B-8b worked example; startup/card-writing instructions link only the relevant sections. Proposed paths and
unresolved owner/connection boundaries are explicit; no product behavior, defaults, owner inputs or work-index status
changed. Verified #24 merged; B-8b remains next. See [guidance](implementation-guidance/README.md).

**2026-10-11 — B-8a (PR #24 pending CI/merge):** working bounded read-only account/connection metadata and change-log summaries, guided settings map, near-expiry warnings; disposable Postgres tenant-isolation regression. Remaining B-8b owner mutations explicitly deferred.

**2026-10-11 — B-7 verified merged (#23):** guard declarations proven with all five CI checks; main `1f9767c96bcb2e6524178a83612bdcb23e896ee5`.

**2026-10-11 — B-7 write declarations (PR #23 pending CI/merge):** strict catalog-linked write safety checks and violation regression tests; no external actions.

**2026-10-11 — B-6 verified merged (#22):** strict profile filtering and home-page counts; main `1c925847c2f808282b5689a321e50a22e65c4141`.

**2026-10-11 — B-6 profiles (PR #22 pending CI/merge):** centralized strict profile-based listing and tool invocation, retained exact local owner switch allowlist, added home-page counts and direct-invocation regression tests. No live provider actions.

**2026-10-11 — B-5 verified merged (#21):** safe recursive output and encrypted one-use input handling, aggregate CI green; main `0bc55c5ed23cef009236e20f27a838f0be0f7f97`.

**2026-10-11 — B-5 result shaping (PR #21, pending CI/merge):** added provider-neutral recursive secret redaction, Denver-local millisecond dates, integer-cents display, size/depth checks and Vercel MCP boundary integration; one-use owner-input resolver and encrypted created-secret references. Offline unit tests; no real provider calls.

**2026-10-11 — B-4 verified MERGED (#20):** commit `83bdd0ccb1ed642c773032f68da656aafda2835e` and all five post-merge checks succeeded. No real credentials or production operations.

**2026-10-11 — B-4 error reporting (PR #20 pending CI/merge):** reconciled unfinished branch with merged B-3; maps recognized provider codes to safe actionable explanations, preserves status, safe operation and Denver rate-limit window, and rejects credential-shaped scope labels. Unit and MCP dispatch tests. No live writes or credentials.

**2026-10-11 — B-3 self-protection (PR #19 pending):** global/team protected-project rules and inherited child-resource guards, protected server token and ID, owner-authenticated add-only protection editor, read-only listing and application guard hook; unit and isolated Postgres tests. No live resources modified.


**2026-10-11 — B-2 owner production guard (PR #18 pending):** adds dedicated pending approval from full preview profile, expiring one-time reference, owner password reentry under setup CSRF, production-server-only switch, confirmed disable with bearer revocation, event audit. Unit and disposable Postgres tests validate no direct AI production enablement. No live change.


**2026-10-11 — B-1 trust-layer primitives (PR #17, merge pending):** generic fail-closed write policy, production classification, integer-cents spend checks, durable request replay and sanitized audit logs. Contract tests cover all eight expected behaviors; no public mutations.


**2026-10-11 — A-6 owner deployment instructions (PR #16, merge pending):** added `docs/DEPLOY.md` explaining controlled dedicated Vercel/Neon setup, safe environment variables, owner-only token entry, read-only MCP connector sign-in and troubleshooting. Documentation only; no external services created.


**2026-10-11 — A-5 owner setup (PRs #13/#14 merged, #15 merge pending):** AES-GCM encrypted credentials, atomic one-time values and inputs, passphrase-locked setup with encrypted 15-minute cookie and CSRF, conservative protected-project defaults, and safe read-only account tools. All tested offline, no live secrets.


**2026-10-11 — A-4 official API transport (PR #12, prepared for merge):** added `src/vercel/client.js`, `operations.js`, strict JSON/schema request validation, snapshot-find/diff scripts, bounded retries/rate-limit/pagination, an additive 10-minute atomic `request_replay` claim table, fake/emulator tests and disposable-Postgres replay concurrency checks. No real Vercel call or token used. Merge only after latest CI is green at the exact head and documented self-review.


**2026-10-11 — Branch reconciliation:** no open PRs or drafts at session start; ten prior AI branches had zero commits ahead of `main`, while `ai/gpt6/a-3b-oauth-endpoints` had only one superseded documentation line in `docs/pr-cards/A-3.md`. That line is already corrected by the merged A-3 record; do not merge the divergent old branch. No historical implementation needs recovery.

**2026-10-11 — Official Vercel OpenAPI snapshot (A-4 prerequisite):** imported the original 11,611,860-byte response from `https://vercel.com/openapi.json` without reformatting, at `vendor/vercel-openapi/openapi-2026-10-11.json`. `SOURCE.md` records SHA-256 `af1db6e9c95e446468f0c3974653298afe8079db03ee2872429a65cb60a72544` and 451 HTTP operations. This is **not** completion of A-4; client and validators remain.

**2026-10-11 — A-3b endpoint implementation (PR #8, merge pending):** fixed-origin HTTP helpers, client registration, passphrase-gated authorization, PKCE/resource checks, code/refresh-token exchange, well-known metadata, bearer authentication, default-deny read-only dispatch, and the status page are implemented. CI run [38141774150](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38141774150) passed all jobs at head `27db3ef4e2e884133be1805fe3221a86450d0dae`; this commit reconciles the final roadmap/card wording and triggers the final CI confirmation before merge. No real Neon database or Vercel token was used.


**2026-10-11 — A-2 database schema (PR #6, merged as `0cd2e1e11154603049e4bb6a514f83df6fc15837`):** nine additive tables and eight indexes; lazy Neon configuration; frozen connection-field contract; fake and throwaway-Postgres schema tests. CI run [38139075567](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38139075567) passed all four jobs and aggregate `ci` at head `330dda3367e80a26b958faf579051ac88cae4fe3`. No real Neon database was created or initialized.


**2026-10-10 — CI cadence (docs + CI config PR):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation (PR #1, branch `ai/claude/a-1-foundation`):** Node 24 ESM package with committed lockfile
and exact versions; `scripts/check-secrets.mjs` (tracked files, planted-token test), `check-docs-updated`,
`check-catalog`, `check-writes`, `check-budgets`, `check-core-imports`; empty registry (`mergeNamespaces`);
`test/helpers/fake-vercel.js`; throwaway-Postgres harness; pinned `emulate` runner; four CI jobs plus `ci`.

**2026-10-10 — Gap check against prior toolkits:** every Vercel tool name from Chris's earlier toolkits mapped in
`audits/2026-10-10-prior-tools.md` — 273 unique names: 211 covered, 7 universal, 44 dropped with reasons, 9 tools added
(E-4, M-2, M-4 with IN-15). Catalog 232 hand-built + 4 universal = 236; work index 59 cards (old-toolkit decision note dropped).

**2026-10-10 — Plan written:** research audit, TOOL-CATALOG, 15 batch designs, AGENTS, START-HERE, SESSION-START,
PLAYBOOK, drift protocol, PLAN, MASTER-ROADMAP, owner inputs, go-live checklist, decisions, roadmap, owner guide,
Appliance Desk project profile, work index with validator, card A-1.

## Blocked

- Owner inputs open: IN-02 … IN-15 except IN-14 (answered: not needed) (`OWNER-INPUTS.md`); none blocks A-2 or A-3.
