# AUD-A2 — Purchase delegation II: executor behavior under the owner's word

Status: APPROVED — audit pipeline S5 packet (filed 2026-10-27). Design: `docs/designs/BATCH-B.md`, 2026-10-27 amendment **D-A** (execution path, budget-as-disclosure, delegated/builder retention, comment re-scoping). Audit: VMCP-001 in `docs/MCP-AUDIT-2026-10-27.md`; ruling **OP-2**; remediation issues #108–#110, #116, #119 are closed by this packet's behavior for end users. Depends on packet **AUD-A1** (policy storage, accessors, setup control) being merged.
Baseline inspected: main `1f7859ce0dc3dda35f6298106c7e4d6635c8465b` (re-inspect at start; AUD-A1 will have moved `src/db.js` and `src/vercel/setup.js`). Prerequisites: AUD-A1; B-1 MERGED. Migration: none (AUD-A1 carried the values; this packet migrates the **enforcement path** off the mandatory grant for owner connections). Subsection mapping: the behavior leg of the B-1 spend layer under the D-A amendment — not a new batch subsection, no new acceptance unit. Workload: medium-high (safety layer; Sol medium per `docs/pr-cards/README.md`).

## Read only these
- `docs/designs/BATCH-B.md`: the full D-A amendment; §3 (the eight write-contract checks); §1 B3 as amended 2026-10-12 + the 2026-10-27 filing note beneath it.
- `docs/END-USER-AUTHORITY.md` (canonical OP-2 statement) and `docs/AI-PR-READ-FIRST.md` items 4–5.
- `src/core/write.js`: the purchase block (grant demand, fingerprint, consume) and the two flagged comments — line ~88 “never relax production or spend requirements” and line ~93 “Agents may only PROPOSE a purchase”.
- `src/core/write-preflight.js`: the spend branch (`checkSpend`, the `purchase` object it returns, the refusal texts).
- `src/vercel/spend.js`: `spendPreflight` (codes `owner_required`, `provider_ceiling_required`) and `accountSpendGuard`.
- `src/db.js`: the `purchase_intents` methods (request/get/consume, ~lines 230–315) — retained, not removed.
- Tests: `tests/helpers/write-contract.js`, `tests/unit/production-spend.test.js`, `tests/unit/owner-spend-mcp.test.js`, the write-contract suites.

## Drift check A
| Expected (design) | Actual at baseline | Consequence |
|---|---|---|
| Owner connections evaluate a standing policy | The executor unconditionally demands a one-use grant for any spend > $0, recurring or unquantified; metered/recurring is refused outright outside one Sandbox exception | The purchase branch becomes policy-driven for owner connections; the grant path remains for delegates and for `purchase_grant_required = true` |
| The budget frames disclosure, never refuses the owner | `spendPreflight` refusals (`owner_required`, `provider_ceiling_required`) and the daily-limit check gate even owner writes | Refusal codes retire on the owner path; the dollar line gains the budget frame from AUD-A1's policy |
| Delegates and builders keep today's machinery exactly | `purchase_intents` request/approve/consume is implemented and tested | Untouched behavior on pass/builder connections; their tests pass unmodified |
| No code comment states a superseded product rule | The two comments above state the retired doctrine as product behavior | This packet rewrites both, scoped to delegated/builder connections and citing `docs/END-USER-AUTHORITY.md` (design D-A, VMCP-015 leg) |

## Scope
**In:** policy evaluation in the purchase path for the account owner's own connections; the delegation block in the change-log row; the budget-framed dollar line; removal of the recurring/unquantified blanket refusal on owner connections (metered executes on the owner's word with the honest “cost depends on usage” disclosure and `spend_cents = null`; the V-4 Sandbox path becomes an instance of this rule); comment re-scoping.
**Out (non-goals):** policy storage/setup (AUD-A1); deleting `purchase_intents` or any delegate path; `vercel_api_write` spend detection (VMCP-013 — it *consumes* this model when U-1 builds it); undo of purchases (X-1 note); any change to production, access or secret guards.

## Build contract
- Connection classification is the existing one: the account owner's own connector/OAuth connections vs RTC pass (delegated) and builder/TEST identities. The policy branch keys off that classification plus AUD-A1's `getPurchasePolicy(account)` — never off caller-supplied arguments.
- Owner path, `grantRequired = false`: a `$` write with the dollar line shown and `confirm: true` proceeds through the normal `defineWrite` flow (preview, production/access/self-protection guards, replay claim, read-back verify — all unchanged). **No purchase intent is created or consumed.** The change-log row records the delegation block `{ basis: 'owner_word', budgetCents, quotedCents, overBudget }` in the row's JSONB payload (the implementing PR names the field; the acceptance tests read it back).
- Owner path, over budget: identical execution; `overBudget: true`. The budget never produces a refusal for the owner.
- Owner path, `grantRequired = true`: today's one-use grant flow, verbatim — it is now the owner's chosen strictness, reached by policy, not by default.
- Dollar line (from `src/vercel/spend.js` / preflight money line): with a budget set — “… Your agent budget is $Y (today so far: $X). This purchase is within your budget.” / “… over your budget — proceeding on your instruction.” With none set — the price plus “no agent budget set”. “Today so far” sums confirmed change-log rows for the account's America/Denver day, as B3 already defines.
- Delegate/builder path: byte-for-byte today's behavior — grant required, fingerprint-bound, single-use, atomic consume; builder/TEST identities still cannot purchase at all.
- Comments: rewrite the two flagged comments to scope the grant rule to delegated/builder connections and the grant-required policy, citing `docs/END-USER-AUTHORITY.md`; the “never relax” doctrine is reworded as a builder-activity constraint. Grep proves no remaining comment states the retired rule as product behavior.

## Ordered steps
1. Policy branch in preflight: owner + `grantRequired = false` skips the grant demand and returns the framed money line + delegation data; all other paths unchanged.
2. Executor: consume nothing on the owner path; write the delegation block into the change-log row; keep the pre-dispatch price re-check (`requirePreDispatch`) semantics for quoted prices.
3. Metered/recurring: remove the owner-path blanket refusal; keep provider-ceiling language only where a *delegate* policy requires it.
4. Comment re-scoping + a grep proof in the PR body.
5. Tests (below), then full gates.

## Acceptance (design D-A, verbatim — the audit's failed probe as tests)
- (i) An end-user full connection completes a fixed-price paid write with `confirm` only — **no purchase intent is created**; the change-log row carries `basis: 'owner_word'`.
- (ii) With a budget set below the price, an explicit owner instruction completes the same write and the journal records `overBudget: true`.
- (iii) A delegated (pass) connection attempting the same write without owner approval is refused exactly as today.
- (iv) An owner connection with no budget set completes on word alone.
- Plus: the eight write-contract checks (BATCH-B §3) unchanged and green; a regression test that builder/TEST identities still cannot purchase; the delegate grant tests pass unmodified; `npm run check` and the full unit suite green (946-test baseline plus new tests).

## Builder guardrails (binding, restated)
- Builders spend $0 (IN-08 builder scope): all acceptance runs on fakes/fixtures; a builder identity never executes or approves a real purchase — the owner-path tests use synthetic owner fixtures, never Chris's real account or token.
- No production activation, no live provider writes outside the X-2 scratch rules (IN-06); secrets are fake values only (`vcp_FAKE…`).
- Do not weaken replay protection, price re-checks, production/access/secret guards or the delegate grant to make a test pass.
- If code contradicts this packet or D-A, stop and file a dated design amendment; do not improvise a new rule.

## Stop and ask
- The owner-vs-delegate connection classification cannot be determined reliably at the purchase branch for some door (MCP / `vercel_call` / HTTPS / RTC): stop that door's conversion; ship the doors that classify cleanly and record the gap in STATUS.
- Any acceptance step that appears to need a real charged run: stop — that proof belongs to the owner's own authorization under OP-2, queued as acceptance, never to a builder session.

## Done when
- Acceptance above is green with `npm run check`, `npm test`, applicable `test:db` suites, and exact-head `ci` + `release-policy`.
- STATUS, this card, the B-1 index revisit and issues #108–#110, #116, #119 are reconciled (issues closed by the implementing PR's evidence or explicitly carried). VMCP-001 closes only at S7, when these acceptance tests pass against the merged result.
