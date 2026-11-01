# AUD-BO — OAuth identity move: issuer to the branded origin

**Baseline inspected:** main `b32515c` (AUD-BL, #396). Live
`b32515c` (the 2026-11-01 recovered promotion).

**Commission:** the owner ruled 2026-11-01 that the server's OAuth
identity moves from the original `vercel-mcp-liard.vercel.app`
origin to the branded `vercel.robinsonaisystems.com` origin, and
that Muse reconnects once against the new origin afterward. This
supersedes the O-6 disposition (2026-10-30), under which the
branded address was attached strictly additively and the issuer
stayed on the original origin.

## The shape of the move (dossier first, per the standing rule)

The issuer is single-sourced: `publicOrigin(env)` in
`src/core/http.js` reads the one configured value
`PUBLIC_BASE_URL`, and every identity surface derives from it —
the authorization-server metadata (issuer and the authorize /
token / register / revoke endpoints, `oauthServerMetadata` in
`src/core/oauth-handlers.js`), the protected-resource metadata
(resource and authorization_servers), the keyless 401's
`WWW-Authenticate` resource_metadata pointer
(`src/core/mcp-auth.js`), the hosted Muse client document's
client_id (redirect URI unchanged), the revocation resource
check, the developer connect page, and the health endpoint's
OAuth self-consistency leg. Grep-verified: the literal old origin
occurs ZERO times in `src/` or `api/`. The identity therefore
moves by changing the one configured value — production env
record for `PUBLIC_BASE_URL` (production target only) set to
`https://vercel.robinsonaisystems.com` as this card's operational
companion step, applied before the release promotion so the new
deployment is born with it — plus the consistency sweep in this
PR. No derivation code changes; the AUD-BD/AUD-AZ issuance
derivation is untouched.

## What this PR changes

- `scripts/check-connected-acceptance.mjs`: the default target
  origin is now the branded origin (the `VERCEL_MCP_ORIGIN`
  override is unchanged).
- `tests/unit/connected-acceptance.test.js`: the fixture origin
  constant is the branded origin; the scheme-rejection negative
  case uses `http://` on the branded host, semantics unchanged.
- `docs/DEPLOY.md` §5: the 2026-10-31 recorded note is superseded
  by a dated AUD-BO record of the move.
- This card and one STATUS bullet.

## Deliberately left, with reasons

- `tests/unit/connection-page.test.js` still pins that the
  /connection payload must not contain `vercel-mcp-liard`. Post-
  move the pin guards against regression to the OLD origin.
  Unchanged text, recorded here so it is not "fixed" later.
- `docs/developer-evidence.json` and the dated O-6 records
  (STATUS history, `docs/pr-cards/O-6.md`,
  `docs/designs/BATCH-O.md`) name the old origin because it was
  the truth on their dates. Evidence is not rewritten.
- Tests that pin the derivation with `*.example.test` origins are
  untouched — they test derivation, not the production value.

## Judgments recorded

- **The old origin after the move:** both origins serve the same
  deployment and the same configuration, so discovery fetched
  from the old origin names the NEW issuer. Accepted and intended:
  the old origin becomes a pure serving alias (front door and
  health keep answering there). Host-derived OAuth metadata is
  not introduced — the standing invariant that request Host
  headers never determine OAuth metadata stands.
- **Previously issued credentials:** resource validation binds
  to the current origin, so credentials issued against the old
  resource stop validating at the move. Nothing live breaks: the
  only OAuth connection was owner-disconnected on 2026-11-01
  ahead of this move; no RTC write pass has ever been issued
  live; Door-2 enrollments are Vercel credentials, unrelated to
  this server's issuer. Stored rows are untouched and age under
  the AUD-AO retention clocks.
- **The diagnostic DCR client** registered during the 2026-11-01
  reconnect diagnosis (`lcuBawHCE7WTZpeuRJqQ2rNl0TPYHNaN`): a
  registration record in the same store, equally inert before and
  after the move (no grants, never authorized). No DCR-client
  deletion surface exists in the registry available to the
  coordinator; it is recorded here and in the gate record, and is
  deleted if such a surface ever ships.

**No catalog impact.** No tool is added, removed, renamed or
re-described; the registry is unchanged (253 registered / 254
catalog rows) and `docs/TOOL-CATALOG.md` is untouched. No `src/`
or `api/` file changes.

## Release and acceptance

On the owner's explicit word (2026-11-01) this card ships as a
daytime release, not on the nightly train: merge at green exact
head, set the `PUBLIC_BASE_URL` production value, then the
owner-override promotion (delete the day's
`live-promotion/2026-11-01` marker + recovery dispatch). Live
acceptance, run post-release against the new origin: discovery
declares the new issuer and all four endpoints; the authorize
page renders; DCR accepts a valid registration; keyless
`/api/mcp` returns 401 whose `WWW-Authenticate` pointer names the
new origin's protected-resource metadata; `/api/health` reports
the serving SHA with status ok (its OAuth-consistency leg follows
the configured origin, so a degraded health would convict the
metadata, not decorate it); `/api/contract` names the new origin
wherever it names one; the old origin's front door still answers
(alias behavior above). The fresh Muse sign-in against the new
origin is the owner's single reconnect and the AUD-BD/AUD-AZ
live proof; it follows this card, it is not claimed here.
