## 2026-10-21 — approved maximum-authority expansion

Owner requested adapting the completed GitHub planning job to all active custom MCPs.
Approve [MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md), indexed CAP-1..CAP-5,
with provider-specific interfaces, credential types, guardrails and open acceptance.
No artificial God-Mode-only tools or percentage coverage from catalog counts.
Existing user-selected policy/provider isolation and developer spending/release gates
remain binding. This document is not implementation or live verification.

# Decisions (dated)

**2026-10-31 — The login fix (AUD-BD): a normal end-user sign-in lands
production/full by default.** The owner ruled (request of 2026-10-31 ~01:47 UTC,
filed by the coordinator the same day) that a normal end-user login lands
entirely in production mode with a full profile, never silently
preview-only/read-only. Two cleanup-program defaults are superseded: **D1**
(the sign-in profile no longer derives from the enrollment door — `full` on
both doors; the credential's own Vercel-side scope, read back at enrollment,
remains the ceiling) and the enrollment-default half of **D7** (a new account
row is born with its `production_enabled` switch ON — the residual IN-09's
AUD-AN note recorded as "an owner policy call" — so the switch-derived initial
mode is production on the production deployment). Untouched: D7's derivation
itself (a user who turns their switch off keeps starting in preview — their
standing choice), the server-deployment conjunct (a non-production deployment
of this server never mints a production connection), grandfathering (D6 —
stored rows are never rewritten, and rotation preserves an existing row's
switch in either direction), the enrollment probe + scope read-back, RTC
passes (D5), and the read-only switch (AUD-AQ, born off). Live proof rides a
nightly train; the owner's single sign-in sitting is the acceptance.
**2026-10-31 — CAP-1's operation ledger is a generated, check-enforced artifact (AUD-BE).**
The owner commissioned the one unbuilt CAP-1 artifact (waiver declined). It is built as a
generator over the server's own living records — the pinned OpenAPI snapshot enumerated
through the runtime's index, joined against the OPS table, the hand-built map and the
universal doors' own policies/classifiers — and committed as `docs/operation-ledger.json`
plus the generated family gap report `docs/OPERATION-LEDGER.md`. `npm run check`
regenerates and compares, so the ledger can never silently drift from the code it
describes. Fields no repo source records (per-operation permissions/entitlements, owner
unit, response tests, live proof, installation-token support) are carried as explicit
unknowns in the artifact itself; filling them without a source would be the invented
coverage CAP-1's own rules forbid. The artifact carries no generation date — its checked
date is the snapshot's — so regeneration is byte-stable and the drift check is meaningful.
CAP-1's SUPERSEDED verdict (#337) is unchanged: the ledger is the reporting artifact the
verdict named, not a reopening of the inventory program.

**2026-10-31 — One sign-in; the sign-in cleanup program (AUD-AZ…AUD-AY).** The owner
ruled that owner-setup is removed, not relocated, and the program shipped the same
day: there is exactly one sign-in. The consent form asks for the account and the
administrator passphrase only; profile is derived from the enrollment door
(integration install → everyday, token → full), mode from the account's own
production switch, and the listing is always the front door (AUD-AZ). Credentials
enroll as a branch of the sign-in flow (`/api/oauth/enroll`, AUD-AR) with probe
and scope read-back before storage. Owner administration lives on the owner's own
connection: approval envelopes are inspected/applied with
`vercel_apply_owner_approval` (AUD-AS — the apply proof is possession of the
owner's connector connection behind the kind gate, not a passphrase re-entry;
dossier D2), the eight form-only account actions are tools (AUD-AT), and passes
are issued/revoked and one-time secrets revealed there (AUD-AU, D8). The setup
route is deleted (AUD-AV) and the `pending_inputs` supply channel with it (D9):
a chosen secret value is set in the Vercel dashboard or generated server-side.
Read-only is the end user's own switch on their connection (`vercel_set_read_only`,
AUD-AQ) — never a sign-in class or grant type; stored rows are never rewritten, so
grandfathered connections keep working unchanged (D6). The full decision set
(D1–D9) is recorded in the sign-in cleanup dossier of 2026-10-31; this entry is
its decisions-log home.

**2026-10-31 — Retention clocks (Production Gate decision, AUD-AO).** The fleet
retention clocks apply to this server: the change journal (`change_log`) and the
purchase ledger (`purchase_intents`) are retained 400 days, then sweep-purged;
authorizations that were never exercised (unredeemed OAuth codes, unconsumed
one-time secrets and pending inputs, still-pending purchase intents, never-used
RTC passes) are purged 180 days after they lapse. Exercised authorizations are
not "unused": approved/consumed intents ride the 400-day ledger clock, and used
or revoked passes are not swept by the 180-day rule. `oauth_tokens` is excluded
from the sweep — it has no durable use marker (`last_used_at` is never written)
and refresh rows are live credentials; misclassifying them would delete
returning users' grants. A stated consequence: the 400-day journal clock bounds
`vercel_undo_change` history at 400 days. Removal copy now discloses the number
("kept for 400 days") where it previously said only "kept".

**2026-10-30 — Batch W front-door composition review (OP-1 delta).** The OP-1 decision
promised the front door's composition would be reviewed "at each audit delta"; Batch W is that
delta. OP-1's 5,000-token cap is owner policy and does not move. Completing the Workflows
section adds twelve `vercel_workflow_*` tools, and the listing code auto-includes every workflow
tool in the front-door and compact listings; at the pre-W registry the full-profile front door
already measured 4,890 tokens, so twelve compact workflow schemas (~120–160 tokens each) cannot
join without rebalancing. The membership artifact moves to version 2 (basis
`batch-w-delta-2026-10-30`): the twelve workflow tools take seats across W-1..W-6, and ten
most-used seats retire to the catalog listing — `vercel_deploy_redeploy`,
`vercel_deploy_get_runtime_logs`, `vercel_git_search_repos`, `vercel_deploy_wait`,
`vercel_domain_get`, `vercel_deploy_get_build_logs`, `vercel_cron_list`, `vercel_alias_get`,
`vercel_team_get`, `vercel_check_token` (~1,593 tokens at the full profile). Retired tools stay
registered and reachable in one search/describe/call hop; several are superseded inside the
door itself (`deploy_and_wait` covers `deploy_wait`; `why_did_build_fail` covers build logs).
Projected full-profile front door after W: ~4,697 tokens. `vercel_project_create` stays: the
front-door suite pins it on the everyday door and it is genuinely most-used. The C6
everyday-listing engineering line steps 24000 → 24500 with the growth (measured ~24,104 at 230
tools); per BATCH-C that line is an engineering sanity bound, not owner policy.

**2026-10-29 — AUD-I S1b: how a personal install is proven and labeled.** Built the same day as the S1 boundary it discharges. The proof is user-keyed: the token's own identity read (a new `user_get_unscoped` operation, following the existing `*_unscoped` pattern) must name exactly the user the Integrations exchange says installed it, the unscoped project list is the account's granted set, and any team visibility beyond the personal account is broader than the box and refuses without the explicit allowance. The account record keys on the user id (Vercel's account-id space is shared between users and teams). The store's scope enum (`team`/`project`/`full`) has no personal value; rather than widen the enum in this slice, the row records scope `team` for the account-shaped box and the probe record carries `accountKind: 'personal'` with `declaredBox: 'personal'` — S3's whoami reporting renders the personal label from the probe record, never from the enum. If a future slice widens the enum, this pairing is the migration note.

**2026-10-29 — AUD-I S1: team installs enroll now; personal installs are an honest boundary, slice S1b.** The Integrations exchange returns `team_id: null` for a personal-account install. The shipped probe (`probeToken`) proves a credential by its visibility of a *team*; a personal installation token has no team to be visible to it, and keying it under the user's id through the team probe would record a scope the probe never proved. So S1 enrolls team installs through the standard probe/store path (installation identity + declared box on the probe record, via storeToken's additive `probeExtra`) and reports personal installs as detected-but-not-enrolled, storing nothing. S1b designs the user-keyed probe (identity + unscoped project visibility, account keyed on the user id) before any personal enrollment ships. Rationale: the declared box is the record — an enrollment whose probe proves a different box than the label claims is exactly the fixture-blindness failure this audit exists to kill.

**2026-10-19 — Product distribution belongs to Robinson AI Systems outside this repository (owner decision).** This repository is responsible for implementing, documenting, securing, and independently verifying **Vercel by Robinson AI Systems** as a standalone MCP server. It does **not** own distribution-channel strategy, public catalog/plugin eligibility or applications, commercial publication, marketing, provider partnership negotiations or launch approval workflows. Those are managed outside this repository. Technical client interoperability, accurate independent-product attribution, credential/tenant security, and published protocol contract conformance **remain** Vercel MCP engineering obligations. Existing developer release, spend, data, permission and deployment restrictions remain binding; this clarification does not authorize publication or unapproved production changes. Historic distribution-related discussion in dated records is historical only.

**2026-10-19 — R-2 pass rate selection: 120/minute default, end-user selectable 1–600.** The approved source already implements this owner-selectable range and default; the owner directed up-to-date documentation and merging the reviewed current changes. The original IN-10 "awaiting" label is superseded for this concrete default/range decision. Existing pass rows retain 60/minute when migrated. This resolution is **not** approval for general write/paid/full RTC access and does not mark R-2 engineering or live-client acceptance complete.


**2026-10-19 — Universal direct MCP, branding and end-user authority owner directive.** Standalone remote MCP must serve independently authenticated desktop/mobile clients where supported, with genuine tool/provider proof. Human-facing owned surfaces should say **Vercel by Robinson AI Systems** while preserving stable technical IDs and making no provider endorsement claim. Audit all developer policy leaks and remediate using user-selected delegation and scope, never by removing tenant security, account checks, real provider restrictions, user approval policy or developer $0/release rules. Hub actual connection is Hub-owned. See `docs/PRODUCT-AUTHORITY-AUDIT.md` and R-2 execution card. Source, exact-head CI, READY deployment, genuine external client/provider acceptance and public eligibility are distinct; no publication or production operation newly authorized.


One entry per design decision. Current latest binding clarifications appear immediately below; earlier records remain historical. Reasons live here; current rules live in AGENTS and the designs.

**2026-10-28 — A failed write names its leg, safely (VMCP-023 delta, AUD-H).** An `outcome_unknown` result from the write executor now carries a bounded `failure` detail when the thrown error provides one: the pattern-validated error `code`, the operation `leg` that failed, a coarse `failureClass` (`timeout`, `network`, `http_status`, `shape`), and the HTTP status. Nothing else is ever surfaced — no error messages, no provider bodies, no request data — so the no-secrets posture is unchanged; the fields are identifiers from the server's own operation table and the provider's already pattern-validated error codes. Provider-transport errors are tagged with their leg at the transport boundary (`src/vercel/client.js`), including the file-upload leg (`deployments_file_upload`), and a response-shape check that cannot recognize the provider's real response throws under the code `response_shape_unverified`. Decided because VMCP-023's S7 evidence was undiagnosable from outside: three deterministic failures, one generic reason. Legibility is a correctness property of the outcome envelope, not debug logging; it applies to every guarded write, present and future.

**2026-10-28 — Muse connects via a server-hosted client metadata document (VMCP-024 delta).** Muse publishes no OAuth client metadata document of its own (unlike Claude and ChatGPT, which publish theirs), so this server hosts one for it at `/.well-known/muse-client.json`: the document's URL is the client_id, its only redirect is Muse's hosted callback, and it authenticates by PKCE only (token endpoint method `none`). The authorize, token and revoke paths resolve that client_id locally to a fixed public-client record; no registration row exists or is needed, and the connection it mints is an ordinary one — owner consent + passphrase still gate it, and account, mode, profile and listing bind at consent exactly as for every client. This is additive conformance with the MCP authorization specification's client-id metadata document pattern, adopted because sourced research showed it is the only documented-shape route by which this client connects at all; dynamic client registration and all existing clients are unchanged, honoring the owner's constraint that no platform lose or gain limits from this fix. The device-authorization direction originally filed under VMCP-024 is retired for Muse (unsupported by that client, no published roadmap) and remains unbuilt; the finding's acceptance probe is unchanged and still required live for closure.

**2026-10-27 — Token expiry is the key owner's choice (IN-04 revisited; RULED by the owner in his own words).** The owner's own key never expires, by his choice, and the server must respect it. End users choose their own key expiration when they create their key; the server respects their choice too — no imposed term. The 90-day-expiring language recorded in IN-04's applied answer (from the 2026-10-10 team-scoped-keys entry below) is retired as policy; at most it survives as a suggestion offered at key creation. The server's duty is to notify ahead of an upcoming expiration (14 days before) for keys that have one.

**2026-10-27 — Production changes stay on; the switch belongs to the end user (IN-09; RULED by the owner in his own words).** Production changes are not off by default behind a ceremony. The enable/disable switch belongs to the end user at any time, and their agent must be able to flip the switch for them with their approval. The two-step ask-then-passphrase enable (the 2026-10-10 "live guard" entry below, implemented in B-2) is superseded as a gate; the switch is an ordinary owner-controlled tool setting. Existing source still implements the passphrase activation flow — flagged as a code contradiction in the PR filing these entries; remediation is engineering work, not a pending owner decision.

**2026-10-27 — Spend alerts are Vercel's, not the server's (IN-12; RULED by the owner in his own words).** Spend alerts belong to Vercel's own Spend Management and exist only if the user set them there. This server reads and reports them; it never controls or enforces spend settings of its own, and changes them in Vercel only when the user directs it to. No dollar figure — including the ~$40 sketched in IN-12 — is a server policy.

**2026-10-27 — Scratch project approved as a builder acceptance fixture (IN-06 answered YES; owner-directed analysis, approved by the owner for filing).** Create `rtc-scratch` (empty static site) plus a project-scoped key for the X-2 real-world write run. This is builder logistics — a blast-radius guard on the builders' own testing — not product policy and not a limit on end users. This entry records the answer only; creating the project and key remains the owner's recorded step (dashboard + setup page).

**2026-10-27 — The server defers to a project's own release workflow (IN-11 answered YES; owner-directed analysis, approved by the owner for filing).** For Appliance Desk: promotion to its live site through this server is blocked, emergency rollback is allowed with the owner's OK, and the owner's "outside the app" instruction overrides. Generalization recorded with the answer: deference attaches to any connected project that declares its own release workflow; projects without one get ordinary deploy capability (production on, per the IN-09 ruling above).

**2026-10-27 — Blob stores: connection is a user-controlled state (IN-15 answered; owner-directed analysis, approved by the owner for filing).** The default is no Blob stores connected — a state the user controls by connecting a store on the setup page, not a server rule. Within a connected store: list/read unrestricted; upload/delete are ordinary writes on the user's instruction, journaled. Appliance Desk's stores are listable but never cleaned up unless the owner says "outside the app"; that limit is the app's own contract, not MCP policy. The M-4 design (`docs/designs/BATCH-M.md` M6) already matches this shape.

**2026-10-27 — Front door is a curated set under a 5,000-token budget (audit OP-1; RULED by the owner in his own words).** "Compact plus the most commonly used tools and compound tools on the front page, budget is 5,000 tokens." The default tool listing for an agent connection is the compact meta-tools plus the measured most-used tools plus the compound tools, tokenizer-measured at no more than 5,000 tokens in total; the catalog listing stays available on request. The 5,000 figure is owner policy from this ruling, not a builder default (the previous ~20,000 catalog budget in `scripts/check-budgets.mjs` was builder-set). Which tools count as most-used is a usage measurement, reviewed at each audit delta — not a guess. Recorded as finding VMCP-009 in `docs/MCP-AUDIT-2026-10-27.md`; design D-C filed as a BATCH-C amendment in the same PR as this entry.

**2026-10-27 — Purchases: optional budget, and the owner's word is enough (audit OP-2; RULED by the owner in his own words).** "User giving the agent a budget (optionally), but also their word is enough — even to override their own budget." An end user may set their agent an optional budget; the budget governs the agent's own discretion and frames the cost disclosure. The account owner's explicit instruction to purchase executes on their word — under the budget, over the budget, or with no budget set — journaled, with the in-chat preview/confirm flow as the confirmation. The mandatory per-transaction, separately authenticated one-use purchase grant (the 2026-10-12 IN-08 machinery below) is retired as the end-user path. It remains binding on implementation and acceptance activity (builders spend $0 and cannot approve grants) and on delegated/builder connections, where the owner's budget binds the delegate and only the owner overrides it; the one-use grant also remains available as any end user's own strictest opt-in. This entry applies IN-08's recorded answer (2026-10-17); remediation issues #108–#110, #116, #119 now have their target shape. Recorded as finding VMCP-001 in `docs/MCP-AUDIT-2026-10-27.md`; design D-A filed as a BATCH-B amendment in the same PR as this entry.

**2026-10-19 — Independent service completion; Hub owns Hub integration.** The owner decides that this Vercel MCP must comply with provider-side frozen RTC 1 and the referenced Hub connection specification, prove its own direct conformance and real deployed provider/denial, but **need not be discovered, connected to or successfully called through the Hub to finish**. The Hub owns origin discovery, onboarding, selected OAuth client consent, grant mapping, routing, broker, relay and Sandbox integration and their real-world acceptance. OAuth production transport in Hub's guide is optional under RTC 1; any advertised provider OAuth must actually work. A reproducible provider-side spec violation found through Hub tests remains a provider bug, but Hub feature incompleteness is not. Developer security/release/spend gates remain. Hub spec checked at `3cc7f4ad4332155d639125b23e8a5c4c13804a3d`.

**2026-10-17 — Owner's definitive developer-versus-end-user authority ruling (supersedes contrary product defaults).** The owner's $0 autonomous spend, no live/production mutations, test-fixture, release and builder approval constraints were instructions to agents BUILDING the MCP services. They were never intended as limits on the finished tools' end users. The service must expose all feasible provider-backed capability to an authenticated user's coding agent according to the user's explicit or delegated choices. Honest risk/cost disclosures, provider rules, real account scopes, security/tenant isolation and user-chosen policy remain. IN-13: do NOT enforce 60 Sandbox minutes/day/account; collect estimates for visibility only. The old developer-only limits in other product code, profiles, purchase paths or catalogs must be inventoried and remediated under existing plans, not silently retained. Current builder is still unauthorized to spend, invoke production changes, bypass tests or deploy unscheduled.

**2026-10-10 — Build a separate, hosted Vercel MCP in the Stripe MCP's form (hub Batch S, `S-vercel`).** Chris builds
each toolset as its own solid, standalone server because official connectors give less functionality and different
agents get different permissions with them. The research audit (`docs/audits/2026-10-10-research.md`) found the old
toolkit's `vercel` namespace unsafe and drifted: 31 of 181 tools unreachable, no confirmation anywhere, decrypted secrets
returned, redeploy and rollback wrong, 110 of 205 call sites on endpoints missing from the current reference.

**2026-10-10 — Standalone first; RTC 1; three audiences.** Applied from the shared brief: fully usable without the hub;
contract doors in Batch R; conformance joins CI only when the hub's package exists; every tool tagged builder / owner /
operator; owner side is Batch O, developer side Batch V.

**2026-10-10 — Every tool name starts with `vercel_`.** Vercel, Neon and GitHub share nouns (project, branch,
deployment); two connectors in one Claude chat must not offer two `project_list` tools. Contract meta-tool names keep
their contract form (`vercel_search_tools`, …); workflows are `vercel_workflow_*`; developer tools `vercel_dev_*`. This
differs from the Stripe MCP's unprefixed area names; flagged to the coordinator so the Neon and GitHub plans and the
contract's §3 wording can agree.

**2026-10-10 — Node 24, not Node 20.** The shared brief says Node 20; Vercel deprecated Node 20 builds on 2026-10-01 and
defaults to 24.x (Appliance Desk runs 24). Plain ES modules, nothing 24-only in `src/core/`.

**2026-10-10 — Preview and production modes, with a two-step enable (the Stripe "live guard" for Vercel).** Every
connection is preview (default) or production; production is offered per team only after `vercel_enable_production`
plus the passphrase on the setup page. Production is defined precisely in `docs/designs/BATCH-B.md` B2 (production
deployments, promote/rollback, rolling releases, production variables, live projects' settings, domains/DNS/certificates,
protection, firewall, routing publish, cache, owner actions).

**2026-10-10 — Team-scoped keys with expiry; project keys for narrow uses; full-account keys refused.** Vercel added
project-scoped tokens on 2026-07-30; per-permission tokens (Sign in with Vercel) are private beta. Recommendation put to
Chris as IN-04.

**2026-10-10 — No environment variable value is ever returned, of any type.** Vercel's 2026 Config/Secret split cannot be
trusted on legacy rows (`encrypted` type holds most real secrets; `visibility` missing). Values go in from the setup
page, server-side generation, or non-secret plain values; copy and compare happen on the server; Chris views a
decryptable value only on the setup page.

**2026-10-10 — Spend guard with a $0 default limit.** Domains, renewals, transfers, credits, paid seats, Marketplace
plans, stores, analytics add-ons, drains, rolling releases, build machines and sandboxes always need confirm; known prices
(registrar, seat setting) count toward a daily limit that starts at $0 (IN-08).

**2026-10-10 — Self-protection.** The server refuses to change its own Vercel project, the other Robinson servers'
projects and the key it runs on, unless Chris edits the protected list on the setup page (IN-07).

**2026-10-10 — A thin client over a dated OpenAPI snapshot, not `@vercel/sdk`.** The SDK lacks operations this plan
needs, is 55 MB and republished almost daily; Vercel's OpenAPI `info.version` is a constant, so the pin is a dated
snapshot with its hash plus each operation's path version in `src/vercel/operations.js`.

**2026-10-10 — Testing: fake Vercel + snapshot validation + Vercel Labs' `emulate`.** There is no Vercel test mode. Unit
tests use an in-process fake; every request is validated against the snapshot; core areas also run against `emulate`
(pre-1.0, a second layer only). Real writes only in a scratch project with a project key (IN-06); real-team smoke test is
read-only (X-2).

**2026-10-10 — Appliance Desk is a completeness check and the first profile.** Its release-by-branch process, build-time
migrations, cost rules, crons, stores and email DNS shaped the profile fields (`docs/designs/BATCH-P.md` P2), not the
server's scope.

**2026-10-10 — Gap check against prior toolkits.** Chris asked to check every Vercel tool he had built or planned across
his Robinson's Toolkit repositories (and outside his organization) and close any gaps. Audit:
`docs/audits/2026-10-10-prior-tools.md` (5 sources, 301 raw names, 273 unique). Result: 211 covered by planned tools or
guided steps, 7 by the universal tools only, 44 deliberately dropped (25 operations Vercel has no public API for, such as
middleware, comments, uptime and storage export; 10 for removed products KV and Postgres; 4 legacy secrets; 2
deprecated or obsolete; 3 unsafe: decrypted values and the OIDC token), and **9 tools added**: `vercel_globalconfig_list_tokens`,
`vercel_globalconfig_revoke_tokens`, `vercel_globalconfig_get_schema`, `vercel_globalconfig_set_schema` (new card E-4),
`vercel_drain_update` (M-2), `vercel_blob_list`, `vercel_blob_head`, `vercel_blob_put`, `vercel_blob_delete` (new card
M-4, owner input IN-15). Blob files move from ROADMAP into scope because Chris's earlier toolkits all had them and his
apps keep files in Blob stores; they stay metadata-only, reach only stores Chris connects on the setup page, and are the
single exception to "Vercel only through the REST client" (BATCH-M M6). Catalog: 232 hand-built + 4 universal = 236.
Projects checked for needs: Appliance Desk, Cortiware, oldReplit, Household-Assistant — no further gaps.

**2026-10-10 — A-1 foundation as built (PR #1).** Copied the Stripe MCP's proven A-1 files (`e2f90e8`) because the hub
has no core package release yet and the Stripe MCP's Batches B–C have not merged (BATCH-A amendment). `emulate` 0.12.1 is
a pinned devDependency, not an `npx` download, so CI and laptops run the same version from the lockfile. A catalog
consistency check joined `npm run check`, so the tool count in TOOL-CATALOG can never silently drift from its tables and
no tool can be registered without a catalog row. CI has four independent jobs and one aggregate `ci` job, the only
check that gates a merge.


**2026-10-10 — Plan approved; no automated review (Chris).** "I approve the plans, and I don't want the automated review
at this time." IN-00 and IN-01 answered; designs marked APPROVED. An organization-wide Codex reviewer may still post
until Chris turns it off for this repository; agents answer and resolve its threads but never wait for one.

**2026-10-10 — No compatibility with the old toolkits (Chris).** "The reference to the older toolkits was to help make sure
you designed this custom MCP with as much functionality as possible … I don't need legacy compatibility." Removed the
old-name map from D-1 and the toolkit decision note (X-3); IN-14 answered "not needed". The prior-tools audit stays as
the completeness checklist it was meant to be.

**2026-10-10 — Stronger anti-stall rules (from the implementing agent's own diagnosis).** Sol stopped after opening a PR
with red CI although nothing blocked it. Its reasons: too much code before running tests; preventable CI errors (a wrong
API parameter, lint, outdated test expectations); no rule forcing a red PR to be finished first; and chat sessions that
end between actions. Added: SESSION-START §0 (finish open PRs first), §6 (problems vs real blockers, thin slices, a
no-shell path with draft PRs, an exact recovery point at every push) and AGENTS rules 11–13.

**2026-10-10 — CI cadence (from the implementing agent's review of its own CI use).** Every push runs the full CI on
purpose (the merge gate must be green at the exact head). The waste was pushing fixes while a run was still going, which
started overlapping full runs. Rule added to SESSION-START §6: never push while your PR's run is in progress; collect all
failures, fix them together, push once; run checks locally first; "re-run failed jobs" only for infrastructure hiccups.
CI cancels an obsolete PR run when a newer push arrives.

**2026-10-11 — Preserve the byte-for-byte official Vercel OpenAPI document.** The 11,611,860-byte source at `https://vercel.com/openapi.json` is vendored as a dated immutable snapshot with a SHA-256 recorded in `vendor/vercel-openapi/SOURCE.md` (451 HTTP operations). An upstream example resembles a Vercel resource ID, so the secret scanner permits **only this exact pathname with this exact pinned SHA-256**; all other files and altered snapshots remain subject to the normal secret scan. The exception is covered by unit tests; changing the upstream snapshot requires explicit hash review. This import unblocks, but does not complete, A-4.

**2026-10-11 — A-4 replay reservation requires one additive table.** The approved A9 ten-minute replay contract must work across separate serverless instances and concurrent requests. The pre-existing `change_log.request_key` is only non-uniquely indexed and cannot provide an atomic claim; a read-then-write implementation would risk duplicate real-world Vercel operations. A-4 therefore adds a single `request_replay` table with a unique request key, expiring claim and claim UUID. This is a mechanical durability implementation of the existing approved A9 rule, not a change to write authorization, spend or production defaults. Pending/unknown outcomes are never blindly replayed. The audit `change_log` remains separate and unchanged. Disposable Postgres concurrency tests and the exact-head CI gate must pass before merging.

**2026-10-11 — A-5 token-scope verification must remain conservative.** Reading `GET /v2/teams` and `GET /v10/projects` can demonstrate a credential reaches the chosen team or project, but **cannot prove all privileges or exclude invisible broader privileges**. A-5b1 therefore records sanitized visibility only, refuses apparently broader visibility unless the owner explicitly permits it, and never uses the probe to authorize production or writes. Those decisions remain guarded by Batch B and owner controls. No live account key is used in tests.

**2026-10-11 — A-5 owner setup uses short-lived encrypted sessions and restrictive defaults.** Setup sign-in uses existing database-counted passphrase lockout. The server issues a 15-minute purpose-bound encrypted cookie with HttpOnly, Secure and SameSite=Strict attributes. State changes require the session's CSRF token. Headers prevent caching/framing and avoid provider error reflection. Conservative protected projects are seeded idempotently; any later loosening needs B-3 and explicit owner authority. Live Vercel/Neon activation, production enabling and purchases remain separately gated.

**2026-10-11 — B-1 fail-closed generic write contract.** A generic write operation is denied if connection profile/mode, production classification, target list, protection/application guard, audit writer, sanitizer or durable replay storage is absent. A real provider response does not establish success; independent verification determines `confirmed: true|false|null`. All current writes require explicit confirmation; protected targets cannot be overridden by `confirm`. Spend remains integer cents with the $0 default. This PR does not publish any mutating tool or use real Vercel credentials. Later Batch B cards implement the owner production switch, protected-resource guard, secret shaping and tighter declaration linting.

**2026-10-11 — B-2 production enable needs independent owner reauthentication.** A confirmed AI-issued request is only a ten-minute encrypted, single-use pending record; it never changes `production_enabled` alone. The owner must reenter `ADMIN_PASSPHRASE` on the authenticated CSRF-protected setup page; the server must itself run in production mode; the reference must match the chosen account. Disabling is an owner-confirmed local safety action revoking production connector tokens. Exposing precisely these two local administrative tools does not open the general provider-write MCP gateway. No real authorization inferred from offline tests.

**2026-10-11 — B-3 protections stay additive until IN-07.** Protected-project defaults cannot be removed or weakened by the new setup editor while the owner's exact protected list remains undecided. A signed-in owner may add a team-scoped project only after fresh passphrase and CSRF verification. The safety check treats unresolvable descendants, absent protected-resource data and the server's own project/credential as protected. The app hook is stable but has no app profiles until Batch P. No live service writes were performed.

**2026-10-11 — B-8b owner authorization implementation boundary (#29).** Reuse existing
authenticated owner setup, CSRF and fresh `evaluateLogin` proof for account-wide local writes;
never infer owner status from a connector profile. Stage the global default-account owner form
first, with atomic SQL/audit and production-deployment restriction. The catalog's MCP write names
are not exposed until a durable independent owner-approval path and existing write contracts pass.
Revoke requires protection against last active OAuth bearer and concurrent refresh/revocation;
spend remains default $0 pending IN-08. This is an engineering restriction, not an owner
authorization to activate anything. Details: `docs/designs/B-8B-OWNER-BOUNDARY.md`.

**2026-10-11 — B-8 completion (#40): MCP owner tools remain proposal-only, even with `confirm`.** Default-account, exact-cent spend-limit and exact-connector revocation requests use the generic mandatory guarded write pipeline only to issue verified encrypted one-use approval references. The authenticated setup application is a separately trusted actor with session, CSRF, owner passphrase reentry, explicit confirmation and atomic read-back-verified DB changes. No OAuth profile or MCP transport can apply those owner changes on its own. Future C-2 and R-2 doors must preserve the identical registry/guards. IN-07/IN-08 and production activation remain pending.

## 2026-10-12 — IN-07: owner-controlled all-project eligibility
The owner rejects any permanent project-identity prohibition, including this MCP's own project. Existing seeded exclusions must be removable through independently authenticated owner setup; protection of the server credential, last owner, production, billing, destructive changes and app-owned state is separate and stays in force. Implementation #107 is not production approval.

## 2026-10-12 — IN-08: zero autonomous spending, unlimited individual owner approvals
The owner sets a fixed $0 autonomous-spending policy. `confirm:true`, general spending limits and agent-generated proposals never authorize payment. Authenticated owner setup must independently approve a transaction tied to account, operation, payload digest, verified provider price or explicit ceiling and one-use nonce. No artificial amount/daily maximum applies to the owner. A $20/month additional Pro developer seat is shown in Vercel's published pricing (https://vercel.com/docs/plans/pro-plan); viewer seats free. Database foundation #108, enforcement awaits subsequent work. No live purchases authorized.

## 2026-10-12 — owner-requested independent server / universal gateway planning repair

RTC external interoperability is independent of shared internal implementation. Hub owns compact broker,
routing and grant mapping; this service owns provider credentials, canonical tools, state and guarded dispatch.
Core adoption is optional and separately gated; do not require K-3 for RTC/Hub acceptance or reduce standalone
capability for common code. Existing source/fake/deployed/real evidence and every owner/CI/release gate remain.
This explicit docs/planning request permits this focused documentation PR; routine cadence remains unchanged.

## October 14, 2026 — owner-delegated concrete implementation designs

The owner requested completing/revising remaining designs, then extending the
same Sol 5.6 implementation detail to all six active custom MCP repositories.
[IMPLEMENTATION-DETAIL.md](implementation-contracts/IMPLEMENTATION-DETAIL.md) adds typed state/argument/result
contracts, domain-specific failure and recovery cases, current code seams and
finite proof requirements for the remaining indexed scope. This is an explicit
design-maintenance exception to routine no-docs-only implementation work, not a
feature PR or completed subsection. Existing owner-specific missing inputs,
spending/production/credential/cleanup authority remain gated; this entry does
not mark them answered. The original Toolkit stays reference-only.

**2026-10-17 — Bounded Sandbox metered end-user authorization (clarifies the 2026-10-16 end-user authority decision, V-4/V-5 PR #216).** The implementing agent retains zero autonomous spending and may not create a paid Sandbox for acceptance. A properly authenticated account owner may authorize one explicitly selected, finite-runtime, 1-vCPU/2-GB, deny-all-egress, nonpersistent Sandbox whose actual regional compute/memory charges are variable. The owner must separately sign in, explicitly acknowledge that a chosen planning amount is NOT a provider-enforced dollar ceiling, and authorize the exact account/operation/payload-bound one-use transaction. The grant is consumed before provider creation and is not inferred from MCP `confirm` or daily minutes. All other metered categories without an enforceable ceiling remain fail-closed pending their own approved product remediation. Vercel's published base Pro rates for context: $0.128 per active-vCPU-hour and $0.0212 per provisioned-GB-hour; applicable region, included usage and future provider pricing may differ. No provider spend was performed.


**2026-10-28 — First deployments carry explicit projectSettings (AUD-J, VMCP-023).** The provider requires `projectSettings` on a project's first deployment and saves them for later deployments (vendored OpenAPI description); a settings-less create against a settings-less project is refused with the provider's 400 `missing_project_settings`, proven live by the VMCP-023 closure probe on the released AUD-H code. Decision: the settings are supplied at the deployment create — never by pre-seeding the project — from the most authoritative source each tool already holds: the seed derives them from its scenario (declared framework, nulls elsewhere = provider auto-detects), and the from-files tool echoes the project record's own stored fields unchanged, so no configured project's settings can be altered by deploying to it. The six-field shape is stated once in `src/vercel/project-settings.js`. The git deployment create is deliberately untouched: no live evidence names it, and a dated register amendment is the route if that changes.


**2026-10-28 — Cleanup reconciles creation intents on proven absence, and the deletion proof reads only documented fields (AUD-K, VMCP-027).** A creation intent is a bookkeeping checkpoint, not a provider resource: cleanup now reconciles one when its creation is proven to have produced nothing unrecorded (target absent, or present and recorded as its own object in the run). An existing unrecorded target is never deleted or ignored by cleanup — it blocks for manual reconciliation; an absence that cannot be proven blocks or lands uncertain under the existing conventions. Separately, the empty-project deletion proof demanded record fields the provider's documented schema does not contain (`storageConnections`/`stores`) and required-field treatment for fields it does not require, making the proof unsatisfiable against real projects; the proof now rests on the completeness-checked list inventories (deployments, domains, env) plus documented record fields read as documented (`link`, `crons` optional; `hasDeployments` a conservative signal). Storage is recorded as outside the provable inventory — no documented field and no list operation exist, and store wiring surfaces as project env vars — with a dated amendment as the route if the provider documents a storage surface.

**2026-10-28 — A create response is an identity claim; the read-back is the proof (AUD-L, VMCP-023).** The provider's documented deployment-create response includes an in-progress shape with no `projectId` (the deployment is still building), and demanding `projectId` equality in the create's `shapeResult` made every such create report `response_shape_unverified` after the provider had done the work — proven live by the VMCP-023 re-probe (`hasDeployments: true` on read-back). Decision: create-response verification requires `projectId` equality only when the response carries the field, in all three create tools; the binding project-identity proof remains each tool's `verify()` read-back of the full deployment object, which checks it independently. This states the general rule for write `shapeResult`s in this server: verify what the documented response for that operation actually guarantees, and let the read-back carry the rest.

**2026-10-28 — In cleanup, `uncertain` means post-dispatch doubt only; project and intent objects reconcile by inspection (AUD-M, VMCP-027).** The stranded probe run's project object sat at `uncertain` because a pre-fix inspection threw — no delete had ever dispatched — and the stored status then short-circuited every later cleanup, leaving no exit short of dashboard surgery. Decision: (1) pre-dispatch proof failures in cleanup return `blocked`, never `uncertain` — uncertainty is reserved for doubt after a dispatch (the delete write, the post-delete read-back); (2) an `uncertain` project or intent object reconciles by inspection inside a confirmed cleanup: intents never dispatch, and a project delete is re-proven by read-back (absent = cleaned, no dispatch; present = inspected, then deleted exactly once in the pass), so the reconciliation is structurally incapable of a blind retry; other object types keep the manual-readback rule. Relatedly (AUD-M, VMCP-023): verify() read-backs require identity fields (projectId, run meta) when the documented response shape carries them, and vercel_dev_seed accepts the provider's promotion of a first deployment to production — the user-facing create tools keep their requested-target demand.

**Addendum (AUD-M, same day) — inside a recorded run's own scratch project, a deployment's identity is its id plus the run's provenance, not its target.** The completed contract audit convicted cleanup's deployment branch on the same pattern (full-shape `projectId` demand; a preview-target demand the provider's first-deployment promotion defeats; a first-read 404 landing in `uncertain`). The branch now requires `projectId` (or the reduced shape's `project.id`) and `meta.rtc_run` when carried, keeps the alias demand absolute (every documented shape carries `alias`), and treats a first-read 404 as an absence proof. The alias branch's cross-check follows identically.

**2026-10-28 — A create response's shapeResult proves identity, never target (AUD-N, VMCP-023).** Three closure probes died at `response_shape_unverified` because the seed's create check demanded the preview matcher over the response target — and the documented response `target` enum is production/staging/null ('preview' exists only as a request instruction; the provider promotes a first deployment at creation, so the response already carries 'production'). Decision: shapeResult in every create tool proves identity only (deployment id; project identity when carried, resolved as `projectId ?? project.id`); all target judgment lives in verify()'s independent read-back — the seed accepts the preview encoding or the promotion, and user-facing tools report a promoted-against-the-ask create as applied with `confirmed: false`, never `outcome_unknown`.
