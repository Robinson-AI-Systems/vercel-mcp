# Go-live checklist — everything that must be switched on before this server changes anything live

Written for Chris (not a developer). Rule: everything is built and tested with fakes, the `emulate` stand-in and, at
the end, one scratch project; anything that could change a live site or spend money is off until you complete the step
here. Tick a box only after the "how you know it worked" check is done. Every PR that adds a switch adds a line here.

Legend: **Owner** = only Chris · **Agent** = Claude can do it once you say go.

## 1. The server itself

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Vercel project and Neon database created (IN-02) | Vercel and Neon connectors (Agent, after you say go) | Not created | The server's home page shows its tool counts |
| [ ] | `ADMIN_PASSPHRASE` and `TOKEN_ENCRYPTION_KEY` set (IN-03) | Vercel → Environment Variables (Owner) | Not set | The setup page asks for the passphrase and accepts a key |
| [ ] | Team key added (IN-04, IN-05) | Vercel → Account Settings → Tokens (team scope, 90 days), then the server's setup page (Owner) | None | `vercel_whoami` shows the team, PREVIEW, key scope, last 4 and expiry date |
| [ ] | Protected projects list confirmed (IN-07) | Setup page (Owner) | Defaults | `vercel_list_protected_resources` shows the list |
| [ ] | Connector added in Claude, preview mode (Owner) | claude.ai → Settings → Connectors | Not added | Claude answers "who am I connected as in Vercel?" correctly |
| [ ] | Spend limit confirmed (IN-08) | Ask Claude: "set my Vercel spend limit to $X" (Owner confirms) | $0 default | `vercel_whoami` shows the limit |
| [ ] | Scratch project and its project key (IN-06) | Vercel dashboard + setup page (Owner) | None | The X-2 report shows the scratch run passing |

## 2. Production changes, per team

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Production enabled for the team (IN-09): ask Claude, then re-enter your passphrase on the setup page | Owner | Off | A new connection offers "production" for that team |
| [ ] | One harmless production change with you watching (e.g. re-issue a certificate, or promote the same deployment that is already live on the scratch project) | Owner + Agent | Not done | It shows in Vercel's activity log and in `vercel_recent_changes` |

## 3. Team settings (guided; the server checks what it can read)

| Done | Item | Today |
|---|---|---|
| [ ] | Spend Management on with alerts, pause production **off** (IN-12) | Unknown |
| [ ] | Two-step login on for every Owner | Unknown |
| [ ] | Keys have expiry dates; no full-account keys in use | Unknown |

## 4. Projects (one section per profiled project)

### Appliance Desk

Run `vercel_workflow_app_readiness` for Appliance Desk and work through what it lists. The full list with explanations
is `docs/APP-NEEDS-APPLIANCE-DESK.md`; the app's own checklist (`appliance-desk/docs/GO-LIVE-CHECKLIST.md`) stays the
authority for the app's launch.

| Done | Item | Today |
|---|---|---|
| [ ] | Release rule confirmed (IN-11): live site changes only through the `live` branch, emergency rollback allowed | Not decided |
| [ ] | Production branch tracking set to `live` (the app's IN-68) | Open there |
| [ ] | Every expected variable present in Production and Preview (names) | Mostly |
| [ ] | Preview database differs from production (checked without showing values) | Verified by the app |
| [ ] | Email DNS records marked as owned in the profile | Not seeded (P-1) |
| [ ] | Ten crons present on the live deployment | Scheduled |
