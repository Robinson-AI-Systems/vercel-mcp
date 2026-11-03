# AUD-CI — The deployment webhook receiver: every deployment gets a name and a purpose

**Commissioned:** 2026-11-03, by the owner, from the approved design at
`research_notes/vercel-deployment-webhook-design-2026-11-03` (kept with the
coordinator's records). The Nov 1–3 manual-deployment census could count
107 manual production deployments but could never say WHO made them or
WHAT they were for — Vercel's own records say "manual" and nothing more.
This card builds the receiver from that design, unaltered in shape.

## What this card does

1. **One new route** — `POST /api/webhooks/deployments`
   (`api/webhooks/deployments.js`, body parser off;
   `src/webhooks/receiver.js`). It verifies `x-vercel-signature` as
   HMAC-SHA1 over the RAW body with a constant-time compare before
   anything touches the store; a forged delivery gets a 403, is counted
   in-process, and is never stored. Unsubscribed event types are
   acknowledged and dropped.
2. **Two additive tables** in the server's existing store
   (`src/db.js initSchema`, names added to `SCHEMA_TABLES`):
   `deployment_events` (one row per delivery; the raw envelope kept
   verbatim; unique on the delivery id, because Vercel retries for up
   to 24 hours) and `deployments` (one row per deployment: project,
   the acting user id from the payload — the attribution the census
   lacked — target, state timeline, promote/rollback flags, commit
   fields lifted from meta under the recognized key spellings, and the
   purpose fields). No existing table is touched.
3. **The purpose classifier** (`src/webhooks/classify.js`, pure): the
   design's four deterministic rules in order — scheduled-release
   (production created inside the 00:01–00:45 Denver promotion
   window), production-repair (production after a failed production
   deployment, or replacing a same-branch production deployment
   created less than two hours earlier), development-verification
   (non-production target, or the second-or-later same
   project+branch deployment of the same Denver day), unknown
   (anything else — an honest class, not a failure). Every verdict
   records which rule fired; a hand correction
   (`purpose_rule='manual'`) is never overwritten.
4. **Honest failures:** if the record write cannot complete, the route
   answers 500 — never a false 200 — so Vercel's retry lands the
   record later; the delivery id makes the retry safe. State only
   moves forward, so out-of-order deliveries cannot regress a row,
   and timestamps come from Vercel's envelope clock, not arrival
   order.

## What this card does NOT do (sequenced, per the design)

- **Registration waits for the live build.** The webhook is created
  (dry-run first, per the design) only after this receiver is live on
  the production address, so no delivery ever points at a route that
  does not exist. At registration: create → reveal the signing secret
  exactly once → set `VERCEL_DEPLOY_WEBHOOK_SECRET` on the project →
  redeploy → prove end-to-end with the server's own test-webhook tool
  and one real scratch preview deployment, reading the rows back.
  Until the secret is set, the route answers 500
  `webhook_secret_not_configured` to anything that knocks.
- **Meta key confirmation** happens against the first live
  deliveries: the payload spec names meta only as a Map, so commit
  fields lift from the recognized spellings and stay null (with meta
  preserved verbatim on every event) until a live delivery proves
  the real keys.
- No alerting, no backfill of the Nov 1–3 window, no freshness
  watcher — the design names all three as out of scope for v1.

## Proof

- Unit tests (`tests/unit/deployment-webhook.test.js`, 12 tests):
  signature accept/reject with the store untouched on a forgery,
  unconfigured-secret 500, non-POST 405, preview lifecycle recorded
  and classified, duplicate absorbed, out-of-order state held,
  promotion-window / after-error / repeat-deploy / unknown
  classifications, rapid-replacement as a direct classifier case,
  manual purpose never overwritten, unsubscribed type ignored,
  store failure answered 500, Denver window/day-boundary edges.
- DB tests (`tests/db/deployment-webhook.test.js`): the real SQL
  against a throwaway Postgres — idempotent delivery insert,
  rollup upsert, and the classification context (previous
  production row + same-day count including the deployment
  itself).
- `npm run check` and the full suites; both repository gates green
  at the exact head before merge.

Release rides the nightly promotion, as commissioned; registration
and the end-to-end proof follow once the build is live.
