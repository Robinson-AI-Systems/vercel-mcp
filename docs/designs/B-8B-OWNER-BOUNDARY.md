# B-8b — owner authorization and atomic account controls

Execution contract for remaining B-8b owner administration, reviewed alongside the dated BATCH-B amendment.
This is a conservative implementation refinement of the approved B-8 scope, **not approval to change a real account,
enable production, purchase anything, widen permissions, or override IN-07/IN-08**.
Baseline checked: `f7026b59c13515b8bdd7cb432153fbc574d3c513`, 2026-10-11.

## 1. Trust boundaries that exist today

- OAuth `requireMcpToken` authenticates a *connection*, not Chris as an owner. `profile=full`, `clientId`,
  `confirm=true`, and an untrusted `isOwner` argument are **not** independent owner consent.
- `/api/vercel/setup` has the durable owner-authenticated boundary: AES-GCM 15-minute secure cookie,
  CSRF, `evaluateLogin` passphrase reentry and DB-backed five-attempt lockout. This is the only
  existing place safe to *apply* B-8b account-wide changes. No API token is owner identity.
- The server's own Vercel credential is stored in `vercel_accounts`, not `oauth_tokens`; it must never be
  revoked as a side effect of revoking a bearer. Owner access is via setup passphrase, not via a last
  OAuth bearer; nonetheless protect at least one active connector per team as additional lockout defense.
- `conn_` refs derive from `md5(token_hash)`; refresh rotates them. Exact current opaque ref matches only.
  A stale ref is missing, never broadened to a client, mode or whole account.

## 2. Ordered activation and scopes

1. **Default account, local setup only:** owner selects an existing account on the authenticated setup page,
   checks explicit confirmation and reenters passphrase. Require `VERCEL_ENV=production` for this account-wide
   setting. Enforce valid CSRF and owner lockout before any SQL mutation. One global selected default,
   zero changes for a nonexistent account. Fresh OAuth connections may be offered the new first choice;
   **existing** `oauth_tokens`, `oauth_codes`, refresh tokens, modes, profiles and production switches
   must remain identical. No Vercel HTTP operation and no secret returned.
2. The catalog's future `vercel_set_default_account` MCP write is **not** a shortcut around the form:
   until a reviewed durable request/owner approval/verify executor exists, keep it unregistered. A
   full-profile connection alone can at most propose an operation, never apply the global change.
3. **Targeted revocation** remains future work: require current tenant opaque ref, owner passphrase and CSRF;
   ensure target is an active `oauth_tokens` connector/pass of that tenant, is not the last active connection
   and cannot be a server-owned/protected credential. Use a serialized single SQL transaction to enforce
   the last-active rule *under concurrent revocations*, with safe audit in the same transaction.
   Both access and refresh must reject the revoked row; unrelated accounts/rows unchanged. Refresh racing
   with a revocation must not use the pre-refresh opaque ref as an implicit selector.
4. **Spend-limit setting** remains future work: signed-in owner + CSRF + fresh passphrase + explicit
   confirmation; exact integer cents 0..2147483647; reject floating, exponent, negative and fractional
   cents. Atomic scoped SQL + same-transaction audit, dollar/cents display. Default **stays $0**;
   no purchases, metered activation or seat-price assumption. IN-08 remains open for the owner.
5. Any MCP initiation of these later owner operations must issue a durable, account/target/amount-bound,
   expiring single-use approval; the owner applies it on the separate setup surface after reentry.
   `confirm` on an AI-supplied request alone cannot approve. Validate `defineWrite` and all mandatory
   write declarations through every enabled door before listing a write tool.

## 3. Atomic default selection contract (first implementation)

Existing data: `vercel_accounts.id` PK; `is_default` Boolean default FALSE; `change_log` safe audit.
No new table, token column or migration is needed for a carefully serialized, single-statement local update.
Use one parameterized SQL statement with target-exists guard to update **every account's** `is_default`,
and insert a safe account-change audit record in the **same statement/transaction** only when exactly
one selected row is returned. Return `{selected:true}` only after a read-back verifies one default matching
the requested ID. If concurrency, SQL failure, missing account or audit failure occurs, fail closed; do not
claim success and do not issue compensating credential changes.

Check both concurrent opposite target selections, invalid ID, zero accounts, and preexisting no-default.
Never split `UPDATE all false` and `UPDATE target true` into separately committed statements.
Do not weaken `check-writes` to register incomplete MCP write tools. The owner-only local setup
route is explicitly outside OAuth tool dispatch and does not create a general provider-write gateway.

## 4. Required evidence before each mutation ships

- Unit: absent/expired session, bad CSRF, wrong or locked passphrase, no explicit confirmation,
  preview deployment, forged/unconfigured account, no SQL/provider side effects; happy path only with
  all independent owner proofs; no secret/error echo in HTML; existing connector settings unchanged.
- Disposable Postgres: exact account update and safe `change_log` row; missing target makes no
  writes; repeated selection stays one default; two concurrent selections never yield zero/two defaults.
- Revoke later: simultaneous last-two revokes cannot both succeed, active refresh cannot bypass
  target identity, last bearer refused, owner/server secret untouched, access and refresh both denied.
- Spend later: 0, 1125 accepted with owner reentry; -1, 1.5 cents, overflow and foreign team denied;
  unrelated account and purchase log unchanged; default remains $0.
- Exact-head `check`, `unit`, `db`, `emulate`, aggregate `ci` green, self-review and no
  unresolved review threads. No real Vercel/Neon resources or credentials used in CI.

## 5. Successor boundary

B-8 remains IN_PROGRESS after the owner default setup action. Finishing named MCP tools,
targeted revocation, spend limit and full write-contract evidence is still required before B-8
can close and C can start. This document grants no authority to alter owner inputs or deploy.
