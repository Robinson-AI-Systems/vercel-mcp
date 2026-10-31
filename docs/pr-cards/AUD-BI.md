# AUD-BI — VMCP-003: enrollment records the token's real expiry

**Filed:** by the coordinator 2026-10-31 (~17:00 MDT, the owner's
"finish building Vercel" directive). **Territory:** VMCP-003 — the
Production Gate report's #1 ranked gap. **This card's build is
source-only:** its live proof rides a nightly train; no live calls are
made by this card. Nothing here claims live behavior.

## The gap (established record)

The expiry *derivation* machinery exists and is settled: AUD-E built
`src/vercel/token-expiry.js` (one derivation shared by every surface),
and IN-16 settled the 14-day warning's home in `vercel_whoami`.
Tool-*created* tokens record their expiry (O-3: `storeToken`'s
additive optional `expiresAt`, supplied by `vercel_token_create`).

What never happens is *enrollment-side* recording. `storeToken()`
writes `expiresAt: null` on every enrollment path, and the probe
retrieves no expiry — so every enrolled token reads
`tokenExpiresAt: null` / posture `unknown` forever, including tokens
Vercel itself knows carry real, near expiries (the A-14 probe tokens
were 1-hour tokens; both rows still read "expiry not recorded"). The
notify-ahead leg has no subject. This card gives it one.

## Shape map (dossier-first — against the pinned vendor snapshot,
## `vendor/vercel-openapi/openapi-2026-10-11.json`, and current source)

### (a) Bearer API token enrollment (Door 2 — `storeToken` / `probeToken`)

| Question | Contract answer |
|---|---|
| Does a token read expose expiry? | **Yes.** The `AuthToken` component schema carries `expiresAt` — type number, milliseconds since epoch, "Timestamp (in milliseconds) of when the token expires" — as an **optional** property (the schema's `required` is `[activeAt, createdAt, id, name, type]`). Absent means Vercel reports no expiry for that token — the same reading O-3's `tokenRow` already states. |
| Which reads return it? | `GET /v6/user/tokens` (list; response `{ tokens: AuthToken[], pagination }`) and `GET /v5/user/tokens/{tokenId}` (single). Both are already in the OPS table (`tokens_list`, `tokens_get`). The single read needs the token's provider id, which an enrolling credential does not know about itself — the **list is the discovery surface**. |
| Can the enrolling token make the read itself? | **Yes.** `tokens_list` is unscoped in the OPS table ("the token family acts as the token's user") — the same read `vercel_token_list` ships. The endpoint documents **no query parameters**; the documented call is the bare GET, so this card makes exactly that call and no other shape. |
| Do the probe's existing calls carry it? | **No.** `user_get` (/v2/user), `teams_list`, `projects_list` return identity/visibility only. **One additional read** — the token list — is required, once, inside `storeToken` after the probe has proven the credential. |
| How does the token find its own row? | `AuthToken` rows carry `suffix` ("The last few characters of the token") and `id`. A row is a candidate iff: it has a string `id`; a string `suffix` of length ≥ 4 with `token.endsWith(suffix)`; it is not revoked (`revokedAt` not a number); and it is team-consistent — every scope entry naming a `teamId` names the enrollment team (a `user`-scope entry names no team and is consistent with any). **Exactly one** candidate → its record is the token's. Zero or several → nothing is recorded. |

### (b) OAuth installation token enrollment (Door 1 —
### `storeInstallationToken` team installs, `storePersonalToken` personal installs)

| Surface | Carries expiry? |
|---|---|
| The token exchange body | **No.** The exchange gate (`src/vercel/integration.js`) pins the field set: `access_token`, `token_type`, `installation_id`, `user_id`, `team_id`. There is no expiry field to read. |
| The installation's configuration record (`GET /v1/integrations/configuration/{id}`) | **No.** The snapshot's response schema enumerates 25 fields; none is a token or expiry field (`completedAt` / `createdAt` / `updatedAt` are the configuration's own lifecycle timestamps, not the credential's). |
| The auth-token list (`GET /v6/user/tokens`) | **Not reachable by this credential class.** The read acts as the token's *user*; an installation token's documented per-scope endpoint map (the AUD-K dossier) grants the configuration read, the single-team read and the team projects list — no auth-token read appears under any installation scope. |

**Verdict for (b): convicted — no documented surface exposes an
installation token's expiry to the enrolling credential.** This card
builds nothing for (b) and invents no value: installation enrollments
keep `expiresAt: null`, their posture stays honestly `unknown`, and
the limit is recorded in `docs/DECISIONS.md` by this card. If Vercel
ever documents a surface, recording for (b) is a follow-up card.

## What this card changes

1. **`src/vercel/tokens.js` — one evidence leg in `storeToken`.**
   After `probeToken` succeeds, when the caller supplied no explicit
   `expiresAt` (the tool-create route's known value always wins and
   skips the leg), `storeToken` makes the one documented bare
   `tokens_list` read with the enrolling credential and matches its
   own row by the pinned rule above. The leg is **evidence-only,
   never load-bearing** (the `installationLabel` precedent in the
   same file): any failure — refusal, bad shape, no match, ambiguity
   — records nothing and enrollment proceeds exactly as today.
   Outcomes:
   - matched row with a finite `expiresAt` → the date is persisted
     through the existing `expiresAt` upsert parameter (ISO), and
     the probe record gains `tokenExpiry: { state: 'recorded',
     providerTokenId }`;
   - matched row with no `expiresAt` → nothing is written to the
     date column, and the probe record gains `tokenExpiry:
     { state: 'none_reported', providerTokenId }` — a truthful,
     provider-reported no-expiry, recorded as its own state;
   - otherwise → the probe record gains `tokenExpiry:
     { state: 'unrecorded' }`, the honest form of today's silence.
   The receipt's `expiry` reports the persisted value.
2. **`src/vercel/token-expiry.js` — the derivation gains the
   recorded-none branch.** Precedence is unchanged where states
   overlap: a stored date first (its posture result now also names
   `source: 'recorded'`), then the owner's attestation
   (`posture: 'no_expiry'`, `source: 'attestation'`, label
   byte-identical: "no expiry — owner's choice"), then the new
   branch — no date, no attestation, probe state `none_reported` →
   `posture: 'no_expiry'`, **`source: 'provider'`**, label "no
   expiry — Vercel reports none for this token". Provider-reported
   and owner-attested no-expiry are therefore distinct states on
   every surface, as they are distinct facts. `unknown` is
   unchanged, and now also names `source: null`.
3. **`src/tools/server.js` — `vercel_whoami`** surfaces
   `expirySource` beside `expiryPosture` / `expiryPostureText`
   (additive field; the warning logic is untouched — it reads the
   stored date, which recorded enrollments now actually have).
4. **Comment truth maintenance** in `token-expiry.js`'s header and
   `src/db.js`'s attestation note: both stated the pre-AUD-BI gap as
   standing fact ("storeToken writes expiresAt: null
   unconditionally"); both now state the recorded/attested
   distinction as built.
5. **`docs/DECISIONS.md`** — a dated entry records the build and the
   (b) conviction (no documented installation-token expiry surface;
   posture stays `unknown` for Door-1 rows until Vercel documents
   one).

## Preserved, pinned by tests

- **The attestation path**: `token_no_expiry` is untouched as a
  mechanism — set only by the owner (directly or by applied
  envelope, AUD-AT), bound to `token_version`, reset on every
  enrollment by the upsert. A recorded date or a provider-reported
  none never sets it, and its label never renders for a merely
  recorded state.
- **Grandfathering**: no stored row is rewritten. A row gains a
  recorded expiry only when its own enrollment next runs
  (rotation/re-enrollment), because the upsert writes what that
  enrollment's leg learned — including, truthfully, `unrecorded`
  replacing nothing but the probe record (the date column receives
  the leg's result, which for an unrecorded leg is the same null it
  writes today).
- **RTC passes** (a separate credential family; untouched) and the
  **read-only switch** (AUD-AQ; untouched).
- **The probe's proof legs**: identity/teams/projects are unchanged
  and remain the only load-bearing legs; `probeToken`'s own call
  pattern is unchanged, so recheck (`recheckStoredToken`) makes no
  new provider call and persists nothing, as before.
- **Catalog judgment (drift checklist B)**: no tool is added,
  removed or renamed — the registry is unchanged at 253 — so no
  catalog row is owed; the `vercel_whoami` row's note records the
  additive `expirySource` field instead (its Card cell gains the
  AUD-BI tag), which also satisfies the mechanical docs check for
  the `src/tools/` touch.

## Evidence

- `tests/unit/token-store.test.js` — the enrollment leg against the
  fake provider: recorded date persisted (receipt + stored row +
  probe state); provider-reported none (probe state, posture
  source); ambiguous suffix (two matching rows → unrecorded,
  enrollment succeeds); a row naming a different team (excluded →
  unrecorded); a refused list read (enrollment unaffected).
- `tests/unit/token-expiry.test.js` (new) — the derivation matrix:
  recorded date / attested / provider-none / unknown, precedence
  (date > attestation > provider-none), and the distinctness of the
  two no-expiry labels and sources.
- `tests/unit/server-tools.test.js` — whoami states the recorded
  posture + `expirySource` for an enrolled row carrying probe
  evidence.
- `tests/unit/oauth-enroll.test.js` — the Door-2 enrollment fixture
  gains the token-list stub; its call count moves 3 → 4 (the one
  documented additional read), and the enrolled row's recorded
  expiry is asserted.
- Full `npm run check` at the exact head (exit read directly), CI
  `ci` + `release-policy` green at the exact head, self-review
  naming the head in the PR.
