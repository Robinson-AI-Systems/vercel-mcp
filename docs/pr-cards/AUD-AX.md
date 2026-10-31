# AUD-AX — Front-door production polish: every surviving page on the fleet shell, copy true to the shipped sign-in

**Baseline inspected:** main `77588f6` (AUD-AV, #370). Design source:
the sign-in cleanup dossier of 2026-10-31
(`signin-cleanup-dossier-2026-10-31.md`, coordinator copy in the audit
goal files), where this card is AUD-AU, renumbered to AUD-AX by the
coordinator addendum at the dossier's head. Owner authority: Chris's
2026-10-31 sign-in hygiene ruling (one clean sign-in; owner-setup
removed, not relocated) and the fleet design rule (2026-10-30): all
RAS MCP pages share ONE look — the dark shell of `src/front-door.js`
(charcoal, white headlines, muted body, emerald accents, header
lockup with logo + product name + the tagline "Practical software.
More capable AI.", bordered address box, small-print disclaimer).

**The gap.** The cleanup program rebuilt the sign-in (AUD-AZ), the
enrollment branch (AUD-AR) and the status/connection pages on the
shared shell, and AUD-AV deleted the setup route and its links. What
remained unpolished, verified against the tree at the baseline (not
the dossier's older snapshot):

1. Three surviving user-facing surfaces still render on private,
   pre-fleet wrappers — bare light pages with no brand lockup, no
   footer, no dark look: the two-doors page (`src/vercel/connect.js`),
   the Door 1 integration callback result pages
   (`src/vercel/integration.js`), and the developer handoff result
   pages (`src/developer/handoff.js`).
2. The root page still carries the stale in-body affiliation line
   (`<small>Not affiliated with or endorsed by Vercel.</small>`) that
   duplicates the AUD-AK footer block, plus two pre-cleanup copy
   claims: signing in lets you "choose what the assistant may do"
   (AUD-AZ removed the pickers; reach is derived) and "Read-only
   connections prevent all changes" (AUD-AQ made read-only a switch
   on the user's own connection, not a connection class).
3. `/connection` still describes the pre-cleanup consent: "Pick your
   account and choose how much the connection may do", and "What a
   connection can do" explains reach as "the profile (read-only,
   everyday or full) and the mode (preview or production)" chosen at
   connect time. Its secrets section also carries the word "setup"
   ("protected credential setup").
4. The two-doors page, in its integration-not-configured fallback,
   tells the reader to ask the operator to "complete the team
   setup" — a setup reference in words, on a public page, after the
   route's deletion.

**The change.**

- `src/vercel/connect.js`, `src/vercel/integration.js`,
  `src/developer/handoff.js`: the page wrappers render through
  `frontDoorPage` (fleet shell, dark look, brand lockup, AUD-AK
  footer). Page texts are carried verbatim — the polish is the
  shell, not new words — except the connect page's "team setup"
  line, which now reads "finish creating the Vercel integration".
  Shell-standard headers join the render paths that lacked them:
  the connect handler and the integration callback's `html()` gain
  `FRONT_DOOR_CSP`; the handoff's result pages set `FRONT_DOOR_CSP`
  for the page response only (its JSON responses keep the stricter
  header, and the shell's CSP keeps `default-src 'none'` — only the
  shell's own inline style and same-origin icon are admitted).
  Untouched in the handoff, per AUD-AW's must-not-touch list: the
  RSA sealing, the poll secret, the code-proof verification, and
  the callback's client-redirect check.
- `api/index.js`: the duplicated in-body affiliation line is
  deleted (the AUD-AK footer block — frozen text, untested here and
  unchanged — remains the one affiliation statement). The sign-in
  sentence now reads that what a connection can do follows the
  account you connect; the read-only bullet describes the switch.
  `publicInfo()`'s JSON is byte-unchanged (dossier must-not-touch).
- `api/connection.js`: the connect section names the actual
  consent (pick the account, enter the administrator passphrase;
  reach follows the account, nothing about it is chosen on the
  sign-in page); "What a connection can do" is rewritten to the
  shipped shape — the door sets the starting tool set (team install
  → everyday; own token → full, per D1), the mode starts from the
  account's production switch and flips freely on a live connection
  (`vercel_set_working_box`, per D7/IN-09), and read-only is the
  user's own switch (`vercel_set_read_only`, AUD-AQ), never a
  sign-in class. The secrets section's "credential setup" becomes
  "credential store". Every phrase the page's test suite pins
  (identity claim, journal, revocation, the as-is sentence and its
  position) is preserved.
- The OAuth authorize and enrollment pages (AUD-AZ/AUD-AR) were
  verified on the shell with truthful copy and are not touched.

**Catalog judgment (drift checklist B):** no tool is added,
removed, or changed; the registry stays 253 and `docs/TOOL-CATALOG.md`
needs no row. This card's doc footprint is this card + STATUS.

**Acceptance (dossier AUD-AU).** Rendered public HTML carries no
`setup`, no `read-only profile`, no `choose your mode`
(case-insensitive) — pinned by a new sweep test over the root page,
`/connection`, the two-doors page, the integration callback pages
and the handoff result pages (`tests/unit/front-door-polish.test.js`);
`publicInfo()`'s JSON shape unchanged (landing suite, unmodified
except the affiliation pin below); both-address live render checks
remain a promotion-night gate task, not this card's claim.

**Test-pin disposition.** `tests/unit/landing-status.test.js`
pinned the duplicated in-body affiliation line. The line is
duplication, not information — the AUD-AK block it duplicates is
pinned verbatim in the same test — so the pin is flipped to assert
the short line's absence, and the card records it here per the
program rule: never keep stale copy because a test liked it.

## Evidence

Local, on the branch tree (base `77588f6`):

- Focused suites — `front-door-polish` (new, 5), `landing-status`
  (3), `connection-page` (5), `connect-page` (5),
  `developer-handoff` (9), `integration-install`,
  `oauth-handlers` (16), `oauth-enroll` (12), `front-door` (11),
  `setup-route-absence` (2): 10 files, 113 tests, all pass.
- Full unit suite: 170 files / 1,640 tests, all pass, exit 0.
- `BASE_SHA=$(git rev-parse origin/main) npm run check`: exit 0,
  read directly (secrets, docs, index, lint, catalog, write-safety,
  core-imports, budgets, session gates).
- Pre-push conflict-marker grep across the tree: clean.

CI at the exact head and the merge are recorded in the PR's
self-review comment.
