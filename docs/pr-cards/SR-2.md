# SR-2 — Consent on attested identity (gate O-2.7)

Date: 2026-11-01
Gate: O-2.7 (sign-in replacement; dossier
`signin-replacement-dossier-2026-11-01.md`, sections 5.1, 5.2,
5.4, 7.1–7.2, 8.1, 8.4 + the 2026-11-01 18:40 MST rulings
addendum). SR-1 (PR #401) built the Vercel sign-in leg dark;
this card wires it into the authorize journey on the public
class. SR-3 re-gates enrollment and persists attested identity
on enrollment rows; SR-4 splits the developer route formally.

## Deployment class — one authority

`deploymentClass(env)` in `src/core/oauth-handlers.js`: the
**public** class is exactly the production deployment
(`VERCEL_ENV === 'production'` — the same conjunct
`issuanceFor` already uses as its mode authority, so class and
derivation can never disagree about which deployment this is);
everything else is the **dev** class. The dev class keeps
today's authorize page and passphrase POST **byte-for-byte**
(the shared legacy path is moved, not edited). Per the Q1/Q5
clarification, the dev class here is the passphrase-gated path
SR-4 will formally split into the developer-only backend
route on this same deployment; this card does not build that
split.

## The public-class journey (dossier §5.1)

- **Authorize GET, fresh:** the client/redirect/PKCE/resource
  validation runs first, exactly as today — a malformed flow
  dies before any detour. Then the handler creates the
  server-side sign-in flow (SR-1's `signin_flows`: the client
  params, a fresh Vercel-leg PKCE pair + nonce, and a
  browser-binding secret whose hash the record stores),
  sets the binding cookie (`httpOnly; Secure; SameSite=Lax`,
  ten-minute max-age), and 302s to Vercel's authorize URL.
- **The callback** (SR-1's handler) attests the flow and now
  302s back to `/api/oauth/authorize?flow=…` — SR-1's card
  named this replacement; its terminal confirmation page is
  gone, its refusal paths are unchanged.
- **Authorize GET with a flow:** the flow must be live,
  attested, unconsumed and browser-bound (the binding cookie
  must hash-match the record). Consent renders the attested
  identity ("Signed in to Vercel as …"), a picker containing
  **only bindable accounts** (§5.4 below), each captioned by
  the unchanged `issuanceFor`, preselected by the AUD-AE
  rules within the filtered set — and **no passphrase
  field**. The empty state offers the enrollment legs inside
  the journey: enroll a token (the AUD-AR branch, carrying
  the in-flight params as today) and connect a team (the
  Door 1 doors page, exactly as today).
- **Consent POST:** carries only the flow handle + the
  chosen account. The server re-derives everything: flow
  live/attested/bound, the eligible set **recomputed at POST
  time** (a tampered or stale account id refuses, and the
  refusal does not consume the flow), then
  `consumeSigninFlow` (single-use) and the same
  `createAuthCode` + redirect tail as the legacy path, with
  issuance derived from the record — any client-posted
  mode/profile/listing is not read, as AUD-AZ pinned.

## Identity binding (§5.4), as the login service

`bindableAccounts(attestedUserId, env)` / `isBindable(...)`
on the Vercel login service; the generic handlers stay
provider-free (the sign-in leg reaches them through the
service adapter: `signinConfigured`, `signinAuthorizeUrl`,
the binding-cookie name constant is pinned by comment to
SR-1's `SIGNIN_BINDING_COOKIE` and the journey tests drive
the real callback against it, so a rename fails loudly).

- **Limb 1 — owner match:** the account's
  `attested_user_id` (SR-1's column; SR-3 populates it) **or**
  the Door 1 probe record's persisted `installerUserId`
  (both install kinds persist it, `src/vercel/integration.js`)
  equals the signer's `sub`. `listVercelAccounts` now selects
  the column (the fake-db projection mirrors it).
- **Limb 2 — roster membership:** a `teams_members_list`
  read (GET `/v3/teams/{teamId}/members` — **verified in
  this card against the pinned snapshot**,
  `vendor/vercel-openapi/openapi-2026-10-11.json`: the path
  exists and its member items carry `uid`, "The ID of this
  user") executed with **the account's own stored
  credential** (`loadToken` + the provider client) names
  the signer's `uid`. Any failure — missing/expired
  credential, provider refusal, malformed page — fails
  closed: the limb simply does not grant. SR-3 still owns
  the per-scope-class probe tests §5.4 assigns it; this
  card's fake-provider tests pin the read's shape and its
  fail-closed posture.

## The Door 1 equality check — and what is NOT built

A Door 1 install inside the journey enrolls the account
with its installer's identity persisted in the probe
record; the binding rule above then makes it bindable
**only by that installer** (or a roster pass) — the
§5.1 step-6 equality check, enforced where consent is
decided. What this card does **not** build: return plumbing
through the install callback. The install URL is
operator-configured verbatim and no state passthrough for
it is verified in the documented contract, so after an
install the browser returns to the picker by re-entering
the authorize flow (the already-authorized App redirects
immediately, per Vercel's documented behavior; the flow
attests the same identity and the installed account now
renders, bindable by its installer). Journey plumbing for
enrollment legs deepens in SR-3, as the dossier sequences
it.

## INTERIM BEHAVIOR — the judgment this card records

The SiwV App does not exist yet (the owner creates it at
cutover, dossier §8.2 — code first, env second, sitting
last). **While the sign-in client is unconfigured
(`signinConfig(env)` is null), the public class behaves
exactly as today**: authorize GET renders the passphrase
consent and the POST honors it. The Vercel leg engages
only when configured, so no existing user can be stranded
mid-consent with no working path, in either direction of
the cutover. The dossier does not settle this case in
text; this is the fail-safe reading, implemented
deliberately and pinned by journey tests (interim GET +
POST). The fallback retires at SR-4/§8.2, when the owner
removes `ADMIN_PASSPHRASE` from the production environment
after the App exists — never before.

## Health-metadata pin

SR-2 changes no OAuth metadata field (the Vercel leg is
internal to the authorize handler), so health's
consistency leg passes by construction; the health suite
now **pins** `oauthServerMetadata`'s exact document for a
fixture origin (key set + every endpoint derivation), so
a future metadata edit fails loudly instead of drifting
past the leg.

## Fixtures

`tests/unit/signin-journey.test.js`: the real handlers +
the real login service + SR-1's fake Vercel AS (a real RSA
keypair published as JWKS, genuinely signed ID Tokens,
PKCE + client auth enforced) + a fake provider for the
roster read. The journey runs end to end — detour, callback,
consent, POST, issued code — and the refusal paths assert
the specific refusal: tampered account id, account outside
the eligible set, identity with no bindable account (empty
state, legs offered, no authorize button), binding-cookie
mismatch, expired flow, consumed-flow replay, POST without
a flow on the configured public class, plus the dev-class
byte-shape and the interim unconfigured pair. SR-1's
callback tests are updated for the redirect tail.

Catalog judgment: no tool added, removed or renamed and
nothing under `src/tools/` changes, so TOOL-CATALOG is
untouched; checklist B is satisfied by this card + the
STATUS bullet. Registry unchanged at 253.

Live exercise is the §8.3 acceptance battery — listed, not
claimed. Batches with the release train.
