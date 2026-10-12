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
