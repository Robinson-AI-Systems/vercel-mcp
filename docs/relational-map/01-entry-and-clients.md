# 01 — Entry and clients

## Hosts (one codebase, two shapes, one contract)

- **Production today: the Development Rack.** Since 2026-11-08 production
  serves from the rack at `https://vercel.robinsonaisystems.com` via
  `rack-server.mjs`, a thin standalone Node server that reproduces the
  Vercel function contract route-for-route. The hosted Vercel deployment
  and its dedicated Neon store were retired the same day.
  Evidence: the 2026-11-08 entry in `docs/STATUS.md` (the move, then the
  Vercel project and Neon store deleted and read back gone). Re-checked
  live 2026-11-18: the rack's route table serves
  `vercel.robinsonaisystems.com` from a rack instance (route generation 15,
  production release receipt 364), and the Vercel team's project list has
  no vercel-mcp project.
- **Vercel-shaped contract:** `api/**/*.js` default exports are the
  handlers; `vercel.json` carries the rewrites. `rack-server.mjs`
  implements exactly the same binding (filesystem routes, `[name]` /
  `[handle]` bracket segments as query params, the `vercel.json`
  rewrites verbatim), so no application logic lives in the entrypoint.
- Release identity: health and the front door read the deployed commit
  from `VERCEL_GIT_COMMIT_SHA`; on the rack the build pins it from
  `RACK_RELEASE_COMMIT` or `release-commit.txt`. No pin → health
  honestly reports a null commit.

## Routes (`api/`)

| Route | Handler | Serves |
|---|---|---|
| `/` , `/api` | `api/index.js` | Front door / service home (`src/front-door.js`) |
| `/api/mcp` | `api/mcp.js` | Streamable HTTP MCP transport (SDK) |
| `/api/contract`, `/api/openapi.json` | `api/contract.js`, `api/rtc-openapi.js` | RTC 1 contract + OpenAPI document |
| `/api/whoami` | `api/whoami.js` | Authenticated identity / connection read |
| `/api/tools`, `/api/tools/{name}`, `/api/tools/_batch` | `api/tools/*` | RTC-1 tool invocation doors |
| `/api/results/{handle}` | `api/results/[handle].js` | Stored large-result delivery |
| `/api/oauth/*` | `api/oauth/*` | OAuth issuer: authorize, token, register, revoke, enroll, Vercel callback |
| `/api/vercel/connect`, `/api/vercel/integration` | `api/vercel/*` | Connection doors (integration install / token enrollment branch) |
| `/api/dev/authorize`, `/api/dev/enroll` | `api/dev/*` | Developer-only routes, administrator-passphrase gated |
| `/api/developer/connect` | `api/developer/connect.js` | Developer connection route |
| `/connection` | `api/connection.js` | User's own connection page (read-only switch, disconnect) |
| `/api/webhooks/deployments` | `api/webhooks/deployments.js` | Vercel deployment webhook receiver (raw body, HMAC) |
| `/api/health`, `/api/health/deep` | `api/health*.js` | Liveness / deep health |
| `/.well-known/*` | `api/well-known/*` | OAuth authorization-server + protected-resource metadata, Muse client document |

## Clients

- **MCP clients** (Claude, Muse, ChatGPT, other MCP apps) — connect to
  `/api/mcp` with OAuth; see 02.
- **Robinson Toolkit Hub** — consumes the RTC 1 HTTPS surface
  (`/api/contract`, `/api/tools…`); the Hub initiates discovery and keeps
  provider schemas out of the agent's default tool menu
  (`docs/HUB-COMPATIBILITY.md`). This server stays independently usable
  without the Hub.
- **Browser users** — front door, sign-in journey, `/connection` page.
