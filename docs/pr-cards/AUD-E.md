# AUD-E — Expiry surface: the enrolled token's posture, stated plainly (D-E)

Status: APPROVED — audit pipeline S5 packet (filed 2026-10-27). Design: `docs/designs/BATCH-O.md`, 2026-10-27 amendment **D-E**. Audit: VMCP-003 in `docs/MCP-AUDIT-2026-10-27.md`; ruling **IN-04** (2026-10-27). Registered by extending card O-3's revisit: this packet is the enrolled-token leg and may land independently of the O-3 token tools.
Baseline inspected: main `1f7859ce0dc3dda35f6298106c7e4d6635c8465b`. Prerequisites: none open (the enrolled-token data path exists since B-8/A-5). Migration: none. Subsection mapping: the enrolled-token leg of the predefined O-3 subsection under the D-E amendment — not a new batch subsection, no new acceptance unit. Workload: small-medium (two display surfaces + tests).

## Read only these
- `docs/designs/BATCH-O.md`: the D-E amendment; O5's expiry sentence (superseded for end users — context for what this packet does **not** do).
- `docs/OWNER-INPUTS.md` IN-04 ruling text.
- `src/tools/server.js`: `vercel_whoami` — the `daysLeft` computation and `tokenWarning` it already returns, and the `safe()` account view exposing `tokenExpiresAt`.
- `src/vercel/setup.js`: the account list rendering (grep `expir` — today it appears only for pass/purchase expiry text, never for the service token).
- `src/vercel/tokens.js`: `tokenExpiry` (where `token_expires_at` is written).
- Tests: the `vercel_whoami` unit tests, `tests/unit/setup-page.test.js`, `tests/unit/setup-actions.test.js`.

## Drift check A — read this first; it corrects the register
| Register/design expectation | Actual at baseline (verified 2026-10-27 at `1f7859ce`) | Consequence |
|---|---|---|
| “Nothing anywhere surfaces days-to-expiry or notifies ahead” (VMCP-003) | **Partly stale.** `vercel_whoami` already computes `daysLeft` from `row.token_expires_at` and returns a `tokenWarning` (expired text, or “…expires within N days” inside 14 days); `safe()` already exposes `tokenExpiresAt` | Do **not** rebuild the warning. This packet adds what is genuinely missing, below |
| Explicit posture: `expiresAt` + `daysLeft` as data | `daysLeft` exists only inside the warning string's construction; the result carries no `expiresAt`/`daysLeft` fields | Add both fields to the whoami result |
| Never-expiring tokens state “no expiry — owner's choice” | A null `token_expires_at` yields `daysLeft = null` and silence — indistinguishable from “unknown” | Add the explicit no-expiry posture in whoami and setup |
| Setup account list shows expiry state + a banner inside the window | Setup renders no token-expiry state anywhere | Add the state line per account + the banner inside 14 days |
| O-3 token tools honor the owner's expiry choice at creation | Tools unbuilt (O-3 is `WRITE_CARD_AT_START`) | **Not this packet** — that leg stays in O-3's card scope under its revisit |

## Scope
**In:** `vercel_whoami` posture fields (`expiresAt` ISO + local rendering per the repo's display rules, `daysLeft`, explicit no-expiry statement) while keeping `tokenWarning` byte-compatible; the setup account list's expiry state per account and the inside-window banner; tests for expiring / never-expiring / expired fixtures on both surfaces.
**Out (non-goals):** any proactive notification channel (none is designed; the surfaces above are the D-E surface); token creation/rotation behavior (O-3); hosted-key tool exposure (`vercel_token_*` remain governed by Batch O as filed); changing the 14-day window (an owner setting if ever revisited — not now).

## Build contract
- `src/tools/server.js` `vercel_whoami`: add `tokenExpiresAt` (already in `safe()`), plus top-level posture: `expiresAt` (ISO string or null), `daysLeft` (integer or null), and `expiryPosture`: `'expiring' | 'no_expiry' | 'expired'`. For `no_expiry`, the result states in plain words that the enrolled key has no expiry by the owner's choice (wording follows `docs/END-USER-AUTHORITY.md` tone; no warning styling). `tokenWarning` behavior is unchanged for expiring/expired tokens.
- `src/vercel/setup.js`: each account row shows its expiry state (“expires in N days”, “expired …”, or “no expiry — owner's choice”); when any account is inside the 14-day window or expired, a banner at the top of the account list says so with the account label and days left. All rendering through the page's existing escaping helpers.
- Time display follows the repo rule: stored UTC, shown America/Denver (the shaping layer's existing `_local` convention where present).

## Ordered steps
1. Whoami posture fields + tests (expiring in 10 days / never / expired fixtures).
2. Setup state line + banner + `setup-page` tests.
3. Full gates (below).

## Acceptance (design D-E, as corrected by the drift check)
- Fixture token expiring in 10 days: whoami returns `daysLeft: 10`, `expiryPosture: 'expiring'` and the existing warning; the setup account list shows “expires in 10 days” **and** the banner.
- Never-expiring fixture: whoami and setup both state the no-expiry posture in words; **no** warning and **no** banner anywhere.
- Expired fixture: posture `'expired'`, the existing expired warning intact, banner shown.
- A token expiring in 30 days: posture fields present, no warning, no banner (window discipline).
- Plus: all pre-existing whoami/setup tests pass unmodified except assertions on fields this packet intentionally adds.

## Builder guardrails (binding, restated)
- Builders spend $0; fixture tokens only — never read, probe or re-check a real enrolled token's expiry from a builder session beyond the read-only smoke rules already in force; fake secrets only (`vcp_FAKE…`), and no real expiry timestamps from Chris's actual key in tests, docs or PR text.
- Do not add nagging: outside the 14-day window the surfaces are silent about expiry (IN-04's duty is notify-*ahead*, not remind-always).
- If code contradicts this packet or D-E, stop and file a dated design amendment; do not improvise a new rule.

## Stop and ask
- The setup page cannot show per-account state without an extra database read per row at page scale: stop and record the cost; a single batched read is the expected shape.
- Any proposal to email/message the owner proactively about expiry: out of scope — no such channel is designed; record it in `docs/ROADMAP.md` instead.

## Done when
- Acceptance above is green with `npm run check`, `npm test`, and exact-head `ci` + `release-policy`.
- STATUS, this card and the O-3 index revisit are reconciled in the implementing PR. The register's VMCP-003 wording is corrected by this card's drift check; S7 closure uses this card's acceptance, not the register's stale sentence. VMCP-003's token-tool leg remains with O-3.
