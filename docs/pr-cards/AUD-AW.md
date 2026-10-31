# AUD-AW — Developer handoff hardening: the standard connection only

**Baseline inspected:** main `8fb9e83` (AUD-AK, #341). Design source:
the sign-in cleanup dossier of 2026-10-31
(`signin-cleanup-dossier-2026-10-31.md`, coordinator copy in the audit
goal files), where this card is AUD-AT, renumbered to AUD-AW by the
coordinator addendum at the dossier's head. Owner authority: Chris's
2026-10-31 sign-in hygiene ruling — one clean sign-in for all users,
no developer mode, no profile/listing choice as a sign-in class —
plus dossier decision D3: the developer handoff survives on the
production deployment, hardened, because the repo's own
connection-recovery rule depends on it; it is unlinked and
client-bound.

**The gap.** `POST /api/developer/connect` (the mobile OAuth handoff
of `docs/pr-cards/DEVELOPER-CONNECTION.md`) minted a *dev login
grant*: `validateStart` in `src/developer/handoff.js` required a
caller-chosen `profile` ∈ {read_only, everyday, full}, and the start
handler baked that profile plus a forced `listing: 'compact'` into
the OAuth authorize URL it returned. A caller-reachable route was
choosing sign-in classes — exactly what the ruling removes — even
though the route is linked from no public page.

**The change (one surface: `src/developer/handoff.js`).**

1. `validateStart`: `profile` is removed from the accepted key set
   and the profile membership check is deleted. A start carrying a
   `profile` (or `listing`) field is now refused by the existing
   strict-key validation as an unknown key (`invalid_request`).
2. The start handler's authorize URL no longer sets `profile` or
   `listing`. The handoff requests the standard connection: consent
   derives both values exactly as it does for any other sign-in
   (today the authorize page's own defaults and the owner's final
   choice; after AUD-AN, the derived values of the one sign-in).
3. A header comment records the invariant: no profile/listing choice
   of the handoff's own, and no public page links the route.

Untouched, per the dossier's must-not-touch list: the RSA sealing,
the poll secret, the code-proof verification, and the callback's
client-redirect check. The handoff store has no profile column and
needed no change; no schema change.

**Docs.** `docs/pr-cards/DEVELOPER-CONNECTION.md`'s review-corrections
note is updated to match: the handoff requests the standard
connection only; a start carrying a profile or listing field is
refused as an unknown key.

## Tests

`tests/unit/developer-handoff.test.js`, updated and extended:

- The start fixture no longer sends `profile`. The first test is
  rewritten to pin the new shape against the old: the authorize URL
  carries **no** `profile` and **no** `listing` parameter (pre-change
  it asserted `profile=full` was preserved).
- New: a start carrying a `profile` or `listing` field is refused —
  `validateStart` throws, and the handler answers 400
  `invalid_request`.
- New: a link scan in the dossier §1C pattern — the front door
  (`api/index.js`), `/connection` (`api/connection.js`), the shared
  shell (`src/front-door.js`), the connect page
  (`src/vercel/connect.js`) and the sign-in handler
  (`src/core/oauth-handlers.js`) contain no reference to
  `/api/developer`, pinning that the handoff stays unlinked from
  every public page and from the public sign-in itself.
- The end-to-end recovery flow (consent callback → RSA-sealed code →
  poll → decrypt) passes unchanged on the standard start shape,
  which is the dossier's acceptance for this card.

## Drift check

- No tool is added, removed or changed: the handoff is a machine
  protocol route, not an MCP tool, so the registry count is
  unchanged and `docs/TOOL-CATALOG.md` is untouched (the AUD-AK/O-6
  precedent: state the judgment on the card).
- This PR changes this card and a STATUS bullet in its first commit,
  per checklist B.
- No identifiers or secrets in the change; test fixtures keep the
  existing fake values.

## AI-PR-READ-FIRST — applicable items

- §6/§7 (secrets): unchanged — the authorization code still travels
  only RSA-sealed to the requesting client; no secret enters code,
  tests, logs or results.
- §9 (guards): the change *narrows* what a caller can request — a
  caller-chosen sign-in class is removed; no guard is bypassed or
  weakened through any door.
- §12 (access widening needs confirm): unchanged — the owner's
  consent on the authorize page remains the only widening step, and
  it now presents the standard choices.
- §14/§16 (login): lockout, hashing, refresh-copy semantics and the
  DB rate limit (handoff start quota) are untouched.

## Acceptance (dossier AUD-AT)

- [x] The connection-recovery flow completes end-to-end in tests
  with the standard connection shape.
- [x] A handoff start carrying a profile field is refused as an
  unknown key (the existing strict-key validation).
- [x] `docs/pr-cards/DEVELOPER-CONNECTION.md` updated to match.
- [x] No public page or the public sign-in links the handoff
  (test-pinned).

Live acceptance is unchanged in kind: the recovery flow against the
deployed origin rides the nightly promotion and the coordinating
runner's saved grant, as DEVELOPER-CONNECTION.md already prescribes.
