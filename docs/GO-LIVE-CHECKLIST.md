# Go-live checklist — everything that must be switched on before this server changes anything live

**Current checkpoint (2026-10-19):** Initial dedicated Vercel/Neon hosting, owner secrets and encrypted selected-team credential were verified 2026-10-13. These are completed setup prerequisites, **not** proof of native client/provider acceptance or approval for live resource mutations. This is a service *operation/acceptance* checklist only; distribution and commercial launch belong outside this repository. Do not repeat completed setup or reactivate paid capability without authorization.

Written for the owner (not a developer). Rule: everything is built and tested with fakes, the `emulate` stand-in and, at
the end, one scratch project; anything that could change a live site or spend money is off until you complete the step
here. Tick a box only after the "how you know it worked" check is done. Every PR that adds a switch adds a line here.

Legend: **Owner** = only Chris · **Agent** = Claude can do it once you say go.

## 1. The server itself

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [x] | Dedicated Vercel project and Neon database created (IN-02) | Verified initial owner setup 2026-10-13 | Exists; deployment on live at cb60c6f4 reported READY 2026-10-19 | Hosting and initialized Neon schema recorded in STATUS; public metadata alone is not client acceptance |
| [x] | Owner login passphrase and encryption key set (IN-03) | Verified through secure owner setup 2026-10-13; never disclose values | Configured | Owner login independently verified; no credential value in this repo |
| [x] | Encrypted team-scoped Vercel credential enrolled (IN-04, IN-05) | Selected Robinson AI Systems team, independently provider-verified 2026-10-13 | Configured; saved key has **no expiration** — the owner's decided choice (IN-04 ruled 2026-10-27: expiry is the key owner's choice, the server respects it and notifies ahead of expirations that exist) | Team visibility verified; does not establish full API permissions or connected desktop/mobile MCP acceptance |
| [ ] | Protected projects list confirmed (IN-07) | Setup page (Owner) | Defaults | `vercel_list_protected_resources` shows the list |
| [ ] | Connector added in Claude, preview mode (Owner) | claude.ai → Settings → Connectors | Not added | Claude answers "who am I connected as in Vercel?" correctly |
| [ ] | Legacy spending control (IN-08) | Existing server requires owner setup before charged operations; future user-selected spending/authorization policy must replace developer-era default $0. | $0 currently in code; **not an owner-approved restriction on customers** | `vercel_whoami` exposes legacy value; record actual delegated-mode acceptance only after implemented |
| [ ] | Blob stores the server may look inside (IN-15; none connected by default — the owner's connection choice, answered 2026-10-27) | Setup page → Blob stores (Owner types each store's key there) | None connected | Not built yet (Batch M-4): `vercel_blob_list` does not exist and no Blob store is connected; no store answers until M-4 is implemented and an owner selects a store |
| [ ] | Variable-cost Sandbox authorization (V-4; optional, per transaction) | First ask the connected agent to preview a bounded Sandbox; inspect the resulting exact purchase reference on the authenticated setup page, check the non-guaranteed-cost acknowledgment, enter your chosen planning threshold and reenter your passphrase. Do **not** use developer-agent approvals | Never automatic | The one-use grant is consumed before the exact preview Sandbox starts; Vercel activity and `vercel_dev_list_runs` verify the owned session. The actual bill may exceed the advisory planning threshold |
| [ ] | Scratch project and its project key (IN-06) | Vercel dashboard + setup page (Owner) | Answered YES 2026-10-27 (builder acceptance fixture); project + key not yet created | The X-2 report shows the scratch run passing |

## 2. Production changes, per team

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Production delegated for the team (IN-09) | Ruled 2026-10-27: production stays ON and the enable/disable switch is the end user's, flippable by their agent with their approval. Current source still requires passphrase activation; remediating the switch to the ruled shape is still to be implemented and tested | On as product policy per the ruling; gated in current source (remediation pending); **not a permanent customer capability ban** | An entitled user/delegated agent can execute, audit and read back a scoped authorized production operation after remediation |
| [ ] | One harmless production change with you watching (e.g. re-issue a certificate, or promote the same deployment that is already live on the scratch project) | Owner + Agent | Not done | It shows in Vercel's activity log and in `vercel_recent_changes` |

## 3. Team settings (guided; the server checks what it can read)

| Done | Item | Today |
|---|---|---|
| [ ] | Spend alerts as you set them in Vercel's Spend Management (IN-12, ruled 2026-10-27: the server reads and reports them; it never controls them) | Set by the owner in Vercel, if wanted |
| [ ] | Two-step login on for every Owner | Unknown |
| [ ] | Keys carry the expiry their owner chose — which may be none (IN-04, ruled 2026-10-27); no full-account keys in use | Unknown |

## 4. Projects (one section per profiled project)

### Appliance Desk

Run `vercel_workflow_app_readiness` for Appliance Desk and work through what it lists. (Not built yet — Batch P-2; until it exists, work through the list in `docs/APP-NEEDS-APPLIANCE-DESK.md` directly.) The full list with explanations
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

## B-8 owner default-account control (not activated)

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Choose the default connected Vercel account for *new* connectors only | Owner: production-server setup page, authenticated session, CSRF, explicit confirmation, reenter passphrase | Server and owner credential configured; **default-account change not applied** | After the owner selects an existing team, owner setup lists it first; existing connections keep their account and mode. Does **not** permit agent-initiated default changes or spending |

## Daily deployment cost controls (2026-10-12)

- [ ] Before linking or activating this server, verify that GitHub has both main and live; initialize live from main only if absent and verify both SHA references.
- [ ] In each linked Vercel project's Production environment, set Branch Tracking to live and read it back. Disable automatic Preview deployments and verify that setting. No Vercel project setting is implied by vercel.json.
- [ ] Confirm exact-head existing application CI and release-policy pass; development PRs never require a paid Vercel preview. Apply live-only Git rules to any nested Vercel root configuration.
- [ ] Verify the first scheduled daily promotion and its live-promotion date tag; validate the resulting production deployment from live. Keep all existing access, spending and activation gates.
