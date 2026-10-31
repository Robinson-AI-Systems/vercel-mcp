# AUD-AZ — The one sign-in: profile, mode and listing derived at OAuth issuance

**Card ID:** this is the sign-in cleanup dossier's one-sign-in
card (its §5 "AUD-AN"), executed as **AUD-AZ** per the
coordinator's Addendum 2 (2026-10-31) on that dossier — the
AUD-AN ID belongs to the documentation-audit card series.

**Baseline inspected:** main `8fb9e83` (AUD-AK, #341). Source of
the design: the sign-in cleanup dossier (2026-10-31) §2.2, §2.3
and the one-sign-in scope in §5, with decided defaults D1 (Door 1
profile is `everyday`) and D7 (initial mode derived from the
account's production switch), under the owner's 2026-10-31
sign-in hygiene ruling: one clean sign-in for all users, no
developer mode, no read-only mode as a sign-in class.

**The gap.** The OAuth consent page let the connecting person
CHOOSE the new connection's mode, profile and listing from
pickers, recomputed per account by an embedded JSON map and a
change script (the AUD-AE shape). The stored values were chosen,
not derived: a Door 1 (integration) seat and a Door 2 (token)
seat could be issued with the same profile, `read_only` existed
as a sign-in class, and the listing could be issued as `catalog`
or `compact` even though the front door is the ruled listing for
OAuth connections. The page also rendered on its own pre-fleet
markup, and its empty state routed the reader to the setup page.

**The change.**

1. `src/vercel/login.js` — `modesFor` is retired. The login
   adapter gains one method, `issuanceFor(account, env)`, the
   single authority both the consent page and code creation read
   (the AUD-AE no-drift lesson): `profile` is derived from the
   enrollment door — the account probe's source, `integration`
   (Door 1) → `everyday`, otherwise (Door 2 token) → `full`;
   `mode` is derived from the account's own production switch
   AND the server's production deployment (D7 / IN-09 — the
   deployment conjunct is the pre-existing safety property of
   `modesFor`, retained: a non-production deployment of this
   server never mints a production connection); plus the
   per-account caption (declared box + starting mode, `boxReport`
   vocabulary) and the AUD-W production note for the selected
   account, both wordings unchanged.
2. `src/core/oauth-handlers.js` — `authorizePage` renders on the
   fleet shell (`frontDoorPage`) and carries exactly the account
   choice, the administrator passphrase and the submit button,
   plus links into the enrollment branch of the same flow
   (`/api/oauth/enroll`, built by AUD-AR; `/api/vercel/connect`).
   AUD-AE's flag-keyed (`is_default`) preselection is preserved;
   every option is captioned with its own derivation; the
   selected account's note renders server-side. The pickers, the
   per-account modes JSON and the script are deleted. The empty
   state no longer names the setup page — it points at
   enrollment. The authorize POST derives via `issuanceFor` and
   binds the listing as `front_door` (`OAUTH_LISTING`); posted
   mode/profile/listing values are never read. The factory guard
   now requires `issuanceFor`.
3. `src/front-door.js` — `BRAND_CSS` gains form-element rules
   (form, label, input/select, button, alert). The consent page
   is the shell's first form; the status and connection pages
   contain no form elements, so their rendering is unchanged.
4. `test/helpers/fake-db.js` — the `listVercelAccounts`
   projection gains `token_probe`, matching the real SELECT in
   `src/db.js`. The derivation reads the probe's door source;
   the fake had drifted from the real row shape (the AUD-AE
   fake/real drift class). No assertion anywhere pins the old
   projection.

## Drift check

- No tool is added, removed or changed: this is a
  consent-surface and issuance-derivation change only, so the
  registry stays 240 and `docs/TOOL-CATALOG.md` is untouched —
  the catalog-note judgment, stated here per checklist B.
- The schema is untouched; stored values are derived at
  issuance, never chosen; existing issued connections are NOT
  rewritten (grandfathering, D6) — a stored `read_only` /
  `compact` connection keeps authenticating with exactly its
  stored values, pinned by test.
- Untouched by design: the token/register/revoke handlers, PKCE
  and resource validation, `evaluateLogin`, and the Muse
  client resolution.
- The shell footer's "Owner setup" link is AUD-AV's removal,
  sequenced with the setup route's deletion; this card's
  consent body names no setup surface (pinned, scoped to the
  body above the footer for exactly that reason).
- This PR changes this card and a STATUS bullet in its first
  commit, per checklist B. No identifiers or secrets; the
  secret scan is part of the check.

## Acceptance

- `tests/unit/oauth-handlers.test.js` — the pickers' absence is
  pinned (the rendered consent carries no mode/profile/listing
  inputs, no modes JSON, no script); the derivation matrix is
  pinned (door × account switch × server deployment →
  profile/mode, listing always `front_door`); posted
  mode/profile/listing cannot steer the issued values; AUD-AE
  preselection, per-account captions and both AUD-W note
  variants are pinned in their new form; a boundary test drives
  the issued values through `listMcpTools` (an `everyday`
  connection's front door excludes the full-only
  `vercel_workflow_project_setup`; a `full` connection's
  includes it); grandfathering is pinned; PKCE exchange and
  refresh carry the derived values.
- `tests/unit/front-door.test.js` — the AUD-C authorize-door
  section now pins the removed listing picker and that a posted
  `catalog` choice still derives `front_door`; the
  binds-front_door test is unchanged.
- `tests/db/oauth-persistent.test.js` — authorization-code
  exchange and refresh persist the derived values on real
  Postgres (the posted pre-cleanup shape is retained in the
  fixture precisely so the test proves it cannot steer).
- `npm run check` green; the change rides the 2026-11-01
  00:01 MDT nightly promotion (no daytime promotion).
