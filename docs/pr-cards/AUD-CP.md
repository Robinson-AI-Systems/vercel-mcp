# AUD-CP — Deployment recorder go-live close-out (documentation only)

**Commissioned:** 2026-11-04 by the owner, under his full-capacity /
early-release directive: everything doable before a release gets done,
then early releases the same day. This card closes the AUD-CI recorder's
one remaining documentation item — its GO-LIVE checklist entry — with
the live record of how registration actually completed.

## What the live proof established (2026-11-04, after the 00:01 promotion)

- The receiver build (AUD-CI, PR #428) went live in the 2026-11-04
  promotion (recovered by owner dispatch after the scheduled run
  missed; live build 93619dbc verified by health read-back).
- The account webhook is registered for
  `https://vercel.robinsonaisystems.com/api/webhooks/deployments`, six
  deployment events, all projects (dashboard read-back, exact URL).
- The signing-secret placement did NOT follow the design's assumed
  route, and the checklist now says so: the env tools refuse
  caller-chosen Secret values by design (Secret values are generated,
  or set in the dashboard), and the Vercel dashboard never displays a
  webhook's signing secret. Placement therefore ran as an owner-side
  dashboard act: delete + recreate, the fresh secret carried
  field-to-field at creation into `VERCEL_DEPLOY_WEBHOOK_SECRET`
  (Sensitive, Production), then a redeploy.
- The first placement carried a wrong value: the receiver's gate
  behavior was correct throughout (500 before configuration, 403 on
  forgeries after), but the dashboard function logs convicted the
  placed value — every real delivery answered 403 and both recorder
  tables stayed empty. The secret was re-placed from a fresh creation
  and the loop was closed in the same minutes: redeploy, real traffic,
  two reads.
- **Recording proof:** from 2026-11-04 11:23:11Z every real delivery
  answers 200; `deployment_events` and `deployments` hold read-back
  rows for real team deployments (the server's own redeploy;
  dokploy-mcp and robinson-ai-systems created → succeeded → promoted
  chains folded into rollup rows), and the classifier names purposes
  live (development-verification for non-production targets; unknown —
  the designed remainder — for ordinary production deployments).
- Known gap: deliveries between the first webhook's creation and the
  fix were refused (500, then 403); Vercel's 24-hour retry may backfill
  part of that window. The rest is a declared day-one gap, consistent
  with the recorder's no-backfill design (AUD-CI §9).

## This PR

Documentation only: the AUD-CI row of `docs/GO-LIVE-CHECKLIST.md` is
ticked with the record above, `docs/STATUS.md` carries the dated
entry, and this card is the paper trail. No tool added, removed or
renamed; registry unchanged at 253; no code touched.
