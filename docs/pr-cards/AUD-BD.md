# AUD-BD — the login fix: a normal end-user sign-in lands production / full

**Filed:** by the coordinator 2026-10-31 (~11:58 MDT, from the owner's
interrupted request of 2026-10-31 ~01:47 UTC). **Territory:** VMCP-025
(the production-mode discoverability line), on top of the sign-in
cleanup program (AUD-AZ…AUD-AY). **This card's build is source-only:**
its live proof rides a nightly train, and the owner's single sign-in
sitting (the Tier-1 acceptance sitting) is the production sign-in
proof. Nothing in this card claims live behavior.

## The owner's words (the spec)

> A normal end-user login should land entirely in production mode
> with a full profile, never silently preview-only/read-only.

The owner's own seat is NOT in scope (verified production/full after
the DPGA rotation; untouched by this card, like every stored row).

## Shape map (dossier-first — mapped against current source, main `f95d79f`)

### What the derivation reads today

`createVercelLoginService(db).issuanceFor(account, env)`
(`src/vercel/login.js`) is the single derivation authority; the
authorize handler (`src/core/oauth-handlers.js`) binds its
`{mode, profile}` plus the fixed `front_door` listing into the auth
code, and the consent page renders its caption/note. Inputs today:

| Output | Derivation today | Authority |
|---|---|---|
| `profile` | Door 1 (probe record `source: 'integration'`) → `everyday`; Door 2 (pasted token) → `full` | cleanup dossier decided default **D1** |
| `mode` | `production` iff the account row's `production_enabled` is true **and** `env.VERCEL_ENV === 'production'`, else `preview` | dossier **D7** + the pre-AZ `modesFor` conjunct |
| `listing` | always `front_door` for OAuth issuance | OP-1 |

### Where the silent preview-only landing is manufactured

`db.upsertVercelAccount` (`src/db.js`) — the single funnel for all
three enrollment paths (`storeToken` Door 2, `storeInstallationToken`
Door 1, `storePersonalToken`; all in `src/vercel/tokens.js`) — never
writes `production_enabled`: not in the INSERT column list, not in
the ON CONFLICT update. A brand-new account row therefore takes the
schema default, `BOOLEAN NOT NULL DEFAULT FALSE` (`src/db.js`
initSchema). Consequences, all silent for a new end user:

- their first sign-in derives `mode = preview` (D7 reading a switch
  they never chose — it was set by the schema, not by them);
- a Door 1 sign-in additionally derives `profile = everyday` (D1);
- the switch's FALSE is load-bearing downstream, not cosmetic:
  `requireMcpToken` (`src/core/mcp-auth.js`) rejects a
  production-mode token on every call while the account row's switch
  is off, and `vercel_set_working_box`'s production rung refuses on
  the same read (`src/tools/server.js`) — so even a manual flip
  cannot rescue the landing until `vercel_enable_production` runs.

The cleanup dossier itself recorded this as a residual: "newly
enrolled account rows default `production_enabled` FALSE until the
owner flips it once — an owner policy call" (IN-09's AUD-AN update
note). This card is the owner making that policy call the other way.

### What this card changes

1. **New account rows are born with the production switch ON.**
   `upsertVercelAccount` writes `production_enabled = TRUE` in its
   INSERT. The ON CONFLICT (rotation/re-enrollment) update
   deliberately does **not** name the column: an existing row's
   switch — the owner's standing choice, in either direction —
   survives rotation untouched, exactly as today. The schema default
   becomes `TRUE` in the CREATE TABLE, and an idempotent
   `ALTER TABLE … SET DEFAULT TRUE` rides `initSchema` (the AUD-AZ
   listing-default precedent) so the existing table's default agrees
   with fresh installs. The fake db mirrors the new-row seed.
2. **Sign-in profile is `full` for both doors.** `issuanceFor` no
   longer derives profile from the door: `full` is the sign-in
   default the owner filed. This supersedes **D1** (reversible
   per-card, as D1 itself stated). The doors still differ where they
   genuinely differ — the credential's own Vercel-side scope (an
   install token's team/project reach vs a token's scope box) is
   read back at enrollment and remains the ceiling; restraint after
   sign-in lives in the user's own switches (production switch,
   read-only switch), never in a consent class.
3. **Mode derivation is otherwise unchanged.** D7's rule stands —
   initial mode from the account's switch — but the switch now
   defaults ON at enrollment, so a normal sign-in on the production
   deployment lands `production`. A user who turns their switch off
   keeps starting in preview: that is their standing choice, and the
   consent caption/note already state it in plain words (information,
   not a silent landing).

### What must NOT change (preserved, pinned by existing tests)

- **The server-deployment conjunct.** The filed card is silent on
  it, so it is preserved and stated here: a non-production
  deployment of this server (`VERCEL_ENV !== 'production'`) still
  never mints a production connection. It is a deployment-identity
  guard, not a user-facing downgrade: on the production deployment —
  the surface the owner's words address — the landing is
  production/full.
- **Door-2's full-profile derivation** (now simply the universal
  derivation), **the enrollment probe + scope read-back before
  storage** (`storeToken` unchanged), and the read-back page.
- **Grandfathering (D6):** stored `oauth_tokens` / `oauth_codes`
  rows are never rewritten; derivation applies at consent. Existing
  `vercel_accounts` rows keep their stored switch value — this card
  changes what NEW rows are born with, and no stored connection's
  mode/profile/listing moves.
- **RTC passes** (D5): pass profile/mode/listing semantics are the
  pass door's own contract, untouched. A new sign-in's read-only
  state is the AUD-AQ switch on the token row, which defaults off —
  never silently read-only.
- **whoami** needs no change: it reports the stored row's truth, so
  a new connection self-reports production/full from the same facts.

### Parts of the filing the cleanup program already discharged

The filing's "production login screen blended with the testing
grant system and dev setup page" was answered by AUD-AV (the setup
route is deleted), AUD-AW (the developer handoff mints only the
standard connection) and AUD-AZ (one sign-in, no pickers). This card
is the remaining piece: the landing defaults themselves.

## Tests

- `tests/unit/oauth-handlers.test.js` — the AUD-AZ derivation matrix:
  profile is `full` on both doors in every row (mode rows unchanged:
  fixtures seed the switch explicitly, so D7 + the conjunct still
  pin mode); the real-boundary test's Door 1 connection now reads
  `profile: 'full'` with the full tool set, and the grandfathered
  legacy row's assertions are unchanged.
- `tests/db/token-store.test.js` — a fresh Door 2 enrollment's row
  reads `production_enabled = true`; rotation preserves the stored
  switch in both directions (born-on stays on; an owner-set off
  stays off).
- `tests/db/schema.test.js` — the schema-default pin reads `true`.
- `tests/db/owner-apply.test.js` — fixture correction found by the
  full db run: the production-enable leg's `team_GAMMA` row was
  inserted raw without naming `production_enabled`, so it silently
  inherited the old FALSE default as its disabled precondition.
  The fixture now states `production_enabled = false` explicitly;
  every assertion of the leg (proposal, apply, journal, replay
  refusal) is unchanged.

**Catalog judgment:** no tool is added, removed or renamed, and no
tool's contract changes → `docs/TOOL-CATALOG.md` untouched. The
living-docs derivation/default statements that this card falsifies
are corrected in the same PR (drift checklist B): CLIENT-CONNECTIONS'
derivation sentence, DEPLOY's fresh-account sentence, IN-09's
residual note, plus a DECISIONS entry recording this ruling as
D1/D7's supersession.

## Acceptance

- [ ] Fresh enrollment (any door) → stored row `production_enabled = true` (db evidence).
- [ ] New sign-in on the production deployment derives `mode = production`, `profile = full` on both doors (unit matrix + boundary).
- [ ] Rotation never moves an existing row's switch, either direction (db evidence).
- [ ] Grandfathered stored connections authenticate byte-identical (existing boundary assertions).
- [ ] Full repo check green locally; CI `ci` + `release-policy` green at the exact head.
- [ ] LIVE proof: **owed, not claimed** — rides the nightly train; the owner's single sign-in sitting is the acceptance.
