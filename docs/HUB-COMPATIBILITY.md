# Robinson Toolkit Hub compatibility reference

**Owner decision, 2026-10-19:** This independent MCP server is a Hub-compatible provider, not a Hub client. The **Hub initiates** discovery, authorization and selected tool calls. The coding agent sees **one Hub MCP connection and a fixed, small set of gateway tools**, even as thousands of provider tools become searchable. The human and coding agent do their own planning. **Never create a server-to-Hub callback, brand-specific Hub adapter, unconditional eager `tools/list` expansion or provider-side automated planning.**

## Governing shared specification

- [Frozen RTC 1 contract](https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/main/docs/CONTRACT.md) is the cross-repository baseline.
- [Hub connection compatibility specification and per-server checklist](https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/main/docs/HUB-CONNECTION-SPEC.md) explains optional standards-based OAuth, independently delegated identity, bounded RTC meta-tool search/describe/call, pagination and result/refusal rules.
- Work from the **latest reviewed Hub main specification**; record the exact Hub commit and the selected provider's exact source and deployed commits whenever demonstrating compatibility. Treat a future breaking contract change as a separate versioned design decision, **never** a silent per-server wire-protocol tweak.

## Required integration boundaries

1. **Stay standalone.** Existing direct MCP clients and original provider credentials must continue working without Hub, and an authorized user may exercise the provider's full legitimate capabilities. Development-team spending, TEST and no-production safeguards are not permanent end-user product policy.
2. **Advertise, don't push.** Serve truthful public RTC 1 `/api/contract` metadata, stable tool prefix, areas, modes, profiles and authorization availability. Do not connect outward to Hub.
3. **Lazy, bounded tool access.** Serve the standard RTC meta-tool search/describe/call family under the *provider's own* authorization and risk checks. A Hub query returns a **small bounded search page** and fetches an individual schema only on demand. Preserve actual page/offset/cursor fields and exact denial codes. No eager full catalog into the agent context.
4. **Provider-owned consent.** Support the provider's independent RTC credential verification and, where implemented, standard OAuth protected-resource/issuer discovery, S256 PKCE, resource-bound consent, token refresh and revocation. The Hub never creates or widens provider scopes. A protected whoami identity that does not attest complete mode/profile/area grants is only enough for the Hub's **read-only** fallback; source must not claim full/write authorization from a successful OAuth callback.
5. **Accurate results.** Keep outputs bounded, protect large pages and handles from cross-account/caller reuse, and reject expired, revoked or narrowed permissions. Unexpected provider POST results must not be retried without a safety guarantee.
6. **Proof separate from code.** Before marking this server Hub-compatible for production, check the actual deployed RTC manifest, a genuinely authorized read via Hub, denied access, revoked/expired grant, credential renewal if provided, provider audit and direct standalone access. Historical TEST fixtures are not current LIVE acceptance.

## Current adoption status

This is a **documentation/implementation reference**, not a deployment, a new token, a registry enrollment or a successful live connection. Existing source and hosted service remain unchanged. Inspect the actual source and real issuer before claiming any checklist row passed.

When implementing a future tool or modifying authorization, include this contract compatibility check in the existing repository roadmap/card and tests, rather than duplicating the Hub's provider-independent router here.
