# AUD-AO — Retention clocks: 400-day journal/ledger sweep + 180-day unused-authorization sweep

**Baseline inspected:** main `8fb9e83` (AUD-AK, #341).
Source of the clocks: the Production Gate decision of 2026-10-31
(Chris/Vivienne, fleet standard, recorded in the RAS MCP Standard's
"Production readiness & protection gate" section): `change_log` and
`purchase_intents` retained **400 days** then sweep-purged; **unused
authorizations out at 180 days**. Dossier:
`retention-clocks-dossier-2026-10-31.md` (audit goal workspace) —
the per-store inventory this card implements.

**The gap.** No retention sweep existed anywhere in the server. The
journal and the purchase ledger grew forever; expired authorization
artifacts (unredeemed OAuth codes, unconsumed owner approval
envelopes and pass requests, unused pending secret inputs, pending
purchase intents, never-used RTC passes) were never deleted — their
rows were removed only by consumption or, for some, by AUD-AA account
removal. The only sweep in the codebase was the result store's own
24-hour TTL at read.

**The change.**

1. `src/db.js` gains `sweepRetention()` (exported clock constants
   alongside: 400 / 400 / 180). One bounded CTE batch per store, in
   the result store's established shape:
   - `change_log`: purge `at` older than 400 days.
   - `purchase_intents`: purge still-pending (never approved, never
     consumed) intents lapsed more than 180 days; purge all rows
     created more than 400 days ago.
   - `oauth_codes`, `one_time_secrets`, `pending_inputs`: purge rows
     lapsed more than 180 days. Consumption deletes these rows
     atomically, so a surviving lapsed row is unused by construction.
   - `rtc_passes`: purge only the provably unused — `window_count = 0`
     (first authorization debits the window and it never returns to
     0), never revoked, lapsed more than 180 days.
   A sweep that purges anything journals exactly one `change_log`
   row (`vercel_retention_sweep`, no account, so it appears in no
   account's audit list) carrying **counts only, never contents** —
   the AUD-AA precedent.
2. The trigger follows the codebase's only periodic shape — there is
   no scheduler and no cron; maintenance is opportunistic on
   requests. `initSchema()` (called by every entry route) invokes
   the sweep behind an in-process one-hour throttle, contained so a
   sweep failure can never break schema init or a request.
3. Disclosure alignment: the three product surfaces that said
   "Audit history and purchase records are kept" without a number —
   the `vercel_remove_account` preview (`src/tools/owner-proposals.js`)
   and the setup page's removal copy + success message
   (`src/vercel/setup.js`) — now say **kept for 400 days**. The
   AUD-AA note in `docs/TOOL-CATALOG.md` says the same.

**Deliberate exclusions (dossier carries the full reasons).**
`oauth_tokens` is NOT swept: no durable use marker exists
(`last_used_at` is never written — only reset to NULL at rotation)
and any row carrying a refresh hash is a live credential regardless
of access expiry, so every available predicate would misclassify
returning users' live refresh grants as "unused" and delete them.
Exercised purchase intents and used/revoked RTC passes are not
"unused" and ride only their ledger/account-removal paths.
`request_replay` (self-bounding by key reuse), `login_attempts`
(telemetry, outside the decided clocks) and the dev-run ledger are
not authorizations and are untouched. The `last_used_at` observation
is recorded in the dossier as a follow-up, not built here.

**Stated consequence — undo.** `vercel_undo_change` reads
`change_log` by id (`getChangeForUndo`), so the 400-day clock bounds
undo history at 400 days: a purged row reads back null and the tool
refuses legibly, exactly as for a row that never existed; nothing
dangles (the `undone_by` pointer lives on the purged row itself).
Undo is a recency tool — its input is a row id from
`vercel_recent_changes` — and the fleet clock is the owner's
decision. Accepted and pinned by test rather than discovered later.

## Drift check

- No tool is added, removed or changed in name, schema or profile —
  the registry stays 240. `vercel_remove_account`'s preview text
  gains four words ("for 400 days"); that is the catalog-note change
  this PR carries, per checklist B, alongside this card and the
  STATUS bullet in the first commit.
- One existing test pin changes, by exactly the copy change:
  `tests/unit/owner-remove-mcp.test.js` now expects the full aligned
  sentence "…are kept for 400 days" (the old pin asserted only the
  unnumbered prefix). No expectation is weakened.
- Schema is untouched (no new table or column — `SCHEMA_TABLES`
  stays 19); the sweep is plain deletes plus one journal insert.
  No secret or identifier appears in code, tests or docs: fixtures
  are `*_FAKE` shapes only, and a test asserts the sweep journal's
  counts payload contains no fixture content.

## Acceptance

- `tests/db/retention-sweep.test.js` (throwaway Postgres,
  fixture-aged rows): each clock purges at its boundary and keeps
  younger rows (journal 401d vs 399d; intent lapsed 200d vs 10d;
  artifacts lapsed 181d vs 10d); the exercised distinction is proven
  both ways (an approved intent and a used pass survive the 180-day
  sweep; a pending intent and an unused pass do not; a revoked pass
  survives); a consumed intent past 400 days is purged by the ledger
  clock; a purging sweep journals exactly one counts-only row and an
  empty sweep journals none; `getChangeForUndo` resolves a retained
  row and returns null for a purged one; an expired `oauth_tokens`
  row carrying a refresh hash is never swept.
- `npm run check` green at the exact head; the change rides the
  nightly promotion (no daytime promotion).
