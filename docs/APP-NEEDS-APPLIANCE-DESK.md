# What Appliance Desk needs from Vercel, and which tool handles each

Audited 2026-10-10 against `christcr2012/appliance-desk` `main` (read only): `vercel.json`, `package.json` scripts
(`vercel-build`), `.github/workflows/release.yml`, `docs/ARCHITECTURE.md` ("Hosting", "Environment variables",
"Photo uploads (Vercel Blob)", "Automation rules", "Vercel builds (previews and production)", "O02A — Non-production
provider safety"), `docs/GO-LIVE-CHECKLIST.md`, `docs/OWNER-INPUTS.md` (IN-67, IN-68), `docs/runbooks/STORAGE.md`,
`docs/DECISIONS.md` (Vercel Sandbox entries).

This is an **example project profile**, and the completeness check used to prove the Vercel MCP can do everything a real
app needs. The server itself is a general development tool; profiles are optional and any app Chris builds can have one
(Batch P, `docs/designs/BATCH-P.md`; `vercel_profile_draft` drafts one from a codebase). This file is also the template
for future profiles. No Vercel team, project or deployment IDs are recorded here (added on the setup page).

**Rule for this file:** every row names the tool or workflow that covers it, or says plainly that Vercel has no API for
it and how the server guides Chris instead. Batch P turns this table into data (`known_apps`) and into one check,
`vercel_workflow_app_readiness`. When the app's Vercel use changes, this file and the `known_apps` seed change in the
same PR (P-1 owns the seed).

## What the app manages by itself (the MCP must not duplicate or fight it)

| The app… | Evidence | What the MCP does |
|---|---|---|
| Releases to its live site by **moving the `live` branch** to a green `main` commit (weekly safety net, on demand, after each batch); Vercel's production branch is `live` | `.github/workflows/release.yml`; ARCHITECTURE "Vercel builds"; OWNER-INPUTS IN-68 | Profile `release_rule: 'branch'`, `production_branch: 'live'`: promote, rolling-release start and production deploys refused without `outsideApp` (IN-11); emergency rollback allowed with confirm and labelled |
| **Runs database migrations during every build** (`vercel-build`: check migrations → `prisma migrate deploy` → schema health → `next build`) | `package.json` `vercel-build` | Profile `rollback_caution`: "rolling back to a deployment built before a migration runs old code against the new database schema; check `docs/runbooks/RESTORE.md` first" in every rollback preview |
| Skips builds when only docs/tests changed (`ignoreCommand`) and disables previews for `ai/**`, `transfer/**`, `recovery/**` branches to keep cost near $20/month | `vercel.json` `ignoreCommand`, `git.deploymentEnabled`; ARCHITECTURE "Monthly cost target" | Profile `no_preview_branches`; `vercel_dev_preview_branch` refuses those branches without `outsideApp`; the MCP never edits `vercel.json` (it lives in the app's repo) |
| Defines **ten cron jobs** in `vercel.json`, each guarded by `CRON_SECRET` | `vercel.json` `crons`; ARCHITECTURE "Environment variables" | Profile `expected_crons` (paths and schedules); `vercel_cron_list` reads them; running or disabling is guided; the MCP never reads `CRON_SECRET` |
| Has Blob stores connected (`appliance-desk-photos`, the private photo store, the preview-only private store); "never clean up a store by browsing and deleting" | ARCHITECTURE "Photo uploads"; `docs/runbooks/STORAGE.md` | Profile `owned_stores`; store delete refused; Blob objects are never touched by this server |
| Gets some variables injected by Vercel or integrations (`BLOB_READ_WRITE_TOKEN` from the store connection; Vercel system variables) | ARCHITECTURE "Environment variables" | Profile `managed_env`; writes refused without `outsideApp` |
| Refuses live provider keys and sends no email/SMS in non-production deployments by itself | ARCHITECTURE "O02A" | Nothing to do; readiness reports it as the app's own guard |
| Uses a persistent Vercel Sandbox for agent work (resumed, never one per card) | `docs/DECISIONS.md` 2026-10-09 entries | Profile `protected_sandboxes` (name entered on the setup page); never stopped or deleted by cleanup |

**Variables the app expects (names only; values are never read or shown by this server):** `DATABASE_URL`,
`DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `STRIPE_SECRET_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `BLOB_READ_WRITE_TOKEN`,
`PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN`, `PRIVATE_PHOTO_BLOB_STORE_ID`, `PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN` (preview),
`PREVIEW_PRIVATE_BLOB_STORE_ID` (preview), `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`LEAD_NOTIFICATION_EMAIL`, `MAINTENANCE_NOTIFICATION_EMAIL`, `BILLING_NOTIFICATION_EMAIL`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (deliberately unset today), `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`,
`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`; planned `COLORADO_GIS_API_KEY`.

## Everything the app needs from Vercel, and who does it

| # | Need (source) | Today | Covered by | API or guided? |
|---|---|---|---|---|
| V1 | Project `appliance-desk` in team Robinson AI Systems, Next.js, Node 24 to match CI (ARCHITECTURE "CI runs the same Node as production") | Set | `vercel_project_get`; `vercel_project_update_settings` (Node version) | API |
| V2 | **Production branch tracking = `live`** (OWNER-INPUTS IN-68 in the app) | Open owner step there | `vercel_where_is_setting("production branch")` + read-back via `vercel_project_get` (`link.productionBranch`) | **Guided** (no API), with read-back |
| V3 | Ignored build step command and per-branch deploy rules (cost fix 2026-10-09) | Set in `vercel.json` | `vercel_project_get` (`commandForIgnoringBuildStep`), `vercel_dev_check_integration` | Read; the rule lives in the app's repo |
| V4 | Production deploys only from `live`; no direct promotes | Release workflow | Profile release rule (IN-11); `vercel_workflow_release_status` shows what is live vs waiting on `main` | API (read) + guard |
| V5 | Rollback with migration caution | — | `vercel_deploy_rollback`, `vercel_workflow_emergency_rollback` with `rollback_caution` | API |
| V6 | Ten crons present on the live deployment and running daily (GO-LIVE "Nightly jobs are running") | Scheduled | `vercel_cron_list`; run history and "run now" guided; `vercel_workflow_project_health` | Read by API; run/enable **guided** |
| V7 | Every expected variable present in Production (and preview ones in Preview) — names only | Mostly set | `vercel_env_list`, `vercel_workflow_app_readiness` (missing names → pending-input request, never invented values) | API |
| V8 | **Preview database isolated from production**: Preview `DATABASE_URL`/`DIRECT_URL` differ from Production (ARCHITECTURE "Neon ↔ Vercel preview isolation") | Verified by the app | `vercel_env_compare` (same/different, computed on the server, values never shown) | API |
| V9 | `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` equal the real domain in Production (GO-LIVE §URLs) | One verified, one pending | `vercel_env_compare` cannot read Secret values; readiness lists it as "needs you: check on the setup page" when the variable is Secret-kind; Config-kind values are compared server-side to the domain | API + setup-page view |
| V10 | Production secrets long, random and unique (`BETTER_AUTH_SECRET`, `CRON_SECRET`) (GO-LIVE) | Set | `vercel_workflow_rotate_secret` (generated on the server, redeploy confirmed) when Chris asks; never shown | API |
| V11 | Custom domain `robinsonappliancerentals.com` on the project, verified, HTTPS (GO-LIVE) | Live | `vercel_domain_list_project_domains`, `vercel_domain_check_config`, `vercel_cert_list` | API |
| V12 | DNS on Vercel nameservers carries the site **and email** (Google Workspace MX, SPF/DKIM/DMARC; Resend sending records) | Live | Profile `owned_dns_records` (MX, SPF, DKIM, DMARC, Resend) — changes need `outsideApp`; `vercel_dns_list` shows owners | API + guard |
| V13 | Domain renewal and auto-renew (registered through Vercel or elsewhere) | Unknown | `vercel_domain_list` (expiry, auto-renew), `vercel_admin_overview` warns 30 days ahead; renew is `$` | API |
| V14 | Blob stores present and connected per environment; private-store token/ID pairing (STORAGE runbook) | Set | `vercel_storage_get_store`, `vercel_env_list` (names per target); delete refused | API (read) + guard |
| V15 | Preview protection: who can see previews (Vercel Authentication on previews recommended) | Unknown | `vercel_protection_get`; `vercel_protection_set_vercel_auth`; readiness reports | API |
| V16 | Automated tests against protected previews when needed | Not used today | `vercel_dev_create_bypass` (shown once), cleanup revokes | API |
| V17 | Monthly cost near $20 (Chris, 2026-10-09): builds per day, previews per branch, build machine standard | Target set | `vercel_workflow_cost_check`, `vercel_billing_summary`, `vercel_admin_cost_review` | API |
| V18 | Spend Management: budget with alerts, **pause production off** | Unknown | `vercel_where_is_setting("spend management")`; IN-12 | **Guided only** (not readable) |
| V19 | Error monitoring after deploys (Sentry is the app's tool; Vercel runtime logs as backup) | Sentry inactive until DSN set | `vercel_logs_errors_summary`, `vercel_deploy_get_runtime_logs` | API |
| V20 | Team security: members and roles, two-step login, tokens with expiry | Unknown | `vercel_admin_review_security`, `vercel_member_list`, `vercel_token_list`; two-step login guided | API + guided |
| V21 | GitHub ruleset must not require a Vercel "Preview" check (IN-67 in the app) | Done there | Not a Vercel setting — the GitHub server's job; readiness says so | — |
| V22 | Persistent Vercel Sandbox for agent work stays available | Exists | `protected_sandboxes`; never touched by `vercel_dev_cleanup` | Guard |

## The one-sentence checks Chris will use

- *"Is Vercel ready for Appliance Desk?"* → `vercel_workflow_app_readiness(app: "appliance-desk")`: every row above as
  done / needs you (with steps) / needs a decision (IN-xx), and the fixes it can make (each previewed, each confirmed).
- *"What's live on the rental site?"* → `vercel_workflow_release_status`.
- *"The site is broken — roll it back."* → `vercel_workflow_emergency_rollback` (with the migration warning).
- *"How much is Vercel costing me this month?"* → `vercel_workflow_cost_check`.
