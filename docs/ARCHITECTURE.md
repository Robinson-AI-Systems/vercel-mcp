## 2026-10-21 source: client-owned OAuth disconnect

The native issuer exposes POST /api/oauth/revoke in source and advertises it through issuer
metadata. core/oauth-revocation.js validates the registered client authentication method and
atomically revokes only that client's matching connector row via revokeOAuthToken. It searches
access and refresh hashes, ignores advisory type hints and returns an empty 200 for known,
unknown, foreign or already-revoked values. Expired access can still stop its current refresh.
No provider credential, RTC pass, sibling connection, production setting or grant is changed.
Revocation addresses the current token row; obsolete tokens replaced by rotation are already
invalid and do not locate subsequent descendants. This is not an independently verified live
client disconnect or proof of full multi-user customer enrollment. See STATUS and the A-3 card.

# ARCHITECTURE — verified runtime facts and limitations

**Source baseline reviewed: 2026-10-26.** `main` at `03b1e4b258e533b27aa53ccebb9577f81b32f5d4` (merge of PR #222; PRs #219–#222 merged 2026-10-21); `live` and the most recent observed **READY** production deployment are at `cb60c6f4c32f8a3a139d5a68fa514aead65a4da6` (last independently verified 2026-10-19; the serving alias was not independently verified). Source code on `main` is **not automatically deployed**. The Vercel deployment inventory confirms READY state and that `live` source SHA; it does not independently prove a specific public alias, real client connection or provider mutation. Review [STATUS](STATUS.md) and the actual Vercel deployment before relying on a later revision.

This document describes currently implemented source, not desired features. The roadmap and designs own still-unimplemented behavior; [PRODUCT-AUTHORITY-AUDIT](PRODUCT-AUTHORITY-AUDIT.md) tracks developer-policy leaks and acceptance deficits. Historical PRs and expired candidate notes remain in dated STATUS history only.

## Runtime and deployment

| Component | Implemented status |
|---|---|
| Hosting | Dedicated Vercel `vercel-mcp` project; Node 24, ESM, serverless `api/` endpoints. Production branch is **`live`**, not `main`. Standard deployment is the checked 00:01 America/Denver main-to-live promotion; automatic preview builds disabled. |
| Persistence | Dedicated Neon PostgreSQL schema created and initialized. Its stored owner/team credential was independently provider-verified and encrypted during initial setup on 2026-10-13. Do not repeat provisioning or reveal secrets. |
| Authentication | Service-owned OAuth protected MCP resource, authorization code + S256 PKCE, account/mode/profile/listing selection in owner-protected consent UI. PR #219 additionally registers explicit **public** clients (`token_endpoint_auth_method=none`, no shared secret) while retaining confidential `client_secret_post` and preexisting confidential records. Access tokens expire and refresh rotation is atomically bound to original client ID. |
| Native transport | Streamable HTTPS MCP at `/api/mcp`, service-owned auth and SDK tool discovery/dispatch. Stable technical identity `robinson-vercel-mcp`, stable `vercel_*` tool names; owner-controlled display name **Vercel by Robinson AI Systems** (proposed in #219). |
| RTC 1 HTTP transport | `/api/contract`, `/api/openapi.json`, `/api/whoami`, `/api/tools`, named `/api/tools/{name}`, `/api/tools/_batch`, `/api/results/{handle}`. Current pass authorization is **read-only preview** or **TEST service identity only**; no production/full/write RTC pass yet. TEST success never proves a Vercel provider read. |
| Rate limits | Pass budget charged atomically via `rtc_passes.window_count/window_started` inside PostgreSQL, including batch costs, no in-memory rate authority. #219 adds owner-configurable 1–600 calls/minute, default 120 for new passes and preserves 60 for legacy passes during additive migration. Do not substitute the old design's proposed separate `rate_limits` table; it was not implemented. |
| CI | Required parallel `check`, `unit`, disposable localhost `db`, and `emulate` jobs plus aggregate `ci`; separate `Daily live policy` / release-policy enforcement. Previously checked #219 source `e43ad22a` passed. Re-run exact-head checks after documentation commits. |
| External proof | Historical provider-scoped V-1 run-list read was marked PASSED in the authoritative acceptance queue; remaining live client/provider write, expiry/revoke/reconnect, desktop/mobile trials and numerous D/E/V operations remain unaccepted. No general public distribution task belongs to this repository. |

## Active source modules

- `api/mcp.js`, `src/core/mcp-server.js`, `src/core/mcp-auth.js`, `src/core/profiles.js`: authenticated MCP transport, profile-aware registry discovery and dispatch.
- `api/oauth/*`, `api/well-known/*`, `src/core/oauth-handlers.js`, `src/core/oauth.js`, `src/oauth/routes.js`, `src/vercel/login.js`: dynamic client registration, issuer/resource metadata, PKCE, browser consent, access/refresh tokens.
- `src/tools/index.js` imports many real read and write families (projects, deployments, releases, aliases, custom/shared/global configuration, team/security, universal reads, Sandbox, developer runs). Individual operations have differing profiles and execution guards. **Do not repeat the old “two read-only tools; no write tools” description.**
- `src/core/write.js`, `src/core/write-preflight.js` and corresponding `src/tools/*`: declared target/production/spend/approval guards, replay/idempotency, shape/readback/audit. Existing mandatory per-purchase approval, blanket unknown/recurring-cost refusal and selected production/confirmation defaults **remain open end-user-delegation defects**; do not remove safeguards without a fully delegated replacement. The target behavior for these seams is set by the owner's 2026-10-27 rulings — IN-04 (key expiry is the key owner's choice; notify ahead of expirations that exist), IN-09 (production stays on; the switch is the end user's and agent-flippable with their approval) and IN-12 (spend alerts are read/report only) — see `docs/DECISIONS.md` and `docs/OWNER-INPUTS.md`.
- `src/rtc/api.js`, `src/rtc/door.js`, `src/core/rtc-contract.js`, `src/vercel/pass-requests.js`, `src/tools/pass-proposals.js`: separate strictly scoped read-only RTC HTTP route, manifest, sealed owner-reviewed pass proposals, one-time pass delivery, result-owner isolation, and (in #219) selected per-pass rate.
- `src/vercel/client.js`, `operations.js`, `provider.js`, `setup.js`, `tokens.js`, `production.js`: provider HTTP integration, pinned request operation shapes, secure account setup and production classification.
- `src/db.js`: sole SQL boundary and additive/idempotent schema initializer. Relevant tables in `SCHEMA_TABLES`: `vercel_accounts`, `oauth_clients`, `oauth_codes`, `oauth_tokens`, `login_attempts`, `change_log`, `one_time_secrets`, `pending_inputs`, `protected_resources`, `request_replay`, `result_store`, `purchase_intents`, `rtc_passes`, `dev_runs`, `dev_run_objects`, `dev_sandbox_usage`, `schema_migrations`.
- `tests/unit`, `tests/db`, `tests/emulate`, `scripts/rtc-hub-offline-check.mjs`: fake-provider contracts and disposable Postgres authorization/race tests. Upstream fake/CLI contract checks prove source conformance, not remote Hub operation or external client acceptance.

## Credentials, isolation and current limitations

- Owner enrolls selected team/project-scoped provider credentials privately via `/api/vercel/setup`; the service stores encrypted tokens. The MCP OAuth client credential is **not** the Vercel provider API token; a pass token is distinct from both. Never return bearer secrets in tools or logs.
- OAuth codes require a registered exact redirect, exact MCP resource and S256 PKCE. Confidential clients authenticate with a hashed client secret; public clients cannot provide a client secret. Existing confidential records remain readable without migration. Rotation/reuse/revocation must be tested independently in real client environments before marking accepted.
- `rtc_passes` stores hashed secrets, owner-scoped issuance and revocation, expiry, profile/mode/area selection. `src/rtc/door.js` rejects RTC writes, local owner administration, other pass modes, unauthorized areas and unrecognized credentials. Broad provider-backed write-capable RTC and per-user billing policy are **unfinished** R-1/R-2/authorization work.
- Provider and tenant/resource isolation, protected/self/app-resource checks, secret shaping, replay reservation, risk declaration and durable results must remain. Developer-only zero-spend restrictions are *operating rules for the implementing agent*, not intended product customer ceilings.
- Service-owned [direct client connection guide](CLIENT-CONNECTIONS.md) documents desktop/mobile setup, fallback, recovery and what is not yet independently confirmed. Hub is optional and Hub-owned real discovery/routing acceptance is not a provider completion gate.

## Environment and operating boundaries

`DATABASE_URL` is private dedicated Neon connection storage; `PUBLIC_BASE_URL` must match the serving HTTPS OAuth issuer/resource; `ADMIN_PASSPHRASE` guards owner setup and OAuth authorization; `TOKEN_ENCRYPTION_KEY` protects saved secrets. Do not print or copy their values. Builder may not change production accounts, enable live paid operations, spend money, manually release or contact customers without applicable additional authority. Refer to `.github/RELEASE-POLICY.md`, `AGENTS.md` and [GO-LIVE-CHECKLIST](GO-LIVE-CHECKLIST.md).

**Distribution boundary:** Only the standalone server's implementation, service branding, technical interoperability and security are owned here. Public directory eligibility, launch/publication/commercial distribution and external provider partnership work are handled by Robinson AI Systems outside this repository.

**Remaining proof:** Each real direct client and provider read/write scope must be separately tested and recorded with client, actual deployed SHA, authorization, denied attempts, revocation, independent readback and any approved fixture cleanup. See [STATUS](STATUS.md) release-acceptance ledger and R-1/R-2/R-3 cards. No tests in this PR established working mobile and desktop connections.
