# AUD-AY — Docs/catalog shadow pass: the sign-in cleanup program, closed on paper

**Baseline inspected:** main `d1d54f5` (AUD-AX, #371). Design source:
the sign-in cleanup dossier of 2026-10-31
(`signin-cleanup-dossier-2026-10-31.md`, coordinator copy in the audit
goal files), where this card is AUD-AW, renumbered to AUD-AY by the
coordinator addendum at the dossier's head. Method: the 2026-10-31
documentation audit's (AUD-AN) — code is ground truth, every claim
re-measured, historical/dated records are not rewritten (dated
addenda only where a stale claim misstates current behavior a reader
would act on).

**The gap.** The documentation audit re-based the living docs
*before* the cleanup cards landed, so the docs described a sign-in
that has since been replaced: a setup page that no longer exists,
profile/mode/listing picked at consent, owner review/apply/reveal on
a page, and pre-program tool counts. This card is the shadow: it
brings the docs, the catalog, the register and the repo's own rules
file back into truth with the shipped state, and closes the program
on paper.

**Registry, re-measured from the code at the baseline** (not copied
from any brief): 253 registered / 254 catalog rows
(`scripts/check-catalog.mjs` passes: "254 catalog tools, 253
registered"); cumulative profile visibility read_only 103 / everyday
144 / full 253; lowest profile read_only 103 / everyday 41 / full 109
(was 96 before the thirteen cleanup tools, all full-profile). Front
door (`scripts/check-budgets.mjs`, exit 0): membership
`src/data/front-door.json` v2, 33 tools; listings read_only 3,617 /
everyday 4,514 / full 4,894, each under the OP-1 cap of 5,000. Route
inventory re-run against the new tree: 22 route files under `api/`
(incl. `api/health.js` and `api/oauth/enroll.js`), no setup route;
the string `/api/vercel/setup` appears in `src/` + `api/` only in
comments and the absence pin.

## What changed

**Code prose (live user-facing strings only; tests verified to pin
none of them):**

- `src/data/dashboard-map.js` — the team-delete guide's location
  label "This server's setup page" → "This server: the owner's
  connection" (AUD-AX scope-note leftover #1).
- `src/tools/dev-integration.js` — the two "owner setup" next-steps
  now name the tools: `vercel_protection_get` for protection review,
  `vercel_protection_create_bypass` on the owner's connection for the
  bypass request (AUD-AX scope-note leftover #2).
- `src/tools/profile-draft.js` (×3, filed forward by AUD-AV) — the
  draft never had a setup-page home (the page carried no profile
  section): env names are split per target by recording each target's
  names in a separate draft; activation is storing the profile with
  `vercel_workflow_project_setup`, in both the APP-NEEDS text and the
  result note.
- `src/tools/workflow-project-setup.js` — the inverse note "Remove
  the draft profile row on the setup page" was unexecutable (no
  delete method exists for `known_apps` rows; the db only upserts):
  it now states the truth — the row remains stored as an inert draft
  (status draft activates nothing).
- `src/vercel/box.js` — the token seat's beyond-ceiling step now
  names enrolling a broader credential through the sign-in flow's
  enrollment branch.
- `src/tools/owner-proposals.js` — the removal plan text now says a
  token is enrolled through the sign-in flow.
- `src/tools/globalconfig-remaining.js` (×2) — the create-token
  preview and tool description now name the shipped delivery: issued
  as a one-time secret (the apply path issues via
  `oneTimeSecrets().issue`, `ownerRevealRef`, 600 s TTL — verified in
  source), revealed once through `vercel_reveal_one_time_secret`.
- `src/db.js` — the Appliance Desk seed note: the private Blob
  stores join `owned_stores` when the owner connects them through
  Blob enrollment in the sign-in flow.
- `src/vercel/tokens.js` (×4) — probe-failure remedies that told the
  reader to "review the connection in owner setup" now name the
  sign-in flow (these surface in enrollment results).

Code comments that still mention the page (file headers in
`src/tools/owner.js`, `src/tools/protected.js`, `src/db.js`,
`src/vercel/owner-approvals.js` and similar) were deliberately left:
they are not user-facing prose, and the D9 refusal texts that say the
pending-input path "was removed with the owner setup page"
(AUD-AV's own shipped wording) are truthful history inside a refusal.

**Living docs corrected to the shipped shape:**

- `README.md` — 253 of 254 registered; the O-5b export is delivered
  by `vercel_export_owner_data`; one sentence records the program.
- `docs/CLIENT-CONNECTIONS.md` — enrollment via the sign-in flow's
  enrollment branch (§"Never" line, credential bullet); the consent
  bullet now states account + passphrase only, with profile/mode/
  listing derived (door / account production switch / front door) and
  enforced server-side; desktop sign-in selects the account only;
  mobile text names the sign-in page; the RTC paragraph issues via
  `vercel_issue_pass` or `vercel_create_pass` +
  `vercel_apply_owner_approval`, bearer via
  `vercel_reveal_one_time_secret`; the diagnose table compares against
  `vercel_whoami` and revokes via `vercel_revoke_connection`
  (owner-applied) / `vercel_revoke_pass`.
- `docs/OWNER-GUIDE.md` — "Built since" note at 253 of 254 plus the
  program sentence; the preview-settings row's chosen Secret value is
  set in the Vercel dashboard (or generated), never chat; the V-5
  row's test key is a one-time secret on the owner's connection; the
  Batch B row applies on the owner's own connection with
  `vercel_apply_owner_approval`, passphrase never a tool argument; the
  pass row is issued with `vercel_issue_pass`, bearer delivered once
  as a one-time secret.
- `docs/START-HERE.md` — the status paragraph names the one OAuth
  sign-in (derived issuance, enrollment in the flow, owner
  administration on the owner's connection); the code map's `api/`
  and `src/vercel/` entries name the shipped files (OAuth authorize +
  enroll branch, `vercel/connect.js`, `vercel/integration.js`,
  `login.js`).
- `docs/DEPLOY.md` — §4: `ADMIN_PASSPHRASE` guards OAuth
  authorization and the enrollment branch; `TOKEN_ENCRYPTION_KEY`
  encrypts stored credentials and one-time secrets (owner sessions no
  longer exist). Intro: a fresh account starts in preview; read-only
  is a switch, not a connection kind. §5 rewritten to the shipped
  flow: enroll from `/connection` through Door 2 to
  `/api/oauth/enroll`; passphrase proven per request (no session),
  shared lockout; IN-04 token-choice text kept verbatim; probe +
  scope read-back before storage, declared-vs-probed stated in plain
  words, broader-than-intended acknowledgment; 253 registered tools;
  enrollment does not record expiry (VMCP-003 remainder kept). The
  trailing paragraph is replaced with the D9 truth: no setup page, no
  pending-input channel; a chosen Secret value is set in the Vercel
  dashboard or generated server-side; created secrets are one-time
  secrets revealed once with `vercel_reveal_one_time_secret`. §6
  step 3: account + passphrase only, derivation stated, read-only via
  `vercel_set_read_only`. §7: "Sign-in or enrollment unavailable /
  HTTP 503"; the no-tools row reads `vercel_whoami`'s derived values.
  §8 step 2: passes issued with `vercel_issue_pass`, bearers via
  `vercel_reveal_one_time_secret` (the live link to the deleted route
  is gone); step 5 revokes with `vercel_revoke_pass`. (§9, the AUD-BA
  runbook, was verified accurate as built — untouched.)
- `docs/ARCHITECTURE.md` — baseline line gains the AUD-AY re-base;
  the Authentication row: account + passphrase in the consent UI,
  mode/profile/listing derived at issuance; the module list names
  `login.js` (the deleted `setup.js` is gone) and gains the AUD-AU
  pass-admin modules; the credentials bullet enrolls via
  `/api/oauth/enroll` with probe + scope read-back; the env paragraph
  guards OAuth authorization and the enrollment branch. (The
  `SCHEMA_TABLES` count of 19, `pending_inputs` included, stays
  correct — the table remains for the retention sweep.)
- `docs/GO-LIVE-CHECKLIST.md` — protected-projects row: the owner's
  connection (`vercel_add_protected_resource` /
  `vercel_clear_protected_resources`); Blob row: the enrollment
  branch (disconnect via `vercel_disconnect_blob_store`), the
  "None connected" state unchanged; Sandbox row: inspect/apply on the
  owner's connection with `vercel_apply_owner_approval`; scratch row:
  dashboard + enrollment branch (historical fixture facts unchanged);
  the B-8 default-account row keeps its [x] and its 2026-10-30
  exercise fact, reworded to name the historical surface as of its
  date and the current proposal + apply path. Dated header lines
  ("Verified through secure owner setup 2026-10-13") are historical
  records and are not rewritten.
- `docs/TOOL-CATALOG.md` — the header's built-vs-planned paragraph
  is consolidated to the final counts (the AUD-AQ/AS/AT/AU rider
  chain is retired) with a closing pointer for dated notes; the
  Totals paragraph is re-measured (103/41/109, cumulative
  103/144/253); the `vercel_list_accounts` row, the protected
  resources note and the `vercel_create_pass` row name the owner's
  connection and the apply/reveal tools; the Blob section intro names
  enrollment in the sign-in flow; the N-3 build note gains a dated
  D9 supersession; a closing AUD-AY note after the AUD-AV note
  records the program's final state. Dated build-era notes (B-5, B-8
  close-out, IN-08 #109, O-3, AUD-I S3/S5) stand as their dates'
  record, closed by the AUD-AV note and this card's header pointer.
- `AGENTS.md` — the two stale factual lines AUD-AV filed: created
  secrets are one-time secrets revealed through
  `vercel_reveal_one_time_secret`, and secret inputs never travel in
  chat or tool arguments (a chosen value is set in the Vercel
  dashboard or generated server-side; the `pending_inputs` channel
  was removed in AUD-AV/D9); "or setup page" → "or on the connection
  page" in the configurable-by-default rule. No rule statement
  changes.
- `docs/DECISIONS.md` — a dated program entry (2026-10-31) gives the
  D1–D9 decision set its decisions-log home.
- `docs/MCP-AUDIT-2026-10-27.md` — one tail addendum (this card):
  gate items 1.2/1.3/2.1/2.2 closed in source, 1.4 partial, the owed
  live evidence listed. No dated entry edited.
- `docs/implementation-guidance/README.md` + `REMAINING.md` —
  stacked 2026-10-31 re-base notes per their convention (snapshot
  bodies untouched): the program, the final counts, what remains
  (live acceptance program incl. the promotion-night evidence list,
  R-2 leg, R-3, X-2, CAP-5/UA-18).
- Outside the repo: the connector doc's consent sentence
  (`~/workspace/custom-connectors/custom.vercel-mcp/CONNECTOR.md`)
  is corrected to the derived-issuance shape in the same pass
  (coordinator follow-up folded into this card's scope).

## The program's final state (recorded, per the card's brief)

Cards and PRs: AUD-AZ one sign-in (#356), AUD-AR enrollment (#362),
AUD-AS envelope apply (#365), AUD-AT account tools ×8 (#366),
AUD-AU pass/reveal tools (#369), AUD-AV setup deletion (#370),
AUD-AQ read-only switch (#360), AUD-AW handoff hardening (#349),
AUD-AX front-door polish (#371), AUD-AY this shadow. Companions from
the same gate package: AUD-AP health endpoint (#363), AUD-AO
retention clocks (#354), AUD-BA the 3AM runbook (#368). Thirteen new
tools; registry 240 → 253; catalog 254 rows.

Gate-item dispositions (dossier §6): **1.1** route inventory — the
§1 inventory was the program's map; the post-build inventory diff is
owed (below). **1.2** setup off the public surface — discharged
stronger: the route is deleted. **1.3** developer grants gone from
the sign-in surface — discharged (AUD-AW + AUD-AZ). **1.4** only
partially discharged: TEST-pass issuance is owner-only; the item's
own probes remain a gate-run task. **2.1** one sign-in — discharged.
**2.2** no sign-in modes/classes — discharged. **2.3** read-only as
the user's own switch — mechanism discharged (AUD-AQ); the live flip
test is owed. **2.4** production switch preserved — discharged.
**2.7** IN-04 preserved; VMCP-003's live notify-ahead proof is NOT
discharged by this program. **5.1** the owner export's named home is
`vercel_export_owner_data` — discharged. **9.5** no doc promises a
removed surface — discharged by this card.

**Evidence still owed post-promotion — listed, NOT claimed:**
both-address keyless 404 on `/api/vercel/setup` plus a setup-link
grep of the `/` and `/connection` HTML; an authorize-page render
capture; the gate-2.3 flip test (flip → write refusal → flip back →
write succeeds, both flips visible in `vercel_recent_changes`);
journal sampling (no pass or grant issued outside the owner's
connection since the train); a walk-the-flow from `/connection` as a
fresh user; the post-build inventory diff (code route count =
inventory count, setup row absent).

**Candidate findings filed, not fixed** (a doc-vs-code disagreement
that looks like a code bug is never fixed on either side of a docs
card): (1) `scripts/check-budgets.mjs` prints the everyday listing
label as `/<20000` while the enforced bound (`LISTING_TOKENS_MAX`)
is 25,500 — cosmetic code-side staleness, carried from the AUD-AN
audit. (2) `docs/pr-cards/work-index.json` statuses lag the
build-out (68 cards: APPROVED 34 / MERGED 19 / IN_PROGRESS 15) — a
dedicated reconciliation pass is recommended; this card does not
touch the index (AUD cards carry no entries, per the AUD-AK
precedent).

## Drift checklist B

This PR changes `src/` prose and `docs/`: it carries this card and a
`docs/STATUS.md` bullet in its first commit, and
`docs/TOOL-CATALOG.md` changes in the same PR (required because
`src/tools/dev-integration.js` is a tool module ≠ index.js — the
catalog's living rows and closing note are updated above). No tool
is added, removed or renamed; no registry, profile or budget change.

## Evidence

- Registry/catalog re-measured from code at the baseline:
  `scripts/check-catalog.mjs` passes ("254 catalog tools, 253
  registered"); profile counts read from the registry directly
  (cumulative 103/144/253; lowest 103/41/109);
  `scripts/check-budgets.mjs` exit 0 (front door 33 tools; listings
  3,617 / 4,514 / 4,894).
- Route inventory re-run: 22 files under `api/`; no setup route;
  the `/api/vercel/setup` string survives in `src/` + `api/` only in
  comments and the AUD-AV absence pin.
- Focused unit suites for every touched prose surface: 20 files /
  148 tests, exit 0 (profile-draft, workflow-project-setup,
  app-profiles, box-report, working-box-flip, owner-proposal-contract,
  token-store, token-scoped-probe, tokens, the five globalconfig
  suites, account-observability, admin, workflow-app-readiness,
  connect-page, oauth-handlers, registry).
- `BASE_SHA=$(git rev-parse origin/main) npm run check` — exit 0,
  read directly from the command, not a pipe.
- Pre-push marker grep (`git grep -n -E '^(<{7}|\|{7}|>{7})' -- .`):
  no hits.
- CI at the exact head: recorded on the PR.
