# AUD-BN — D-2 runtime-log stream diagnosis: the `unknown_error` convicted and fixed

Status: built on the owner's finish directive (2026-10-31); D-2's work-index revisit
named this diagnosis ("October 14 current READY custom-MCP runtime stream still
returns unclassified error with valid deployment identity. Candidate bounded
stream/error diagnosis needs CI, checked release, and genuine native/provider proof").
Design: `docs/designs/BATCH-D.md` §D-2; prior slices D-2l (#172) and D-2m (#190).
Migration: none. No tool added, removed or renamed; the one catalog row for
`vercel_deploy_get_runtime_logs` is corrected where it states the convicted bound.

## Live reproduction (2026-10-31, deployed production, owner connection, reads only)

| Subject | Call | Outcome |
|---|---|---|
| Current READY production deployment of this server, default 30-min window | `vercel_deploy_get_runtime_logs` ×2 | `unknown_error`, **no HTTP status**, both times |
| Previous READY production deployment (superseded ~16 h earlier) | same | `unknown_error`, no status |
| Nonexistent deployment ID, real project (classification control) | same | `not_found (HTTP 404)` — classified correctly |
| Same live deployment | `vercel_deploy_get` | success |
| Same live deployment | `vercel_deploy_get_build_logs` (ordinary JSON read) | success |

So the defect is alive on the current checked release, deterministic, and specific
to the stream leg: identity proof and ordinary reads are healthy, and the failure
carries no status — it is not a provider HTTP error (every provider error response
keeps its status through `responseError`).

## Conviction (two layers, both in this repo)

1. **Classification.** When the provider request itself never completes (timeout or
   network failure), `src/vercel/client.js` throws `outcome_unknown` — but it
   attached the computed `failureClass` ('timeout' / 'network') **only for writes**.
   For reads the class was discarded, and `src/tools/errors.js` had no branch for
   the code at all, so the surface rendered `unknown_error` with the false claim
   "The provider did not return a recognized safe error code" — the provider
   returned nothing; the request never finished. That is the unclassified error
   the index records, and it violates the IN-18 / AUD-AH classify-why standard.
2. **Budget.** D-2m capped the sampler's whole network deadline at 2.5 s to fit an
   October serverless budget. That single deadline also covers the provider's
   time-to-first-byte on a log-query endpoint; on real deployments the answer does
   not begin inside 2.5 s, so the fetch aborts before the bounded reader (32 KiB /
   50 rows, abort → `time_limit` partial sample) can ever run — the tool fails
   deterministically instead of returning the sample it exists to return. The
   failing calls' end-to-end time sits consistently ~2.5 s above sibling reads,
   matching the abort. (The provider's true time-to-first-byte cannot be observed
   from outside — no token leaves the server, by design; the post-promotion live
   re-run below is the falsification test for the raised bound.)

## Fix (bounded)

- `src/vercel/client.js`: the fetch-failure `outcome_unknown` now carries its
  `failureClass` for reads as well as writes (write shape unchanged — `leg` stays
  write-only, and the write 5xx `http_status` throw is untouched).
- `src/tools/errors.js`: `outcome_unknown` is a classified surface error in plain
  words per class — timeout ("Vercel did not answer before this read's time
  limit… retry; provider latency or an undersized bound, not a refusal"),
  network ("the connection failed before an answer arrived…"), and `http_status`
  ("answered with a server error before the outcome could be verified — read
  back before retrying"). No provider text is surfaced, as everywhere here.
- `src/tools/deployments.js`: the stream request's bound rises 2.5 s → 10 s,
  covering a realistic provider start; the reader's byte/row caps and the
  abort-driven partial-sample semantics are unchanged, and the total worst case
  (identity ≤4 s + 10 s) stays inside this codebase's 25 s provider-timeout norm.
  The TOOL-CATALOG row's stated bound is corrected to match.

## Evidence

- `tests/unit/errors.test.js`: the three classes render their plain-words text,
  never `unknown_error`, never the "no recognized safe error code" claim; a plain
  code-less error still renders `unknown_error` (the class boundary did not move).
- `tests/unit/vercel-client.test.js`: a read whose fetch dies with a timeout now
  rejects `{code:'outcome_unknown', failureClass:'timeout'}`; a network failure
  rejects `failureClass:'network'` (write assertions unchanged).
- `tests/unit/runtime-logs.test.js`: through the real dispatch boundary, a stream
  fetch that times out and one that fails at the network layer now return the
  classified text (not `unknown_error`); the handler's other behavior is pinned
  unchanged by the existing suite.
- Full `npm run check` and the full unit suite at the exact head; CI `ci` +
  `release-policy` green at the exact head before merge.

## Acceptance still owed (not claimed here)

Live acceptance stays open until the nightly promotion carries this fix and the
coordinator's post-promotion battery re-runs the matrix above: a bounded sample
(or an honestly classified timeout, if the provider still cannot start inside
10 s) on a real deployment with events, plus the empty-window case. D-2's wider
acceptance (scoped passes, file scenario, revocation) is untouched by this card.
D-2 remains IN_PROGRESS; its index revisit is refreshed with this evidence.
