# AUD-BY — Public health answers without touching the store (the Neon wake-up fix)

Filed 2026-11-03 from the owner's platform-budget ruling the same
morning: keep Neon under $20/month and as low as possible — pay only
for what live production services need. The wake-up audit (read-only,
proven from code) found this server's own health endpoint among the
three fleet stores being kept awake around the clock.

## The defect

`src/health.js`'s `/api/health` handler awaited
`db.storeReachable()` — a `SELECT 1` against the Neon store — on
EVERY request, by design (AUD-AP built it that way: a genuinely
failable store leg for the public roll-up). The store is Neon with
scale-to-zero after five quiet minutes. Two of the owner's own
watchers call `/api/health` every 300 seconds, so the compute never
gets five quiet minutes: it stays awake 24/7 at roughly 15 CU-hours
every 3 days (~$19/month) answering health checks. A watcher leg
needs liveness and release identity, not a database round-trip.

## The fix

1. **`/api/health` is database-free.** The public document keeps its
   exact pinned shape (status, version, deployed_source_sha, tools,
   timestamp; 200/503) and is answered entirely from memory and
   configuration. Its one remaining check — OAuth metadata
   self-consistency with the configured origin — is derived from
   configuration alone and can still genuinely fail (missing or
   non-HTTPS `PUBLIC_BASE_URL`, or metadata drift). The production
   wiring no longer builds a store handle at all on this path, and
   `healthDocument` takes no db parameter, so the store cannot be
   wired back in by accident (pinned by test: a down/throwing store
   handed to the handler is never called and cannot flip the answer).
2. **The real store check moves behind sign-in.**
   `GET /api/health/deep` (a `vercel.json` rewrite to the thin
   `api/health-deep.js` function, the repo's existing pattern for
   non-filesystem paths) requires the server's existing connection
   bearer check — the same `requireMcpToken` as `/api/mcp`, which
   answers the 401 itself. Authentication runs first: a keyless or
   refused caller never reaches the store probe. Behind it, the deep
   document serves the public five fields plus a `checks` breakdown
   (`store`, `oauth_metadata`) with the real `storeReachable()`
   verdict both ways, 200/503. Nobody polls this path routinely; it
   exists for deliberate diagnosis — the 3AM runbook's store leg now
   points here.
3. **Docs follow the code.** DEPLOY.md §9 (the 3AM runbook) no longer
   sends a degraded public health leg at the database: public
   `degraded` now means origin/metadata configuration; the store is
   proven through the authenticated deep check. STATUS.md carries
   this card's entry.

## Acceptance

- Unit tests: public handler issues no store query (spy-proven with
  down and throwing stores); deep document reports the real store
  verdict up, down and throwing; keyless refusal is 401 before any
  store query against the REAL bearer check; unknown token is 401
  with the store unprobed; authenticated callers get 200 up / 503
  down with the pinned deep shape; non-GET refused before auth.
- Full suite + `npm run check` green locally; CI `ci` +
  `release-policy` green at the exact head before merge.
- Rides the nightly 00:01 promotion as usual (owner's ruling: not a
  fire, no daytime release). Live proof is owed after the promotion:
  `/api/health` answers in the same shape on the new build, and the
  deep check answers 401 keyless and reports real reachability with
  a connection token.
