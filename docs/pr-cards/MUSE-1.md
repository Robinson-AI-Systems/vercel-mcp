# MUSE-1 — Muse sign-in: omitted `resource` and duplicate binding cookies (RAS MCP Standard D-006)

**Commissioned:** 2026-11-09 by the owner: "whatever you did for this to work
with Muse needs to be done to all my custom MCP servers and this needs to
become part of my RAS MCP Specification." The fleet design is filed as
D-006 in the Library (`designs/ras-mcp-muse-connection.md`); this card is
Vercel Unleashed's share of it.

## Live finding (2026-11-09)

The Muse client document (`/.well-known/muse-client.json`) was served and
recognised, and the client ID card resolver was in place. A Muse authorize
with that document as `client_id` and no `resource` was refused "Authorization
code, S256 PKCE, and exact MCP resource are required". The same request with
`resource` supplied went straight on to Sign in with Vercel. So the omitted
resource was the only gap.

## Scope

- **D-006 MC-4.** An absent or empty `resource` means this server's MCP at
  authorize, the developer authorize and the token endpoint (code exchange
  and refresh). Any sent value must still match exactly.
- **D-006 MC-7.3.** The sign-in binding check accepts any binding-cookie copy
  matching the flow, so a stale copy beside the live one no longer reads as
  the wrong browser. MC-7.2 already conformed here: a missing or wrong
  binding renders the plain "Finish signing in from the browser that started
  it" page and never restarts the Vercel round trip.

## Acceptance

- `tests/unit/muse-resource-default.test.js` and the new
  `tests/unit/signin-journey.test.js` case both fail without the fix and pass
  with it.
- `npm run check` and the full suite pass at the exact head.
- Live (after release): the D-006 §7 knock probe. Authorize with the
  document address and no `resource` reaches Sign in with Vercel. Then a real
  Muse connect lists tools and runs one call.
