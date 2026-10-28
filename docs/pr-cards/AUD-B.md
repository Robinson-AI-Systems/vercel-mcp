# AUD-B — Production switch: enable completes on the owner's word (D-B)

Status: APPROVED — audit pipeline S5 packet (filed 2026-10-27). Design: `docs/designs/BATCH-B.md`, 2026-10-27 amendment **D-B**. Audit: VMCP-002 in `docs/MCP-AUDIT-2026-10-27.md`; ruling **IN-09** (2026-10-27) in `docs/OWNER-INPUTS.md` / `docs/DECISIONS.md`. Registered on card B-2 (design owner) and already described in card R-2's revisit (pass semantics inherit the switch).
Baseline inspected: main `1f7859ce0dc3dda35f6298106c7e4d6635c8465b`. Prerequisites: B-1, B-2 MERGED. Independent of AUD-A1/A2 except shared files (see sequencing). Migration: additive `vercel_accounts` column. Subsection mapping: behavior change inside the predefined B-2 subsection under the D-B amendment — not a new batch subsection, no new acceptance unit. Workload: medium (production guard).

## Read only these
- `docs/designs/BATCH-B.md`: §1 B2, §4 B-2, the 2026-10-27 D-B amendment.
- `docs/pr-cards/B-2.md` (the as-built two-step contract this packet amends) and `docs/OWNER-INPUTS.md` IN-09.
- `src/tools/production-guard.js` (whole file, ~100 lines): `requestProductionEnable` returns `awaiting_owner_passphrase` after confirm; `approveProductionEnable` consumes the one-time receipt; `disableProduction` already completes on confirm.
- `src/tools/production.js`: `vercel_enable_production` / `vercel_disable_production` definitions and descriptions (the enable description states the passphrase requirement — it must change).
- `src/vercel/setup.js`: the `approve_production` form (~line 217) and handler (~line 611).
- `src/db.js`: `setProductionEnabled` (~line 563), `production_enabled` in `initSchema` (~line 947).
- `src/core/mcp-server.js`: the local-owner tool allowlist (enable/disable are already the only listed owner writes — expect no change; verify).
- Tests: `tests/unit/production-approval.test.js`, `tests/db/production-switch.test.js`.

## Drift check A
| Expected (design) | Actual at baseline | Consequence |
|---|---|---|
| Enable with `confirm: true` on the owner's full connection completes and reads back | Enable only issues a 10-minute one-time receipt; a passphrase on setup completes it (`production-guard.js` → `awaiting_owner_passphrase`) | The word path becomes the default completion route under `word` strictness |
| Passphrase survives only as an owner-chosen per-team strictness | No strictness setting exists anywhere | Add `production_enable_strictness` (`word` default / `passphrase`), settable only on setup |
| Disable already agent-completable | `disableProduction` completes on confirm and revokes production tokens | Unchanged; regression-tested |
| Pass connections can never enable | Guard requires the owner's full connection to even request | Unchanged in both strictness modes |

## Scope
**In:** the word-path completion in `requestProductionEnable`; the strictness column, its setup-page choice and its enforcement in both the tool path and the `approve_production` setup path; tool description updates (`docs/TOOL-CATALOG.md` rows for both production tools, which currently describe the ceremony); tests.
**Out (non-goals):** removing the passphrase machinery (it becomes the `passphrase` mode, verbatim); `vercel_disable_production` behavior; R-1/R-2 pass implementation (it inherits these semantics when built); production *write* classification (B2 rules 1–6 unchanged); the setup status panel (VMCP-019 quotes this packet's strictness choice when it assembles).

## Build contract
- `src/db.js`: `ALTER TABLE vercel_accounts ADD COLUMN IF NOT EXISTS production_enable_strictness TEXT NOT NULL DEFAULT 'word'`; a setter used only by the setup handler, with a `change_log` row per change (tool `vercel_enable_production`, summary naming the new strictness).
- `src/tools/production-guard.js`: in `requestProductionEnable`, after the existing confirm step, branch on the team's strictness: `word` → call the same enable effect `approveProductionEnable` performs (`db.setProductionEnabled(account, true)`), record the change via the existing `recordChange`/change-log path, read the account back, return `{ status: 'enabled', productionEnabled: true, strictness: 'word' }`. `passphrase` → today's receipt flow, byte-for-byte. The non-production-deployment block (A12: a preview deployment of this server can never enable) applies to **both** modes.
- `src/vercel/setup.js`: the production section shows each team's current strictness with an owner-only control to switch it; `approve_production` still consumes receipts for `passphrase` teams and reports `word` teams as already word-enabled (no receipt needed).
- `src/tools/production.js` + `docs/TOOL-CATALOG.md`: descriptions state the switch plainly — enable completes on the owner's confirmed word unless the team is set to passphrase strictness on setup.

## Ordered steps
1. Column + setter + setup control; db test for default and round-trip.
2. Guard branch on strictness; keep the receipt path untouched behind `passphrase`.
3. Tool descriptions + catalog rows.
4. Tests (below), then full gates.

## Acceptance (design D-B, verbatim)
- Enable with `confirm: true` on an owner full connection returns `productionEnabled: true`, with a change recorded and **no passphrase consumed**.
- A team with strictness `passphrase` still returns `awaiting_owner_passphrase` and enables only through the setup step.
- Disable behaves as today (confirm completes; production tokens revoked).
- A pass connection is refused in both strictness modes.
- Plus: the A12 preview-deployment block fires in both modes; strictness changes only via setup (a tool call attempting to set it is refused); the existing `production-approval` / `production-switch` suites pass with only the intended expectation updates, each called out in the PR.

## Builder guardrails (binding, restated)
- Never enable production on any real account from a builder session; all acceptance is fixture/fake accounts and disposable Postgres.
- Builders spend $0; no real token use outside the X-2 scratch rules (IN-06); fake secrets only (`vcp_FAKE…`).
- Do not weaken: preview-connection production refusals, the A12 deployment block, disable's token revocation, or the last-resort `recordChange` audit on every state change.
- If code contradicts this packet or D-B, stop and file a dated design amendment; do not improvise a new rule.

## Stop and ask
- The enable effect cannot be shared between the word path and `approveProductionEnable` without duplicating state writes: stop and record — duplication here would fork the audit trail.
- Any suggestion that strictness become settable through a tool: refused by design (setup-only); record and move on.

## Done when
- Acceptance above is green with `npm run check`, `npm test`, `npm run test:db` for the switch suites, and exact-head `ci` + `release-policy`.
- STATUS, this card and the B-2 index revisit are reconciled in the implementing PR. Sequencing note for the session plan: AUD-B shares `src/db.js` (schema) and `src/vercel/setup.js` with AUD-A1 — land AUD-A1 first and rebase, or take B first and let A1 rebase; never land both from the same stale base. VMCP-002 closes only at S7.
