# Decisions (dated)

One entry per design decision, newest last. Reasons live here; current rules live in AGENTS and the designs.

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
