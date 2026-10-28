# AUD-A1 — Purchase delegation I: standing policy, storage and setup surface

Status: IMPLEMENTED — audit pipeline S6 (2026-10-28, branch `ai/vivienne/aud-a1`, base main `60d9414` after PRs #227/#228; AUD-F's PR #229, main `6d62036`, merged in before push — STATUS-only conflict, both entries kept). See the implementation evidence at the end of this card.
Packet status at filing: APPROVED — audit pipeline S5 packet (filed 2026-10-27). Design: `docs/designs/BATCH-B.md`, 2026-10-27 amendment **D-A** (bullets: standing policy, migration of values). Audit: VMCP-001 in `docs/MCP-AUDIT-2026-10-27.md`; ruling **OP-2** in `docs/DECISIONS.md`; canonical doctrine in `docs/END-USER-AUTHORITY.md`. This packet is the first of two for D-A; AUD-A2 (executor behavior) depends on it.
Baseline inspected: main `1f7859ce0dc3dda35f6298106c7e4d6635c8465b`. Prerequisites: none open (B-1, B-8 MERGED). Migration: additive `vercel_accounts` columns. Subsection mapping: implements the policy/storage leg of the B-1 spend layer and the B-8 setup surface under the D-A amendment — it is **not** a new batch subsection and creates no new acceptance unit. Workload: medium (safety layer + SQL + setup form).

## Read only these
- `docs/designs/BATCH-B.md`: §1 B3, the 2026-10-27 D-A amendment (first, second and fifth bullets), the VMCP-019 panel note (delegation leg only).
- `docs/AI-PR-READ-FIRST.md` items 4–5 (builder spend scope); `docs/END-USER-AUTHORITY.md` OP-2 statement.
- `src/db.js`: `vercel_accounts` schema in `initSchema` (~line 947), `setSpendLimit` and its read-back (~lines 195–220), the account SELECTs carrying `spend_limit_cents` (~lines 156, 341).
- `src/vercel/setup.js`: the `set_spend_limit` form (~line 129) and action handler (~line 419); the account list rendering that consumes the line-156 SELECT.
- `src/tools/server.js`: `vercel_whoami` handler (spend fields it returns today).
- `src/tools/owner.js` (`vercel_set_spend_limit` proposal — read-only context; its conversion is VMCP-007, **not** this packet).
- Tests: `tests/unit/setup-page.test.js`, `tests/unit/owner-spend-mcp.test.js`, `tests/db/` account tests as they exist.

## Drift check A
| Expected (design) | Actual at baseline | Consequence |
|---|---|---|
| Two owner-set policy settings on `vercel_accounts` | Only `spend_limit_cents INTEGER NOT NULL DEFAULT 0` exists; no `purchase_budget_cents`, no `purchase_grant_required` | This packet adds both, additively |
| An existing positive owner limit is carried, not discarded | Setup writes `spend_limit_cents` via `db.setSpendLimit` with read-back | Migration maps `> 0` → `purchase_budget_cents`; `0`/unset → NULL |
| Setup presents the policy in plain words | Setup has a single spend-limit form/action (`set_spend_limit`) | Policy section extends that seam; no second settings surface |
| Executor still grant-bound until AUD-A2 | `src/core/write.js` purchase branch demands `purchase_intents` for every paid write | This packet changes **no** executor behavior; existing purchase tests must pass unchanged |

## Scope
**In:** schema + value migration; DB accessors for the policy with journaled changes; the setup-page policy section (agent budget in dollars, grant-required opt-in) with read-back; `vercel_whoami` reporting the account's current policy beside today's spend fields.
**Out (non-goals):** executor/preflight/spend-refusal behavior (AUD-A2); the `vercel_set_spend_limit` MCP tool's proposal conversion (VMCP-007, B-8 revisit); the assembled setup status panel (VMCP-019, B-8 revisit — this packet ships only the policy section the panel will quote); any change to `purchase_intents`.

## Build contract
- `src/db.js` `initSchema`: `ALTER TABLE vercel_accounts ADD COLUMN IF NOT EXISTS purchase_budget_cents INTEGER` (nullable; NULL = no budget) and `purchase_grant_required BOOLEAN NOT NULL DEFAULT FALSE`, in the file's existing additive style. The value carry is **one-time, gated on a durable migration marker** — never a bare `IS NULL` update inside `initSchema`: `initSchema()` runs on requests (`api/mcp.js:12`, `api/vercel/setup.js:7`, `src/oauth/routes.js:9`, `src/rtc/api.js:27`), so an unguarded `UPDATE … WHERE purchase_budget_cents IS NULL AND spend_limit_cents > 0` would re-fire for the life of the deployment and silently resurrect a budget the owner had deliberately cleared back to NULL. The carry therefore runs only when its marker is absent (a marker row in the repo's existing migration bookkeeping if one exists, otherwise a one-row marker created in the same additive style), performs `UPDATE vercel_accounts SET purchase_budget_cents = spend_limit_cents WHERE spend_limit_cents > 0` for accounts not yet carried, and writes the marker in the same transaction; every later `initSchema` run is inert. Once the marker exists, an owner's cleared budget is final. `spend_limit_cents` is **not** dropped (AUD-A2 retires its enforcement read; removal is a later cleanup, not this packet).
- DB accessors next to `setSpendLimit`: `getPurchasePolicy(accountId)` → `{ budgetCents: number|null, grantRequired: boolean }`; `setPurchasePolicy(accountId, { budgetCents, grantRequired })` with the same read-back verification pattern `setSpendLimit` uses, returning boolean success. Every successful set writes a `change_log` row (tool `vercel_set_purchase_policy`, summary naming the new values in dollars, no secrets).
- `src/vercel/setup.js`: the account policy section shows the current budget (“no agent budget set” when NULL) and the grant-required state; the form posts budget dollars (empty = no budget) + the opt-in checkbox through the existing authenticated/CSRF seam as an extended `set_spend_limit` action or a sibling `set_purchase_policy` action — implementer's choice, recorded in the PR; the response page reads the policy back and shows it.
- `src/tools/server.js` `vercel_whoami`: add `purchaseBudgetCents` (null allowed) and `purchaseGrantRequired` to the result beside `spendLimitCents`/`spentTodayCents`; keep the existing fields (AUD-A2 reframes their meaning). Update the `vercel_whoami` row in `docs/TOOL-CATALOG.md` if its text names the spend fields.

## Ordered steps
1. Schema + marker-gated value carry in `initSchema`; disposable-Postgres test proves fresh, pre-existing-positive, pre-existing-zero and clear-after-migrate rows.
2. Accessors + journaling; unit/db tests.
3. Setup form + action + read-back; `tests/unit/setup-page.test.js` additions.
4. `vercel_whoami` policy fields; catalog touch-up if needed.
5. Full gates (below).

## Acceptance (from design D-A — executable)
- Fresh schema: every account has `purchase_budget_cents = NULL`, `purchase_grant_required = FALSE`.
- Migration: an account with `spend_limit_cents = 2500` reads back `budgetCents = 2500` after init; `0` reads back NULL; re-running init changes nothing. **Clear-after-migrate:** that same account's owner then clears the budget to NULL through the policy accessor, `initSchema()` runs again (as it does on the next request), and the budget still reads back NULL — the carry never resurrects it (marker regression test).
- Setup round-trip: set budget $25.00 + grant-required on → `getPurchasePolicy` and the re-rendered setup page and `vercel_whoami` all show the same values; a `change_log` row records the change; clearing the budget returns NULL.
- Non-regression: the existing purchase/grant test files pass unmodified (`tests/unit/production-spend.test.js`, `tests/unit/owner-spend-mcp.test.js`); no executor file is touched (`git diff` shows no `src/core/write*.js`, no `src/vercel/spend.js`).

## Builder guardrails (binding, restated)
- Builders spend $0 (IN-08 builder scope): tests use fakes only; never execute or approve a real purchase, renewal, seat, credit or plan action; never use a real Vercel token outside the X-2 scratch rules (IN-06).
- Secrets: fake values only (`vcp_FAKE…`); no real token, env value, passphrase or database URL in code, tests, docs or PR text.
- Additive SQL only (`IF NOT EXISTS`); previews share the production database — no destructive migration.
- If code contradicts this packet or D-A, stop and file a dated design amendment; do not improvise a new rule.

## Stop and ask
- The setup auth/CSRF seam cannot carry the policy form without widening a permission: stop; that is an owner-boundary change (B-8B), not a packet decision.
- Any need to drop or rename `spend_limit_cents` in this packet: stop — out of scope by design.

## Done when
- Acceptance above is green with `npm run check`, `npm test`, `npm run test:db` for the schema tests, and exact-head `ci` + `release-policy`.
- STATUS, this card and the B-1 index revisit are reconciled in the implementing PR. Successor AUD-A2 inherits: policy storage, accessors and journaled setup control — it changes behavior, never storage.

## Implementation evidence (S6, 2026-10-28)

- Drift check A re-run against the merged baseline `60d9414` (PR #227 AUD-F docs, PR #228 AUD-C): the packet's code baseline was unchanged in substance — AUD-C touched `src/db.js` only at the listing defaults (auth-code/token parameters and the `oauth_codes`/`oauth_tokens` defaults), a disjoint surface from this packet's `vercel_accounts` work; no real overlap. One naming note: the packet's "`setSpendLimit`" is `setOwnerSpendLimit` in code (`src/db.js`); the new accessors sit beside it and follow its read-back pattern.
- Schema: `vercel_accounts` gains `purchase_budget_cents INTEGER` (nullable) and `purchase_grant_required BOOLEAN NOT NULL DEFAULT FALSE`, both additive (`ADD COLUMN IF NOT EXISTS` for existing tables; fresh creates carry them inline). No migration bookkeeping existed in the repo, so the packet's fallback applies: a new one-row marker table `schema_migrations` (added to `SCHEMA_TABLES`, now 17 tables). The carry is a single statement — marker `INSERT … ON CONFLICT DO NOTHING RETURNING` plus `UPDATE … WHERE spend_limit_cents > 0 AND EXISTS (marker)` — so marker and carry commit together and every later per-request `initSchema()` is inert. `spend_limit_cents` is not dropped.
- Accessors: `getPurchasePolicy(accountId)` → `{ budgetCents, grantRequired }` (null for a missing account) and `setPurchasePolicy(accountId, { budgetCents, grantRequired })` with validated inputs, atomic update + journal in one statement (tool `vercel_set_purchase_policy`, summary naming the new values in dollars, `after` carrying both fields), and read-back verification returning boolean success.
- Setup: sibling action `set_purchase_policy` (implementer's choice, recorded here per the packet) on the existing owner seam — session, CSRF, production-only, explicit confirm, fresh passphrase — posting budget dollars (blank = no budget) and the grant-required checkbox. The panel's new Purchase policy section renders each account's current policy in plain words, and the post-save response re-renders from a fresh `listVercelAccounts()`, so the page reads the stored policy back.
- Whoami: `vercel_whoami` returns `purchaseBudgetCents` (null allowed) and `purchaseGrantRequired` beside `spendLimitCents`/`spentTodayCents`; existing fields unchanged. The `vercel_whoami` catalog row now names the purchase policy.
- Tests: `tests/db/purchase-policy.test.js` (new) builds a pre-AUD-A1 `vercel_accounts` table by hand and proves positive-carry (2500 → 2500), zero-carry (0 → NULL), fresh-account defaults, re-run inertness, clear-after-migrate, set/get round-trips with journal rows, and invalid/missing-account rejection without journaling. `tests/unit/setup-page.test.js` gains the policy section's guard matrix (session/CSRF/account/confirm/production-only/exact-dollar/passphrase), a full set → re-render → clear round-trip through the fake, and the false/throw failure surfaces. `tests/unit/server-tools.test.js` gains both whoami policy cases (set and unset). `tests/unit/schema.test.js` updated for the 17-table list. Non-regression per the packet: `tests/unit/production-spend.test.js` and `tests/unit/owner-spend-mcp.test.js` pass unmodified, and the diff touches no executor file (no `src/core/write*.js`, no `src/vercel/spend.js`).
- Merge-in before push: AUD-F (PR #229, main `6d62036`) landed while this packet was in flight and was merged into the branch — `docs/STATUS.md` conflicted (both top entries kept, A1 first) and `src/vercel/setup.js` auto-merged (AUD-F's probe-leg catch block; this packet's policy section and handler; the setup + scoped-probe suites pass together). Final merged-tree verification: `npm run check` green; unit suite 974 passed / 0 failed (970 baseline + 4 new); db schema + purchase-policy files 10/10 (full db suite 90/90 pre-merge).
- Guardrails honored: fakes only, no real purchase/token/production action, additive SQL only.
