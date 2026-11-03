# AUD-CG — The pinned preview fetch answers Node's address-list lookup contract (branch G, fetch leg)

Filed from AUD-CF's live verdict (2026-11-03): branch G's
fetch on the seeded run failed with `failureClass:
'connection'` — not a protection redirect, not a timeout.
No request ever left the server.

## Root cause (convicted from the transport source)

`pinnedHttpsGet` pins the validated IP through a custom
DNS `lookup` that always answers in the scalar form
`(null, address, family)`. Node's connection layer asks
the lookup for the full address list (`options.all`, the
auto-select-family contract) and expects an array of
`{address, family}`; the scalar answer breaks the socket
before any connection is attempted. The production fetch
path therefore never worked against a real socket — the
suites inject a test fetcher for the handler and a fake
request for the transport, and neither exercises Node's
real lookup contract. A second latent defect rode along:
the handler pinned only the first validated address, so
one unroutable family or dead edge would fail the fetch
even with the contract fixed.

## Fix

- The lookup now answers each contract in its own shape:
  an array of `{address, family}` when `options.all` is
  set, the scalar form otherwise.
- A new `pinnedHttpsGetAny` tries each pre-validated
  address in resolver order until one produces an HTTP
  outcome; connection and timeout failures fall through,
  while a redirect or an invalid status — a real answer
  from the deployment — stops the iteration. Every
  attempt stays pinned to an address `publicHost` already
  validated; the SSRF discipline is unchanged. The fetch
  handler calls it with the full validated set.

## Acceptance

Unit proof in this PR: a new transport test answers the
lookup through the `all:true` contract, fails the first
address with a connection refusal, and succeeds on the
second — it fails with the fix reverted. Full suite and
`npm run check` green locally; CI `ci` + `release-policy`
green at the exact head. Live proof rides the promotion
under the owner's 2026-11-03 release-now directive:
branch G's fetch re-run on the seeded run must return
the seeded page through the bypass (direct fetch answers
302 to sign-in — already proven). No tool added, removed
or renamed; registry unchanged at 253.
