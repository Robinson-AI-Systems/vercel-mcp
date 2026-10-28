# AUD-G — Muse client metadata document: Muse connects, other clients untouched (VMCP-024 delta)

Status: IMPLEMENTED 2026-10-28 (branch `ai/vivienne/vmcp-024-muse-client`, base main `ad5af3b`) — VMCP-024 stays **open** until its acceptance probe passes live (a fresh Muse client connecting end-to-end, below).

**Why this card exists:** VMCP-024 (P1 · D11, filed at S7) recorded that connecting an agent to this server from a real client is not a working first-run path. The owner directed the fix the same day ("fix it — start with the Vercel MCP server"), under his recorded constraint: do not lose or limit the ability to connect to other platforms — most especially ChatGPT and Claude (desktop and their mobile apps, which connect through the mobile web browser). Sourced research run 2026-10-28 (report retained with the audit evidence) corrected the finding's filed fix direction and identified the concrete blocker this card removes:

- The filed device-authorization direction is **retired**: Muse's custom-connector flow supports no device grant and publishes no roadmap for one.
- Muse publishes **no client metadata document of its own** (Claude and ChatGPT publish theirs), so a server that accepts Muse connections hosts one for it — a client-id metadata document at `/.well-known/muse-client.json` whose URL is the `client_id`, naming Muse's single hosted callback (`https://agent.meta.ai/api/hatch/oauth/callback`) and PKCE-only authentication (method `none`). Two live third-party servers publish exactly this document and accept Muse connections. This server published nothing of the kind; the hand-built registering client that proved the server healthy at S7 is a path Muse's connect sheet does not use.

This card is **not** a new batch subsection and creates no new acceptance unit: VMCP-024's acceptance lives in the finding (`docs/MCP-AUDIT-2026-10-27.md`, as amended by the implementing PR) and is unchanged.

## Scope

**In:** serve the client metadata document from the server's own origin (new `museClient` OAuth handler + `api/well-known/muse-client.js` function + the `/.well-known/muse-client.json` rewrite, mirroring the two existing well-known routes); resolve that one `client_id` locally to a fixed public-client record in authorize, token and revocation; advertise `client_id_metadata_document_supported: true` in the authorization-server metadata; unit tests for the document and the full Muse-client flow; the register amendment, DECISIONS entry and STATUS entry that record the corrected direction.

**Out (non-goals):** any change to dynamic client registration or to any other client's flow (ChatGPT, Claude desktop/mobile, the DEVELOPER-CONNECTION runner) — the owner's constraint, enforced by the unmodified pre-existing registration/public-client suites; any database schema change (no registration row exists for this client); any new tool or listing surface; the live Muse acceptance probe itself (it runs after release and closes the finding, per the pipeline rule — merged code never closes a finding).

## Build notes (as implemented)

- The document is derived from the server's configured public origin (`publicOrigin`), exactly like the OAuth metadata: `client_id` = origin + `/.well-known/muse-client.json`, `client_name` "Muse", grant types `authorization_code` + `refresh_token`, the single Muse callback as the only redirect, response types `code`, token endpoint auth method `none`.
- Resolution is an exact full-URL comparison in one `resolveClient` step inside `createOAuthHandlers`; a merely similar `client_id` falls through to the registered-client lookup and fails as unknown. The synthesized record is a fixed public-client record (`client_secret_hash: null`), so the token endpoint's existing `none`-method rule refuses any supplied secret for it.
- Revocation accepts an optional injected resolver (`getClient`); the handlers pass theirs so Muse-client tokens revoke through the same path. With no resolver injected, revocation is the previous code path verbatim.
- Refresh behavior needed no change: the token endpoint already issues a refresh token on every code exchange with no scope gating, so the community-reported one-hour cliff (a client that never requests `offline_access`) has no server-side cause here.
- The connection this client mints is an ordinary one: owner consent + Administrator passphrase still gate it, and account, mode, profile and listing bind at consent exactly as for every client. This widens who can *ask* for a connection, never what a connection can do.

## Acceptance

- **Document served:** `GET /.well-known/muse-client.json` returns the document with the exact fields above (unit-proven field-for-field), and the authorization-server metadata advertises `client_id_metadata_document_supported: true`.
- **Full flow without registration:** with no row in `oauth_clients` for the document URL, consent renders 200; a foreign redirect URI is refused 400; consent POST returns 302 to the exact Muse callback carrying a code; a token request carrying a forged secret is refused 401; the secretless PKCE exchange returns 200 with access + refresh tokens; the access token binds the consent's account and listing; refresh rotation returns 200. (Unit-proven in `tests/unit/oauth-handlers.test.js`.)
- **No regressions:** the pre-existing OAuth suites (registration, secretless public clients, revocation, core) pass unmodified; `npm run check` green; the full unit suite passes at the baseline count plus this card's new tests.
- **Live closure probe (post-release, closes VMCP-024):** after this reaches `live` through the normal daily release, a fresh Muse client connects end-to-end with the owner performing only the consent + passphrase step — no operator-built tooling, no hand-carried codes. Until it passes, VMCP-024 stays open.

## Builder guardrails (binding, restated)

- Builders spend $0; tests use fakes only; no real token is used and no live call is made by this card. The live closure probe is an owner-session step after release.
- No secret appears in the change: the document contains only this server's public origin and Meta's public callback URL.
- If live Muse behavior contradicts this card or the amended finding, stop and file a dated amendment to VMCP-024; do not improvise a new rule.
