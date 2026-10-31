# AUD-AS — Envelope apply on the owner's connection

**Card ID:** this is the sign-in cleanup dossier's envelope-apply
card (its §5 "AUD-AR"), executed as **AUD-AS** per the
coordinator's Addendum 1 (2026-10-31) on that dossier — the
AUD-AR ID belongs to the enrollment card.

**Baseline inspected:** main `02a5094` (AUD-AR, #362). Source of
the design: the sign-in cleanup dossier (2026-10-31) §2.4 and the
AUD-AR scope in §5, under the owner's 2026-10-31 sign-in hygiene
ruling as sharpened the same day: owner-setup is REMOVED, not
relocated; owner administration lives on the owner's authenticated
connection (the approval-envelope pattern is the owner's surface)
or in Vercel's own console.

**The gap.** Owner tools propose: a `localAdmin` tool's dryRun
returns a plan and its confirm issues an encrypted approval
envelope {reference, ~10-minute TTL, `reviewAt: /api/vercel/setup`}
— but the only apply path was the setup page, behind its cookie
session and a fresh passphrase entry. Once AUD-AV deletes that
route, every envelope family (owner account changes, purchase
intents, RTC pass requests, production-enable receipts) would be
stranded: proposable, never applicable.

**The change.**

1. **`vercel_apply_owner_approval`** (new tool, `src/tools/owner-apply.js`):
   `localAdmin`, profiles `['full']`, added to `LOCAL_OWNER_TOOLS`;
   arguments `{reference, dryRun?, confirm?}` (additionalProperties
   false), mirroring the working-box tool's contract shape.
   dryRun (or no confirm) = **inspect**: resolve the reference
   against the four envelope stores and return the exact
   plain-words summary the setup page's review renders; inspect
   never consumes. confirm = **apply**: re-inspect, consume
   single-use, compare, apply (below). Registry +1 (240 → 241 at
   build; 242 on merged main — AUD-AQ landed first).
2. **The apply engine** (`src/vercel/owner-apply.js`) calls the
   same functions the page calls, in the page's order, with each
   family's existing change_log journaling unchanged:
   `consumeOwnerAccountChange` + `applyApprovedOwnerAccountChange`;
   `db.approvePurchaseIntent` (a fixed price at exactly its quoted
   total — the ceiling the envelope carries; the metered Sandbox
   shape only as an explicit unbounded acknowledgment, its summary
   stating the non-guaranteed variable-charge risk in the page's
   words); pass-request consume + `issueReadOnlyRtcPass` /
   `issueWriteRtcPass`, with the page's independent scope read-back
   (`inspectRtcPass`) and the bearer delivered as a one-time secret
   reference, never in the tool result (revoked if verification or
   delivery fails); `approveProductionEnable` for receipts.
3. **Hard gate:** the handler refuses unless
   `connection.kind === 'connector'`, before any argument or store
   is touched. A delegated RTC pass carries `kind: 'pass'` and can
   never apply an owner approval — including a write-capable pass
   with the full profile, which passes profile visibility and is
   stopped by this gate at the handler (boundary-tested through
   `dispatchReadOnlyTool`, not a fixture shortcut).
4. **Production-enable inspection:** `db.getProductionEnableRequest`
   — a scoped, non-consuming read modeled on `getRtcPassRequest`
   (same store, same TTL; an accessor, not a shape change) — so the
   fourth family can be previewed before `approveProductionEnable`
   consumes its receipt.
5. **`reviewAt` repoints** from `/api/vercel/setup` to
   `vercel_apply_owner_approval`: the approval-envelope result and
   the purchase-intent result in `src/core/write.js`; the
   passphrase-strictness directions in
   `src/tools/production-guard.js` (the owner is now told to
   approve with the tool); the default-account guard sentence
   mirrored in `src/vercel/owner-approvals.js` and
   `src/tools/owner-proposals.js`. Proposal plan texts are
   otherwise untouched; the one-time-secret `revealAt` pointer is
   NOT a reviewAt and stays for AUD-AU.

**The proof change, stated plainly (dossier D2, SURFACE).** The
apply step's human-presence proof changes from "the administrator
passphrase, typed on the setup page" to "possession of the owner's
own connector credential + the unguessable, single-use, 10-minute
reference + an inspect/compare of the exact envelope + each
family's journaling". The passphrase never becomes a tool argument
(gate 2.6 bars it; an argument-shaped like one refuses). This is
the one real weakening in the cleanup program and it is inherent
to the owner's decision: the authenticated connection is the
owner's surface, and this card implements it with the strongest
gates the connection offers rather than smuggling the page back.

**Not touched:** the envelope stores' shapes or TTLs; the proposal
tools' plan texts (except the `reviewAt`/direction repoints
above); purchase pricing; the setup page itself (AUD-AV's card);
`handleSetup` and its page-side apply paths, which keep working
until the route is deleted.

**Acceptance — evidence.**

- Each family applies end-to-end from proposal to journaled
  application via tools only, on throwaway Postgres
  (`tests/db/owner-apply.test.js`, 4 tests): a spend-limit
  envelope proposed by `vercel_set_spend_limit` applies and the
  db method's own application audit row exists exactly once; a
  fixed-price intent approves at its $20.00 quote
  (`vercel_owner_approve_purchase` journaled) and a metered Sandbox
  intent approves only with `allow_unbounded_metered`; read and
  write pass requests proposed by `vercel_create_pass` issue, the
  bearer read back from its one-time secret verifies through
  `inspectRtcPass` with the approved scope, and the issuance audit
  rows land; a passphrase-strictness production receipt proposed by
  `vercel_enable_production` applies and the team's
  `production_enabled` flips with the passphrase-verified journal
  row. Every family's replayed reference refuses, and a second
  account's connection can neither inspect nor consume another
  account's envelope.
- Unit (`tests/unit/owner-apply.test.js`, 5 tests): the pass-kind
  boundary through the real dispatch (a full-profile pass reaches
  the handler and refuses on kind; the envelope is left
  unconsumed); inspect is non-consuming and apply is single-use;
  argument discipline, including a passphrase-shaped argument;
  preview-deployment and unknown-reference refusals; the purchase
  ceiling rule.
- The pinned registry list, the localAdmin allowlist and the four
  `reviewAt` expectations are updated to the new values; the
  neighboring owner/purchase/pass/production unit and db suites
  pass unchanged.
