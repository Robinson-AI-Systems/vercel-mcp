# AUD-AJ — SECURITY role: exact unpriced-seat disclosure, acknowledgement gate, labelled totals

**Baseline inspected:** main `4f815a4` (X-1, #330). Owner ruling
2026-10-30 ~17:12 MDT, on Chris's own research.

**The settled fact.** Vercel publishes **no** seat price for the
SECURITY role anywhere: it is an Enterprise-only RBAC role with
per-contract pricing. It is not free (Vercel says "no extra cost" /
"free of charge" for Billing and Pro Viewer seats on the same pages
but not for Security) and it is not $20 (every $20 figure is
Pro-scoped; the members API returns no price field). O-2 therefore
stores no figure for it (`seatPrice('SECURITY')` = `{cents: null,
known: false}`) — that stays. What changes is the disclosure, the
gate, and the totals:

1. **Exact disclosure.** Every SECURITY seat-price disclosure in the
   member tooling (invite spend + preview, role-change spend +
   preview) becomes exactly:
   "Security role — seat price not published by Vercel. This role is
   Enterprise-only; any charge is set by your team's Enterprise
   agreement."
   One exported constant (`SECURITY_SEAT_DISCLOSURE` in
   `src/tools/members.js`) carries the sentence so the surfaces
   cannot drift apart.
2. **Acknowledgement gate.** An invite or role change INTO the
   SECURITY role proceeds only with an explicit acknowledgement of
   that disclosure, composed with the existing confirmation flow: a
   new boolean argument `acknowledgeUnpricedSeat` on
   `vercel_member_invite` and `vercel_member_update_role`. The
   preview (dry run) shows the disclosure; a confirmed call into
   SECURITY without the acknowledgement refuses, carrying the
   disclosure and naming the argument. Other roles' priced flow is
   unchanged, and the argument is meaningless (ignored) for them.
3. **Labelled totals.** `vercel_admin_cost_review`'s seat total,
   when the roster includes a SECURITY seat, is labelled
   "known costs only — excludes the Security seat" (a `label` field
   on `paidSeats`, and the note leads with the same words). With no
   SECURITY seat on the roster the total is unlabelled, exactly as
   before.

## Drift check

- This PR changes this card and a `docs/TOOL-CATALOG.md` note in
  its first commit, plus a STATUS bullet. No new tool — registry
  stays 240. The two tools' input schemas gain one optional
  boolean each; budget pins are verified by the check.
- No price figure is stored anywhere for SECURITY; `seatPrice` is
  untouched.

## Acceptance

- `tests/unit/members.test.js`: the SECURITY invite preview carries
  the exact disclosure; a confirmed SECURITY invite without
  `acknowledgeUnpricedSeat` refuses and dispatches nothing; with
  the acknowledgement it applies; the same gate pins on
  `vercel_member_update_role` into SECURITY; a DEVELOPER invite's
  preview/behaviour is byte-unchanged.
- `tests/unit/admin.test.js`: a roster containing a SECURITY member
  yields `paidSeats.label` = "known costs only — excludes the
  Security seat" and the priced seats still total correctly.
- `npm run check` green.
