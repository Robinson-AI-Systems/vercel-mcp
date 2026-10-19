# Direct MCP client connections — Vercel by Robinson AI Systems

**Status 2026-10-19: source paths implemented, independent external desktop and mobile acceptance still PENDING.** This is an **unofficial, independently developed Vercel integration** and is not Vercel-endorsed. An OAuth login, visible tool list, TEST pass or installed app is **not** evidence that the delegated provider tools performed correctly.

## Two distinct ways to connect — Hub is optional

1. **Native remote MCP (primary for capable coding agents):** connect a client that genuinely supports **remote Streamable HTTP MCP and the required OAuth** to the service origin plus **`/api/mcp`**. The active origin must be the URL of this standalone service, not the Hub or a deployment preview of an unrelated application. `/.well-known/oauth-protected-resource` advertises the protected MCP resource and `/.well-known/oauth-authorization-server` advertises the service issuer/registration/authorization/token URLs. Server metadata has a stable technical identity `robinson-vercel-mcp`; owner-controlled display identity should be **Vercel by Robinson AI Systems**. Authorization is service-owned.
2. **RTC 1 read-only HTTPS API:** the same standalone origin exposes the unauthenticated manifest `GET /api/contract` and schema `GET /api/openapi.json`. After separately authenticated owner issuance, supply a short-lived **`rtc_pass_...`** bearer ONLY in an HTTPS Authorization header. Start with `GET /api/whoami`, `GET /api/tools`, `GET /api/tools/<name>` and `POST /api/tools/<name>`; `GET /api/results/<handle>` is owner-bound. RTC 1 pass grants implemented today are read-only preview or TEST service identity, not general-purpose end-user writes; R-1 write-capable pass support is incomplete. A Hub client is never required for these direct doors.

**Never** put the passphrase, provider token, bearer, database URL or one-time secret in a chat, URL query, example issue, committed code, browser screenshot or assistant result. Use the authenticated owner setup page or the client’s secure OAuth/credential flow. Keep existing connection IDs/tokens stable when changing branding.

## Existing native MCP OAuth contract (source description, not external acceptance)

- The server advertises dynamic client registration `/api/oauth/register`, authorization `/api/oauth/authorize`, token/refresh `/api/oauth/token`, and exact resource binding to `/api/mcp`. Current implementation requires authorization code with S256 PKCE, and **client_secret_post** for dynamically registered clients. Token responses include 3600-second access tokens and a refresh token; refreshing rotates it and a reused/expired/revoked credential is refused.
- During sign-in select the correct previously enrolled owner Vercel account/team, mode and connection profile; owner sign-in uses a separate protected browser form. Profile, account and production authorization are enforced server-side; merely asking an agent to change profile does not grant permissions.
- The provider Vercel API credential is stored by the owner in `/api/vercel/setup` and never passed to the coding agent. A service OAuth token and a Vercel provider API token are different credentials and must not be confused.
- A client MUST support the actual remote MCP transport, registration method, PKCE, client authentication, state and redirect handling securely. In particular, clients that support only **public OAuth clients with `token_endpoint_auth_method=none`** may not work with this service’s current `client_secret_post` registration. That limitation is **open interoperability engineering**, not an instruction to weaken OAuth or embed a shared secret in a mobile application.

## Desktop and mobile setup without unverified compatibility claims

For a capable desktop coding agent, open its remote/custom MCP connector settings, enter the standalone server's verified HTTPS origin plus `/api/mcp`, choose its normal OAuth connection flow, select the enrolled Vercel account and profile during server authorization, and complete its browser callback. Run a genuine `vercel_whoami` then an authorized provider-scoped read such as `vercel_list_accounts`; compare the selected team ID to the Vercel account you intended. The actual documented user-interface menu labels vary by client and platform.

For mobile, use the same remote HTTPS endpoint **only if the specific mobile client supports remote custom MCP and the described secure OAuth flow and browser redirect**. A mobile browser that opens the setup page or a ChatGPT plugin that shows installed does not establish remote MCP support on that coding agent. There is no independently verified mobile client acceptance in this repository as of this date. Where the platform does not support the flow, use its documented supported integration or an authorized desktop environment; do not require a desktop IDE to operate the hosted service itself.

For the independently scoped RTC API, first issue/review the selected **read-only** pass in owner setup, set approved areas and expiry (and after #219 ships, rate limit 1–600/min), securely give it to the capable HTTPS client and perform a real permitted read. `TEST` passes intentionally cannot call Vercel. A successful TEST `vercel_whoami` verifies this service only.

## Diagnose and recover without widening access

| Symptom | Owner-safe verification and recovery |
|---|---|
| Missing remote MCP/connection menu | Confirm that exact client and version support remote MCP on that platform; mere mobile app access is insufficient. No unsupported compatibility claim. |
| OAuth issuer/resource/callback rejected | Check that deployment origin matches configured `PUBLIC_BASE_URL` and registration redirect. Check that the client supports the advertised PKCE and token authentication. Never paste secret into chat. |
| Connected but no tools | Check chosen team, mode, profile, listing mode, real deployed `live` revision and correct connector identity; compare with owner setup. Discovery alone is not provider execution. |
| Missing access to a Vercel project | Check the actual stored provider token scope and the user’s delegated role; an account “whoami” read is not proof of project ownership, production access or spending permission. |
| Expired/refresh failure | Let the client perform a normal refresh once. A failed rotation/reuse must not be retried with stale tokens; disconnect, independently reauthenticate and consent to reconnect. |
| Revocation needed | Revoke a selected owner connection or RTC pass in authenticated owner setup; confirm that the old token now fails, then reconnect and verify the intended account. Do not clear unrelated credentials. |
| RTC 429 | Check the pass-specific limit and the documented `Retry-After` response. Do not evade Vercel provider's independent rate limits. |
| Write or spend refused | Determine whether a true user credential/scope, intentional user approval, protected-resource rule, or the **known unfinished developer-policy leak** caused it; do not bypass a guard or claim full authority when only reads work. |

## Required evidence before calling a client supported

For **each** independently supported desktop and mobile client, record: exact client/version/environment; service hostname and serving source SHA; fresh client registration/authorization without exposing credentials; MCP `initialize`, authenticated `tools/list` and real provider-scoped `tools/call`; safe approved disposable write plus independent provider readback if delegated; expiry/refresh, owner revocation, reconnect; unauthorized tenant/resource refusal and failure without a mutation. Separate the unit/fake DB results from actual client/provider evidence in `docs/STATUS.md`, existing acceptance queue and R cards.

**Never** create live resources, charge an account or publish an open listing just to demonstrate setup. The builder’s $0/test-only rules remain fully in force. This standalone service need not successfully connect through Robinson's Toolkit Hub; actual Hub routing is Hub-owned.
