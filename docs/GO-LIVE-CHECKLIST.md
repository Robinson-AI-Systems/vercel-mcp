# Go-live checklist — everything that must be switched on before this server changes anything live

**Current checkpoint (2026-10-19):** Initial dedicated Vercel/Neon hosting, owner secrets and encrypted selected-team credential were verified 2026-10-13. These are completed setup prerequisites, **not** proof of native client/provider acceptance or approval for live resource mutations. This is a service *operation/acceptance* checklist only; distribution and commercial launch belong outside this repository. Do not repeat completed setup or reactivate paid capability without authorization.

Written for the owner (not a developer). Rule: everything is built and tested with fakes, the `emulate` stand-in and, at
the end, one scratch project; anything that could change a live site or spend money is off until you complete the step
here. Tick a box only after the "how you know it worked" check is done. Every PR that adds a switch adds a line here.

Legend: **Owner** = only Chris · **Agent** = Claude can do it once you say go.

## 1. The server itself

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [x] | Dedicated Vercel project and Neon database created (IN-02) | Verified initial owner setup 2026-10-13 | Exists; `live` is promoted from `main` nightly by the checked daily job (2026-10-31 audit: STATUS records the current heads/deployments — this checklist no longer pins a SHA) | Hosting and initialized Neon schema recorded in STATUS; public metadata alone is not client acceptance |
| [x] | Owner login passphrase and encryption key set (IN-03) | Verified through secure owner setup 2026-10-13; never disclose values | Configured | Owner login independently verified; no credential value in this repo |
| [x] | Encrypted team-scoped Vercel credential enrolled (IN-04, IN-05) | Selected Robinson AI Systems team, independently provider-verified 2026-10-13 | Configured; saved key has **no expiration** — the owner's decided choice (IN-04 ruled 2026-10-27: expiry is the key owner's choice, the server respects it and notifies ahead of expirations that exist) | Team visibility verified; does not establish full API permissions or connected desktop/mobile MCP acceptance |
| [ ] | Protected projects list confirmed (IN-07) | Setup page (Owner) | Defaults | `vercel_list_protected_resources` shows the list |
| [x] | Connector added in Claude (Owner) | claude.ai → Settings → Connectors | Added; runs in **PRODUCTION mode, full profile** (verified live 2026-10-30/31; acceptance A-6 passed) | `vercel_whoami` answers with the Robinson AI Systems team, scope full, productionEnabled true |
| [ ] | Legacy spending control (IN-08) | User-selected spending/authorization policy replaced the developer-era default (AUD-A2, 2026-10-30): the owner's word executes with cost disclosed; an optional self-set budget exists (OP-2); delegated connections park spend for owner approval | Shipped in source; **not an owner-approved restriction on customers** | `vercel_whoami` exposes the spend posture; delegated-mode live acceptance is recorded in STATUS as it accrues |
| [ ] | Blob stores the server may look inside (IN-15; none connected by default — the owner's connection choice, answered 2026-10-27) | Setup page → Blob stores (Owner types each store's key there) | None connected | Batch M-4 is built (2026-10-30): `vercel_blob_list` / `vercel_blob_head` / `vercel_blob_put` / `vercel_blob_delete` are registered; no store answers until an owner selects a store |
| [ ] | Variable-cost Sandbox authorization (V-4; optional, per transaction) | First ask the connected agent to preview a bounded Sandbox; inspect the resulting exact purchase reference on the authenticated setup page, check the non-guaranteed-cost acknowledgment, enter your chosen planning threshold and reenter your passphrase. Do **not** use developer-agent approvals | Never automatic | The one-use grant is consumed before the exact preview Sandbox starts; Vercel activity and `vercel_dev_list_runs` verify the owned session. The actual bill may exceed the advisory planning threshold |
| [ ] | Scratch project and its project key (IN-06) | Vercel dashboard + setup page (Owner) | Answered YES 2026-10-27 (builder acceptance fixture); **created 2026-10-28 at the owner's direction** (project `rtc-scratch` + project-scoped token "rtc-scratch X-2 fixture", expiring 2026-11-27, both verified in Vercel); VMCP-022 **closed 2026-10-29**: after the AUD-F fix the fixture enrolled, was exercised with real writes, and the project + token were deleted and verified; the leftover account record was removed 2026-10-30. A future X-2 run re-stages a fresh fixture | The X-2 report shows the scratch run passing |

## 2. Production changes, per team

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Production delegated for the team (IN-09) | Ruled 2026-10-27: production stays ON and the enable/disable switch is the end user's, flippable by their agent with their approval. The switch was remediated to the ruled shape (AUD-B/AUD-E: `vercel_enable_production` on the owner's word; UA-05 satisfied in source) and production is verified live on the owner's connection (2026-10-30) | On as product policy per the ruling, and in source; **not a permanent customer capability ban**. One recorded posture: newly enrolled account rows default production-off until the owner flips them once | An entitled user/delegated agent can execute, audit and read back a scoped authorized production operation |
| [x] | One harmless production change with you watching (e.g. re-issue a certificate, or promote the same deployment that is already live on the scratch project) | Owner + Agent | Done 2026-10-30: the branded-domain attach (`vercel.robinsonaisystems.com`) was applied through the owner's own MCP connection on the owner's order | It shows in Vercel's activity log and in `vercel_recent_changes` (change_log id 83) |

## 3. Team settings (guided; the server checks what it can read)

| Done | Item | Today |
|---|---|---|
| [ ] | Spend alerts as you set them in Vercel's Spend Management (IN-12, ruled 2026-10-27: the server reads and reports them; it never controls them) | Set by the owner in Vercel, if wanted |
| [ ] | Two-step login on for every Owner | Unknown |
| [ ] | Keys carry the expiry their owner chose — which may be none (IN-04, ruled 2026-10-27); no full-account keys in use | Unknown |

## 4. Projects (one section per profiled project)

### Appliance Desk

Run `vercel_workflow_app_readiness` for Appliance Desk and work through what it lists. (Batch P-2 built 2026-10-30 — the tool is registered; the underlying list with explanations is in `docs/APP-NEEDS-APPLIANCE-DESK.md`.) The full list with explanations
is `docs/APP-NEEDS-APPLIANCE-DESK.md`; the app's own checklist (`appliance-desk/docs/GO-LIVE-CHECKLIST.md`) stays the
authority for the app's launch.

| Done | Item | Today |
|---|---|---|
| [ ] | Release rule confirmed (IN-11): live site changes only through the `live` branch, emergency rollback allowed | Owner rule answered YES 2026-10-27 (IN-11); feature/application verification remains open |
| [ ] | Production branch tracking set to `live` (the app's IN-68) | Open there |
| [ ] | Every expected variable present in Production and Preview (names) | Mostly |
| [ ] | Preview database differs from production (checked without showing values) | Verified by the app |
| [ ] | Email DNS records marked as owned in the profile | Not seeded (P-1) |
| [ ] | Ten crons present on the live deployment | Scheduled |

## B-8 owner default-account control

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [x] | Choose the default connected Vercel account for *new* connectors only | Owner: production-server setup page, authenticated session, CSRF, explicit confirmation, reenter passphrase | Mechanism shipped (B-8) and exercised: on 2026-10-30 the owner set the default to Robinson AI Systems through the setup page's owner form and it was verified | After the owner selects an existing team, owner setup lists it first; existing connections keep their account and mode. Does **not** permit agent-initiated default changes or spending |

## Daily deployment cost controls (2026-10-12)

- [ ] Before linking or activating this server, verify that GitHub has both main and live; initialize live from main only if absent and verify both SHA references.
- [ ] In each linked Vercel project's Production environment, set Branch Tracking to live and read it back. Disable automatic Preview deployments and verify that setting. No Vercel project setting is implied by vercel.json.
- [ ] Confirm exact-head existing application CI and release-policy pass; development PRs never require a paid Vercel preview. Apply live-only Git rules to any nested Vercel root configuration.
- [x] Verify the first scheduled daily promotion and its live-promotion date tag; validate the resulting production deployment from live. Keep all existing access, spending and activation gates. (Verified repeatedly 2026-10-28…31; the 2026-10-31 scheduled run did not fire and the checked recovery dispatch completed that day's promotion — STATUS carries the record.)
