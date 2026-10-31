# AUD-AT — Account tools for the form-only owner actions

**Card ID:** this is the sign-in cleanup dossier's account-tools
card (its §2.5 family, drafted there as "AUD-AS"), executed as
**AUD-AT** per the coordinator's Addendum 1 (2026-10-31) on that
dossier — the AUD-AS ID belongs to the envelope-apply card.

**Baseline inspected:** main `e9141020` (AUD-AS, #365). Source of
the design: the sign-in cleanup dossier (2026-10-31) §2.5, under
the owner's 2026-10-31 sign-in hygiene ruling: owner-setup is
REMOVED, not relocated; owner administration lives on the owner's
authenticated connection or in Vercel's own console.

**The gap.** Eight owner actions existed only as forms on the
setup page: export owner data, set purchase policy, set the
no-expiry attestation, set production strictness, add a protected
resource, clear protected resources, recheck the stored token,
disconnect a Blob store. When AUD-AV deletes the setup route,
every one of them strands — including the export (the owner's own
data, O-5b) and the Blob disconnect that pairs AUD-AR's
enrollment-time connect.

**The change.** Eight new tools (`src/tools/account-settings.js`,
registry 242 → 250, all full-profile), each carrying its form's
validations verbatim (src/vercel/setup.js; the setup suites are
the parity fixtures — ported, not paraphrased):

1. **Envelope family** (the four actions whose page tier was a
   fresh passphrase entry) — `vercel_set_purchase_policy`,
   `vercel_set_token_no_expiry`, `vercel_set_production_strictness`,
   `vercel_clear_protected_resources`: `defineWrite` proposals
   (approvalOnly) over a new envelope store
   (`src/vercel/account-settings.js`, kind `owner_account_setting`),
   mirroring `owner-approvals.js`; applied by
   `vercel_apply_owner_approval` through a new family branch in
   `src/vercel/owner-apply.js` (consume single-use → compare →
   the same db setters the page calls, journaling unchanged). One
   additive db read, `getAccountSettingRequest`, modeled on
   AUD-AS's `getProductionEnableRequest`. The remove-all
   acknowledgment of the clear form becomes the proposal's plan
   text. The purchase policy's arguments are cents-native (the
   stored shape the db setter validates; the form's dollar parsing
   is a form concern).
2. **The tokenVersion binding.** The attestation envelope is
   bound to the token version current at proposal: a caller may
   name the version (validated against the enrolled row — a stale
   one refuses at proposal with the page's rotation-remedy
   wording); when omitted, the current version binds server-side
   (no tool surface displays it). At apply, the db setter's own
   version predicate is the truth: a rotation in between returns
   false and surfaces **unverified**, never an attestation of the
   replacement token — the AUD-E property, preserved. The bound
   version travels in the envelope and the write-path before-image
   as `boundVersion`: the audit screen refuses credential-shaped
   keys (`token*`) in journaled data, and the envelope's format
   field already owns the name `version`.
3. **Direct family** (the four actions whose page tier was
   passphrase-plus-confirm) — `vercel_export_owner_data`,
   `vercel_add_protected_resource`, `vercel_recheck_token`,
   `vercel_disconnect_blob_store`: plain handlers hard-gated to
   `connection.kind === 'connector'`, AUD-AS's wording — a
   delegated pass can never perform them. The export keeps the
   O-5b invariant exactly: `buildOwnerExport` → the change_log row
   → the stored result, in that order; a journal failure stores
   nothing and the stored body is shape-identical to the page's
   export for the same store. Add-protected makes the page's db
   call and journal row verbatim except the note, which names this
   surface truthfully ('Owner protected via owner connection'; the
   db records source 'setup_page' for both paths — that label is
   AUD-AV's to retire). Disconnect mirrors AUD-AR's store-ID bound
   and the page's outcome texts, with the page's no-journal parity.
   The recheck is the owner-surface twin of the page action (same
   `recheckStoredToken` probe), full-profile only by the profile
   contract (`localAdmin` cannot ride a read); `vercel_check_token`
   keeps its all-profile read unchanged.
4. **Registration:** the namespace joins the registry after
   `ownerApplyTools`; the seven writes join `LOCAL_OWNER_TOOLS`
   (the recheck is a read and does not). No front-door seats
   (AUD-AQ/AS precedent); descriptions ≤160 chars; budgets
   unaffected (full-only tools).

**Not touched:** `buildOwnerExport`'s projections; the db setters
(three header comments updated where this card makes their
"setup only / never through a tool" wording untrue — the envelope
path is now a second owner-proofed caller, and the comments say
so); `handleSetup` and its forms, which keep working until AUD-AV.

**Acceptance — evidence.**

- Unit (`tests/unit/account-settings.test.js`, 22 tests): per-tool
  parity against the page actions — the export's journal-first
  ordering proven (a recordChange that throws for the export tool
  stores nothing and serves the page's failure text; the stored
  body deep-equals `buildOwnerExport`'s output for the same stub
  store, planted secret values absent); stale-version refusal at
  proposal with the page's remedy; rotation between proposal and
  application → unverified, attestation unchanged; invalid budgets
  and strictness words refuse; the pass-kind boundary for the
  direct tools through the real dispatch; the recheck's
  full-profile-only visibility through dispatch.
- Db (`tests/db/account-settings.test.js`, 7 tests, throwaway
  Postgres): all four envelope families propose → cross-account
  refusal (unconsumed) → inspect → apply → the db setter's own
  journal row exactly once (isolated by its exact summary, AUD-AS's
  rule), replay refuses; the rotation leg on real rows; the direct
  tools land their rows (export journal + stored result with no
  token material, protection rule with its note, Blob row deleted
  and the second disconnect reporting not-found).
- The pinned registry list (250), the front-door full-catalog
  count (250) and the catalog (251 rows; section 23 → 31) are
  updated in this PR; `npm run check` green locally before push.

**Sequencing.** Merges after AUD-AS (the apply tool it routes
through) and before AUD-AU (pass issuance/reveal) and AUD-AV
(setup route deletion — the forms stay live until then, so both
surfaces coexist for exactly one wave, by design).
