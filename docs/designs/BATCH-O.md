# Design — Batch O: Owner and administration

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch O.
Cards O-1 … O-5. Depends on Batches B and C (O-5 also reads every area batch built so far). Tool list:
`docs/TOOL-CATALOG.md` sections Owner: team and security settings; members and access groups; access tokens; billing,
usage and activity; administration. Follows Robinson Tool Contract §11.

For the team owner, not only developers (Chris, 2026-10-10: "great for both developers and end users of each service,
account management tools … everything"). Every owner setting is reachable: real tools where Vercel has an API, guided
settings (structured steps + read-back) where it does not.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| O1 | `PATCH /v2/teams/{teamId}` accepts: name, slug, description, avatar, emailDomain, previewDeploymentSuffix, saml (`enforced`, `roles`), sensitiveEnvironmentVariablePolicy, disjunctiveProductionSecretPolicy, remoteCaching, hideIpAddresses, hideIpAddressesInLogDrains, requireVerifiedCommits, defaultDeploymentProtection, defaultExpirationSettings, strictDeploymentProtectionSettings, strictPasswordProtectionSettings, strictShareableLinks | read the request body (≤150 lines); research list from the SDK model |
| O2 | Members: `GET /v3/teams/{teamId}/members`, `POST /v2/teams/{teamId}/members` (invite with role), `PATCH\|DELETE /v1/teams/{teamId}/members/{uid}`, `DELETE /v1/teams/{teamId}/invites/{inviteId}`; roles include OWNER, MEMBER, DEVELOPER, SECURITY, BILLING, VIEWER, VIEWER_FOR_PLUS, CONTRIBUTOR | `node scripts/openapi-find.mjs "team member"` |
| O3 | Which roles are paid seats on Pro, and the seat price | `https://vercel.com/pricing` and the Pro plan docs; record both URLs and the price in the O-2 PR; it becomes the stored seat-price setting |
| O4 | Access groups `/v1/access-groups*` (Enterprise); tokens `GET /v6/user/tokens`, `GET /v5/user/tokens/{id}`, `POST /v3/user/tokens` (accepts `projectId`, `expiresAt`, team scope), `DELETE /v3/user/tokens/{id}` | same tool |
| O5 | Billing: `GET /v1/billing/charges` and `GET /v1/billing/contract-commitments` (FOCUS format, date window), activity `GET /v3/events` | same tool |
| O6 | Directory-sync role mappings `POST /v1/teams/{teamId}/dsync-roles` (Enterprise) | same tool |

## 1. Decisions

**O1. Owner writes are production-class** (B2 rule 6): they need a production connection, the `full` profile and
`confirm`, and they appear in the change log through any door (contract §11).

**O2. Loosening security is an access change.** Turning SAML enforcement off, showing IP addresses, removing the
verified-commits rule, weakening default protection, enabling email-domain auto-join, and widening a member's role are
`A` with a plain "who can now do what" line.

**O3. Seats cost money.** Inviting someone with a paid role, or changing a role to a paid one, is `$` with the stored
seat price (O3 row; IN-08) per month in the preview, and counts toward the spend limit as one month's price.
Inviting is also a message to a person: the preview shows the email and role.

**O4. Never lock Chris out.** `vercel_member_remove` and `vercel_member_update_role` refuse to remove or demote the last
Owner or the token's own user; `vercel_token_delete` refuses the token this server runs on (self-protection);
`vercel_team_update_security` refuses `saml.enforced: true` unless the preview confirms SAML is already configured
(guided check) — otherwise members could lose access.

**O5. Tokens.** `vercel_token_create` requires an expiry (≤1 year) and a team or project scope (never full account),
shows the token once on the setup page, and can optionally store it directly as another account of this server ("add
to this server") so it never leaves the server. Listing shows names, scope, dates, last used — never values.

**O6. Billing is read-only by tool.** Charges come in integer cents with `_display`; `vercel_billing_summary` totals the
current billing period by service and project and compares with the Pro monthly credit (a stored setting, default $20)
and Chris's monthly target (setting, default $20 from Appliance Desk's cost decision). Plan changes, payment method,
invoices, Spend Management and credits purchase are guided (credits purchase also reachable through `vercel_api_write`
as `$`).

**O7. `vercel_admin_overview`** reads in one call: team profile and plan, members and roles (count, Owners), tokens
(expiring within 14 days), security settings, default protection, domains (expiring within 30 days, auto-renew off),
certificates (expiring), this period's spend vs target, integrations, webhooks, drains, protected resources, plus every
guided setting's state. Each item: `ok` / `needs_attention` (why) / `not_readable` (no API; link to steps).

**O8. Guided settings and the dashboard map.** `vercel_where_is_setting(query)` returns contract §11 structured steps
`{ setting, url, steps: [{ n, action, target, value? }], expected, verifyWith?: { tool, args, field, equals } }` from
`src/data/dashboard-map.js`, which covers every settings page of the team, each project and the account (research §9).
Dashboard URLs use Vercel's team-agnostic `https://vercel.com/d?to=…` links where available. A guided setting is never
reported as done unless read back or Chris says so. Examples with read-back: production branch tracking
(`vercel_project_get` → `link.productionBranch`), cron enabled state (`vercel_cron_list`), Git connection
(`vercel_project_get` → `link`). Without read-back: Spend Management, notifications, two-step login, plan, payment
method. Deleting the team or the account is steps-only and says so.

## 4. Work units

### O-1 — Team profile and security settings (M, medium effort)
Tools: the 7 tools of "Owner: team and security settings". Tests: loosening is `A`; SAML enforce refused when not set
up; slug change warns of the 6-per-week limit and URL change; retention shortening is `D` with the count of deployments
that would be removed (read first).
### O-2 — Members and access groups (M, medium effort)
Tools: the 10 tools of "Owner: members and access groups". Tests: paid-seat invite shows the price and hits the spend
limit; last Owner protected; Enterprise-only errors explained.
### O-3 — Tokens (S, medium effort)
Tools: the 3 tools of "Owner: access tokens". Tests: expiry required; full-account scope refused; token only on the
one-time page or stored directly; server's own token protected.
### O-4 — Billing, usage, activity (M)
Tools: the 4 tools of "Owner: billing, usage and activity". Tests: FOCUS fixture → cents and `_display`; period totals
by service and project; target comparison.
### O-5 — Admin overview, reviews, guided settings, full dashboard map (L, medium effort)
Tools: `vercel_admin_overview`, `vercel_admin_review_security`, `vercel_admin_cost_review`,
`vercel_admin_list_guided_settings`, `vercel_admin_check_setting`; `vercel_where_is_setting` upgraded to cover the full
map. Tests: every overview item is ok / needs_attention / not_readable on fixtures; every map entry has steps and an
expected result; every `verifyWith` points at a real read tool and field; team/account deletion entries are steps-only.

## 5. Stop-and-ask points

1. O3 cannot be determined: keep seat invites `$` with "price unknown" and ask Chris for the seat price (IN-08).
2. Any change that could remove Chris's own access: stop.

## 6. Acceptance mapping

| PLAN Batch O line | Evidence |
|---|---|
| Owner writes guarded, logged, never lock out | `tests/unit/team-*.test.js`, `tests/unit/members.test.js` |
| Tokens shown once, scoped, expiring | `tests/unit/tokens-tools.test.js` |
| Admin overview and full dashboard map with read-back | `tests/unit/admin-overview.test.js`, `tests/unit/dashboard-map.test.js` |

## Amendments

(Dated entries only.)
