# SR-1 — The Vercel sign-in leg (ships dark)

Date: 2026-11-01
Gate: O-2.7 (sign-in replacement; dossier `signin-replacement-dossier-2026-11-01.md`, sections 3.1, 5.1–5.3, 7.5, 8.1).

## What this card builds

The upstream half of the public sign-in: this server as a
relying party of Vercel's own Sign in with Vercel provider,
built against the documented contract (authorization_code +
PKCE S256 required; RS256 ID Token verified against Vercel's
JWKS; scopes `openid profile email`; identity only — Vercel's
GA grants sign-in, not API authority, and nothing from this
leg is or becomes a credential).

- `src/vercel/signin.js` — the client + callback:
  `signinConfig` (env-carried App registration, client secret
  read from env only; the callback URI derives from the one
  configured public origin — no second identity source),
  `createSigninPkce`, `buildSigninAuthorizeUrl`,
  `exchangeSigninCode` (client_secret_basic per the Q2
  ruling), `fetchSigninJwks`, `verifySigninIdToken` (iss,
  aud, exp/nbf, nonce, sub all checked; unknown kid and bad
  signature are distinct refusals), `fetchSigninUserinfo`
  (belt-and-braces display claims; a sub mismatch refuses),
  and `handleSigninCallback` — state lookup, single-use and
  expiry guards, browser-binding check when the flow carries
  one, exchange, verification, attestation, and a plain
  confirmation page. Refusals are plain words naming the leg
  and the remedy (IN-18's shape), never a raw provider error.
- `api/oauth/vercel/callback.js` — the route, composed like
  the connect route (handler in the provider module; this
  file only builds the store and the 503 shape).
- `src/db.js` — the `signin_flows` table (handle hashed at
  rest; the row carries the client-side request, the Vercel
  leg's PKCE verifier + nonce, the browser-binding hash, the
  attested identity and display claims, the chosen account,
  and the two consume stamps; ten-minute TTL), the methods
  `createSigninFlow` / `getSigninFlow` / `attestSigninFlow`
  (guarded: unattested, unconsumed, unexpired — else false)
  / `consumeSigninFlow` (attested-only, single-use), the
  additive `vercel_accounts.attested_user_id` column
  (section 5.3: rows keyed by enrollment gain the column;
  no stored row is rewritten and this card populates no
  value), and the retention sweep's tenth class: expired
  sign-in flows are deleted at expiry (section 7.5 names
  the artifact; the flow's own TTL is its clock).
- Nothing from the SiwV leg is stored as a credential: the
  one-hour access token is used transiently for userinfo,
  the ID Token is verified and discarded, and
  `offline_access` is never requested (pinned by test).

## Ships dark, by design

No route into the leg exists yet: nothing creates a flow and
nothing links the callback — SR-2 rewires authorize to start
the leg (recording the browser binding), SR-3 persists the
attested identity on enrollment rows. Until the owner creates
the SiwV App and sets its env (section 8.2, owner hands
only), the callback answers an honest 503 "not configured"
page, and the public authorize still proves consent with the
passphrase exactly as before. No user-visible change.

## Fixture

The fake Vercel authorization server in
`tests/unit/vercel-signin.test.js` is built from the
documented shapes, not from this code: a real RSA keypair
published as JWKS, genuinely signed ID Tokens, a token
endpoint that enforces PKCE and client_secret_basic, and
userinfo behind the access token. Negative controls assert
the specific refusal: wrong audience, bad nonce, expired ID
Token, bad signature, unknown kid, wrong issuer, userinfo
sub mismatch, replayed state, consumed flow, expired flow,
browser-binding mismatch, unconfigured App. The db suite
(`tests/db/signin-flows.test.js`) proves the store against
real Postgres: idempotent schema + additive column,
lifecycle guards, hashed handle at rest, sweep-at-expiry.

Catalog judgment: no tool added, removed or renamed and
nothing under `src/tools/` changes, so TOOL-CATALOG is
untouched; checklist B is satisfied by this card + the
STATUS bullet. Registry unchanged at 253.

Live exercise is SR-2/acceptance work — listed, not claimed.
Batches with the release train.
