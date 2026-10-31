# AUD-BB — Journal the working-box flip

**Baseline inspected:** main `8a5b6d24` (AUD-AY, #372).
Filed by AUD-AQ's card ("Dossier correction" section): the
sign-in cleanup dossier §3.2 described the read-only flip as
"journaled like the working-box flip," but that premise was
factually off — `vercel_set_working_box` / `setOwnConnectionMode`
wrote **no** `change_log` row, despite the AUD-I S4 claim that
every flip is journaled. AUD-AQ journaled its own flip and
reported this gap for the coordinator to file rather than
silently fixing it inside its must-not-touch boundary. This
card is that filing.

**The gap.** The change journal is the server's audit spine —
`vercel_recent_changes` reads it, X-1 undo consumes it, the
AUD-AO retention sweep ages it. A connection's mode flip
(preview ↔ production) is exactly the class of change the
journal exists to record: it changes what the very next call
may do, including whether it may touch production. Until this
card the flip landed with no row, so the journal silently
under-reported the connection's posture history.

**The change (one handler, AUD-AQ's exact shape).**
`vercel_set_working_box` (`src/tools/server.js`) now journals a
confirmed flip the way `vercel_set_read_only` does: after
`db.setOwnConnectionMode` returns a result, the handler calls
`db.recordChange({account, mode: connection.mode,
tool: 'vercel_set_working_box', summary: 'Working-box mode
flipped <from> to <to> on this connection', dryRun: false,
production: connection.mode === 'production'})`, guarded by a
`typeof db?.recordChange === 'function'` check and a try/catch,
so journaling never changes the flip's outcome — the flip
stands even if the journal write fails (the AUD-AQ test pins
the same semantics for the switch).

**Layering choice (stated per the brief).** The journaling
sits in the tool handler, because that is where AUD-AQ's
equivalent lives — the db methods (`setOwnConnectionMode`,
`setOwnConnectionReadOnly`) stay journal-free in both designs,
and the handler is the one layer every door (MCP,
`vercel_call`, HTTPS API) dispatches through. The flip has no
second path: `setOwnConnectionMode` has exactly one caller in
the tree (this handler; verified by grep over `src/`, `api/`
and `test/`), so handler-level journaling covers every flip.
One deliberate refinement over AUD-AQ's shape: journaling
fires only when the db reports an actual change
(`result.from !== result.to`). The handler's same-state early
return already covers the ordinary no-op, but a stale-context
ask the db already satisfies would otherwise write a
degenerate "flipped preview to preview" row; the guard makes
"a no-op lands none" true at the journal itself.

**Untouched.** The tool's plan/confirm contract, its refusal
texts and rungs, the AUD-AZ mode derivation, the db method,
and `vercel_set_read_only` — journaling only. The AUD-I S4
header comment in the handler (which claimed the flip was
"journaled by the write path") is corrected to name the real
mechanism.

**Catalog judgment (drift checklist B).** No tool is added,
removed or renamed; the registry is unchanged at 253. The
catalog rows for both flips were checked: neither
`vercel_set_working_box`'s nor `vercel_set_read_only`'s row
describes journaling, so no row text changes; this card adds
one dated AUD-BB note beside the AUD-AY note, per checklist B
for a `src/tools/` change. Card + STATUS bullet + this note
are in the first commit.

## Acceptance

- `tests/unit/working-box-flip.test.js` (extended): the AUD-BB
  describe block pins, through the real handler — narrowing
  production → preview lands exactly one journal row
  (`tool: 'vercel_set_working_box'`, `mode: 'production'`,
  `production: true`, `dryRun: false`, summary naming
  "production to preview"); widening preview → production
  lands exactly one the other way (`mode: 'preview'`,
  `production: false`); a no-op, a dryRun plan, a guard
  refusal and an unavailable connection each land none; the
  flip stands when journaling throws; and the row reads back
  through the real `vercel_recent_changes` handler over the
  production `recordChange`/`listRecentChanges` seams.
  All seven pre-existing S4 tests pass unchanged.
- `tests/db/working-box-flip.test.js` (new, throwaway
  Postgres): a token row is born in its issued mode; a
  confirmed flip persists and reads back through
  `getAccessToken` both ways; a same-mode ask reports
  `from === to` and changes nothing (the state the handler's
  journal guard keys on); a foreign connection id returns
  null and flips nothing; malformed arguments throw; and a
  journal row in the handler's exact shape round-trips
  through `recordChange` → `listRecentChanges` (tool-filtered,
  unfiltered, and invisible to another account).
- `npm run check` green, exit code read directly; merge only
  at `ci` + `release-policy` green at the exact head, 0
  unresolved threads. No promotion (nightly train), no live
  calls.
