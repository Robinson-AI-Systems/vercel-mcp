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

## 2026-10-12 approved IN-08 amendment — replaces B3's discretionary daily spending limit

The owner explicitly rejects autonomous AI purchases of **any amount**. Any previously configured positive `spend_limit_cents` is not a purchase authorization. A paid write is permitted only after the independently authenticated owner reviews the exact account, operation, request key, payload fingerprint and verified quoted price; an approved purchase grant is recorded in the database, re-read and consumed atomically once before provider dispatch. Generic MCP `confirm:true` is never a spending grant. There is no discretionary dollar cap for the owner's individual approvals, only the safe integer-cents representation. The $0 autonomous baseline persists.

For usage-based charges, an owner-chosen dollar ceiling without a **provider-enforceable** maximum is not sufficient. Git imports and build/function resource setting mutations currently cannot prove a per-operation provider cap, so their charged execution remains disabled (read/preview allowed) until this is demonstrated. Quoted charges must use Vercel/pricing evidence, never amounts supplied by agents. This supersedes the B3 spend-limit permission rule and the older eight-contract test wording; all production, credential, ownership, replay and destructive-operation guards remain unchanged. IN-07 separately ends permanent project-identity exclusions by owner action.

**Filing note 2026-10-27:** IN-08 was ANSWERED on 2026-10-17 (see `docs/OWNER-INPUTS.md` and `docs/END-USER-AUTHORITY.md`). The grant machinery in this amendment binds implementation and acceptance activity — builders spend $0 and cannot approve grants. As end-user product behavior it is superseded: the finished service honors user-selected delegation with disclosed cost. The existing implementation is known non-compliance under remediation (issues #108–#110, #116, #119); new end-user-facing work must implement the delegation model, not extend the mandatory one-use grant.

**2026-10-27 — D-A design: purchase delegation replaces the mandatory grant for end users (audit VMCP-001; owner ruling OP-2).** Target shape, per OP-2 (`docs/DECISIONS.md`; canonical statement in `docs/END-USER-AUTHORITY.md`):

- **Standing policy per account.** Two owner-set settings on `vercel_accounts`, presented in plain words on the setup page and journaled when changed: `purchase_budget_cents` (integer cents, NULL = no budget — the budget is optional) and `purchase_grant_required` (boolean, default FALSE — the owner's opt-in to the strictest setting, restoring per-transaction one-use grants for their own connections).
- **Execution path (the account owner's own connections).** The purchase branch in `src/core/write.js` / `src/core/write-preflight.js` evaluates the account policy instead of unconditionally demanding a grant. With `purchase_grant_required = false`, a paid write with the dollar line shown and `confirm: true` executes; the change-log row records a delegation block `{ basis: 'owner_word', budgetCents, quotedCents, overBudget }`. An explicit owner instruction over the set budget executes and is journaled as an override (`overBudget: true`) — the budget never refuses the owner. The blanket refusal of recurring and unquantified metered spend is removed for owner connections: metered writes execute on the owner's word with B3's honest "cost depends on usage" disclosure and `spend_cents = null`; the V-4 Sandbox path becomes one instance of this general rule, not an exception to a refusal.
- **Budget as disclosure frame.** The B3 dollar line gains the budget frame when a budget is set: "… Your agent budget is $Y (today so far: $X). This purchase is within your budget / over your budget — proceeding on your instruction." With no budget set, the line shows the price and "no agent budget set". The daily-sum wording from B3 survives only as this disclosure, never as a refusal for the owner.
- **Delegated and builder connections keep the grant machinery.** RTC passes and any connection that is not the account owner's own keep `purchase_intents` exactly as built: the owner's budget binds the delegate, a delegate's word never overrides it, and only the owner's separately authenticated approval — or a standing delegation the owner explicitly granted that pass — releases a purchase. Implementation and acceptance activity by builders remains $0 under the same machinery (`docs/AI-PR-READ-FIRST.md` items 4–5 unchanged for builders).
- **Migration.** The `purchase_intents` table and code paths are retained (delegated path + opt-in strictness). Where an owner has already set a positive `spend_limit_cents` on the setup page, that value is honored as their `purchase_budget_cents` at migration — an existing owner choice is carried, not discarded; $0/unset migrates to NULL (no budget). On deploy, owner connections follow OP-2; the setup page shows the current policy and the strictness opt-in (see the VMCP-019 panel note below).
- **Comment re-scoping (VMCP-015).** The implementing PR rewrites the two comments the audit flagged: `src/core/write.js` "Agents may only PROPOSE a purchase" is scoped to delegated/builder connections and the grant-required policy; the "never relax production or spend requirements" doctrine in `src/core/write.js` / `src/core/write-preflight.js` is reworded as a builder-activity constraint citing `docs/END-USER-AUTHORITY.md`. No code comment may state a product rule this amendment supersedes.
- **Acceptance tests (the audit's failed probe becomes the test):** (i) an end-user full connection completes a fixed-price paid write with `confirm` only — no purchase intent is created; the change-log row carries `basis: 'owner_word'`. (ii) With a budget set below the price, an explicit owner instruction completes the same write and the journal records `overBudget: true`. (iii) A delegated (pass) connection attempting the same write without owner approval is refused exactly as today. (iv) An owner connection with no budget set completes on word alone. Plus: the eight write-contract checks (BATCH-B §3) unchanged, and a regression test that builder/TEST identities still cannot purchase.

**2026-10-27 — D-B design: the production switch flips on the owner's word (audit VMCP-002; IN-09 ruling).**

- `vercel_enable_production` on the account owner's own full connection with `confirm: true` completes the flip in one step: it sets `production_enabled`, writes the change-log row (the `recordChange` path production-guard already uses), and returns the state read back. The dry-run and needs-confirmation steps stay as the disclosure surface; the non-production-deployment block (A12) is unchanged.
- The passphrase step becomes a per-team, owner-chosen strictness setting (`production_enable_strictness`: `word` default | `passphrase`), presented on the setup page beside the team's production state (VMCP-019 panel). Teams set to `passphrase` keep today's two-step flow verbatim. The setting itself changes only on the setup page, by the owner.
- `vercel_disable_production` is unchanged in behavior (already agent-completable) and records under the same model. Delegated/pass connections can never enable production (unchanged); R-1/R-2 pass work inherits this switch semantics.
- **Acceptance tests:** enable with `confirm: true` on an owner full connection returns `productionEnabled: true` with a change recorded and no passphrase consumed; a team with strictness `passphrase` still returns `awaiting_owner_passphrase` and enables only through the setup step; disable behaves as today; a pass connection is refused in both strictness modes.

**2026-10-27 — Owner-admin proposals: convert on owner connections (audit VMCP-007).** B-8's owner tools (`vercel_set_default_account`, `vercel_set_spend_limit`, `vercel_revoke_connection`, `vercel_create_pass`) are proposals-only through every door (B-8B boundary). The audit's distinction: on the account owner's own full connection, the owner approving his own agent's proposal on the setup page is ceremony; on delegated/pass connections the proposal flow protects a different human's account and stays. Design: the owner tools gain a direct path on owner connections — execute + change log, reusing the atomic SQL/audit seams B-8B §3–§4 already specify for the setup forms (the MCP path reuses them; it does not bypass them) — while pass connections keep the proposal flow unchanged. Note `vercel_set_spend_limit` sets the OP-2 delegation budget (D-A) under the new model. **Acceptance:** each owner tool applies on an owner full connection with `confirm` and is read back; the same call on a pass connection returns the proposal flow unchanged; B-8B §1 protections (last active connection, server credential) hold on both paths.

**2026-10-27 — Stable write keys (audit VMCP-020).** `writeRequestKey` embeds a 10-minute time bucket when the caller supplies no `requestKey`, so an ordinary write's idempotency silently expires. Design: the executor returns the effective request key in every applied write result (previews already carry it), the replay claim for a completed write stays addressable by that key for the result-retention window, and tool descriptions tell callers that supplying a stable `requestKey` makes retries exact. Paid writes already mandate explicit keys (unchanged). **Acceptance:** a repeated call with the returned key after the bucket rolls returns the recorded result with no second provider write; any remaining idempotency window is stated in the write result, not silent.

**2026-10-27 — Vercel spend state: read and report (audit VMCP-004; IN-12 ruling).** IN-12: spend alerts are Vercel's Spend Management; this server reads and reports them and controls nothing of its own. Today no operation in `src/vercel/operations.js` reads team spend-management state, while the server keeps its own limit (reframed by D-A as the user's optional agent budget, not server policy). Design: (1) the first acceptance step is the register's D9 probe (VMCP-018) — settle from the vendored OpenAPI snapshot, and with a live read when a token is available, whether team spend-management configuration is API-readable; record the answer in this amendment either way. (2) If readable: a read tool in O-4 scope reports the Vercel-side state beside the account's local delegation settings, each labelled — Vercel's settings vs the user's local budget. (3) If not API-readable: the guided-settings route (BATCH-O O8) gains the Spend Management entry with read-back marked `not_readable`, and `vercel_admin_overview` reports it as such — never as a server-controlled value. **Acceptance:** the probe result is recorded here; the report surface distinguishes Vercel's settings from local ones on fixtures; no write path to Vercel spend settings exists except on the user's explicit instruction through the universal tools.

**2026-10-27 — Setup status/choices panel (audit VMCP-019).** The setup surface is an approval terminal (queues for purchases, owner requests, production, passes) but does not present the state and choices the filed decisions guarantee. Design: setup gains a per-account status panel showing token expiry state and days-left (D-E, BATCH-O amendment), production state per team with the D-B strictness choice, the D-A delegation policy (budget, grant-required opt-in), and Vercel spend state as reported under the VMCP-004 note above. Panel values are the same values the tools report — one source of truth, two surfaces. **Acceptance:** each panel value matches the corresponding tool/read output on fixtures; each choice the panel offers round-trips (set on setup → reflected in tool behavior) for budget, strictness and production state.
