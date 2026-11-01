# DEPLOY — Owner guide to setting up Vercel by Robinson AI Systems

**Branding/connection status (2026-10-19):** Owner-controlled service display name is **Vercel by Robinson AI Systems** (unofficial and independently operated). Technical IDs, origins, OAuth grants and stored credentials stay stable. Acceptance state no longer lives in this header: the 2026-10-30 acceptance filings in `docs/STATUS.md` record what has been exercised live (A-3/A-6/A-10/A-14/A-15 pass); the formal per-client acceptance matrix remains open. A production deployment/real user action remains separate. (Header updated 2026-10-31, AUD-AN.) The owner-approved directive does not permit unscheduled release, distribution decisions (owned outside this repository) or account changes.


**Already completed, do not provision again:** 2026-10-13 initial hosting and owner credential setup verified. Sections 1–5 below describe the original first-time setup or authorized recovery, not remaining required provisioning. The dedicated Vercel project is READY on the checked `live` revision, dedicated Neon schema initialized and an encrypted, team-scoped Robinson AI Systems credential stored. Public OAuth and RTC metadata respond over HTTPS; authenticated custom MCP, live provider reads/writes and provider revocation were exercised in the 2026-10-30 acceptance pass (verdicts in `docs/STATUS.md`); the formal per-client acceptance matrix remains open; Hub routing/relay/Sandbox testing is Hub-owned. Existing approved setup is not permission for additional provisioning, production writes or spending.

This server has its own Vercel project and Neon database. It must never be installed into Appliance Desk or another existing business project. Start with a restricted Vercel team token; a fresh account is born with its production switch on, so a normal sign-in starts in production mode with a full profile (AUD-BD; the switch remains the account owner's own setting to turn off), and read-only is a switch on the connection, not a connection kind; production writes require a separate approval and additional safety implementation.

## 1. Before starting

- GitHub repo: [Robinson-AI-Systems/vercel-mcp](https://github.com/Robinson-AI-Systems/vercel-mcp). Development happens on `main`; the Vercel production branch is the checked `live` branch (see §3), which the daily job promotes from `main`. Do not point a Vercel project at `main` as its production branch.
- Have access to your Vercel account and to [Neon](https://console.neon.tech/).
- Review [OWNER-INPUTS.md](OWNER-INPUTS.md): IN-02 approves the dedicated Vercel project/Neon database, IN-03 covers owner-managed credentials, IN-04/05 choose token scope/team, IN-07 protects projects, and IN-09 keeps production changes ON with the enable/disable switch in the end user's own hands (ruled 2026-10-27).
- Review the provider's current pricing **before** clicking Create/Upgrade. The intended starting point is a suitable free tier; do not select paid plans or add-ons without a separate decision.
- Keep all passwords, keys, token values and database URLs **out of GitHub, chats, screenshots, terminal transcripts and logs**. Enter them directly in the provider's secret fields. The AI assistant never needs to see their values.

## 2. Create the isolated Neon database (owner approved only)

1. In the [Neon Console](https://console.neon.tech/), create a new project dedicated to `vercel-mcp`. Select a sensible nearby region and a free plan if available and sufficient.
2. In the project's connection details, select the **pooled** connection string (often labeled `-pooler`) for serverless use, with SSL required.
3. Copy the secret PostgreSQL URL directly into the Vercel environment variable `DATABASE_URL`; do not place it in chat or commit it.
4. No manual schema editing or shared database is necessary. Once the deployed server receives an authenticated OAuth request, `src/db.js` runs its additive schema initialization. The automated tests use only disposable Postgres, never the real database.
5. Verify that the database is dedicated to this server, not a business app; keep credentials private and rotate them immediately if accidentally disclosed.

Reference: [Neon deployment and pooled connection example](https://neon.com/blog/authenticating-users-in-astro-using-neon-postgres-and-lucia-auth).

## 3. Create the dedicated Vercel project (owner approved only)

1. Go to Vercel's Add New → Project / Import Git Repository flow, select `Robinson-AI-Systems/vercel-mcp` and the intended team.
2. Use the project name `vercel-mcp`. The project is a plain Node.js (24.x), ES module Vercel Functions application, not Next.js; follow its committed `vercel.json` and `api/` structure. Do not copy it into any other project's root.
3. **For this repository use the checked `live` branch**, not `main`, as the Vercel production branch. The scheduled, guarded daily `main → live` promotion runs at 00:01 America/Denver. Automatic previews are disabled to control build cost. Do not manually deploy, promote or change this policy for a routine PR; an emergency needs separate explicit approval.
4. Avoid installing any additional products, add-ons, integrations or paid services just to deploy this basic server.
5. A custom domain is optional, not a prerequisite. Use an HTTPS URL for this project, not another app's domain. (History: the branded address `vercel.robinsonaisystems.com` was attached on 2026-10-30 as a strictly additive public address, the issuer staying on the original origin. **Superseded 2026-11-01 (AUD-BO, on the owner's ruling): the OAuth identity moved to the branded origin — `PUBLIC_BASE_URL` is now `https://vercel.robinsonaisystems.com`, so the issuer, every OAuth endpoint, the protected-resource metadata and the hosted Muse client document all name that origin. The `vercel-mcp-liard.vercel.app` address remains a serving alias; discovery fetched from it names the canonical branded issuer, by the standing rule that request Host headers never determine OAuth metadata.**)

References: [Vercel GitHub integration](https://vercel.com/docs/git/vercel-for-github) and [project environment settings](https://vercel.com/docs/environment-variables/managing-environment-variables).

## 4. Environment variables — enter values privately in Vercel

In the dedicated Vercel project, open **Settings → Environment Variables**. Set each variable in the intended deployment environments, review the selection, then redeploy so changed values take effect.

| Key | Purpose / owner action |
|---|---|
| `DATABASE_URL` | Neon pooled PostgreSQL URL with SSL; a secret. |
| `ADMIN_PASSPHRASE` | Unique, long owner passphrase used for OAuth authorization and the sign-in flow's enrollment branch. Never use a real provider password. |
| `TOKEN_ENCRYPTION_KEY` | Random 32-byte key represented as exactly **64 hexadecimal characters** (or 43 base64url characters), used for AES-256-GCM encryption of stored credentials and one-time secrets. |
| `PUBLIC_BASE_URL` | This server's exact public **HTTPS origin** only; no path, trailing slash, query, username or password (e.g. `https://example.invalid` is a placeholder, not a working URL). |

Generate the encryption key **on your own trusted device** or in your password manager. For a local Node.js terminal, the following prints one newly generated 32-byte value for you to capture securely. Do not run it in CI, screenshots, an AI chat, or a recorded/shared terminal:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex') + '\\n')"
```

Put that output **only** into the Vercel secret variable and your secure password vault. Rotating this key without a planned re-encryption procedure makes existing stored token values unreadable.

Do not manually set `VERCEL_ENV=production` in preview: Vercel controls deployment environment context. Preview deployments must remain unable to turn on production mode.

If you use different hostnames for preview and production, give each environment the correct `PUBLIC_BASE_URL`. OAuth issuer/resource checks require an exact origin; mismatches cause login failure. Note that preview and production deployments may share a database, so use the existing preview-mode guard.

Reference: [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables).

## 5. Owner sign-in and first restricted token

1. Open `https://<your-mcp-host>/connection` in your normal private browser after deployment and follow the token door (Door 2) to the enrollment branch of the sign-in flow (`/api/oauth/enroll`). Do not paste your real host or passphrase into a public PR.
2. The enrollment branch proves `ADMIN_PASSPHRASE` on every request — there is no owner session to sign in to. The form uses the database-counted lockout shared with sign-in; after repeated errors, stop and check the passphrase rather than trying many times.
3. Create a **team-scoped** Vercel API token in the Vercel account's own token settings; choose the intended team, the smallest available scope and **the expiry you want — including no expiry: the choice is the key owner's and the server respects it (IN-04, ruled 2026-10-27). For a key that does expire, the server's job is to warn ahead of the date (14 days before).** Do **not** use a full-account token by default. Project-scoped tokens may be added for narrower access.
4. Paste the token into the enrollment form only. Provide the chosen Vercel team ID, and optionally the project ID for a project-scoped credential. Before anything is stored, the server probes the token read-only against the specified team/project and reads back its granted scope: the receipt states the declared box and the probed box in plain words, and they can differ (a full-account token reads back as a full box). The token is then encrypted in Neon; the form returns only a receipt, never the full token.
5. If the probe shows the token sees multiple teams or a broader account than the one named, enrollment requires an explicit broader-than-intended acknowledgment before storing. A successful visibility probe **does not prove the full privilege scope of the token**; production/write rules still need the Batch B safety guards and separate authorization.
6. Once enrolled, confirm the account label and scope. Start with the read-only checks `vercel_whoami` and `vercel_list_accounts`. The server now has 253 registered tools (projects, deployments, releases, environment variables, Global Config, teams, domains/DNS/registrar, firewall, billing, developer tools — see `docs/TOOL-CATALOG.md`; the catalog build-out completed 2026-10-30). Deployment, environment and release writes are guarded by profile, production mode, `confirm` and the spend rules: spend runs on the connection owner's word with the cost disclosed first (IN-08 as ruled 2026-10-27; an optional self-set budget is available under OP-2), while delegated connections park spend at `awaiting_owner_approval` for the owner to apply. Token creation/removal (`vercel_token_*`, O-3) is built. The server warns ahead of a recorded credential expiry (14 days before, IN-04); an enrolled token's expiry may not be recorded — when it is not, `vercel_whoami` says so plainly (the VMCP-003 remainder) — so record the date in your password manager whenever you enroll a token whose expiry enrollment does not capture.

There is no setup page and no pending-input channel (both removed in the 2026-10-31 sign-in cleanup, AUD-AV). A secret value a tool needs is never typed into chat or a tool argument: set a chosen Secret value in the Vercel dashboard, or let the tool generate it on the server. Secrets the server creates are delivered as one-time secrets and revealed exactly once on the owner's own connection with `vercel_reveal_one_time_secret`; once a value has been revealed, that record cannot be opened again.

## 6. Connect Claude to the hosted MCP

1. In Claude's settings, navigate to **Customize → Connectors → Add custom connector** (wording may vary by plan).
2. Name the client connection `Vercel by Robinson AI Systems` (the independently developed, unofficial service), and use exactly `https://<your-mcp-host>/api/mcp` as the remote MCP endpoint.
3. Choose the OAuth sign-in/authentication option rather than a static bearer token in a chat. During authorization, select the enrolled account and enter the admin passphrase; Claude does not receive it. Nothing else is asked: the profile is derived from the enrollment door (a token enrollment yields the full profile), the mode from the account's own production switch (a fresh account starts in preview), and the listing is always the front door. To make the connection read-only, flip its own switch afterwards with `vercel_set_read_only`.
4. Enable the connector for a conversation and test `vercel_whoami`, then `vercel_list_accounts`. The result must identify the expected team and contain no token values.
5. Domain/DNS/registrar tools (Batch N) and production operations are built; they stay gated by profile, production mode, `confirm` and the spend rules in §5 — a domain purchase charges real money on confirm, so treat it exactly like buying in the Vercel dashboard. Deployment, environment and release changes are available only under those same guards, never by default.

Reference: [Claude's remote MCP custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## 7. Verification and troubleshooting

| Symptom | What to check without sharing secrets |
|---|---|
| Sign-in or enrollment unavailable / HTTP 503 | Confirm the four required env keys exist in the correct Vercel environment and redeploy. Check Neon reachability without copying credentials into logs. |
| Login rejected / locked | Check the passphrase directly in your password vault; repeated failures trigger the 15-minute lockout. |
| OAuth origin/resource rejected | `PUBLIC_BASE_URL` must exactly match the externally reachable HTTPS origin. |
| Team verification fails | Confirm team ID, intended key scope and whether the team is visible to the supplied token. Do not bypass the safe probe. |
| Token decrypt fails | The original `TOKEN_ENCRYPTION_KEY` was changed, is invalid, or the ciphertext was tampered with. Stop; do not print encrypted/unencrypted keys. |
| No tools displayed | Confirm the OAuth connection, the derived mode/profile `vercel_whoami` reports, the account's read-only switch, and the selected account and scope; verify the published `live` revision separately from tested `main`. A public tool count is not proof of an authenticated session. |
| Unexpected production capabilities | Disconnect and verify production mode remains disabled. Do not run commands that change a real resource. |

The repository's CI (`npm run check`, unit tests, disposable database tests, and local Vercel emulator) is the normal offline validation. Read-only smoke testing and the first live acceptance legs are recorded in `docs/STATUS.md` (2026-10-30 filings); a real-team write test stays restricted to the separately approved scratch project (IN-06, Batch X-2).

**This document is not authorization to deploy, buy services, configure production, or use real provider tokens.** All owner approvals remain explicit.

## 8. Protected read-only connected acceptance (owner/authorized runner)

No pass, passphrase, project file bytes or provider credential should be copied
into a chat, issue, PR, command argument, screenshot or CI output. This procedure
is **not** part of normal CI and never provisions or mutates Vercel resources.

1. Select an **owner-approved disposable nonproduction deployment** with a
   harmless public UTF-8 file smaller than 2 KiB and runtime activity you
   are authorized to examine. Identify its project ID, deployment ID and
   bounded file ID using owner-authenticated read-only tools; avoid
   Appliance Desk production, secrets and confidential files. Only use
   a project the selected credential is allowed to inspect.
2. On the owner's own connection, issue **two separate short-lived service
   passes** privately with `vercel_issue_pass`: one `mode=test`,
   `areas=['server']` identity-only pass; one `mode=preview` read-only
   `deployments` pass under the approved selected account. Obtain each
   bearer through `vercel_reveal_one_time_secret`, never in an AI
   transcript. If no authorized disposable deployment exists, run
   public/TEST acceptance only; do not improvise a provider write or paid
   deployment to manufacture evidence.
3. In a trusted, private Node 24 checkout at the **exact verified
   repository revision**, configure protected **environment variables**
   `VERCEL_MCP_ORIGIN`, `RTC_TEST_PASS`, `RTC_PREVIEW_PASS`,
   `RTC_APPROVED_PROJECT_ID`, `RTC_APPROVED_DEPLOYMENT_ID`;
   optionally supply `RTC_APPROVED_FILE_ID` together with the locally
   computed SHA-256 of the safe known file as `RTC_EXPECTED_FILE_SHA256`.
   Do not echo these inputs, enable shell tracing or run on a public
   untrusted CI runner. The required pass values are secrets; keep them in
   your trusted private environment, not your shell command-line arguments.
4. Run `node scripts/check-connected-acceptance.mjs`. It performs only
   bounded HTTPS reads/negative authorization checks, refuses redirects,
   validates exact scope, and prints safe limited result labels. A
   `runtimeStreamObserved:false` or absent file digest means provider
   acceptance is **partial**, not a success claim. Record timestamp,
   exact **source and deployed commit**, approved nonproduction context,
   exit code and safe evidence flags; do not include raw service replies.
5. **Revoke both temporary passes with `vercel_revoke_pass` on the owner's
   own connection**. With the
   same protected pass values still available privately, set
   `RTC_ACCEPTANCE_PHASE=after-revocation` and run the script again:
   the previously valid passes must now be rejected with HTTP 401 **and** the explicit `pass_revoked` error code. Expiry or invalid credentials do not establish actual revocation.
   Remove the pass values from the execution environment immediately
   afterward. A revocation step without an independently observed denial
   is not verified revocation.

This script proves only the checked host's direct RTC subset and provider
reads actually executed. OAuth client login to original `/api/mcp`, true
Toolkit Hub relay, Vercel Sandbox, and any unauthenticated-to-authenticated
connection transition remain **separate** manual acceptance gates. A TEST
pass **cannot** read Vercel provider data; never relabel preview as TEST.

## 9. The 3AM watch — failure runbook

A scripted watch (no agent tokens) probes this server every few minutes
and wakes an agent only on a **confirmed** failure. Nobody wakes the
owner for a probe failure; this section is the recovery half the woken
agent follows.

**What the watch checks — three legs.**

1. The front-door document at the root of the public origin: the
   service-status JSON naming `endpoint`, `oauth` and `health`.
2. `GET /api/health`: healthy is HTTP 200 with `status: "ok"`. A 503
   with `status: "degraded"` is a failure signal to triage, not proof
   of an outage.
3. Keyless `POST /api/mcp`: must answer 401 with the documented
   unauthorized shape (`{"error":"unauthorized", ...}`). Any other
   answer — a success, a different error, no answer — is a posture
   failure.

**Triage, in order.**

1. **Re-probe once.** A single failed probe can be a transient network
   or platform blip; only a confirmed second failure starts this
   runbook.
2. **Read `/api/health`'s five fields.** `version` and
   `deployed_source_sha` say *what* is running, `tools` says the
   registry loaded, and `timestamp` proves the answer is live rather
   than cached.
3. **Check for a fresh promotion before blaming the code.** Compare
   `deployed_source_sha` with the `live` branch head and read the
   project's production deployment in the official Vercel deployment
   list. A failure that begins with a promotion is a release problem;
   a failure on an unchanged deployment is an environment problem.
4. **Follow the degraded leg.** With the front door and the 401 leg
   healthy, `degraded` means a checked dependency is down. The store
   read failing points first at the database connection — check the
   database's own status and reachability, and never print connection
   strings. OAuth metadata inconsistency points first at configuration
   — the configured public origin against the served metadata. Deeper
   posture is authenticated: `vercel_whoami` for the connection's own
   read-back, `vercel_recent_changes` for what changed last.

**Escalation.** Nobody wakes the owner for a probe failure. Escalate to
the owner only for owner-only needs — credentials, payment, a legal
signature — or a confirmed security or data-loss event. Everything
else is agent-handled, verified fixed by re-probe, and reported in the
morning summary.

**What not to do.** Do not promote outside the nightly train; the only
exception is the daily-live workflow's documented recovery dispatch
(`recover_missed_daily`, gated to the owner's own actor) when a
scheduled promotion was missed. Do not run writes against real Vercel
teams while diagnosing a posture failure — diagnosis is reads only
until the cause is known.

**Rolling back a bad promotion.** The mechanism has no backward move
and no target-commit input: the promotion script
(`.github/release/promote-live.mjs`) only ever fast-forwards `live`
to `main`'s current head, after the required checks (`ci` +
`release-policy`) pass at that head and `live` proves an ancestor of
`main`; the recovery dispatch promotes that same head. Neither can
select an older commit. There are exactly two ways back, in order of
preference.

1. **Fix forward — the supported rollback.** Land the correction — a
   fix, or a revert of the bad change — on `main` through the normal
   PR gates, then move `live` to it through the checked path: that
   Denver day's scheduled promotion if it has not yet run. If the
   day's promotion already ran, the day's marker tag
   (`live-promotion/<YYYY-MM-DD>`) makes every later run that day a
   checked no-op — including the recovery dispatch — so the owner
   first deletes that day's marker tag, then runs the recovery
   dispatch (`recover_missed_daily`, gated to the owner's own actor).
   The script then re-runs the full check gate against `main`'s new
   head before moving `live`, and writes a fresh marker. Nothing in
   this path skips a check.
2. **Emergency ref move — manual, outside the checked path.** When
   production cannot wait for a fix to clear the gates, an operator
   with write access can point `live` directly at the last
   known-good commit: `git push origin <good-sha>:refs/heads/live`.
   Find that commit in the promotion tags — each
   `live-promotion/<YYYY-MM-DD>` tag names the exact `main` commit
   that went live that day, so the most recent tag from before the
   bad promotion names the previous live head. This is safe for the
   mechanism only because every promoted commit is an ancestor of
   `main`, so `live` remains an ancestor and the next checked
   promotion still fast-forwards; never point `live` at a commit
   outside `main`'s history — every later promotion then refuses
   with "live has diverged; refusing to rewrite history". Two limits,
   stated plainly: the move bypasses the check gate (the target was
   check-green when it was promoted; the move itself is unchecked),
   and it consumes no day marker, so the next scheduled promotion
   fast-forwards `live` back to `main`'s head. Land the step-1 fix on
   `main` immediately, or the rollback undoes itself at the next
   train. It is a bridge, not a destination.

**Verify the rollback.** Vercel builds only `live`, so the project's
production deployment list must show a READY production deployment
built from the target commit, and `GET /api/health` must report
`deployed_source_sha` equal to that commit with `status: "ok"`. Then
re-run the watch's three legs above. A rollback that has not passed
this verification is a hope, not a recovery.
