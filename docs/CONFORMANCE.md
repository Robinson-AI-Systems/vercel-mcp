# Conformance record — Vercel Unleashed by Robinson AI Systems

**Re-baselined:** 2026-11-03 (America/Denver)
**Standard:** the RAS MCP Standard, Library living design D-001 at
Library `main` `f134c849`, including the 2026-11-03 amendments
(capability completeness, the conformance-correction process, and
owner-obedience / confirmed action).
**Code baseline:** `main` at
`f501ba01c887e74e61c75b9bb2a3e01a976eaae0` (PR #434).
**Deployed baseline:** production branch `live` at
`be964f171783cff27928edbefdf286dc13b7462c` (PR #426); the
2026-11-04 00:01 America/Denver promotion carries `main` to `live`.

This record follows the fleet's 17-row shape. A row closes **only on
live evidence at the checked release**: *implemented in source* is
not *deployed*, and *deployed* is not *proven live*. A ruled
exception is a decision with the owner's name on it, never a quiet
omission.

**Declared degradation:** this re-baseline is a single-cartographer
verification pass — the 2026-11-02 documentation audit spot-verified
against current code, plus live read-backs on 2026-11-03 night — not
a Tier 2 Critic panel. Rows are closed here only where a live
read-back is named; everything else stays exactly as open as the
evidence leaves it.

## Tool census (counting method stated)

Three methods, one answer:

1. **Catalog count.** `docs/TOOL-CATALOG.md` lists **254** tool rows;
   `scripts/check-catalog.mjs` verifies the catalog against the
   registry in CI, and `tests/unit/registry.test.js` pins the
   registered list.
2. **Registry count.** **253** tools are registered from
   `src/tools/` (merged by `src/core/registry.js`). The one unbuilt
   catalog row is `vercel_admin_overview`, **closed by owner ruling
   IN-16 — deliberately out, it will not be built**.
3. **Live advertised count.** At `live` `be964f17`, the front door
   (`/`), `/api/health` and `/api/contract` all report **253**
   tools (contract: 150 writes, 22 money tools).

Listing modes (compact, front_door) filter which registered tools a
connection sees; they do not change the registry count, and no
meta-tool is double-counted. The owner-obedience conversions
(PRs #427–#434) changed existing tools and added none — every one
of their STATUS entries records "registry unchanged at 253".

## The 17 rows

| Row | Status | Evidence and remaining work |
|---|---|---|
| 1. Client compatibility | **OPEN — correctable.** | Per-client instruction sections are live on the home page (Muse, Claude web/desktop/phone, ChatGPT, Claude Code, Cursor). The formal per-client acceptance matrix and mobile-client acceptance remain open (README, STATUS). Next: run the matrix with a spec-shaped handshake per transport/auth shape and record per-client results; a client that cannot be tested is declared untested. |
| 2. Client ID cards (CIMD) | **SOURCE IMPLEMENTED + DEPLOYED; LIVE KNOCK NOT RECORDED.** | AUD-BX (`src/core/cimd.js`) fetches and validates card clients per the fleet contract (HTTPS-only, self-naming, redirect binding, secret-holding cards refused, SSRF discipline); live discovery advertises `client_id_metadata_document_supported: true` (read 2026-11-03). Next: a real Claude/ChatGPT card-client knock test at a checked release, recorded here. |
| 3. One public sign-in | **VERIFIED LIVE.** | The SR-1…SR-6 replacement is live (2026-11-02): the public sign-in is Vercel's own start to finish, every sign-in receives the full tool set, and read-only / production are switches on the user's own connection, never sign-in classes. Gate O-2.7 closed on the owner's acceptance reconnect. The `/connection` page read live 2026-11-03 states the same shape. |
| 4. Developer access boundary | **PARTIAL.** | Route separation is live: the developer/operator door sits under `/api/dev/*` and the public pages never link or name it (`docs/DEVELOPER-ACCESS.md`); the old owner setup page is deleted outright. Its gate is still the administrator passphrase, which the Standard records as **transitional**. Next: named operator identity (owner decision on timing; recovery must not break during migration) and the entitled-operator vs ordinary-user live denial pair. |
| 5. Release provenance (VER-1) | **PARTIAL — front door and health VERIFIED LIVE.** | `/` and `/api/health` at `live` name `deployed_source_sha` `be964f171783cff27928edbefdf286dc13b7462c`, matching the `live` branch head read the same night (2026-11-03). Owed: the same identity in the MCP `initialize` response, `vercel_whoami`'s `server_release`, and the RTC manifest, plus the per-deployment agreement test (all four surfaces agreeing; unknown SHA stated as unknown). |
| 6. Identity anchoring / branded origin | **VERIFIED LIVE.** | OAuth discovery read 2026-11-03 names issuer `https://vercel.robinsonaisystems.com` with every endpoint on that origin (AUD-BO, this rule's worked example). The `*.vercel.app` address remains a serving alias only. |
| 7. Unleashed branding and naming | **PARTIAL.** | Front door and connection page carry the full name **Vercel Unleashed by Robinson AI Systems** (live read-back 2026-11-03); the Break-Out mark with the Sky `#5FA8FF` shard is served from `src/brand-assets.js`, byte-identical at `main` and `live`; the D-005 claims registry carries the Vercel claim (filed 2026-11-02). The README title is corrected in the same PR as this record. Recorded, not silently conformed: `src/service-identity.js` keeps `SERVICE_DISPLAY_NAME = 'Vercel by Robinson AI Systems'` as the MCP-facing display name under a deliberate no-rename decision for stable identifiers — whether that name is an identifier or a public title under the naming rule is the owner's call, filed as a finding in the 2026-11-03 fleet audit evidence. |
| 8. Branded front door — five fleet things | **PARTIAL.** | (a) Branded subdomain attached and serving — verified live. (b) Status front door at `/` — verified live (HTML for browsers, JSON status for programs, both from the one shell in `src/front-door.js`). (c) Plain-English `/connection` page — verified live 2026-11-03. (d) Instructions name only the branded address — verified on the connection page and in `docs/PAGE-AND-BRAND-BLUEPRINT.md`. (e) Exactly one listing on robinsonaisystems.com/tools — asserted by the brand blueprint; **not verified from this repository** in this pass; site-side read-back is owed. |
| 9. Fleet health contract | **VERIFIED LIVE.** | `/api/health` at `live` answers the pinned shape (`status`, version, deployed SHA, tool count, timestamp) and is database-free since AUD-BY (PR #416); the genuine store check lives behind authentication at the deep health route. `/api/contract` advertises the health path. |
| 10. Production readiness and protection gate | **OPEN — no filed pass.** | The gate's five owner questions were answered by decision on 2026-10-31 and are logged in STATUS and the go-live checklist, and several gate sections have live evidence scattered through STATUS. No single filed gate report with evidence per section exists, so this server is **not** called production ready here. `docs/GO-LIVE-CHECKLIST.md` still carries open owner-operation boxes, including deployment-webhook registration (AUD-CI), which waits on the receiver's promotion and a secret placement through the owner's secure route. Next: file the gate report section by section, declaring any degraded check degraded. |
| 11. Discovery and contract governance (RTC) | **CONFORMS at plan level.** | `/api/contract` is live (RTC 1 advertisement, health path carried). The RTC 1 freeze holds and RTC 2 is adopted as its successor (owner ruling 2026-10-31, D1–D5); RTC 2 adoption lands through this server's own card — no silent in-version dialect change. This row is a plan-level conformance, not a live RTC 2 pass. |
| 12. No global credential fallback | **CONFORMS at plan level.** | Connections act only through the Vercel account their own sign-in attests and the credentials that account enrolled; there is no service-owned global fallback credential for another tenant. Future changes must keep demonstrating this under row 16's process. |
| 13. Version evolution (no-reinstall) | **CONFORMS at plan level.** | Additive-only surface evolution; the deletion-conversion family changed no tool name, shape or count. A continuing rule for later changes, not a completed acceptance event. |
| 14. Pattern appraisal guardrails | **RECORDED; remote coding runtime NOT APPLICABLE.** | This server's `vercel_dev_*` tools run the provider's own Sandbox jobs; they are a product feature, not a fleet remote coding runtime, and no appraisal item is owed for them. |
| 15. Capability completeness | **CORRECTABLE — PARTIAL under the 2026-11-04 completeness amendment (two-source re-census, 2026-11-04).** | Re-issued 2026-11-04 by the fleet completeness re-census (Critic Step 0, two sealed sources; full addendum below). Graded against the service's full published surface, not this server's catalogue of itself: of **468 mapped endpoint rows** in Vercel's REST reference, **191 are covered by named tools, 136 through the universal door, 112 are missing (21 of them credential-refused by design — see the addendum — leaving 91 build-relevant), and 29 are unverified**. The previous basis for this row (254 catalog rows — 253 covered, 1 deliberately out by IN-16) graded the tool catalogue; the re-census grades the map, and the grade is capped at PARTIAL while plausibly-needed capabilities stand missing. The headline is on this server's own store: **OAuth client registrations are create-only** — no list, no owner read, no update, no delete anywhere in the code, no registration access token issued, and the retention sweep never touches the table (card **RECENSUS-1**, filed with this record). RTC passes likewise have no list or read leg. The core operating families (projects, deployments, domains, DNS, environment variables, teams, drains, routing, rolling releases) stand at or near full named coverage, and token/connection revocation is symmetric and complete. Missing-with-plan rows M1–M10 and the composition-owed flag are in the addendum; still owed from this row's earlier text: the workflow-frequency research, the consumer test, and a front-door depth line that cites this census rather than the tool count. |
| 16. Conformance-correction process | **CORRECTABLE — process running.** | Step 0 (freeze + inventory) is the 2026-11-02 documentation audit at its baseline plus tonight's spot verification at `f501ba01`; Step 1 is row 15's census state; Step 2 is this record. The row closes when every row conforms or carries a ruled exception with live proof filed. |
| 17. Owner-obedience (confirmed action) | **CORRECTABLE — conversions source-merged; live proof owed.** | The AUD-CH refusal audit classified this server's refusal points (858 inventoried; aim checks kept hard). Conversions to the confirmed-action pattern merged to `main` on 2026-11-03: project deletion (#427), the deployment webhook receiver (#428), deployment deletion (#429), team-with-enrollments deletion (#430), last-Owner removal/demotion (#431), domain-in-use removal (#432), custom-environment deletion (#433), shared-variable deletion (#434) — each evaluating the exact target, disclosing in plain words, binding confirmation to the evaluation fingerprint, re-checking at execution, journaling, and verifying by read-back. **This row does not close on source:** the family reaches production only with the 2026-11-04 00:01 promotion (`main` → `live`), and each conversion closes only on live proof at that checked release. Separately owed: registering the AUD-CI webhook on the live route and setting its signing secret through the owner's secure route (GO-LIVE-CHECKLIST). |

## Row 15 addendum — the 2026-11-04 two-source completeness re-census

**Method.** Two sealed cartographers, reconciled leg by leg.
Cartographer A mapped the service from Vercel's published REST API
reference only (468 endpoint rows, 115 resources, 18 owner
workflows step-counted; page `last_updated` 2026-11-04).
Cartographer B inventoried this server only (repo code at `main`
`f76ab78138bf51f4ad7426915d1bb7c0e09e3e20` — the same commit the
live front door reported that day — plus the live front door):
759 of 759 files, **253 tools by registry execution** (profiles
read_only 103 / everyday 144 / full 253), the catalog's 254 rows
and the one IN-16 closure confirmed by execution. The graded
denominator is the service map (468). The server's own operation
ledger (455 provider operations over the vendored 2026-10-11
OpenAPI snapshot: 338 reachable by its own accounting, 96
documented-only, 21 credential-refused) is the second lens,
published in the reconciliation, never blended into the grade.

**Counts (arithmetic closes: 191 + 136 + 0 + 0 + 112 + 29 = 468).**

| Disposition | Count |
|---|---:|
| Mapped endpoint rows | 468 |
| Covered — named tools | 191 |
| Covered — universal door only | 136 |
| Composed (endpoint level; composites re-reach counted legs) | 0 |
| Owner-excluded operation legs | 0 |
| Missing | 112 |
| Unverified | 29 |

Inside Missing, **21 are credential-refused by design** — the
server declines operations whose credential class the owner's
architecture does not hold (the posture rows 12 and 17 record).
They are counted as not-covered because they are not reachable;
they are not build items, and changing any of them takes an owner
ruling on credential classes. Build-relevant missing is **91**.
Under the conservative variant (the door tier counted as
unproven), covered is 191 of 468 and the grade is PARTIAL under
both variants. Per-family tables, the symmetry ledger, and the
full reconciliation are the fleet audit's record
(`vercel-reconciliation.md`, 2026-11-04); the families carrying
the missing mass are Vercel CI (17), VCR (14), Integrations &
Marketplace provider side (10), Sandboxes (8), AI Gateway (7),
Observability & Analytics (6), Connect (6), Domains/Registrar (5).

**Server-self headline.** OAuth client registrations
(`oauth_clients`) are create-only: `POST /api/oauth/register`
inserts the row (`src/db.js`, `createOAuthClient`) and issues no
registration access token; the only read is an internal lookup;
there is no list function, no update function, and no
`DELETE FROM oauth_clients` anywhere in `src/` or `api/`, no
deregistration route, and the retention sweep never touches the
table. A registration, once created, cannot be removed through
the product. RTC passes can be created (two doors) and revoked
but never listed or read. By contrast: enrolled accounts have a
full lifecycle ending in a hard delete with a journaled cascade,
and connection revocation is symmetric through two doors with
durable tombstones — the wound is specifically registrations,
not revocation generally. The one ruled closure stands as ruled:
`vercel_admin_overview` is not an operation on the service map
and IN-16 is not counted as an exclusion above.

**Missing-with-plan.**

- **M1 — OAuth client registration lifecycle** (list, owner read,
  update, delete; a management credential or owner-tool door; a
  retention story for abandoned registrations). **Filed as card
  RECENSUS-1 with this record.** Acceptance: registrations
  created through the server become listable and deletable
  through the product, and a deleted registration reads back gone.
- **M2 — RTC pass list/read.** An owner list/read for issued
  passes. To be filed.
- **M3 — Protected-resources per-item remove** (clear-all exists).
  Minor; to be filed, may ride M2's card.
- **M4 — Vercel CI family** (17 missing): disposition decision
  per leg — named reads or a recorded door-only posture. To be filed.
- **M5 — VCR** (14 missing): decide whether registry management
  is plausibly needed for the fleet's container work; if yes,
  named repository/image/tag legs first. To be filed.
- **M6 — Marketplace provider-side legs** (7 missing): scope
  against the fleet's marketplace ambitions; the consumer side
  is covered. To be filed.
- **M7 — Sandboxes documented-only legs** (8): extend the
  dev-sandbox dispatch or record a door-only posture. To be filed.
- **M8 — Two operations-table entries with no dispatch reference
  in `src/`** (`firewall_config_get_version`,
  `registrar_contact_schema` — flagged by this server's own
  operation ledger): wire the dispatch or remove the table claim.
  To be filed (small).
- **M9 — The unverified block (29):** Daemons (3) and
  Organizations (7) are absent from the vendored snapshot;
  AI Gateway (6), Feature Flags (6), Vercel CI (4) and Connect (1)
  surpluses postdate it; the WAF config-version delete (1) rests
  on a corrupted reference description; the untagged
  `POST /api-keys` (1) has path-level semantics only. Plan:
  refresh the vendored OpenAPI snapshot, regenerate the operation
  ledger (the CAP-1 machinery), and re-disposition at the next
  census. Unverified counts as neither covered nor missing.
- **M10 — Composition-owed:** the joined owner job "buy a domain
  and put it live on my project, verified" takes up to 8 calls
  (each half is within the 3-call line alone, and a composite
  already covers the second half). Proposed composite:
  `vercel_workflow_register_and_attach_domain`. To be filed.
  Every other workflow in the service map's 18 completes in 3
  calls or fewer through this server, most in 1 through the
  `vercel_workflow_*` family.

**Declared limits of this re-census.** The service map's Storage
area is degraded (its 3 mapped rows are all covered by named
tools; store listing/update and KV/Postgres store management do
not appear in the REST reference and are carried as an unverified
area, not counted as missing — and Blob object operations, which
sit outside the REST index, are in fact covered here by named
tools through the dedicated SDK transport). The map's platform
absences (webhook update, project-member role update, registrar
delete, team access-request decision endpoint, organization
delete, billing refund, integration-configuration REST create,
access-group member add/remove, cron — config-only by platform
design) are platform facts, recorded in the reconciliation so no
future census re-opens them as server gaps. The server
inventory's lifecycle legs rest on tool names plus targeted code
reads, not all 759 files line-by-line; its live facts are the
front door, which agreed with the executed registry at the same
SHA. The two sources differ in vintage by three weeks; the 24
snapshot-surplus rows sit in Unverified by construction (M9).

## CI speed note (standing rule, Chris 2026-11-03)

MCP-server CI target is 30 seconds with a 1-minute hard cap. The
last ten `ci` runs at this baseline (2026-11-03, PR and push
events) all **passed**, with wall-clock durations of **84–119
seconds** — over the hard cap every time, so re-optimizing the CI
layout is a standing work item under the fleet rule (three
over-cap runs). Slow-but-green still passes; nothing in this
record treats the overrun as a failure of the work it checked.
