# STATUS — current work, blockers and next action

Updated 2026-10-12. **A-1 foundation, A-2 schema (PR #6), A-3 OAuth/MCP endpoints (PRs #7/#8), and A-4 official API transport (PR #12) and A-5 owner setup (PRs #13–#15) are implemented, with all five post-merge CI checks green on `main`.** No real Neon database has been created or initialized, no Vercel token has been added, and nothing is deployed or live.

## Next

- **D-1bf PR #105 — membership pagination integrity:** complete team/project member inventories now reject contradictory root continuation flags, incomplete next-page signals and declared page counts that differ from observed records. Existing safe role grants/removals refuse before POST/DELETE on contradictory provider inventories. Fake-provider regression coverage; owner-gated admin and nonempty deletion still disabled. D-1 IN_PROGRESS; production inactive.

- **D-1be PR #104 — name-collision race protection:** creation rechecks exact project name availability with the same bound credential that would POST, after any slow Git proof and owner spend checks; a concurrently claimed name or unverified GET refuses all creation. Fake-provider tests cover both empty and paid Git imports. D-1 IN_PROGRESS; no live resources or changed owner gates.

- **D-1bd PR #103 — encoded metadata secrecy:** central credential checks now decode nested percent-encoded text for inspection before projecting project and Git metadata; unknown repeated nesting refuses rather than risking a hidden secret. Read-only fake-provider tests cover nested tokens; no provider write or additional authority. D-1 IN_PROGRESS; production inactive.

- **D-1bc PR #102 — verified user identity for guarded access:** project/team membership inventory and grant/remove checks now require stable `uid` or matching `userId`, and never substitute a membership-record `id` for the user who could receive or lose access. Reject unverified records before POST/DELETE; adversarial identity tests. D-1 IN_PROGRESS; owner-gated admin/deletion disabled and production inactive.

- **D-1bb PR #101 — consistent authenticated Git search:** require the same validated top-level `gitAccount` identity for read discovery and owner-gated metered Git project imports, including preflight and last-moment bound-credential verification. Forged or rotated provider/namespace metadata refuses before POST. Offline fake-provider tests only. D-1 remains IN_PROGRESS; IN-07/08 pending; production disabled.

- **D-1ba PR #100 — canonical Git discovery links:** read-only repository results now expose a provider HTTPS link only when the URL path exactly matches the verified canonical full repository name, and refuse mismatched provider/namespace metadata from both root `gitAccount` and individual repository rows. Fake-provider tests cover same-host link spoofing, encoded paths and cross-namespace rows. Also corrects post-merge #99 P1: percent-encoded cron paths/schedules now redact before MCP output. No live provider write, privileges, production activation or spending changes; D-1 remains IN_PROGRESS.

- **D-1az PR #99 — cron output secrecy:** cron list projection now strips URL parameters while suppressing credential-shaped plain/percent-encoded paths, control-bearing paths, suspicious schedules and provider IDs. No cron invocation or provider write. D-1 still IN_PROGRESS; production remains inactive.

- **D-1ay PR #98 — unambiguous read-only membership identities:** project member reads reject contradictory `uid`/`userId` aliases and duplicate user IDs; membership-record IDs are not misrepresented as user UIDs. Project and member read pages also refuse contradictory root continuation flags. No access grants/removals or elevated authority unlocked. D-1 IN_PROGRESS.

- **D-1ax PR #97 — transfer issuance credential-bound recheck:** a one-time transfer claim now requires an unchanged stored team/account and a fresh immutable project ID/name proof using the exact credential that would POST. Credential rotation or rename aborts before transfer code issuance. No claim is generated in real Vercel; production and owner controls unchanged. D-1 IN_PROGRESS.

- **D-1aw PR #96 — conservative reported resource totals:** irreversible empty-only project deletion requires schema-real pagination counts and rejects any domain, environment or deployment inventory whose declared total contradicts the observed terminal page; totals on preflight and final bound-credential recheck are both enforced. Nonempty deletion, spending and production remain blocked. D-1 IN_PROGRESS.

- **D-1av PR #95 — destructive storage inventory consistency:** empty-only project deletion now inspects both `storageConnections` and legacy `stores` when both are present; a nonempty or malformed secondary inventory refuses DELETE rather than allowing one empty alias to conceal data. D-1 remains IN_PROGRESS; independently owner-gated privileged roles and nonempty deletion remain disabled.

- **D-1au PR #94 — canonical Git import identity:** authenticated repository search now treats `fullName` as authoritative when present; a colliding `slug` cannot override another repository identity before a potentially metered Git project creation. Scope and $0 default preserved; D-1 IN_PROGRESS.

- **D-1at PR #93 — Git repository link authenticity:** read-only Git search only projects canonical HTTPS repository links on the selected Git provider's recognized hostname, excluding external and lookalike hosts. Git identity/spend/creation gates unchanged; D-1 IN_PROGRESS.

- **D-1as PR #92 — truthful project pause status:** project summaries and detail now distinguish unknown, contradictory and confirmed paused/unpaused metadata. Unknown never displays as safely running; provider read only, no traffic change. D-1 IN_PROGRESS.

- **D-1ar PR #91 — verified member identity aliases:** project/team member pagination rejects conflicting provider `uid`/`userId` aliases before any project role grant or revocation. A distinct membership record `id` remains valid. Tested offline; privileged ADMIN/owner changes still disabled; D-1 IN_PROGRESS.

- **D-1aq PR #90 — project member read secrecy:** member ID, display name, email and role now reject credential-shaped provider text as well as control characters and oversized values. Fake-provider tests show secrets cannot escape in read-only MCP results. D-1 remains IN_PROGRESS pending independent owner-gated privileged membership/deletion; D-2 not yet authorized.

- **D-1ap PR #89 — Git discovery output secrecy:** namespace and repository fields reject credential-shaped text, identifiers and repository URLs, including arbitrary provider labels. Fake-provider adversarial tests; no live Vercel actions or widened access. D-1 remains IN_PROGRESS.

- **D-1ao PR #88 — metered resource lost-update defense:** fingerprint selected original build/function settings; final credential-bound GET refuses a concurrent value change before the billed PATCH. Usage-spend and confirmation gates unchanged; no real billable operations or production activation.

- **D-1an PR #87 — reject stale project setting overrides:** project command, directory and framework writes fingerprint their original selected values and recheck them using the PATCH credential. Concurrent edits refuse before mutation, with no raw build-command values in audit/previews. No new production authority; D-1 remains IN_PROGRESS.

- **D-1am PR #86 — last-moment project role collision check:** the guarded grant re-enumerates the complete project membership using the very credential that would POST, refusing any concurrently assigned viewer, developer or administrator role instead of accidentally overwriting it. Race/partial-page tests included. Project ADMIN grant remains gated; D-1 IN_PROGRESS and production inactive.

- **D-1al PR #85 — project traffic execution race hardening:** production pause/unpause now authenticate the current team scope, immutable project identity and original pause state using the same writable credential that would perform POST. Changed state, owner token rotation or project rename abort before traffic impact. D-1 remains IN_PROGRESS pending independently owner-gated operations. D-2 only when roadmap dependency authority permits; production inactive.

- **D-1ak PR #84 — project settings confirmation-time identity and production protection:** rename, framework and grouped build-command/directory updates now validate final project identity and live-status classification through the exact PATCH credential. Project renames, rotated project scope and new live deployments abort before PATCH. D-1 remains IN_PROGRESS; production inactive.

- **D-1aj PR #83 — metered resource execution proof:** guarded build/function resource mutations now recheck immutable project identity, same-bound writable token authority and independently owner-approved daily spending immediately before billable PATCH. Changed limits, scope or project identity abort without write. D-1 still IN_PROGRESS; production inactive.

- **D-1ai PR #82 — destruction credential-race closure:** empty-only deletion now uses the identical write credential and team for complete final inventory and irreversible DELETE. Credential/scope changes cause definite pre-dispatch refusal; conservative project `hasDeployments` remains a hard gate even when the separate page is empty. No new deletion authority or live operations.

- **D-1ah PR #81 — six post-merge review corrections:** canonical metadata sanitization, numeric deployment impact with conservative emptiness, same credential for write-time project access and Git proof, spend policy after Git reads, and retry-safe release for definite pre-dispatch denial. Adversarial unit and database checks; D-1 remains IN_PROGRESS, owner gates and production inactivity unchanged.

- **D-1ag PR #80 — Git-import execution gate:** confirmed Git project imports now recheck stored-account daily spend authorization and independently authenticated namespace/exact repository identity immediately before potentially metered POST. Lost permission or spending headroom aborts without creation. Default $0 spending refusal, no production activation or privileged owner change. D-1 remains IN_PROGRESS.

- **D-1af PR #79 — revocation execution recheck:** before project-role DELETE the bound owner principal, project identity, complete project role inventory, last-member safety and independently verified contributor status are rechecked; any intervening elevated role/identity change aborts. No owner/admin removal enabled. D-1 IN_PROGRESS; production inactive.

- **D-1ae PR #78 — grant-time identity revalidation:** project role grants now re-read immutable project identity and independently re-prove confirmed team contributor eligibility immediately before POST. Changed team role or project identity stops execution; administrative grants remain separately owner-gated, production inactive. D-1 IN_PROGRESS.

- **D-1ad PR #77 — nonempty deletion impact in dry-run only:** authenticated complete inventory counts explain nonempty deletion impact during dry-run without unlocking removal; confirmation remains empty-only and owner-gated. Fake REST verifies no DELETE or sensitive content. D-1 remains IN_PROGRESS.

- **D-1ac PR #76 — safe project metadata projection:** project list and detail whitelists now reject credential-shaped, unbounded or control-bearing scalar fields and suspicious production alias URLs. Project settings/createdAt are bounded; no provider writes or owner gate changes. D-1 remains IN_PROGRESS.

- **D-1ab PR #75 — shared Git import proof:** one fail-closed authenticated namespace verifier now protects both Git discovery and production-classified, potentially metered Git-linked project creation. New exact repository proof rejects duplicate matches, conflicting provider/namespace metadata and restricted/reauth repositories before POST. All previous owner-stored spending, production/full-profile confirmation, immutable read-back, app/protected and replay gates remain unchanged. D-1 remains partial pending separately reviewed privileged membership and nonempty deletion designs. Proceed to D-2 only when dependency authority permits.


- **D-1aa PR #74 — callable, bounded read pagination:** authenticated project and member page tools require explicit valid continuation metadata, reject oversized or inconsistent pages, normalize safe numeric-string cursors to callable integer `until`, and return `complete`/`nextStep` accurately. Member metadata is explicitly bounded. No team scope override or write surface changed.


- **D-1z PR #73 — fail-closed destructive inventory proof:** empty-only deletion now requires explicit Git link state and fully enumerated domains/env collections with terminal pagination, at most 100 entries and no contradictory continuation flags. Missing link, partial or oversized resources refuse before DELETE. No nonempty deletion enabled; full owner and production gates remain intact.


- **D-1y PR #72 — independently verified Git discovery:** authenticated repository search first checks that exactly one matching, accessible Git namespace exists for the selected provider, rejecting restricted/reauth/ambiguous selectors before search. Returned repository links require safe HTTPS with no URL credentials, query or fragment; metadata is whitelisted and bounded. D-1 privileged actions remain gated; production inactive.


- **D-1x PR #71 — richer safe project inspection:** `vercel_project_get` includes whitelisted Git linkage, ignore-build command, deployment presence, pause status, selected compute configuration and bounded production deployment metadata for operational diagnosis. Unknown is null; nested tokens/credentials and arbitrary provider objects excluded. D-1 owner-gated privileged access and nonempty delete remain disabled.


- **D-1w PR #70 — bounded complete membership pagination:** shared authenticated project/team member inventory now follows up to five explicit safe numeric cursors, while refusing duplicate identity, repeated cursor, missing pagination, contradictory flags and excess scope. Large-team viewer/developer grants and removals remain independently owner-safe and production-confirmed; no widened admin rights or real Vercel writes. D-1 still partial; privileged member and nonempty delete require separate approved owner design before D-2 dependency can be declared complete.


- **D-1v PR #69 — independently verified deployment-free deletion:** even when the project GET claims `hasDeployments:false`, empty-project deletion also requires a complete authenticated `/v7/deployments` inventory, exactly scoped to the immutable project ID, before preview and again immediately before DELETE. Unknown/paginated/cross-project/late deployment data fails closed. Nonempty project deletion remains disabled; no live mutation.


- **D-1u PR #68 — provably safe role revocation:** reuse the authenticated team contributor/complete-membership preflight for viewer/developer removals, preventing a misleading project role field from revoking a team owner/member or ambiguous identity. Missing, unconfirmed, paginated or non-contributor team records are denied before DELETE. No new owner role capability or real Vercel write.


- **D-1t PR #67 — independently verified existing team identity:** ordinary project member grants require an independently fetched, complete team page containing exactly one confirmed CONTRIBUTOR matching the supplied UID. The team identifier comes only from the stored account, and no team invitation is issued. Owner/admin project access remains blocked. Fake Vercel and exact-head CI only; no live provider resources.


- **D-1s PR #66 — access-role and pagination safety:** MCP project role grants are restricted to project developer/viewer until an independently authenticated owner design is approved for ADMIN; grant and removal refuse incomplete member inventories (missing terminal cursor, further pages, oversized page). Offline CI only. Remaining D-1 privileged role and nonempty deletion work stays gated; D-2 read tools can proceed independently.


- **D-1r guarded Git-linked creation (#65):** extend existing project creation with exact repository/namespace lookup through the authenticated Vercel Git connection. Unlinked projects retain preview-mode $0 flow. Git imports require full-profile production connection and explicit confirmation, spend policy with owner-set positive limit, pinned POST schema and independent GET identity/Git-link read-back. No repo credentials, user-supplied monetary quote, provider Git tokens or real Vercel writes. Elevated role removal and broad project delete remain independently blocked; IN-07/08 pending.

- **D-1q grouped build/function resources (#64):** full-profile production-confirmed and protected project resource PATCH, with pinned resourceConfig body, authenticated owner limit/spent checks (unpriced usage blocked at $0), no caller-quoted charges, partial-field-only changes and independent resource read-back. No real Vercel spend or production activation. Continue D-1 Git-linked creation and separately approved elevated membership/broad-delete work.

- **D-1p spend boundary preparation (#63):** shared account-bound spend policy reads only owner-approved limit and already-spent cents from the authenticated account; unknown costs cannot bypass $0 default or an exhausted limit, and user confirmation is still required. Paid writes carry integer-cents evidence into the safe change audit (only after actual apply, never on preview). Enables separately reviewed metered project resource settings; no paid writes or live Vercel actions introduced.

- **D-1o guarded project transfer code issuance (#62):** full-profile production-confirmed project transfer request using exact typed project name and protected/app guards. The returned code is stored encrypted for owner-only one-time reveal; only opaque reference enters safe transport replay, audit and MCP. This initiates a claim, never completes a transfer; confirmation of actual ownership is unknown. No connected token or real project used. Remaining D-1: Git-linked creation, build-resource spend controls, privileged membership decisions and broad deletion safety.

- **D-1n correctness repairs (#61):** PATCH project configuration accepts explicit nullable override resets (independent read-back accepts null or omitted defaults); MCP schemas, local validation and pinned request validation enforce 256-character limits for all six fields. Project creation keeps nonnullable configuration. Both unresolved #57 reviewer findings addressed with grouped reset and 256/257 boundary regressions. No production activation. Continue approved D-1 work and independent spend/access/destructive reviews.

- **D-1m guarded empty-only deletion (#60):** separate destructive review, verified scope and resource inventory from project, domains and env GET, explicit typed-name and production confirmation, conservative refuse-on-unknown and independent 404 read-back. Broad delete/transfer/spend remain outstanding. Production inactive; IN-07/08 pending.

- **D-1l grouped project creation (#59):** same six pinned build settings supported on unlinked project creation, shared input validation with project updates and independent full-configuration read-back. Next independently review destructive project deletion; no production activation.

- **D-1k grouped project traffic lifecycle (#58):** production-confirmed pause/unpause with scoped before/after Boolean paused status and no-op replay protection. Full-profile access conservative for resuming metered service. Next independently gated delete/transfer and build-resource spend; IN-07/08 pending, production inactive.

- **D-1j grouped project configuration (#57):** add build/install/dev/ignore commands and root/output directories to the single guarded project PATCH; values never enter previews/audits, existing live-status and read-back checks reused. Next D-1 lifecycle/spend units remain gated; production inactive.

- **PR #56 security/throughput baseline:** resolve unresolved #51 trust-origin, per-mutation transport replay and write-only MCP classification findings with adversarial tests. Group compatible D-1 settings changes in later PRs, preserving approval and risk boundaries. IN-07/IN-08 pending; no production activation.

- **D-1i guarded project member removal (#55):** DELETE /v1/projects/{idOrName}/members/{uid} only for existing viewer/developer roles, explicit production/full connection and confirmation, server principal and admin/owner/final member denial, complete pagination required and independent no-membership read-back. Admin/owner removal intentionally deferred pending verified last-owner protection. Finish remaining D-1 project operations in #56 onward; IN-07/08 still pending, production inactive.

- **D-1h guarded project member grant (#54):** POST /v1/projects/{idOrName}/members for an existing team UID only, no seat invites or paid operations, production/full connection required, access-widening declaration, preflight member existence and bounded page, independent member-role GET read-back, safe audit and replay. Next guarded member removal; production inactive and IN-07/08 outstanding.

- **D-1g guarded project rename/framework (#53):** PATCH /v9/projects/{idOrName} with authenticated scope, true before/after project GET, production classification on live or unknown deployments, protection for old/new project identity, replay, confirmation and safe shaping. Build/install/dev commands and remaining settings are still pending D-1, not claimed complete.

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
