# Developer-only backend access (SR-4, 2026-11-01)

This page is the repository's own record of the
developer/operator door, written for agents and
operators who work in this repo (the owner directed
2026-11-01 18:48 MST that any agent working here can
learn where it exists and how to use it from the repo
itself). The public pages never link or name this
route — that silence is deliberate and ruled (the
public connection journey is Vercel's own sign-in
only). This internal documentation is where the door
is documented; coordinator briefs for this repo point
here.

## Where it is

On the same deployment as the public surface, under
a distinct developer namespace:

| Route | What it serves |
|---|---|
| `GET/POST /api/dev/authorize` | The operator consent: the account picker + administrator passphrase form (the pre-SR-2 authorize, unchanged) |
| `GET/POST /api/dev/enroll` | The enrollment branch: token enrollment + Blob store connection, passphrase-gated (the AUD-AR branch, unchanged) |
| `POST/GET` the developer handoff endpoint (unchanged; its path is the `callbackPath` constant in `src/developer/handoff.js`) | Handoff start + poll; its browser consent leg is built on `/api/dev/authorize` |

## What it is for

- Developer/operator work on this server: enrolling
  accounts (incl. break-glass enrollment), consenting
  connections for testing, and exercising the doors
  the public journey is built from.
- **Builder agents recovering production
  connections**: the developer handoff runs through
  this door. An agent whose connection is wedged
  starts a handoff, the operator consents at
  `/api/dev/authorize` with the passphrase, and the
  agent finishes with the sealed code — no copied
  pass, no public sign-in involved. This is a ruled
  capability (owner clarification 2026-11-01 18:40
  MST), not an accident of the routing.

## How an agent authenticates

The gate is the administrator passphrase, evaluated
by the same `evaluateLogin` as always: failures are
counted per source address in a shared 15-minute
budget across both dev POSTs; more than 5 failures
locks the door (HTTP 429, `Retry-After: 900`). If
the passphrase is not configured on a deployment,
both POSTs fail closed with 503.

**Obtaining the value:** only through the owner's
secure credential route (the same protected setup
that holds this server's other operator secrets).
The value itself appears in NO documentation, chat,
code, test or commit — any of those sightings is a
leak to report, not a convenience to use. An agent
that does not already hold it through that route
asks the owner; it does not search the repo, the
history or the environment for it.

## Its limits

- Issuance is still derived, never chosen: a consent
  through this door derives profile/mode/listing from
  the account exactly as the public journey does
  (AUD-AZ/AUD-BD). On a non-production deployment the
  derivation can only mint preview-mode connections;
  on the production deployment it can mint production
  connections for accounts whose production switch
  is on — that reach is the point of the recovery
  door, and it is why the passphrase protects it.
- It is not a tool: nothing here is in the tool
  catalog, and no MCP call reaches it.
- It does not resurrect deleted surfaces: the owner
  setup route stays deleted (404 everywhere), and
  owner administration still happens on the owner's
  own authenticated connection.
- RTC passes are untouched: they authenticate at
  their own door by bearer shape and have nothing to
  do with this route.
