# Toolkit Hub RTC 1 — Vercel MCP integration and acceptance

Reviewed Hub contract and agent setup 2026-10-12; pinned source commit `e76b1f8bc76e4658f404263ee47a9edbcbeda625`.
This server remains independently usable over OAuth `/api/mcp`; no Toolkit Hub dependency is needed at runtime.

## Implemented HTTP doors

Public: `GET /api/contract`, `GET /api/openapi.json`.
Pass-only: `GET /api/whoami`, `GET /api/tools`, `GET /api/tools/{name}`,
`POST /api/tools/{name}`, `POST /api/tools/_batch`, `GET /api/results/{handle}`. Handle reads return a bounded records page (default/max 20), count, next page, and accepted fields/detail projection; unbounded content and malformed selectors are refused rather than silently truncated.
Tool metadata for a read-only pass must be explicitly registered read-only with a valid declared area (or the established narrow `server` default) and non-contradictory hints; ambiguous duplicated names are excluded from RTC discovery and dispatch. Authorization records lacking a valid account, pass ID or narrowly validated area list fail closed before provider reads. All tool calls share the existing MCP dispatcher. Read-only preview passes have explicit area restrictions; all paid, privileged, destructive and production operations remain forbidden through RTC. OAuth access/refresh tokens are rejected on the pass-only door. A one-time secret from signed-in owner setup gives the temporary pass; revocation is performed there. Pass scope/rate-limit and handle ownership are enforced by PostgreSQL, not process memory. For `_batch`, the PostgreSQL rate counter atomically reserves the number of requested read tools (1–10) before any tool runs, so batching cannot multiply the pass's 60-read-units/minute quota. The same counter is shared by serverless instances.

Read-only discovery supports bounded cursor pagination: the numeric `next` offset can be supplied as `cursor` to retrieve the following page with the same query and pass scope. Hidden/write-capable tools are filtered before pagination, never counted or leaked to a read-only pass. Invalid cursor/filter types are refused. The OpenAPI query parameters describe this interface.

## CI evidence and limitations

The unit CI job installs the **reviewed** public Hub source and runs the hub's actual conformance tests against its reference fixture. The additional localhost end-to-end check invokes upstream `runConformance` for public manifest, OpenAPI and unauthenticated-denial checks and actual Hub `checkAgent` for read-only direct CLI invocation against **this server's** handlers. It tests denied write and revoked pass; DB tests exercise two independent SQL sessions. This proves a subset of RTC 1, **not** full conformance: the server intentionally does not grant full/write-enabled RTC passes, so upstream write/readback/full-catalog checks cannot yet certify the production service.

## D-4 real-world handoff (pending)

Owner approved narrowly scoped read-only, non-production tests on 2026-10-12. The next authorized integration agent must independently verify an actually deployed, fixed HTTPS service origin and correct Vercel dynamic route resolution, then use owner setup to issue a short-lived read_only preview pass limited to `server` (or the exact required non-production area). Never paste a pass into chat, logs, code, query strings, CLI arguments or GitHub issues.

From a reviewed Hub checkout, configure protected `RTOOL_SERVERS=vercel=https://VERIFIED_ORIGIN` and protected `RTC_TEST_PASS` (plus `RTOOL_PASS_VERCEL` if required by CLI). Run `node scripts/agent-check.mjs --server vercel --read-tool vercel_whoami --pass-env RTC_TEST_PASS --expect-route direct --authorized-real-run`. Then prove a GitHub-only workspace relay route with exact scoped encrypted relay binding and `--expect-route relay`, and separately a Vercel Sandbox allow-listed direct run. Follow the Hub `docs/pr-cards/D-4.md` and `docs/AGENT-SETUP.md` for safeguards and route setup. Existing ordinary GitHub/Vercel connectors are NOT evidence of custom RTC routing.

Record each run's reviewed commit, UTC timestamp, runner environment, expected/observed route, exit code, and pass revocation; do not record credential values or sensitive tool output. Revoke every temporary pass even on failure. No hosted relay bindings, real owner pass, live endpoint tests, real relay, or Sandbox run were configured or performed in PRs #112–#115. Production, money and D-2 remain gated independently.

## Credential integrity cross-check

The server-side output projector, audit writer and repository secret scanner recognize RTC pass bearer material. The scanner rejects a real-shaped pass even if the text contains FAKE. Tests use generated in-memory test credentials and verify that no bearer is emitted in scanner diagnostics, tool output or audit metadata.
