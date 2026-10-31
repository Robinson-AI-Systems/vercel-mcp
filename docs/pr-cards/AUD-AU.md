# AUD-AU — Pass issuance, revocation, and one-time reveal as tools

**Card ID:** this is the sign-in cleanup dossier's pass/reveal
card (its §2.5, listed there as "AUD-AV"), executed as **AUD-AU**
per the coordinator's Addendum 1 (2026-10-31) on that dossier —
the AUD-AV ID belongs to the setup-route deletion, which merges
after this card: this is the last replacement card before it.

**Baseline inspected:** main `8c2f8cb` (AUD-BA, #368). Source of
the design: the sign-in cleanup dossier (2026-10-31) §2.5, under
the owner's 2026-10-31 sign-in hygiene ruling: owner-setup is
REMOVED, not relocated; owner administration lives on the owner's
authenticated connection or in Vercel's own console.

**The gap.** Direct pass issuance, pass revocation, and one-time
secret reveal existed only as owner setup page forms, behind the
cookie session and a fresh passphrase entry. AUD-AR/AS/AT replaced
enrollment, envelope apply, and the account forms; without this
card, AUD-AV's deletion of the setup route would strand pass
administration itself — the owner could propose passes
(`vercel_create_pass`) but never issue one directly, revoke one,
or read back a one-time secret (every `revealAt` pointer in the
system aimed at the page being deleted).

**The change.**

1. **`vercel_issue_pass`** (new tool, `src/tools/pass-admin.js`;
   engine `src/vercel/pass-admin.js`): `localAdmin`, profiles
   `['full']`, added to `LOCAL_OWNER_TOOLS`. One tool, the
   `writes` boolean discriminating the page's two forms, replacing
   `issue_rtc_pass` + `issue_rtc_write_pass`. Validations carried
   verbatim from the forms through the shared decoders
   (`passScope` / `writePassScope` in `src/vercel/pass-requests.js`
   — the factored statement of the forms' checks): areas from the
   FULL registry vocabulary (the forms' `validAreas`, both forms —
   not the proposal flow's read-only subset); 1–12 unique areas;
   lifetime 1–720 h; rate 1–600/min; TEST = the server area only;
   read modes preview/test, write modes preview/production; write
   profile everyday/full; spend ceiling an integer-cent amount
   0..2147483647; project restriction ≤ 50 unique IDs of the form's
   shape. Two argument mappings, stated plainly: the forms'
   comma-string areas become an array argument (the
   `vercel_create_pass` precedent), and the write form's dollar
   string becomes a `spendLimitCents` integer — the underlying
   validation (exact integer cents within the same bound) carries
   verbatim; the string parse is a form artifact. Write-only
   arguments on a read ask refuse rather than being silently
   dropped (the same precedent). dryRun/no-confirm returns the
   plain-words plan; confirm calls the SAME db methods the forms
   called (`issueReadOnlyRtcPass` / `issueWriteRtcPass`), so
   issuance journaling is identical by construction, then verifies
   the stored scope by the db's own read-back (`inspectRtcPass` —
   the request→approve flow's verification, ported from
   AUD-AS's apply) and delivers the bearer ONLY as a one-time
   secret under the forms' own labels ('Read-only RTC pass' /
   'Write-capable RTC pass', 10-minute TTL). Any verification or
   delivery failure revokes the pass before refusing. The bearer
   never appears in the issue result.
2. **`vercel_revoke_pass`**: replaces `revoke_rtc_pass`. Exact
   `pass_…` reference; the preview reads the same listing the page
   rendered (`listRtcPasses` metadata, non-consuming); confirm
   calls `db.revokeRtcPass` — the page's single any-row revoke,
   with its journaling. Unknown, already-revoked, malformed and
   foreign references share the form's one refusal ("Pass missing,
   already revoked or belongs to another account"). Revocation is
   effective immediately: a revoked pass refuses at the door
   (`authorizeRtcPass` → `pass_revoked`), proven in the db tests.
3. **`vercel_reveal_one_time_secret`**: replaces the setup page's
   `reveal` action (decided default **D8**, below). Arguments
   `{reference, account?, dryRun?, confirm?}`; an omitted account
   addresses the server / global scope, exactly the reveal form's
   default selection; a named account must be a connected one.
   The preview uses a new scoped, non-consuming metadata read,
   **`db.getOneTimeSecret`** (modeled on `getRtcPassRequest`;
   selects id/account/kind/label/expiry only — never the
   ciphertext; an accessor, not a store change). Confirm consumes
   the row atomically through `oneTimeSecrets().reveal` (the
   store's existing single-view semantics, TTLs unchanged) and
   returns the value in that tool result only; no stored result
   is created. The journal records the reveal AFTER the consume
   succeeds: tool `vercel_reveal_one_time_secret`, the secret's
   kind and reference in the summary, never the value
   (`recordChange`'s own credential screen would refuse it, and
   it is never offered — asserted in both test tiers).
4. **Hard gate (all three tools):** the handler refuses unless
   `connection.kind === 'connector'`, before any argument or
   store is touched (the `vercel_apply_owner_approval` gate). A
   delegated RTC pass carries kind `'pass'` and can never issue,
   revoke or reveal — including a write-capable full-profile
   pass, which passes profile visibility and is stopped at the
   handler, proven at the real dispatch boundary
   (`dispatchReadOnlyTool`) in both test tiers. The passphrase
   never becomes a tool argument (gate 2.6; a passphrase-shaped
   argument is in the malformed set).
5. **The `revealAt` pointer AUD-AS left** repoints from
   `/api/vercel/setup` to `vercel_reveal_one_time_secret`: the
   one-time delivery receipt in `src/core/write.js` and the
   issued-secret shape in `src/vercel/shape.js`. Four pinned test
   expectations move to the new value (a deliberate pointer
   change, expectations updated — none weakened).
6. **Truthful caller comments:** the "only owner setup calls
   this" notes on `issueReadOnlyRtcPass` / `issueWriteRtcPass`
   and the one-time-secrets header now name the owner-connection
   tools as callers too. Comments only — no store shape, TTL or
   behavior changes.

**D8, stated plainly (SURFACE for Chris).** One-time secrets are
delivered through this guardrailed owner-connection reveal tool:
the owner's own connector connection is the only surface that can
call it; consumption is single-view and atomic; the existing
short TTLs are unchanged; the value is returned once, in that
tool result only, and is never journaled or stored as a result.
The guardrails ARE the design — the AGENTS.md line directing
created secrets to "the one-time-secret page" is superseded for
reveal by this decision, and its intent (a secret is shown once,
to the owner, through an authenticated owner surface) is what
the tool carries.

**The one implementation consequence of D8, stated plainly.**
Every MCP result passes the final redaction boundary
(`compact()`), which hides credential-shaped strings — a naive
reveal result would arrive as `[hidden]`. The delivery layer
(`src/vercel/result-delivery.js`) therefore carries ONE narrow,
explicit exemption, keyed on BOTH the tool name
(`vercel_reveal_one_time_secret`) AND the handler's own
`'revealed'` payload shape: that payload's `value` field alone is
restored after every other field passes the normal redaction.
Any other tool's payload — and any other payload shape from this
tool — is redacted exactly as before, and the exemption creates
no stored result. Tests pin all three sides: a reveal payload
keeps its value through `shapeStoredMcpResult` (preview and
production presentations), the same string is redacted under
another tool's name, and a non-revealed payload under the reveal
name is redacted. No encoding or splitting tricks are used to
evade the boundary; the exemption is named in the code where it
lives.

**Not touched:** the envelope stores' shapes or TTLs; the pass
store's shapes; `handleSetup` and its page-side forms, which keep
working until AUD-AV deletes the route; the proposal flow
(`vercel_create_pass` stays approval-only); the front door (the
three tools are full-profile owner tools, callable by name, not
front-door seats — the AUD-AS/AUD-AT default).

**Registry:** +3 (250 → 253 registered; catalog 251 → 254 rows;
the sole unbuilt row remains `vercel_admin_overview`, closed by
the IN-16 ruling).

**Acceptance — evidence.**

- Unit (`tests/unit/pass-admin.test.js`, 13 tests): the kind
  gate for all three tools at the real dispatch boundary (a
  full-profile pass reaches the handler and refuses on kind; an
  everyday pass is unavailable; nothing is issued, revoked or
  consumed); argument discipline including a passphrase-shaped
  argument; the forms' validation sets for both forms (lifetime,
  rate, areas incl. duplicates and the 13-area cap, TEST rule,
  per-form modes, write profile/ceiling/project restriction,
  write areas explicit, write-only arguments on a read ask);
  preview issues nothing; confirm issues with the db methods
  called exactly as the forms called them, the bearer present
  only inside the one-time secret; a failed scope read-back
  revokes before refusing; revoke preview/confirm/second-refusal;
  reveal preview non-consuming, wrong-account refusal
  unconsumed, exactly-once consumption, global-scope semantics,
  and the journal carrying the reference and never the value;
  preview-deployment refusals; and the D8 delivery carve-out's
  three pinned sides.
- Db (`tests/db/pass-admin.test.js`, 4 tests, throwaway
  Postgres): a read pass issues via the tool, its bearer —
  obtained only through the reveal tool — verifies through
  `inspectRtcPass` with the exact issued scope, and a second
  reveal refuses; a write pass (production, full profile,
  $25.00 ceiling, project restriction) verifies the same way,
  authorizes at the door, and after tool revocation both
  `inspectRtcPass` and `authorizeRtcPass` return `pass_revoked`;
  a secret scoped to one account refuses reveal under another
  and stays revealable by its own; a full-profile pass is
  stopped at the reveal kind gate through the real dispatch
  with the secret left unconsumed; the change_log carries the
  db issuance rows and the reveal row (reference present), and
  no journal row contains a bearer.
- The pinned registry list and the four `revealAt` expectations
  are updated to the new values; the neighboring owner/pass/db
  suites pass unchanged.
