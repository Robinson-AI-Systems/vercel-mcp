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
6. **Provider proof independent of Hub.** Before declaring this server ready, verify the actual checked-READY deployed RTC manifest, bounded search/describe/call, a genuine **direct** MCP/HTTPS authorized read and other approved direct writes, scope and denial, revoked/expired grant, applicable refresh, provider audit and standalone operation. Neither mocked TEST passes nor a Hub-originated read prove the missing server-owned acceptance. Do not require a live Hub call for provider completion.
7. **Hub proof belongs to Hub.** Hub connection discovery, gateway OAuth DCR/PKCE onboarding, selected owner/caller permissions, broker routing, relay, Sandbox and end-to-end Hub-routed native calls belong to Hub's release/acceptance queue. They do not block this server, except that a demonstrated violation of the provider-side RTC 1/spec contract remains a provider defect to fix.

## October 19, 2026: owner-defined completion boundary

Reviewed canonical Hub main `3cc7f4ad4332155d639125b23e8a5c4c13804a3d`, `docs/CONTRACT.md` (frozen RTC 1), and `docs/HUB-CONNECTION-SPEC.md` (optional production OAuth connection profile).

| This standalone MCP's completion requirements | Hub's completion requirements — NOT this server's |
|---|---|
| Serve truthful public `/api/contract`, direct `/api/mcp`, independent HTTPS tool API, tool metadata, accessible scoped profiles and correct RTC 1 `search/describe/call/batch` | Discover provider origins; route through a compact Hub menu; maintain cross-provider registry, caller-specific policies and connections |
| Check real deployed source, authorized direct positive and negative reads/writes as applicable, proper pagination, bounded result handles, deny/revoke/expire, consent and refresh only if advertised, provider readback/audit | Execute Hub-originated onboarding/PKCE/consent, save/encrypt Hub credentials, renew and isolate Hub users, test Hub direct/relay/Sandbox routes |
| Run source/RTC conformance in this repository; prove standalone client behavior with authentic service credentials | Prove Hub-to-provider LIVE continuity, Hub search/describe/call and Hub's own scale/context requirements |

**No real Hub connection is a Vercel MCP completion gate.** The provider may declare its own RTC 1 conformance and standalone readiness only after independent real deployment/direct acceptance; Hub's unavailable or broken gateway does not block those milestones. Hub tests that identify a concrete provider-contract defect can reopen that defect, but missing Hub orchestration is a Hub problem.

**Optional does not mean unverified:** The Hub spec's OAuth DCR/PKCE/resource-binding profile is OPTIONAL to frozen RTC 1 pass-compatible operation. If this server advertises such OAuth capability, prove the actual issuer, resource binding, scope/identity/refresh/revocation independently. It is not mandatory to implement Hub's particular onboarding workflow here; do not create Hub callbacks or adapters. Source/deployed revisions and conformance evidence belong to this repository, Hub route test evidence to Hub.

## Current adoption status

This is a **documentation/implementation reference**, not a deployment, a new token, a registry enrollment or a successful live connection. Existing source and hosted service remain unchanged. Inspect the actual source and real issuer before claiming any checklist row passed.

When implementing a future tool or modifying authorization, include this contract compatibility check in the existing repository roadmap/card and tests, rather than duplicating the Hub's provider-independent router here.
