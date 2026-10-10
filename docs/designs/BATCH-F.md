# Design — Batch F: Firewall, deployment protection and traffic

Status: **APPROVED DESIGN pending IN-00**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch F.
Cards F-1 … F-3. Depends on Batches B, C and D. Tool list: `docs/TOOL-CATALOG.md` sections Deployment protection;
Firewall; Routes, redirects and cache.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| F1 | Project protection settings are fields on `PATCH /v9/projects/{idOrName}`: `ssoProtection` (Vercel Authentication), `passwordProtection`, `trustedIps`, `optionsAllowlist` | read the update-project body (research: SDK model field list) |
| F2 | Bypass secrets: `PATCH /v1/projects/{idOrName}/protection-bypass` (create, revoke, choose the env-var one); URL shareable links: `PATCH /aliases/{id}/protection-bypass` | `node scripts/openapi-find.mjs "protection bypass"` |
| F3 | Firewall: `GET\|PUT\|PATCH /v1/security/firewall/config`, `GET\|DELETE /v1/security/firewall/config/{configVersion}`, `POST …/{configVersion}/activate`, `GET /v1/security/firewall/attack-status`, `POST /v1/security/attack-mode`, `GET /v1/security/firewall/events`; PATCH supports per-rule actions (insert, update, remove) and IP-block entries | same tool; read the PATCH body (≤150 lines) |
| F4 | Routes: `/v1/projects/{projectId}/routes` (GET/POST/PUT stage/DELETE), versions GET/POST (publish); bulk redirects `/v1/bulk-redirects` with versions and restore; cache `POST /v1/edge-cache/invalidate-by-tags`, `…/invalidate-by-src-images` | same tool |

## 1. Decisions

**F1. Everything here that changes visitors' experience is production** (B2 rule 5); staging routes or redirects is `P`
(nothing changes until published).

**F2. Loosening protection widens access.** Turning Vercel Authentication or password protection off, narrowing its
scope, adding trusted IP ranges, creating bypass secrets and shareable links are also `A`: the preview says who can now
reach which URLs.

**F3. Passwords and bypass secrets never pass through chat.** `vercel_protection_set_password` takes a
`pendingInputId` (kind `deploy_password`) for the password. Bypass secrets and shareable links go to the one-time page.
`vercel_protection_list_bypass` shows notes and dates only. Revoking the secret marked as `VERCEL_AUTOMATION_BYPASS_SECRET`
warns that deployments built with it stop bypassing until redeployed.

**F4. Firewall changes are diffs in words.** Every firewall write reads the active configuration, applies the change
to a copy, and previews: rule(s) added/changed/removed in plain words ("Deny requests to /wp-admin from any IP"), the new
version number, and how to undo (`vercel_firewall_restore_version` to the previous version — stored as the inverse).
Rules are written through the PATCH actions (never a blind full PUT of a stale copy). `vercel_firewall_set_attack_mode`
requires an end time when turning on (max 24 h by default) so it cannot be forgotten.

**F5. Cache invalidation marks stale; deleting is universal-only.** `vercel_cache_invalidate` uses the invalidate
operations (content refetched on next visit). The "dangerously delete" operations are reachable only through
`vercel_api_write` (always confirm).

**F6. Firewall generate-from-words is not a tool.** Vercel's `generate-rule` operation is a POST, so it is
reachable only through `vercel_api_write` (with confirm, although it changes nothing); the hand-built add-rule tool takes structured conditions and the preview renders them
in words.

## 4. Work units

### F-1 — Deployment protection and bypass (M, medium effort)
Tools: the 8 tools of "Deployment protection". Tests: loosening is `A`; password only from a pending input; bypass
secret and shareable link only on the one-time page; production connection required.
### F-2 — Firewall (M, medium effort)
Tools: the 11 tools of "Firewall". Tests: rule rendered in words; inverse restores the previous version; attack mode
needs an end time; events summarized under 8 KB.
### F-3 — Routes, redirects and cache (M)
Tools: the 8 tools of "Routes, redirects and cache". Tests: stage is `P`, publish is `PR`; restore picks the named
version; cache invalidate is production; no hand-built tool calls a "dangerously delete" operation (grep test).

## 5. Stop-and-ask points

1. Any F0 row false (especially PATCH rule actions): amend before that card.
2. A managed rule set costs money on the team's plan: mark that call `$` and record the price source.

## 6. Acceptance mapping

| PLAN Batch F line | Evidence |
|---|---|
| Protection loosening is an access change; secrets never in chat | `tests/unit/protection.test.js` |
| Firewall diffs in words with undo | `tests/unit/firewall.test.js` |
| Staged vs published routing | `tests/unit/routes.test.js` |

## Amendments

(Dated entries only.)
