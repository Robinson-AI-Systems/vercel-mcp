# AUD-AR — Enrollment inside the sign-in flow

**Card ID:** this is the sign-in cleanup dossier's enrollment
card (its §5 "AUD-AP"), executed as **AUD-AR** per the
coordinator's Addendum 1 (2026-10-31) on that dossier — the
AUD-AP ID belongs to the public health endpoint card.

**Baseline inspected:** main `9532158` (AUD-AZ, #356). Source of
the design: the sign-in cleanup dossier (2026-10-31) §2.2 and
the AUD-AP scope in §5, under the owner's 2026-10-31 sign-in
hygiene ruling as sharpened the same day: owner-setup is
REMOVED, not relocated; token enrollment is a *user* surface
and survives inside the one sign-in flow.

**The gap.** Token enrollment (`storeToken`: probe, scope
read-back, encrypted store) and Blob store enrollment existed
only as form actions on the setup page, behind its cookie
session — and the connect page's Door 2 button routed the user
to that setup page. Enrollment was a setup surface, not part
of sign-in: once the setup route is deleted (AUD-AV), Door 2
would have no enrollment path at all.

**The change.**

1. `api/oauth/enroll.js` — new thin wrapper in the
   `api/oauth/*` pattern, dispatching to an `enroll` handler.
2. `src/core/oauth-handlers.js` — an `enroll` handler beside
   `authorize`. Deliberately stateless: no session is minted
   or consulted; the in-flight OAuth parameters ride along as
   hidden fields (the authorize form's field list, factored
   into one shared `flowFields`), so completing or abandoning
   enrollment returns to the SAME consent, and the read-back's
   "Continue to sign-in" action returns to
   `GET /api/oauth/authorize` with the new account
   preselected. Every POST proves the administrator
   passphrase with `evaluateLogin` — the authorize POST's own
   per-request proof, sharing the `login_attempts` lockout —
   before anything probes or stores. Pages render on the
   fleet shell (`frontDoorPage`). The enrollment operations
   live behind the service adapter, so this generic handler
   imports nothing provider-specific; a service without them
   gets a legible 503.
3. `src/vercel/login.js` — the adapter gains `enrollToken`
   and `enrollBlobStore`. `enrollToken` calls the existing
   `storeToken` **unchanged**: probe and scope read-back
   happen before anything is stored, only ciphertext is
   persisted, and the upsert by team (+project) makes
   re-enrollment the rotation path (a fresh `token_version`
   is minted; the prior no-expiry attestation does not carry
   over). A probe failure names its leg in the setup form's
   AUD-F words and enrolls nothing. The read-back is composed
   from the stored row (`boxReport`: declared vs probed box,
   scope, last four) — what the page states is what was
   recorded. `enrollBlobStore` carries the setup form's
   `connect_blob_store` validation wording verbatim (enrolled
   account, bounded store ID and label, Blob read-write token
   shape) and stores `encryptSecret` ciphertext under
   `BLOB_CONTEXT` via `db.insertBlobStoreConnection`. The
   adapter factory gains an optional `fetchImpl` seam used
   only by tests; production calls use the token store's
   global fetch exactly as the setup page's enrollment does.
4. `src/vercel/connect.js` — `SETUP_PATH` is deleted; the
   Door 2 button points at `/api/oauth/enroll`. The connect
   page is a standalone explainer and carries no flow
   parameters, so its button enters the branch in standalone
   mode: after read-back the page returns the user to the
   connect guide, and the new account is offered when they
   start the connection from their client.
5. `test/helpers/fake-db.js` — gains `upsertVercelAccount` /
   `getAccountCredential` and the Blob store connection
   methods, mirroring the real `src/db.js` semantics
   (validation, the AUD-E enrollment resets, the list
   projection that never carries ciphertext).
6. Tests — new `tests/unit/oauth-enroll.test.js` (12 tests);
   `tests/unit/connect-page.test.js`'s Door 2 assertion now
   pins the enrollment branch and the setup route's absence.

## Drift check

- No tool is added, removed or changed: enrollment is a
  route, not a tool, so the registry stays 240 and
  `docs/TOOL-CATALOG.md` is untouched — the catalog-note
  judgment, stated here per checklist B.
- Untouched by design: `storeToken`'s probe logic (AUD-M2/M3
  territory), the Door 1 integration callback, and
  `handleSetup` — its `add_token` / `connect_blob_store`
  actions are deleted by AUD-AV with the route itself.
- The schema is untouched; no session or cookie is created
  anywhere in the branch.
- Nothing is activated by enrollment: the stored account row
  is inert until a consent binds a connection to it (the
  store-then-bind semantics the setup page has today).
- No token value reaches any page, log, journal or tool
  surface: the suites sweep rendered pages and stored rows
  for the fixture token values.
- This PR changes this card and a STATUS bullet in its first
  commit, per checklist B. No identifiers or secrets; the
  secret scan is part of the check.

## Acceptance

- `tests/unit/oauth-enroll.test.js` — both forms render with
  the flow parameters carried as hidden fields and no setup
  surface named in the body; a team token enrolls end-to-end
  (the probe's three provider calls precede the store;
  ciphertext only at rest; the read-back states scope,
  declared vs probed box and last four; Continue returns to
  the same consent with the account preselected, and the
  account is then offered at consent — binding still happens
  only there); a Full Account read-back requires the explicit
  allowance, and broad visibility without it refuses naming
  the broad-visibility leg and stores nothing; a
  project-scoped read-back is pinned; a wrong passphrase
  refuses 401 before any provider call; an invisible team
  names the teams leg and stores nothing; rotation
  re-enrolls and rotates `token_version`; Blob enrollment
  connects to an enrolled account with its token never shown
  or listed, and refuses an unknown account or a non-Blob
  token; standalone mode (no flow parameters) returns to the
  connect guide; an unknown enrollment kind refuses.
- Neighbor suites green (AUD-AZ consent non-regression):
  `tests/unit/oauth-handlers.test.js`,
  `tests/unit/connect-page.test.js`,
  `tests/unit/front-door.test.js`,
  `tests/unit/connection-page.test.js`,
  `tests/unit/oauth-core.test.js`,
  `tests/unit/oauth-revocation.test.js`,
  `tests/unit/token-store.test.js`,
  `tests/unit/tokens.test.js`,
  `tests/unit/token-scoped-probe.test.js` — 75 tests.
- `npm run check` green; the change rides the 2026-11-01
  00:01 MDT nightly promotion (no daytime promotion).
