# SR-6 — Public login always full: profiles are development options

Date: 2026-11-02
Ruling: the owner, 2026-11-02 05:45 MST, verbatim: "Read
only, everyday and full are development options and should
not be part of the public log in. Public login should
always give full." Expedited by the owner's word the same
morning (build + merge immediately; the release runs as an
owner-override; his next login is the acceptance test).

## The ruling, precisely

- No profile choice is presented to public users, and no
  tier derivation is applied to public connections: a
  public login always yields the **full** profile.
- UNCHANGED: the read-only **switch** in a connected
  user's own settings (IN-09; `vercel_set_read_only` + the
  `oauth_tokens.read_only` enforcement) — an end-user
  control after connecting, not a login class.
- UNCHANGED: limits inherent to the enrolled credential
  (an install token's Vercel-side scope) still bind — that
  ceiling is Vercel's, not a profile tier.
- The dev door (`/api/dev/*`) keeps the profile machinery
  for development use — unchanged.
- RTC passes: disposition below.

## Survey — every place a profile is derived, stored or applied

Method: tree-wide grep for profile derivation, assignment
and read-back across `src/`, `api/`, the schema and the
test fakes, read at each site. (Project profiles —
`known_apps` rows, P-1 — are data about Vercel projects
and are not connection profiles; out of scope.)

| # | Place | Class | Finding | Disposition |
|---|-------|-------|---------|-------------|
| 1 | `issuanceFor` (`src/vercel/login.js`) — the single derivation behind consent rendering and code creation | both | Returns `profile: 'full'` as a constant since AUD-BD; mode derives from the account's production switch ∧ production deployment | Conforms already; pinned by the new journey invariant |
| 2 | Public attested consent POST (`authorizeAttested`, `src/core/oauth-handlers.js`) | public | Profile comes only from `issuanceFor`; no posted profile/mode/listing is read anywhere in the handlers (grep: zero reads) | Conforms; crafted-param pin added (journey test) |
| 3 | Legacy authorize POST via `devAuthorize` + the non-public class | dev | Same `issuanceFor` derivation | Unchanged (dev door keeps working; existing suites) |
| 4 | Enrollment branch POST (`enrollLegacy` → `createAuthCode` via `issuanceFor`) | public journey | Same derivation | Conforms |
| 5 | `db.createAuthCode` parameter default `profile = 'everyday'` | storage | Latent tier mint: any caller omitting the argument issues an everyday code. Both live callers pass it explicitly today | **CONVICTED — default is now `'full'`** |
| 6 | `db.createAccessToken` parameter default `profile = 'everyday'` | storage | Same latent mint at token creation | **CONVICTED — default is now `'full'`** |
| 7 | Schema column defaults: `oauth_codes.profile` / `oauth_tokens.profile` `DEFAULT 'everyday'` | storage | The tier survives at rest as the fallback for any insert that omits the column | **CONVICTED — `SET DEFAULT 'full'` on both tables (CREATE text + ALTER, the AUD-C pattern); stored rows never rewritten** |
| 8 | Token exchange + refresh rotation (`token` handler, `rotateRefreshToken`) | neither — application | Copies the stored profile verbatim; a refresh is not a login and re-derives nothing | Unchanged; stored rows keep the profile they were issued with (grandfathered, as listings already are) |
| 9 | `requireMcpToken` (`src/core/mcp-auth.js`) | application | Validates the stored profile ∈ PROFILES and exposes it as `connection.profile` | Unchanged |
| 10 | Profile machinery (`src/core/profiles.js`: `visibleToProfile`, `listProfileTools`, per-tool `profiles` arrays, front-door listing variants) | application | Applies whatever profile a credential carries; derives nothing at login. This machinery IS the development-options surface (dev door, passes, stored rows) | Unchanged |
| 11 | `vercel_whoami` read-back (`src/tools/server.js`) | read-back | Reports `connection.profile` verbatim | Unchanged; the journey invariant asserts the publicly minted connection authenticates as `full` — the exact record whoami reports |
| 12 | Front door (`api/index.js`): anonymous JSON carried `tools_by_profile {read_only, everyday, full}`; the page stated "Available by connection profile: read-only N · everyday N · full N" | **public presentation** | Presents the three tiers as connection classes to anonymous public readers — on the public surface there is exactly one profile | **CONVICTED — census removed from both shapes; the page states the one truth ("Every sign-in gets the full tool set — there are no sign-in tiers")** |
| 13 | Connect page (`api/connection.js`), "What a connection can do" | **public presentation** | STALE AND FALSE since AUD-BD: "A team install starts with the everyday tool set; a connection made with your own Vercel token starts with the full set" — a door-tier derivation the code abolished | **CONVICTED — copy corrected: every sign-in starts with the full set; reach follows the connected account's Vercel-side permissions / the token's enrolled scope, the production switch, and the read-only switch** |
| 14 | Developer handoff (`src/developer/handoff.js`) | dev | Lands on `devAuthorize`; carries no profile/listing choice of its own | Unchanged |
| 15 | RTC pass system (`rtc_passes` table + defaults, `src/rtc/door.js` attestation + door whoami, `vercel_issue_pass` / `vercel_revoke_pass` / `vercel_reveal_one_time_secret`, `db.issue*RtcPass`) | owner connection | Pass profiles are chosen by the owner at issuance; read passes are forced `read_only` | **UNCHANGED — see the pass disposition** |

## Pass disposition (recorded, per the ruling's scope)

RTC passes are **unchanged**. A pass is not a login of any
class: it is a scoped bearer delegation the account owner
issues from their own full-profile connection
(`vercel_issue_pass`, gated to `profiles: ['full']` owner
connections), with explicit areas, rate, expiry, mode
and — for write passes — a spend ceiling and optional
project restriction. Nothing in any sign-in flow mints,
derives or presents a pass profile. Passes and connections
share only the profile *vocabulary* and the visibility
machinery (survey #10) — not an issuance mechanism — so
the ruling's words ("part of the public log in") do not
reach them, and no pass behavior changes in this card.

## What changed

- `src/db.js` — `createAuthCode` / `createAccessToken`
  parameter defaults `'everyday'` → `'full'`; the
  `oauth_codes` / `oauth_tokens` CREATE defaults likewise;
  two `ALTER … SET DEFAULT 'full'` statements on the
  AUD-C pattern, with the SR-6 comment. `rtc_passes`
  untouched. `test/helpers/fake-db.js` mirrors both
  parameter defaults (fixture parity).
- `api/index.js` — `tools_by_profile` removed from the
  anonymous JSON; the page's per-tier census line replaced
  with the single statement; the now-unused
  `profileToolCounts` import removed (the machinery itself
  stays — survey #10).
- `api/connection.js` — the "What a connection can do"
  section corrected (survey #13). No AUD-AK pinned text
  touched; nothing under `src/tools/` changes, so
  TOOL-CATALOG is untouched and the registry stands at 253.

## The invariant, pinned

- `tests/unit/signin-journey.test.js` (new SR-6 test):
  the full public journey through SR-1's fake Vercel AS
  with **crafted** `profile=read_only` / `mode=preview` /
  `listing=catalog` on BOTH the authorize request and the
  consent POST — detour, attested consent, code, real
  token exchange — and the authenticated connection (the
  record `vercel_whoami` reports) reads `profile: 'full'`,
  `listing: 'front_door'`, mode derived (`production`),
  never the crafted tier.
- `tests/unit/front-door.test.js` (AUD-C issuance-defaults
  suite extended): a code and a token created with NO
  profile argument carry `'full'`, never `'everyday'`.
- `tests/unit/landing-status.test.js`: the anonymous
  document has no `tools_by_profile`; the page carries the
  new sentence and not the census.
- Existing pins keep standing: posted profile params
  cannot steer the legacy issuance (oauth-handlers suite),
  the dev-route split, the read-only switch suite
  (IN-09 untouched), and the pass suites (disposition
  above).

## Release

Expedited on the owner's word (2026-11-02 05:48 MST):
merged to main on build, released by owner-override
promotion; the owner's next login is the acceptance test.

## Fix note (same PR, second commit)

CI's db suite caught a pin this card missed in its first
commit: `tests/db/schema.test.js` ("enforces safe
defaults") asserted the oauth tables' profile default
matched /everyday/ — the pre-ruling value, pinned the same
way AUD-BD's production-switch pin sits above it. The pin
now asserts /full/ for exactly the two convicted tables;
the assertion's strength is unchanged (an exact default is
still enforced), and the local db-suite run that
reproduced the failure passes with it.
