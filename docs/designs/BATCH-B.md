# Design — Batch B: Trust layer (safety, production guard, spend, access, self-protection, errors, profiles)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch B.
Cards B-1 … B-8. Depends on Batch A.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| B1 | The copied write layer exports `defineWrite`, `guard`, `gone`, `safetyNote` (or the core package's equivalents) | `grep -n "^export" src/core/write.js` |
| B2 | `change_log` has `production`, `spend_cents`, `request_key`, `result`, `inverse` (Batch A §2) | `grep -n "change_log" src/db.js` |
| B3 | Vercel error bodies are `{ error: { code, message, … } }` with `limit` on `rate_limited` | `docs/audits/2026-10-10-research.md` §1.1; one 404 against `emulate` |
| B4 | A deployment's target is `deployment.target` (`production`, `preview`, or null/custom) and a project's current production deployment is readable (`targets.production` on the project, or the newest READY production deployment) | `node scripts/openapi-find.mjs "get project"`; read the response schema (≤150 lines) |

## 1. Decisions

**B1. Every write tool is built with `defineWrite`** (preview with `dryRun`, confirmation, apply, read-back, verify,
change-log row), extended with these declarations, all checked by `scripts/check-writes.mjs` (B-7):
- `production(args, ctx, before) → { production: boolean, why: string }` — required on every write (B2).
- `spend(args, ctx, before) → { cents: number | null, recurring: boolean, description }` — required on `$` tools (B3).
- `access(args, before) → { widens: boolean, who, what }` — required on `A` tools (B4).
- `secretOut` — names the result field that is moved to the one-time-secret page (`1x` tools); `secretIn` — names the
  argument that must come from `pending_inputs` or `generate` (B5).
- `inverse(args, before, after) → { tool, args } | null` stored in the change log (Batch X undo).
- `targets(args, before) → [{ kind: 'project'|'domain'|'token'|'store'|'dns_record'|'env', id, name }]` — what the
  write touches, used by self-protection (B6) and the profile guard (B7).

**B2. Production guard ("live guard" for Vercel).** A write is production when any of these hold, and the tool's
`production()` returns the reason in words:
1. It creates, redeploys, cancels or deletes a deployment whose target is `production`, or the deployment currently
   serving production; or promotes, rolls back, or changes a rolling release.
2. It changes an environment variable (project or shared) whose targets include `production`, or a shared variable
   linked to any project with a production target.
3. It changes a **live project's** settings (a project is live when it has a current production deployment):
   name, framework, commands, root directory, Node version, build resources, pause/unpause, transfer, delete.
4. It touches domains, DNS, certificates or nameservers: every DNS record write, team-domain update/removal, nameserver
   change and certificate issue/remove; a project-domain write unless the domain is tied to a branch or a non-production
   custom environment.
5. It touches deployment protection, protection bypass secrets, firewall/WAF, attack mode, routes or redirects publish,
   CDN cache, Global Config items or backups of a store connected to a live project, or integration resources injected
   into production.
6. It is an owner action (team settings, members, access groups, tokens) — contract §11 account-wide changes.

Rules: on a **preview** connection every production write is refused before anything is read beyond what `production()`
needs (`refused_by_guard`: "this connection is preview-only; reconnect choosing production"). On a **production**
connection a production write needs `confirm: true`, the result starts with `"mode": "PRODUCTION"`, and the change-log
row is marked `production`. Reads are never blocked. `production_enabled` turns on only through
`vercel_enable_production` (confirm) **plus** the passphrase re-entered on the setup page within 10 minutes; a tool alone
can never enable production; non-production deployments of this server never enable it (A12). Manifest `modes`:
`["preview", "production"]`.

**B3. Spend guard.** `$` tools always need `confirm` (in either mode), show a dollar line first
(`Buy example.com for 1 year: $11.25 USD, auto-renew on. Counts toward today's $0.00 of $25.00 spend limit.`), and are
refused when the known dollar amount would pass `vercel_accounts.spend_limit_cents` for today (America/Denver calendar
day, summed from confirmed change-log rows). Amounts come from Vercel (registrar price endpoints; integration billing
plan prices) or from stored settings for things Vercel prices by plan (a paid seat, IN-08), never from arguments. When
no price is knowable (build machines, metered add-ons, drains per GB, sandbox usage) the preview says "cost depends on
usage; Vercel bills it monthly" with the pricing link, still needs `confirm`, and logs `spend_cents = null`. Default
limit **$0**: every purchase with a known price is refused until Chris raises the limit (IN-08). Implementers never
buy anything (AGENTS hard limit): tests use fakes only.

**B4. Access guard.** Inviting members, changing roles, adding project members, access-group changes, creating tokens,
passes and bypass secrets, shareable links, trusted-IP or authentication loosening, system bypass rules, and SAML role
mappings always need `confirm`; the preview names the person or credential and exactly what they will be able to do.
Inviting someone is also a message to a person: the preview shows the email address and role.

**B5. Secrets.** (a) No tool result contains an environment variable value, a token, a bypass secret, a webhook secret,
a Global Config token, a transfer code or a pass: `secretOut` fields are moved to `one_time_secrets` and replaced with a
link. (b) Secret inputs come from `pending_inputs` (Chris pastes on the setup page) or `generate: { bytes, encoding }`
(random on the server); a plain `value` argument is accepted only for non-secret configuration and is **refused** when it
looks like a credential (`sk_live_`, `sk_test_`, `rk_`, `whsec_`, `vcp_`, `vercel_blob_rw_`, `ghp_`, `github_pat_`,
`xox`, `AKIA`, `-----BEGIN`, `postgres://…:…@`, or ≥32 characters of mixed base64/hex). (c) The change log stores
"value set (hidden)" and never the value.

**B6. Self-protection** (`src/tools/self-guard.js`). Every write's `targets()` are checked against
`protected_resources` (seeded per IN-07: this server's own project, found at runtime from `VERCEL_PROJECT_ID` when set
and by name otherwise, plus the other Robinson servers' projects) and against the token this server runs on. A match is
refused with `refused_by_guard`, naming the resource and saying the list is edited only on the setup page. Domains,
env vars, stores and aliases of a protected project count as protected. Reads are never blocked.
`vercel_list_protected_resources` shows the list.

**B7. Profile guard hook.** `src/tools/app-guard.js` exposes `checkApp(targets, ctx)`; until Batch P it is a constant
"no profiles" that allows everything. Batch P fills it from `known_apps` without changing tool code.

**B8. Plain-English errors** (`src/tools/errors.js`): what happened, likely cause, what to do, then one technical line
(Vercel `error.code`, HTTP status, operation). Rules: `forbidden` on a project-scoped token for a team resource ("this
account's token only reaches project X"); `forbidden` from role ("the token's owner needs the Owner role"); expired token
(names the setup page); `not_found` with scope hint ("not in team <slug>"); `rate_limited` with the reset time in
Denver time; `price_mismatch`; `not_available`; `conflict_aliases`; `custom_domain_needs_upgrade`; `env_*` validation
codes; deployment `missing_files`/`no_files`; plan-gated features (Enterprise-only access groups, Pro-only webhooks).
Unknown errors fall back to Vercel's message unchanged.

**B9. Result shaping** (`src/core/util.js` `compact` plus `src/vercel/shape.js`): millisecond timestamps get `_local`
(America/Denver) beside them; money from billing in integer cents with `_display`; `value`, `decryptedValue`, `token`,
`secret`, `bypass`, `authCode`, `password` fields → `[hidden]`; any key-shaped string anywhere → `[hidden]`; PRODUCTION
banner on production connections.

**B10. Profiles** (`read_only`, `everyday`, `full`) come from each tool's `profiles` metadata (catalog column Prof.);
`read_only` lists no write tool and refuses one called by name. Counts print on the home page.

**B11. Writes are declared, not guessed.** `scripts/check-writes.mjs` fails when a tool lacks `writes`, a write lacks
`dryRun`, `production()`, or `targets()`, a `$` tool lacks `spend()`, an `A` tool lacks `access()`, a `1x` tool lacks
`secretOut`, or a catalog Safety mark disagrees with the declarations.

## 2. Schema

None beyond Batch A. `vercel_set_spend_limit` updates `vercel_accounts.spend_limit_cents`.

## 3. Shared primitive — the write-contract helper (`tests/helpers/write-contract.js`)

`runWriteContract({ tool, args, fixtures, production?, spendCents?, widens?, protectedTarget?, appOwned?, inverse? })`
runs eight checks every write tool must pass, through every door that exists at the time (direct handler;
`vercel_call` after C-2; HTTPS after R-2):

1. `dryRun: true` → no write call on fake Vercel; a preview change-log row.
2. Without `confirm` (when needed) → nothing changed; `needs_confirmation` with a plain summary.
3. With `confirm` → exactly one write call; read-back returned; change-log row with the request key; a repeat with the
   same key within 10 minutes makes no second call.
4. Read-back mismatch → `confirmed: false` and a warning; nothing readable → `confirmed: null`.
5. Profile-owned target → refused without `outsideApp` (after P-1; before that the hook allows).
6. Production write on a preview connection → refused; on a production connection → needs `confirm` even where the
   preview twin would not.
7. `$` tools → dollar line; spend limit enforced; amount from Vercel or settings, not arguments.
8. Protected target → refused whatever the mode, profile or `confirm`.

## 4. Work units

### B-1 — Safety layer with production, spend and access declarations (L, medium effort)
Files: `src/core/write.js`, `src/vercel/spend.js` (limit, dollar formatting), `src/vercel/production.js` (B2 helpers:
`isLiveProject`, `deploymentIsProduction`, `envTouchesProduction`, `domainIsProduction`), `tests/helpers/write-contract.js`.
Tests: the eight checks against sample tools (one `P`, one `Cp`, one `PR`, one `$`, one `A`, one `1x`).

### B-2 — Production guard and two-step enable (M, medium effort)
Files: `src/tools/production-guard.js`, `src/tools/index.js`, setup-page section in `api/vercel/setup.js`.
Tools: `vercel_enable_production`, `vercel_disable_production`.
Tests: check 6; PRODUCTION banner; enable needs both steps within 10 minutes; a preview deployment never enables.

### B-3 — Self-protection and the profile-guard hook (M, medium effort)
Files: `src/tools/self-guard.js`, `src/tools/app-guard.js` (hook), setup-page editor for `protected_resources`.
Tool: `vercel_list_protected_resources`.
Tests: check 8 for a project, its domain, its env var and the server's own token; the editor needs the passphrase;
default seed matches IN-07.

### B-4 — Plain-English errors (M)
Tests: one per rule using real error shapes from the errors page and `emulate`; unknown errors pass through.

### B-5 — Result shaping and secret handling (M, medium effort)
Tests: Denver times across a daylight-saving change; every hidden field; key-shaped strings hidden in nested arrays;
secret-shaped plain values refused; `pending_inputs` and `generate` paths; change log never holds a value.

### B-6 — Profiles (M)
Tests: `read_only` lists no write; hidden tool refused by name; counts on the home page.

### B-7 — check-writes (S)
Done when: `npm run check` fails on each violation in B11 (prove once each, then remove).

### B-8 — Server tools (S) — may group with B-6
Tools: `vercel_set_default_account`, `vercel_check_token`, `vercel_list_connections`, `vercel_revoke_connection`,
`vercel_set_spend_limit`, `vercel_recent_changes`, `vercel_where_is_setting` (data file `src/data/dashboard-map.js`,
seeded with every guided row of `docs/APP-NEEDS-APPLIANCE-DESK.md`; O-5 extends it to the full map).
Tests: per write tool through the write-contract helper; `vercel_whoami` warns 14 days before token expiry.

## 5. Stop-and-ask points

1. A tool whose production status cannot be decided before acting (B2 needs a read Vercel does not offer): stop that
   tool; propose an amendment.
2. Any change to the default spend limit, the protected-resource defaults, or what `read_only` contains.

## 6. Acceptance mapping

| PLAN Batch B line | Evidence |
|---|---|
| Eight write-contract checks exist and run | `tests/unit/write-contract.test.js` |
| Production guard with two-step enable | `tests/unit/production-guard.test.js` |
| Spend, access, secrets, self-protection | their unit test files |
| check-writes enforces declarations | B-7 PR evidence |

## Amendments

(Dated entries only.)

**2026-10-11 — B-8b conservative owner authorization boundary (PR #29).** An authenticated MCP connection
is not owner identity; `full` and `confirm` never authorize an account-wide write. Account changes
apply only after CSRF-protected owner setup and fresh passphrase, with DB lockout and safe atomic audit.
No real service can be changed by an AI request alone. The first supported local owner action is
selecting the global default account, atomically and with production-server-only setup approval.
Later revoke/spend MCP operations remain disabled until they have durable target-bound approval
and concurrency safeguards. See [B-8b owner boundary](B-8B-OWNER-BOUNDARY.md) for exact invariants,
negative tests and successor requirements. This refines implementation without widening the
previously approved production, spend, access or secret rules; IN-07 and IN-08 remain outstanding.
