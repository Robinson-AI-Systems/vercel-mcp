# AUD-BU — Documentation reconciled against code and production (audit filing)

Owner's order, 2026-11-02: "audit the repo documentation against
the codebase and production, and update it accordingly. If any
remaining acceptance gates or other work exists, handle it."

## Scope and method

Baseline: `main` at `00b8ddbd4858d442028c10cd23fa31d566e260bf`
(PR #408); production `live` at `4dd4e8b` (SR-6). Production facts
were re-verified firsthand before any doc was judged: `/api/health`
(200, 253 tools, deployed SHA = live), `/api/contract` (rtc 1;
253 tools / 150 writes / 22 money), the authorization-server
metadata on the branded origin, the `/connection` page text, the
root product document, `/api/vercel/setup` answering 404, and the
ten production environment variable NAMES on the vercel-mcp
project (values never read). Code facts were read at the baseline
head (`SCHEMA_TABLES`, `signinConfig`, `integration.js`,
`evaluateLogin`, the dev-authorize handler).

Coverage is declared, per the fleet's degraded-pass rule: this is
a **single-cartographer** pass. Fully reconciled: README,
ARCHITECTURE, CLIENT-CONNECTIONS, DEPLOY, MASTER-ROADMAP,
GO-LIVE-CHECKLIST, PRODUCT-AUTHORITY-AUDIT, APP-NEEDS-APPLIANCE-DESK,
AI-PR-READ-FIRST, OWNER-INPUTS, PLAN, RTC-HUB-INTEGRATION,
HUB-COMPATIBILITY, DEVELOPER-ACCESS, OWNER-GUIDE, START-HERE,
STATUS (head), the audit register, DECISIONS (dated history —
stands). Not line-reconciled: STATUS's dated history below the
head bullets, the pr-card set and the BATCH designs (dated build
records; they stand as written at their dates), `archive/`, and
the generated surfaces (TOOL-CATALOG, OPERATION-LEDGER — enforced
byte-stable by `npm run check`, current by construction).
`docs/developer-evidence.json` still carries the 2026-10-15
seeded evidence; the 35-task session queue it feeds is reconciled
as a stale ledger of owner-fixture-gated items, not 35 live orders.

## Findings (all fixed in this PR)

1. **ARCHITECTURE** — `SCHEMA_TABLES` stated as 19 with
   `signin_flows` missing (actually 20); the authentication row
   described the pre-SR passphrase consent and door-derived
   profile; the environment section said `ADMIN_PASSPHRASE`
   "guards OAuth authorization and the enrollment branch" (it now
   gates only `/api/dev/authorize` + `/api/dev/enroll`); the RTC
   row predated AUD-BM3's executed-write proof; the external-proof
   row predated O-2.7 / A-13 / BM3; the CI row cited PR #219 as
   its proof point.
2. **CLIENT-CONNECTIONS** — the native-OAuth section instructed
   users to enter the administrator passphrase at consent; wrong
   for the public journey since SR-2/SR-6. Rewritten as the
   public-vs-developer split.
3. **DEPLOY** — §4 listed 4 of the 10 production env variables;
   §5 walked the owner through passphrase enrollment as the public
   path; §6 step 3 contradicted §5 (preview start, door-derived
   profile, passphrase at consent) — all stale post-SR-6; §7's
   lockout row now scoped to the developer route.
4. **MASTER-ROADMAP** — "240 of 241 catalog tools" (actually 253
   of 254); CAP-1's ledger "unbuilt" (built, AUD-BE #375); R-3
   conformance "open" (executes in CI, AUD-BG; index MERGED);
   V-4/V-5 shown IN_PROGRESS (index: MERGED); R-2 framing updated
   to the BM3/AUD-BT state.
5. **GO-LIVE-CHECKLIST** — the IN-09 row still stated the
   pre-AUD-BD posture (new rows default production-off); header
   checkpoint refreshed from 2026-10-19.
6. **PRODUCT-AUTHORITY-AUDIT** — remedied by a dated 2026-11-02
   verdict addendum (this document's own convention): UA-05's
   residual discharged by AUD-BD, UA-06's issuance note corrected
   (owner connection tools; no passphrase), UA-14's owner desktop
   acceptance recorded as proven live, UA-15's R-3 closed, and the
   closing matrix's core rows discharged on the STATUS filings'
   evidence. History preserved; no old row edited.
7. **README** — status paragraph predated the SR cutover going
   live, the O-2.7 closure, the A-13 closure and the scratch
   deletion; refreshed.
8. **APP-NEEDS-APPLIANCE-DESK** — three references to the deleted
   setup page (profile IDs, `protected_sandboxes`, the V9 check)
   re-pointed at the profile record / the Vercel dashboard.
9. **AI-PR-READ-FIRST** — rule 7 named two removed channels
   ("tokens enter only through the setup page; secret inputs only
   through `pending_inputs`"); corrected to the enrollment branch
   and the dashboard/generate routes.
10. **OWNER-INPUTS** — IN-03/IN-05/IN-15 gained dated UPDATE notes
    (history preserved).
11. **PLAN** — CAP-1 verdict corrected in both places it appears;
    a dated reconciliation note covers the setup-page /
    pending-inputs criteria lines in the early batches.
12. **RTC-HUB-INTEGRATION** — pass issuance/revocation re-pointed
    from "signed-in owner setup" to the owner's connection tools;
    the "no actual owner pass recorded" line updated for the R-1
    discharge (2026-11-01) and the 2026-11-02 pass legs.
13. **START-HERE** — code map now names `signin.js`, the dev
    routes and the 20-table schema.

## Filings in this PR

- **A-13 fully closed** in the register: the RAS Acceptance
  Scratch team was deleted 2026-11-02 on the owner's word through
  `vercel_team_delete` and verified gone (403 on read-back;
  visibleTeamCount 2 → 1; project count unchanged). The Pro Trial
  never converts. All five owner steps are complete; the daily
  owner-steps reminder cron was retired. A-11's second-team
  premise is moot unless a fresh scratch team is created.
- **Four gate items discharged live** (production at 4dd4e8b):
  O-1.7 leak sweep (PASS — repo hits are documented non-secrets;
  public surfaces clean), O-7.1 owner export (PASS — stored,
  journaled first, handle retrievable), O-4.1 pass rate limit
  (PASS — 5/min TEST pass: 5×200 then 429 `rate_limited`,
  Retry-After 60; revoked after), O-4.2 dev-door lockout (PASS
  from a fixed-IP source — 5×401 then 429, Retry-After 900; the
  coordinator VM's egress rotates source IPs, so the probe is
  only meaningful from a fixed-IP source — recorded as an
  environment fact, not a defect).
- **D-2 runtime-log leg retested** on the current production
  deployment: the same ~13 s provider-latency timeout, honestly
  rendered as `outcome_unknown`. No code conviction; the leg
  stays open.

## Remaining work, named (not closed by this filing)

Owner-sitting only: O-2.4/CAP-5 two-tenant acceptance; O-2.5
AUD-BI live expiry proof (next fresh enrollment); O-2.6
replayed-refresh probe (sacrificial OAuth client); O-7.2 Neon
PITR (dashboard read); Tier-1 A-2/A-4/A-5/A-9/A-12 (Door-1 install
cycle each); X-2 re-stage (owner-minted token). Buildable:
AUD-BS (branch G's `projectSettings` layer; fixture + run
retained), AUD-BT (pass-door typed outcomes; carries BM3's
priced-refusal atom), AUD-BM1 (parked PR #392, revives after
AUD-BT). VMCP-008 stays open with no buildable content
identified. Live debris with no tool path (the cleanup-blocked
BM3 project and its run, the orphaned VMCP-016 run, two inert
DCR registrations, three unconfigured integration configurations)
clears via the owner's dashboard or a future guarded extension.

No code, no tools; registry unchanged at 253; TOOL-CATALOG
untouched. Batches with the release train.
