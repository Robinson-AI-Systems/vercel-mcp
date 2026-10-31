# Toolkit Hub RTC 1 — Vercel MCP integration and acceptance

Reviewed Hub contract and agent setup 2026-10-12; pinned source commit `e76b1f8bc76e4658f404263ee47a9edbcbeda625`.
This server remains independently usable over OAuth `/api/mcp`; no Toolkit Hub dependency is needed at runtime. **Owner 2026-10-19:** real Hub routing is NOT a provider completion gate. This server independently proves RTC 1, direct auth/provider behavior and revoked/expired denial. The historic Hub route plans below are Hub-owned optional integration handoffs.

## Implemented HTTP doors

Public: `GET /api/contract`, `GET /api/openapi.json`.
The HTTPS entrypoint verifies method and strict bearer *syntax* before constructing a database client or initializing SQL schema. Unauthenticated malformed traffic does not wake the account database. A syntactically valid pass still requires full PostgreSQL authorization; arrays and objects never become Bearer headers through implicit coercion.

Pass-only: `GET /api/whoami`, `GET /api/tools`, `GET /api/tools/{name}`,
`POST /api/tools/{name}`, `POST /api/tools/_batch`, `GET /api/results/{handle}`. Handle reads return a bounded records page (default/max 20), count, next page, and accepted fields/detail projection; unbounded content and malformed selectors are refused rather than silently truncated.
Tool metadata for a read-only pass must be explicitly registered read-only with a valid declared area (or the established narrow `server` default) and non-contradictory hints; ambiguous duplicated names are excluded from RTC discovery and dispatch. Authorization records lacking a valid account, pass ID or narrowly validated area list fail closed before provider reads. All tool calls share the existing MCP dispatcher. Read-only preview passes have explicit area restrictions; all paid, privileged, destructive and production operations remain forbidden through RTC. OAuth access/refresh tokens are rejected on the pass-only door. A one-time secret from signed-in owner setup gives the temporary pass; revocation is performed there. Pass scope/rate-limit and handle ownership are enforced by PostgreSQL, not process memory. For `_batch`, the PostgreSQL rate counter atomically reserves the number of requested read tools (1–10) before any tool runs, so batching cannot multiply the pass's per-minute quota (owner-selected 1–600 calls/minute; default 120 for new passes, legacy passes retain 60). The same counter is shared by serverless instances.

**Write-capable passes (R-1W, 2026-10-30; noted 2026-10-31, AUD-AN):** the read-pass rules above describe read-only passes. Since R-1W the owner may issue a pass with write scope (`allowWrites`, stored on `rtc_passes`); its writes dispatch through the same guarded registry path as the MCP door — confirm-gating, spend disclosure and the OP-2 delegation rules apply unchanged — and its scope, project restriction and revocation are owner-controlled per pass. The design record is the R-1W amendment in `docs/designs/BATCH-R.md`. R-2's separate HTTP write-contract leg remains open on its own card.

Read-only HTTPS invocation rejects prototype-bearing property names, credential-shaped nested argument strings (including repeated percent encoding), and excessive nesting at the shared RTC boundary. This precedes provider dispatch for both single and batch routes and does not add or relax individual tool schema permissions.

Read-only discovery supports bounded cursor pagination: the numeric `next` offset can be supplied as `cursor` to retrieve the following page with the same query and pass scope. Hidden/write-capable tools are filtered before pagination, never counted or leaked to a read-only pass. Invalid cursor/filter types are refused. The OpenAPI query parameters describe this interface.

Batch execution uses one canonical request snapshot from preflight through the final atomic quota check; changes to a request object after an await cannot redirect a previously approved call. Before each additional batch read, an unmetered SQL inspection checks revocation, expiration and unchanged account/area scope. If validation fails, remaining reads stop and no partial HTTP result is returned. These checks do not create new pass authority.

The read-only HTTPS batch response is also bounded to 8 KiB. A valid batch of up to 10 individually sanitized reads whose aggregate exceeds the envelope budget is stored for 24 hours under the same account and pass-derived result owner, and a handle is returned for the paged result endpoint. Unknown storage outcomes fail closed; no write pass is introduced.

Read-only MCP/RTC output presentation treats **every** text part as untrusted data, including non-JSON plaintext; the HTTPS adapter can return its sanitized text as a scalar RTC result. Unsupported image, binary, resource and malformed content parts are rejected before presentation or storage; no raw part may bypass the same credential masking used for structured JSON responses. Registry handlers which need non-text content require separately reviewed, safe explicit support.

Both OAuth MCP and RTC HTTPS refuse a tool falsely declaring itself read-only if it also carries writeContract, guardedWrite, localAdmin, secretIn/secretOut, destructiveHint:true or readOnlyHint:false. These contradictory declarations are not exposed on tool lists, and direct/batched invocation never calls their handlers.

## CI evidence and limitations

The unit CI job installs the **reviewed** public Hub source and runs the hub's actual conformance tests against its reference fixture. The additional localhost end-to-end check invokes upstream `runConformance` for public manifest, OpenAPI and unauthenticated-denial checks and actual Hub `checkAgent` for read-only direct CLI invocation against **this server's** handlers. It tests denied write and revoked pass; DB tests exercise two independent SQL sessions. This proves a subset of RTC 1, **not** full conformance: write-capable RTC passes are granted since R-1W (2026-10-30), but the upstream conformance suite has not been re-run against the write surface, so the upstream write/readback/full-catalog checks remain uncertified — the outstanding step is the re-run (R-3), not a missing grant. (Updated 2026-10-31, AUD-AN.) R-3 has since executed under disposition (b) — see the dated section below (AUD-BG, 2026-10-31).

## R-3 executed under disposition (b) — 2026-10-31 (AUD-BG)

**The divergence.** This server's RTC 1 evidence pins the hub suite at commit `e76b1f8bc76e4658f404263ee47a9edbcbeda625` (the suite as of the RTC 1 freeze, 2026-10-11). At hub HEAD `e6cfb98` the suite has moved in ways the contract does not authorize: two dialects changed after the freeze with no new RTC version and no dated decision, as CONTRACT §9 requires — (1) catalog pagination: HEAD walks `page=N` pages to exhaustion, while the pin (and §4) speaks the single cursor-offset page this door ships (the `next` offset supplied as `cursor`); (2) result recovery: HEAD expects CONTENT pages (`{page, pages, bytes, content, next}`), while §7 and the shipped door return record pages (`{page, limit, count, records, next}`). Post-freeze commits also added the fixtures mechanism the newer probes assume.

**The ruling that resolves it.** The owner's composite decision of 2026-10-31 (hub `docs/DECISIONS.md`, PR #251, entry "2026-10-31 — RTC 2 adopted as RTC 1's §9 successor; the RTC 1 freeze holds (R-3 disposition)"; mirrored in this repo's `docs/DECISIONS.md` by AUD-BH, #377): the RTC 1 freeze HOLDS — no shipped dialect is amended to chase the unversioned suite drift — AND RTC 2 is adopted by that dated decision as RTC 1's §9 successor. This server's RTC 2 adoption (content pages, the `page=N` walk, the RTC 2 manifest) is a separate later card under the adopted contract, never a chase of the unversioned suite. R-3 therefore executes against the PIN suite.

**Which named checks run where.** The CI job `conformance` (`.github/workflows/ci.yml`) runs `scripts/rtc-conformance-ci.mjs`: the pin suite's `runConformance` against this server's real door (`src/rtc/door.js`) on a throwaway Postgres through `src/db.js`, with the pinned `emulate` fake Vercel behind the provider path — the door's shipped `fetchImpl` seam aims the client at the emulator; no base-URL override exists in shipped code or was added. Asserted, named check by named check: `manifest`, `manifest.openapi`, `catalog`, `meta`, `passes`, `passes.read_only`, `passes.expired`, `passes.revoked`, `safety`, `budget`, `oauth.refresh_settings` (adapter over this server's own OAuth store — `createAccessToken` / `getTokenByRefreshToken` / `getAccessToken` / `rotateRefreshToken` in `src/db.js`), and `limits.two_instance` (two independent door processes, one throwaway database, a dedicated low-limit pass). A failure fails `ci` (BATCH-R §R3; the §6 acceptance mapping names this job). The suite's reference pass is a catalog-listing pass scoped to the projects area: the suite selects its reference read/write/guarded tools from the first catalog page, the door's page is the shipped 8 KiB envelope-bounded prefix of the pass-visible catalog, and the projects page is the first page carrying all three kinds (`vercel_project_list`, `vercel_project_update_settings`, `vercel_project_create`).

**Dispositioned: `reads` / `writes`.** At the pin these two probes hardcode the hub fixture server's semantics — a positional reference read whose result is a stored `value`, a fields projection of exactly that value, a >8 KB read recovering as a payload string, and write dry-run/commit shapes (`done`, `confirmed`, `logged.id`, `needsConfirmation`) that CONTRACT §§6–7 do not carry — so no real server can pass them as written. They run in the harness for the record and are never asserted. Their behavior is covered by the interim coverage BATCH-R §R3 names — this server's own write-contract tests over MCP, `vercel_call` and HTTPS: `tests/unit/write-contract.test.js`, `tests/unit/purchase-delegation.test.js`, `tests/unit/rtc-write-passes.test.js`, `tests/db/rtc-write-passes.test.js`, `tests/unit/rtc-http.test.js` and `tests/unit/rtc-api.test.js`.

**Two latent mismatches the frozen suite exposed, fixed in the same card.** (1) A read-only pass invoking an existing write tool was refused `outside_scope`; the frozen probe (identical at the pin and at hub HEAD — freeze-era, not drift) requires `refused_by_guard`. The door's invoke route now returns `refused_by_guard` for exactly that case; visibility answers (list/describe, and write passes invoking outside their areas) are unchanged, and nothing is dispatched in either case. (2) CONTRACT §3 requires a money tool's listing text to lead with `MOVES MONEY:`; no tool definition carried the prefix. `rtcMetadata` — the single derivation behind every RTC catalog row — now applies it for money tools on the RTC surface; the MCP listing surface is separately governed and untouched.

## Historical D-4 Hub-owned integration handoff (not server completion)

The Hub's optional real direct/relay/Sandbox integration procedure below belongs to the Hub project. Its unexecuted tests must not be represented as passed, but they cannot block this server's independent RTC 1 completion. A specific provider-contract violation discovered during Hub tests remains actionable here.

Owner approved narrowly scoped read-only, non-production tests on 2026-10-12. The next authorized integration agent must independently verify an actually deployed, fixed HTTPS service origin and correct Vercel dynamic route resolution, then use owner setup to issue a short-lived read_only **TEST** pass limited to `server` for service identity; never substitute a Vercel preview pass for the Hub TEST gate. Never paste a pass into chat, logs, code, query strings, CLI arguments or GitHub issues.

From a reviewed Hub checkout, configure protected `RTOOL_SERVERS=vercel=https://VERIFIED_ORIGIN` and protected `RTC_TEST_PASS` (plus `RTOOL_PASS_VERCEL` if required by CLI). Run `node scripts/agent-check.mjs --server vercel --read-tool vercel_whoami --pass-env RTC_TEST_PASS --expect-route direct --authorized-real-run`. Then prove a GitHub-only workspace relay route with exact scoped encrypted relay binding and `--expect-route relay`, and separately a Vercel Sandbox allow-listed direct run. Follow the Hub `docs/pr-cards/D-4.md` and `docs/AGENT-SETUP.md` for safeguards and route setup. Existing ordinary GitHub/Vercel connectors are NOT evidence of custom RTC routing.

Record each run's reviewed commit, UTC timestamp, runner environment, expected/observed route, exit code, and pass revocation; do not record credential values or sensitive tool output. Revoke every temporary pass even on failure. No hosted relay bindings, real owner pass, live endpoint tests, real relay, or Sandbox run were configured or performed in PRs #112–#115. Production, money and D-2 remain gated independently.

## Credential integrity cross-check

The server-side output projector, audit writer and repository secret scanner recognize RTC pass bearer material. The scanner rejects a real-shaped pass even if the text contains FAKE. Tests use generated in-memory test credentials and verify that no bearer is emitted in scanner diagnostics, tool output or audit metadata.

## Semantically isolated RTC TEST identity (#133)

The prior mismatch was a real authorization problem: Vercel preview
credentials can read provider resources, while owner-approved Hub D-4
requires `mode=test`. A new independently issued TEST pass is **service
only**, with no Vercel API or account-resource access. Owner setup
requires its own fresh authentication and confirmation; SQL enforces
exactly `areas=['server']` and expiration, quota and revocation.
HTTPS discovery, direct invoke and batch preflight allow only
`vercel_whoami`, which returns the actual running RTC service identity
without querying account rows, secrets or Vercel. All other tools fail
closed. Preview passes still report preview and have their original
separate scoped-read permissions.

CI's fake pass and pinned local Hub tests prove this limited service
identity compatibility and negative scope/mode boundaries. They do
NOT prove a genuine nonproduction Vercel project, external provider
reads, deployed HTTPS, actual owner TEST pass, real Hub direct/relay/
Sandbox runs, post-revocation verification, or full RTC conformance.
Those still need independently recorded evidence and owner-protected
credentials. Do not provision paid resources or relax Hub checks.

## Service-specific gateway recovery acceptance — 2026-10-12

Current isolated TEST pass permits service identity only (`vercel_whoami`) and no Vercel provider account resources. It can prove limited RTC service connectivity, not real provider reads or full conformance. Preserve that distinction; a genuine isolated provider-resource TEST read needs its own service-owned contract and existing approvals. No paid project or manual deployment.

## Hosted direct evidence runner — candidate #160

The isolated owner-operated `scripts/check-connected-acceptance.mjs`
covers public OAuth discovery and RTC metadata, anonymous denial,
short-lived TEST identity and provider-read denial, preview deployment
read-only proof, approved nonproduction D-2 runtime/file checks, and
post-revocation 401. Never pass service credentials to the runner as
CLI flags or store real passes in CI fixtures or repository files.
See `docs/DEPLOY.md` §8. Its unit tests use fabricated bearer material;
there is still **no** actual owner pass or genuine relay/Sandbox run
recorded. A direct script success proves its named direct server scenario only; it does not prove a Hub route, which is not a service completion requirement.
