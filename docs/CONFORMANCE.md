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
| 15. Capability completeness | **CORRECTABLE.** | The tool catalog is this server's retroactive census of the provider's API surface: 254 rows dispositioned — 253 covered, 1 deliberately out (IN-16) — and the one-call composites exist as the `vercel_workflow_*` family. Still owed in census form: beside-API/substrate dispositions, the workflow-frequency research, and the consumer test, filed as a census addendum; and a front-door depth line that cites the census rather than the tool count. |
| 16. Conformance-correction process | **CORRECTABLE — process running.** | Step 0 (freeze + inventory) is the 2026-11-02 documentation audit at its baseline plus tonight's spot verification at `f501ba01`; Step 1 is row 15's census state; Step 2 is this record. The row closes when every row conforms or carries a ruled exception with live proof filed. |
| 17. Owner-obedience (confirmed action) | **CORRECTABLE — conversions source-merged; live proof owed.** | The AUD-CH refusal audit classified this server's refusal points (858 inventoried; aim checks kept hard). Conversions to the confirmed-action pattern merged to `main` on 2026-11-03: project deletion (#427), the deployment webhook receiver (#428), deployment deletion (#429), team-with-enrollments deletion (#430), last-Owner removal/demotion (#431), domain-in-use removal (#432), custom-environment deletion (#433), shared-variable deletion (#434) — each evaluating the exact target, disclosing in plain words, binding confirmation to the evaluation fingerprint, re-checking at execution, journaling, and verifying by read-back. **This row does not close on source:** the family reaches production only with the 2026-11-04 00:01 promotion (`main` → `live`), and each conversion closes only on live proof at that checked release. Separately owed: registering the AUD-CI webhook on the live route and setting its signing secret through the owner's secure route (GO-LIVE-CHECKLIST). |

## CI speed note (standing rule, Chris 2026-11-03)

MCP-server CI target is 30 seconds with a 1-minute hard cap. The
last ten `ci` runs at this baseline (2026-11-03, PR and push
events) all **passed**, with wall-clock durations of **84–119
seconds** — over the hard cap every time, so re-optimizing the CI
layout is a standing work item under the fleet rule (three
over-cap runs). Slow-but-green still passes; nothing in this
record treats the overrun as a failure of the work it checked.
