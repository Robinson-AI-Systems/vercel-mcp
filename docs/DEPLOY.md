# DEPLOY — Owner guide to setting up Vercel by Robinson AI Systems

**Branding/connection status (2026-10-19):** Owner-controlled service display name is **Vercel by Robinson AI Systems** (unofficial and independently operated). Technical IDs, origins, OAuth grants and stored credentials stay stable. Source support for remote direct MCP does not establish client-specific login, refresh, provider read/write or revocation acceptance. A production deployment/real user action remains separate. The owner-approved directive does not permit unscheduled release, distribution decisions (owned outside this repository) or account changes.


**Already completed, do not provision again:** 2026-10-13 initial hosting and owner credential setup verified. Sections 1–5 below describe the original first-time setup or authorized recovery, not remaining required provisioning. The dedicated Vercel project is READY on the checked `live` revision, dedicated Neon schema initialized and an encrypted, team-scoped Robinson AI Systems credential stored. Public OAuth and RTC metadata respond over HTTPS; authenticated custom MCP, live D-2 provider file/log response, standalone direct OAuth/RTC client and provider revocation acceptance remain OPEN; Hub routing/relay/Sandbox testing is Hub-owned. Existing approved setup is not permission for additional provisioning, production writes or spending.

This server has its own Vercel project and Neon database. It must never be installed into Appliance Desk or another existing business project. Start with a restricted Vercel team token and a preview/read-only connection; production writes require a separate approval and additional safety implementation.

## 1. Before starting

- GitHub repo: [Robinson-AI-Systems/vercel-mcp](https://github.com/Robinson-AI-Systems/vercel-mcp). Use its latest tested `main`.
- Have access to your Vercel account and to [Neon](https://console.neon.tech/).
- Review [OWNER-INPUTS.md](OWNER-INPUTS.md): IN-02 approves the dedicated Vercel project/Neon database, IN-03 covers owner-managed credentials, IN-04/05 choose token scope/team, IN-07 protects projects, and IN-09 keeps production changes disabled.
- Review the provider's current pricing **before** clicking Create/Upgrade. The intended starting point is a suitable free tier; do not select paid plans or add-ons without a separate decision.
- Keep all passwords, keys, token values and database URLs **out of GitHub, chats, screenshots, terminal transcripts and logs**. Enter them directly in the provider's secret fields. The AI assistant never needs to see their values.

## 2. Create the isolated Neon database (owner approved only)

1. In the [Neon Console](https://console.neon.tech/), create a new project dedicated to `vercel-mcp`. Select a sensible nearby region and a free plan if available and sufficient.
2. In the project's connection details, select the **pooled** connection string (often labeled `-pooler`) for serverless use, with SSL required.
3. Copy the secret PostgreSQL URL directly into the Vercel environment variable `DATABASE_URL`; do not place it in chat or commit it.
4. No manual schema editing or shared database is necessary. Once the deployed server receives an authenticated setup/OAuth request, `src/db.js` runs its additive schema initialization. The automated tests use only disposable Postgres, never the real database.
5. Verify that the database is dedicated to this server, not a business app; keep credentials private and rotate them immediately if accidentally disclosed.

Reference: [Neon deployment and pooled connection example](https://neon.com/blog/authenticating-users-in-astro-using-neon-postgres-and-lucia-auth).

## 3. Create the dedicated Vercel project (owner approved only)

1. Go to Vercel's Add New → Project / Import Git Repository flow, select `Robinson-AI-Systems/vercel-mcp` and the intended team.
2. Use the project name `vercel-mcp`. The project is a plain Node.js (24.x), ES module Vercel Functions application, not Next.js; follow its committed `vercel.json` and `api/` structure. Do not copy it into any other project's root.
3. **For this repository use the checked `live` branch**, not `main`, as the Vercel production branch. The scheduled, guarded daily `main → live` promotion runs at 00:01 America/Denver. Automatic previews are disabled to control build cost. Do not manually deploy, promote or change this policy for a routine PR; an emergency needs separate explicit approval.
4. Avoid installing any additional products, add-ons, integrations or paid services just to deploy this basic server.
5. A custom domain is optional, not a prerequisite. Use an HTTPS URL for this project, not another app's domain.

References: [Vercel GitHub integration](https://vercel.com/docs/git/vercel-for-github) and [project environment settings](https://vercel.com/docs/environment-variables/managing-environment-variables).

## 4. Environment variables — enter values privately in Vercel

In the dedicated Vercel project, open **Settings → Environment Variables**. Set each variable in the intended deployment environments, review the selection, then redeploy so changed values take effect.

| Key | Purpose / owner action |
|---|---|
| `DATABASE_URL` | Neon pooled PostgreSQL URL with SSL; a secret. |
| `ADMIN_PASSPHRASE` | Unique, long owner passphrase used for setup and OAuth authorization. Never use a real provider password. |
| `TOKEN_ENCRYPTION_KEY` | Random 32-byte key represented as exactly **64 hexadecimal characters** (or 43 base64url characters), used for AES-256-GCM credentials and owner sessions. |
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

1. Open `https://<your-mcp-host>/api/vercel/setup` in your normal private browser after deployment. Do not paste your real host or passphrase into a public PR.
2. Sign in with `ADMIN_PASSPHRASE`. The form uses database-counted lockout; after repeated errors, stop and check the passphrase rather than trying many times.
3. Create a **team-scoped** Vercel API token in the Vercel account's own token settings; choose the intended team, the smallest available scope and a short expiry (target 90 days if supported). Do **not** use a full-account token by default. Project-scoped tokens may be added for narrower access.
4. Enter the token into the setup page only. Provide the chosen Vercel team ID, and optionally the project ID for a project-scoped credential. The server performs read-only probes of the specified team/project and encrypts the token in Neon; the page returns only a receipt, never the full token.
5. If the provider appears to expose multiple teams or a broader account, the setup form requires an explicit owner checkbox. A successful visibility probe **does not prove the full privilege scope of the token**; production/write rules still need the Batch B safety guards and separate authorization.
6. Once connected, confirm the account label and scope. The two initial read-only tools are `vercel_whoami` and `vercel_list_accounts`. Token creation/removal and all other management tools come in later batches. Current storage may not know the credential's actual expiration date; record it separately in your password manager until reminder/renewal functionality is built.

The same authenticated setup page supports **one-use pending inputs** (a tool's secret value is entered here, not supplied through an AI message) and authorized **one-time secret reveal**. Once a value has been revealed, that record cannot be opened again.

## 6. Connect Claude to the hosted MCP

1. In Claude's settings, navigate to **Customize → Connectors → Add custom connector** (wording may vary by plan).
2. Name the client connection `Vercel by Robinson AI Systems` (the independently developed, unofficial service), and use exactly `https://<your-mcp-host>/api/mcp` as the remote MCP endpoint.
3. Choose the OAuth sign-in/authentication option rather than a static bearer token in a chat. During authorization, select the connected team, **PREVIEW** mode, and **read_only** profile. The server's login page asks for the admin passphrase; Claude does not receive it.
4. Enable the connector for a conversation and test `vercel_whoami`, then `vercel_list_accounts`. The result must identify the expected team and contain no token values.
5. Do not request deployment changes, DNS changes, purchases, or production operations; those tools are intentionally unavailable until subsequent approved batches.

Reference: [Claude's remote MCP custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## 7. Verification and troubleshooting

| Symptom | What to check without sharing secrets |
|---|---|
| Setup unavailable / HTTP 503 | Confirm the four required env keys exist in the correct Vercel environment and redeploy. Check Neon reachability without copying credentials into logs. |
| Login rejected / locked | Check the passphrase directly in your password vault; repeated failures trigger the 15-minute lockout. |
| OAuth origin/resource rejected | `PUBLIC_BASE_URL` must exactly match the externally reachable HTTPS origin. |
| Team verification fails | Confirm team ID, intended key scope and whether the team is visible to the supplied token. Do not bypass the safe probe. |
| Token decrypt fails | The original `TOKEN_ENCRYPTION_KEY` was changed, is invalid, or the ciphertext was tampered with. Stop; do not print encrypted/unencrypted keys. |
| No tools displayed | Confirm OAuth connection mode/profile, selected account and scope; verify the published `live` revision separately from tested `main`. A public tool count is not proof of an authenticated session. |
| Unexpected production capabilities | Disconnect and verify production mode remains disabled. Do not run commands that change a real resource. |

The repository's CI (`npm run check`, unit tests, disposable database tests, and local Vercel emulator) is the normal offline validation. Actual read-only smoke testing is a later planned acceptance step; a real-team write test is restricted to the separately approved scratch project (IN-06, Batch X-2).

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
2. In the authenticated
   [Vercel MCP owner setup](https://vercel-mcp-liard.vercel.app/api/vercel/setup)
   page, issue **two separate short-lived service passes** privately:
   one `mode=test`, `areas=['server']` identity-only pass; one
   `mode=preview` read-only `deployments` pass under the approved
   selected account. Obtain them using the page's one-time reveal, never in
   an AI transcript. If no authorized disposable deployment exists, run
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
5. **Revoke both temporary passes in authenticated owner setup**. With the
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
