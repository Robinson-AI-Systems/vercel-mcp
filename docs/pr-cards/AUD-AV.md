# AUD-AV — Delete the setup route

**Card ID:** this is the sign-in cleanup dossier's setup-deletion
card (its §2.5/§2.6, listed there as "AUD-AQ"), executed as
**AUD-AV** per the coordinator's Addendum 1 (2026-10-31) on that
dossier. It is the deletion every prior cleanup card prepared:
AUD-AZ (one sign-in), AUD-AR (enrollment in the sign-in flow),
AUD-AS (`vercel_apply_owner_approval`), AUD-AT (the eight account
tools), AUD-AU (pass issuance/revocation/reveal as tools), AUD-AQ
(the read-only switch) and AUD-AW (developer-handoff hardening)
are all on main, so no owner function lives only on the page any
more.

**Baseline inspected:** main `7fe3b62` (AUD-AU, #369). Source of
the design: the sign-in cleanup dossier (2026-10-31) §1B/§1C/§2.5,
under the owner's 2026-10-31 ruling: owner-setup is REMOVED, not
relocated — no hidden, unlinked, renamed, or local successor
route. Owner administration lives on the owner's authenticated
connection (the account/apply/pass/reveal tools) or in Vercel's
own console.

**The gap.** `/api/vercel/setup` was the server's original owner
surface: a passphrase-session page carrying 28 POST actions —
token enrollment, Blob enrollment, envelope review/apply, pass
issuance, account settings, protected resources, one-time reveal,
and the protected pending-input vault. Each action has since been
replaced on the owner's connection or in the sign-in flow; the
page, its session machinery (`rmcp_owner` cookie — `handleSetup`
was its only consumer, verified by tree-wide grep), and the
pending-input store's writer/reader are the remaining residue.
The page also remained publicly linked: the shared shell footer
carried an "Owner setup" link on both public pages, and
`/connection` linked to it twice.

**Disposition of the 28 POST actions** (dossier §1B; every action
verified present in the deleted handler and matched to its
replacement before deletion):

| # | Action | Disposition |
|---|--------|-------------|
| 1 | `login` | Dies with the route — the session existed only for the page |
| 2 | `logout` | Dies with the route — same |
| 3 | `add_token` | AUD-AR: enrollment branch of the sign-in flow (`/api/oauth/enroll`, token kind) |
| 4 | `connect_blob_store` | AUD-AR: enrollment branch, Blob kind |
| 5 | `review_owner_request` | AUD-AS: `vercel_apply_owner_approval` (inspect) |
| 6 | `approve_owner_request` | AUD-AS: `vercel_apply_owner_approval` (apply) |
| 7 | `review_purchase` | AUD-AS: same tool (inspect) |
| 8 | `approve_purchase` | AUD-AS: same tool (apply) |
| 9 | `approve_production` | AUD-AS: same tool (production family) |
| 10 | `review_rtc_pass_request` | AUD-AS: same tool (inspect) |
| 11 | `approve_rtc_pass_request` | AUD-AS: same tool (apply) |
| 12 | `set_default_account` | Existing tool `vercel_set_default_account`; form removed |
| 13 | `set_spend_limit` | Existing tool `vercel_set_spend_limit`; form removed |
| 14 | `revoke_connection` | Existing tool `vercel_revoke_connection`; form removed |
| 15 | `remove_account` | Existing tool `vercel_remove_account` (AUD-AA); form removed |
| 16 | `disconnect_blob_store` | AUD-AT: `vercel_disconnect_blob_store` |
| 17 | `export_owner_data` | AUD-AT: `vercel_export_owner_data` |
| 18 | `set_purchase_policy` | AUD-AT: `vercel_set_purchase_policy` |
| 19 | `set_token_no_expiry` | AUD-AT: `vercel_set_token_no_expiry` |
| 20 | `set_production_strictness` | AUD-AT: `vercel_set_production_strictness` |
| 21 | `add_protected` | AUD-AT: `vercel_add_protected_resource` |
| 22 | `clear_protected` | AUD-AT: `vercel_clear_protected_resources` |
| 23 | `recheck_token` | AUD-AT: `vercel_recheck_token` |
| 24 | `issue_rtc_pass` | AUD-AU: `vercel_issue_pass` (`writes: false`) |
| 25 | `issue_rtc_write_pass` | AUD-AU: `vercel_issue_pass` (`writes: true`) |
| 26 | `revoke_rtc_pass` | AUD-AU: `vercel_revoke_pass` |
| 27 | `reveal` | AUD-AU: `vercel_reveal_one_time_secret` |
| 28 | `pending_input` | **Removed outright (dossier D9)** — see below |

**The change.**

1. **The route and the handler are deleted.** `api/vercel/setup.js`
   and `src/vercel/setup.js` (1,212 lines: the page, the
   `rmcp_owner` session, CSRF, login lockout wiring for that
   surface, all 28 action branches) are removed. vercel.json has
   no rewrite for the route — the file path was the route — so
   the path now 404s like any unknown path. The post-deletion
   live 404 on both public addresses is a promotion-night probe,
   not this card's claim.
2. **Every public reference is removed** (dossier §1C, verified
   one by one): the shell footer's "Owner setup" link
   (`src/front-door.js`, rendered on both public pages); the two
   setup links on `/connection` (`api/connection.js` — the passes
   paragraph now names `vercel_issue_pass`/`vercel_revoke_pass`,
   the disconnect paragraph names `vercel_revoke_connection`);
   the root page's "authenticated setup page" copy
   (`api/index.js`). Items §1C #4/#5 were already resolved by
   AUD-AR/AUD-AZ. A tree-wide grep pin joins the test set: no
   `/api/vercel/setup` reference anywhere in `src/` or `api/`.
3. **`pending_input` is removed (D9, decided).** The writer/reader
   service (`src/core/pending-inputs.js`) and the db methods
   `insertPendingInput`/`consumePendingInput` are deleted. The
   `pending_inputs` TABLE stays (additive-only schema rule;
   AUD-AO precedent): its rows expire unconsumed under AUD-AO's
   180-day sweep, the removal cascade and the owner-proposal
   counts that read it are untouched. The six tool input paths
   that consumed pending inputs lose the parameter; passing it
   now refuses by name with the guided remedy, per the dossier:
   - secret env values (`vercel_env_set`, `vercel_env_set_many`,
     `vercel_shared_env_set`, `vercel_dev_wire_preview_env`):
     a chosen secret value is set in the Vercel dashboard
     (Project Settings → Environment Variables) or generated
     server-side with `generate` — the tools' remaining source;
   - deployment-protection password (`vercel_protection_set_password`):
     setting or changing the password is done in the Vercel
     dashboard (Project Settings → Deployment Protection);
     on/off and scope changes that need no new password are
     unaffected;
   - domain purchase / transfer-in (`vercel_registrar_buy`,
     `vercel_registrar_transfer_in`): the registrant contact (and
     the transfer auth code) can no longer be supplied, so both
     refuse with the remedy — complete the purchase/transfer in
     the Vercel dashboard under Domains. `vercel_registrar_renew`
     without a contact input proceeds exactly as before; with
     one it refuses with the same remedy.
   The raw-value refusal is unchanged everywhere (a secret value
   in chat was never accepted). `resolveVercelInput`'s pending
   branch (a reader path with test-only callers) is removed with
   matching wording. The setup workflow's value-needed follow-up
   (`vercel_workflow_project_setup`) and the universal write
   tool's refusal texts (`vercel_api_write`) no longer point at
   the deleted vault.
4. **Dead-surface copy is repointed where it instructed the
   deleted page.** Created-secret delivery texts (token create,
   webhook create, protection bypass/share links, dev test
   webhook, project transfer) now name the actual delivery path,
   `vercel_reveal_one_time_secret` (AUD-AU). Token-rotation
   next-steps (error classification, whoami expiry warning) name
   the enrollment step of the sign-in flow. Blob guidance
   (`SETUP_STEPS`) names the enrollment branch.
   `vercel_enable_production`'s strictness refusal names the
   AUD-AT path (propose with `vercel_set_production_strictness`,
   apply with `vercel_apply_owner_approval`). Stale comments that
   cited `src/vercel/setup.js` as a living module are corrected.
5. **`PROTECTED_DEFAULTS` moves** from the deleted module to
   `src/db.js` beside `seedProtectedProjects` (its only consumer
   is the db test's pin that the defaults are empty, IN-07).

**Catalog judgment.** No tool is added or removed (registry
stays 253); the TOOL-CATALOG changes on this card are the prose
rows of the tools whose input paths or delivery texts changed
(env set/batch, shared env set, dev preview env, protection
password, registrar buy/renew/transfer, webhook create). The
remaining historical "setup page" mentions in long-form docs
(DEPLOY, CLIENT-CONNECTIONS, ARCHITECTURE, designs) are AUD-AY's
docs-shadow accounting, not this card's. One follow-up is filed
for AUD-AY: the repo AGENTS.md line "secret inputs come from the
setup page (pending_inputs)" is stale under D9 — the ruling
removed the page, and the line's intent (no secret ever travels
in chat or tool arguments) is carried by the raw-value refusals
and the console remedies above. Two copy leftovers are filed
for AUD-AX rather than this card: `src/tools/profile-draft.js`
still points owners at a "setup page" for profile drafts (the
page never had a profile section — the text was always stale),
and the seeded Appliance Desk profile text in `src/db.js`
says apps are "named on the setup page" (seeded data, left
untouched here).

**Must-not-touch, honored.** The envelope/pass/secret stores'
shapes and TTLs are unchanged; AUD-AR's enroll branch, the
apply/issue/reveal handlers and AUD-AZ's OAuth derivation are
untouched; no tool's provider behavior changes beyond the
removed input path and its refusal text; the `pending_inputs`
table, AUD-AO's sweep leg, AUD-AA's removal cascade and the
proposal removal counts all keep reading the table as before.

**Test accounting — every deleted or reworked suite.**

Deleted with the page (their subject was the page itself; the
validations they carried live on in the replacement suites):

- `tests/unit/setup-page.test.js` (30 tests — login/session/CSRF
  and every form): form validations ported by AUD-AS
  (`tests/db/owner-apply.test.js`, `tests/unit/owner-apply.test.js`),
  AUD-AT (`tests/db/account-settings.test.js`,
  `tests/db/purchase-policy.test.js`,
  `tests/db/token-no-expiry.test.js`,
  `tests/db/owner-spend-limit.test.js`,
  `tests/db/default-owner-account.test.js`) and AUD-AU
  (pass-admin unit/db); the page-only machinery (session, CSRF,
  login lockout on this surface) dies with the surface it tested.
- `tests/unit/protected-setup.test.js` (4): add/clear protected
  via the page → AUD-AT's db coverage
  (`tests/db/account-settings.test.js` add/clear protected;
  `tests/db/protected-defaults.test.js` at the db layer).
- `tests/unit/purchase-owner-setup.test.js` (4): purchase
  review/approve via the page → AUD-AS
  (`tests/db/owner-apply.test.js` purchase family;
  `tests/db/owner-approval-inspection.test.js`,
  `tests/db/owner-approval-application.test.js`).
- `tests/unit/rtc-owner-passes.test.js` (4) and
  `tests/unit/setup-write-passes.test.js` (3): direct pass
  issuance via the page → AUD-AU (`tests/unit/pass-admin.test.js`,
  `tests/db/pass-admin.test.js`).

Reworked (live behavior kept, the page driver replaced):

- `tests/unit/pass-proposals.test.js` /
  `tests/unit/pass-proposals-write.test.js`: approval legs now
  dispatch `vercel_apply_owner_approval` (AUD-AS) instead of
  posting to the page; proposal-side validations unchanged.
- `tests/unit/production-approval.test.js`: the two page-driven
  approval tests are replaced by the apply-tool path (AUD-AS's
  db suite carries the passphrase-receipt application); the
  production-guard behavior tests are unchanged.
- `tests/unit/owner-export.test.js`: the page-action describe is
  deleted; `buildOwnerExport` composition coverage stays, and
  the journaled tool delivery is AUD-AT's db coverage.
- `tests/unit/blob.test.js`: the page connect/disconnect describe
  is deleted (connect → AUD-AR's `tests/unit/oauth-enroll.test.js`
  Blob tests; disconnect → AUD-AT's db coverage); the blob tools
  describe stays, with the unconnected-store expectation updated
  to the enrollment wording.
- `tests/unit/token-scoped-probe.test.js`: the enrollment driver
  now calls the login service's `enrollToken` (the service
  behind AUD-AR's enroll handler) instead of the page; the
  probe-leg coverage is unchanged.
- `tests/unit/secret-vault.test.js` and
  `tests/db/secret-vault.test.js`: the `pendingInputs` describes
  die with the deleted module (D9); the one-time-secret describes
  are unchanged.
- `tests/unit/secret-input.test.js`: the pending-consume case
  becomes a named-refusal case against the resolver; the
  remaining source cases are unchanged.
- Env/protection/registrar suites (`project-env-write`,
  `project-env-batch`, `shared-env-write`, dev preview env,
  `protection`, `registrar`, `registrar-secrets`): the
  pending-input cases become named-refusal cases carrying the
  console remedy; every other case is unchanged.
- `tests/db/protected-defaults.test.js`: import of
  `PROTECTED_DEFAULTS` repointed to `src/db.js`.

Added: `tests/unit/setup-route-absence.test.js` — the route
files do not exist, and no file under `src/` or `api/` contains
the route string (mirrors AUD-AW's link-scan pattern).

**Acceptance — evidence.**

- Targeted suites: every reworked suite run individually green —
  pass-proposals 7/7, pass-proposals-write 4/4,
  production-approval 9/9, token-scoped-probe 13/13,
  protection 17/17, registrar 12/12, registrar-secrets 4/4,
  blob + owner-export + secret-vault (unit) + secret-input +
  the new setup-route-absence pin 19/19 across 5 files, and the
  three copy-pin suites (connection-page, errors, server-tools)
  40/40 after their pins moved to the enrollment wording.
- Full unit suite: 170 files, 1,635 tests, all passed
  (exit 0, isolated run).
- Db suites on a throwaway localhost Postgres: secret-vault,
  protected-defaults, owner-remove-account, retention-sweep and
  schema — 5 files, 21 tests, all passed (exit 0). The
  `pending_inputs` table, AUD-AO's sweep leg over it and
  AUD-AA's removal cascade over it are untouched and green.
- Full check: `BASE_SHA=$(git rev-parse origin/main) npm run
  check` exit 0 (secret scan, docs, index, lint, write-safety,
  budgets, catalog).
- Route-absence proof: `grep -rn '/api/vercel/setup' src/ api/`
  returns nothing; the pin suite asserts the same over the
  whole tree (outside historical docs/cards). The live
  both-address 404 probe is a promotion-night task, not this
  card's claim.
- One skeptic-pass find worth recording: the first transfer-in
  refusal text ran past the preflight refusal screen's
  300-character verbatim bound and would have been masked to
  the generic text; the refusal was shortened and its test now
  pins the dashboard remedy in the delivered reason.
- CI: ci and release-policy both green at the PR head before
  merge (verified in the PR, per the merge rule).
