# AUD-AQ — Read-only as an end-user switch (dossier AUD-AO, renumbered)

**Baseline inspected:** main `8fb9e83` (AUD-AK, #341).
Design: the sign-in cleanup dossier
(`signin-cleanup-dossier-2026-10-31.md`, goal files) §3 and its
card entry §5 "AUD-AO" — renumbered **AUD-AQ** by the dossier's
coordinator addendum (the dossier's AUD-AO/AUD-AP IDs were already
in flight for the retention and health cards). Authority: Chris's
2026-10-31 sign-in hygiene ruling — read-only is an end-user switch
in the user's own settings (IN-09 philosophy), never a sign-in
class or grant type.

**The gap.** Today read-only exists only as a *profile*: a species
of login chosen at consent and baked into the issued token
(`profile: 'read_only'`). A user who wants their own live
connection to stop writing has no dial of their own — the only
routes are re-consenting into a different login species or
revoking the connection. The ruling makes read-only a property of
the connection that its own user flips at any time.

**The change (dossier §3.3 items 1–6, exactly).**

1. **Schema (additive, house style):** `ALTER TABLE oauth_tokens
   ADD COLUMN IF NOT EXISTS read_only BOOLEAN NOT NULL DEFAULT
   FALSE` in `src/db.js` `initSchema`, beside the AUD-C listing
   default alignment. A connection is born with the switch off;
   stored rows are never rewritten.
2. **db method `setOwnConnectionReadOnly({account, connectionId,
   readOnly})`** modeled line-for-line on `setOwnConnectionMode`:
   same `conn_` + md5(token_hash) identity derivation,
   connector-kind only, live tokens only, select-then-update with
   a confirming read-back, returns `{from, to}` or null.
   `getAccessToken` selects the new column, so the auth layer sees
   the flip on the next call (the connection context is fixed at
   auth — the S4 precedent). Refresh rotation updates the token
   row in place, so the switch survives refresh like every other
   connection setting (AI-PR-READ-FIRST item 16).
3. **Auth context:** `requireMcpToken` (`src/core/mcp-auth.js`)
   adds `readOnly: record.read_only === true` to the frozen
   connection context.
4. **New tool `vercel_set_read_only`** (`src/tools/server.js`):
   `localAdmin`, profiles `['full']`, added to `LOCAL_OWNER_TOOLS`;
   arguments `{readOnly: boolean, confirm?, dryRun?}` under the
   same plan/confirm contract as `vercel_set_working_box`. It
   flips the caller's *own* connection only (keyed by the
   connection's own identity); an RTC pass connection never sees
   it. A confirmed flip is journaled (`change_log`, tool
   `vercel_set_read_only`, summary naming from/to) so both flips
   read back through `vercel_recent_changes` (the §5 live-leg
   acceptance); journaling never changes the flip's outcome.
5. **Three enforcement gates, one behavior:**
   - *Listing* (`listMcpTools`): a connection whose switch is on
     lists reads only — plus `vercel_whoami` and
     `vercel_set_read_only` itself, which also survive the
     listing filter while the switch is on, so the user can always
     see posture and flip back from any listing.
   - *Dispatch* (`mayUse` in `src/core/mcp-server.js`): with the
     switch on, any `writes === true` tool other than the switch
     is unusable regardless of profile — a wrapper predicate, no
     tool's `profiles` array edited.
   - *Write preflight* (`writePreflight`,
     `src/core/write-preflight.js`): beside the existing
     `profile === 'read_only'` refusal, a connection with
     `readOnly === true` refuses **before** the purchase branch
     with a named reason carrying the remedy (flip your own switch
     off with `vercel_set_read_only`).
6. **Posture:** `vercel_whoami` reports `readOnly` beside
   mode/profile, and its `workingBoxChanges` gains a
   `readOnlySwitch` line in plain words (A-10 cold relay: a fresh
   agent reading whoami alone can state the posture and the flip).

**Front-door seat decision (OP-1).** The switch takes **no**
front-door seat: it follows its model, `vercel_set_working_box`,
which is not a front-door member either — posture flips are
reached by name through the dispatch gate, and gate 1 above makes
the switch *listed* exactly while it is on, which is the only
moment discoverability is load-bearing (a read-only connection
must see its way back). Membership is therefore unchanged and the
front door keeps its measured size (re-measured on this tree with
`scripts/check-budgets.mjs`; the figure is quoted in the PR).

**Catalog arithmetic (verified against
`scripts/check-catalog.mjs`).** This card adds one registered
tool: the registry goes 240 → **241**, and every one of the 241
registered tools is built. `docs/TOOL-CATALOG.md` gains one row
in "Server about itself" (21 → 22), so its tables list 242 rows
in total — 241 built plus `vercel_admin_overview`, which stays
closed by the IN-16 ruling and is not built. Totals move:
Hand-built 237 → 238, All tools 241 → 242, per-batch AUD 5 → 6.

## Drift check

- This PR changes this card, a STATUS bullet and
  `docs/TOOL-CATALOG.md` (new row + AUD-AQ note) in its first
  commit, per checklist B; `src/tools/` changes, so the catalog
  note is required, not optional.
- **Must NOT touch** (dossier §5): `rtc_passes`, the RTC door,
  profile arrays on existing tools, `vercel_set_working_box`.
  RTC passes keep `profile: 'read_only'` as a *pass scope* — the
  door mints pass connections without a `readOnly` field, so all
  three gates are inert for passes by construction, and a test
  pins it.
- Grandfathering (dossier D6): existing connections stored with
  `profile: 'read_only'` keep working exactly as issued — the
  switch defaults off on their rows and no stored value is
  rewritten; a boundary test pins their listing/dispatch shape.
- No secret, token or identifier is added anywhere; test fixtures
  use the established FAKE shapes only.

## Dossier correction (evidence, not a redesign)

Dossier §3.2 describes this flip as "journaled like the
working-box flip." That premise is factually off about the
current code: `vercel_set_working_box` / `setOwnConnectionMode`
write **no** `change_log` row today (verified by grep on main
`8fb9e83`: the only handler-side `recordChange` call in
`src/tools/server.js` is the one this card adds), despite the
AUD-I card's "every flip is journaled" claim. This card follows
the dossier's §5 acceptance instead — the read-only flip IS
journaled, so both flips read back in `vercel_recent_changes` —
and does **not** touch `vercel_set_working_box` (dossier
must-not-touch list). The working-box journaling gap is reported
here for the coordinator to file; it is not silently fixed.

## Acceptance

- `tests/unit/read-only-switch.test.js` (new): the flip handler
  (plan on dryRun, refusal without confirm, no-op in the current
  state, apply keyed by the caller's own connection id, malformed
  asks rejected, flip journaled naming from/to) and the boundary
  set through the **real** registry, `listMcpTools` and
  `dispatchReadOnlyTool` (the AUD-Z lesson — no hand-rolled owner
  list): switch on → writes hidden from the listing and refused at
  dispatch by name; reads, whoami and the switch itself stay
  listed and callable under catalog **and** front_door listings;
  switch off → writes resume; a grandfathered `read_only`-profile
  connection is unchanged and cannot reach the switch; pass-shaped
  connections (read-only pass, write pass) are unaffected.
- Gate 3 is pinned in `tests/unit/read-only-switch.test.js`
  alongside the other two layers: a switch-on connection is
  refused at preflight with the named reason before the tool's
  `before()` runs; switch-off and write-pass connections pass.
- `tests/db/read-only-switch.test.js` (new, throwaway Postgres):
  the column defaults off on a fresh token row; the flip persists
  and reads back through `getAccessToken`; a foreign
  connection id / wrong account returns null and changes nothing.
- `tests/unit/owner-tools-boundary.test.js`: the filed owner set
  gains `vercel_set_read_only` (the AUD-AA precedent — the test
  fails loudly by construction until the filing matches).
- `tests/unit/registry.test.js` and `tests/unit/front-door.test.js`
  counts move 240 → 241 where the registry is pinned.
- `npm run check` green, exit code read directly; merge only at
  `ci` + `release-policy` green at the exact head, 0 unresolved
  threads. No promotion (nightly train), no live calls.
- Post-promotion live leg (acceptance queue, not this PR): flip →
  legible write refusal → flip back → write succeeds; both flips
  in `vercel_recent_changes` (dossier §5, gate 2.3).
