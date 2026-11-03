# AUD-BV — Connection page: client directions split by client (fix)

Filed 2026-11-02 from a live owner report: the owner followed the
public `/connection` page literally in Claude, pasted the Client ID
the page offered, and the sign-in failed with
`{"error":"invalid_request","error_description":"Unknown client or redirect address"}`.

## The defect — the published directions, not the server

The page's connect section told every client the same thing: add a
custom connector with the server address, and "If the client asks
for a Client ID, paste the server's own client document"
(`/.well-known/muse-client.json`). That document is Muse-specific
by design (AUD-G): it declares exactly one redirect URI,
`https://agent.meta.ai/api/hatch/oauth/callback` — Muse's own
return address. Any other client that pastes it presents a
client_id whose only accepted redirect is Muse's, so its own
return address is refused.

Live repro (coordinator, 2026-11-02, production): an authorize
request carrying the Muse client_id with Claude's return address
(`https://claude.ai/api/mcp/auth_callback`) reproduced the owner's
error byte-for-byte.

The server itself is not broken. With no Client ID supplied,
Claude registers itself: the coordinator verified the full path
live the same day — `POST /api/oauth/register` accepts the
registration, authorize proceeds, and the flow 302s to Vercel's
own sign-in (the SR-era public journey). Only the directions were
wrong, for every client except Muse.

## Fix

Copy only, in `api/connection.js` (the `/connection` page is
generated there; the rest of the page is untouched):

- Every client: add a custom connector with the server address
  `https://vercel.robinsonaisystems.com/api/mcp`.
- The Client ID sentence is now scoped explicitly to Muse by
  name: "Muse only: if Muse asks for a Client ID, paste the
  server's own client document:" followed by the document URL,
  unchanged.
- A new paragraph for the rest: "In Claude, ChatGPT, or any other
  client, leave the Client ID and the Client Secret blank — the
  client registers itself automatically. Do not paste the Muse
  document there: it only accepts Muse's own return address, so
  any other client using it fails with an "Unknown client or
  redirect address" error."

`tests/unit/connection-page.test.js` pins the new split (the Muse
sentence scoped by name, the blank-fields instruction, the
registration sentence, and the old unscoped sentence gone); the
pre-existing pins (branded address, document URL, custom
connector) still hold.

## Scope notes

- No tool added, removed, or renamed; the registry is unchanged,
  so no TOOL-CATALOG note is needed — this is a public page's
  copy, not a tool change.
- No OAuth behavior changed: the Muse client document, dynamic
  registration, and every client's flow are byte-unchanged. The
  page was the only wrong surface.
- Batches with the nightly release train; no daytime release.
  Until the promotion lands, the live page still carries the old
  wording — the correction is this PR plus the owner's own
  workaround (connect in Claude with the Client ID fields blank).
