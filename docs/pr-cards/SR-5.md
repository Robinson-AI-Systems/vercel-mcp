# SR-5 — Migration, cutover record + copy lockstep (gate O-2.7)

Date: 2026-11-01
Gate: O-2.7 (sign-in replacement; dossier
`signin-replacement-dossier-2026-11-01.md`, sections
5.5, 7.4, 8.1-8.3) **as amended by the dossier's
closing addendum (owner rulings 2026-11-01 18:40 +
18:48 MST) and by SR-4's corrected owner steps, which
govern wherever the dossier's original section 8.2
text conflicts with them.**

## Scope of this card

This card is the program's repo-side cutover record
plus the copy lockstep the dossier assigns to SR-5.
It builds nothing and changes no behavior. The
remaining live legs — the coordinator's migration
run, the post-promotion absence battery, and the
owner's sitting — are **recorded below as this
card's open remainder, with an owner named per leg;
none of them is attempted or claimed by this card.**
The build (SR-1..SR-4) is complete on main; the
cutover's live effect lands with the promotions plus
the owner steps, in that order (code first,
configuration second, sitting last — dossier
section 8.1).

## What the build landed (SR-1..SR-4)

- **SR-1 (PR #401, merged 159930d)** — the Sign in
  with Vercel leg, shipped dark: this server as a
  relying party of Vercel's own provider
  (authorization_code + PKCE S256; RS256 ID Token
  verified against Vercel's JWKS; scopes
  `openid profile email`; identity only — nothing
  from the leg is stored as a credential, and
  `offline_access` is never requested; client-secret
  authentication per Q2); the `signin_flows` record +
  TTL sweep; the additive
  `vercel_accounts.attested_user_id` column.
  Exercised against a fake Vercel AS built from the
  documented shapes, negative controls included.
- **SR-2 (PR #402, merged 4e52885)** — consent on
  attested identity: on the public class the
  authorize journey detours to Vercel's own sign-in
  and consent renders the attested identity + the
  binding-rule-filtered account picker with no
  passphrase field; eligibility is re-checked at
  consent POST; Door 1 install kept as a leg of the
  one journey (Q4) with the installer-identity
  equality check; the health-metadata pin.
- **SR-3 (PR #403, merged 090460b)** — enrollment
  under identity + attestation capture: the enroll
  branch requires an attested flow on the public
  class; every probe persists the identity it
  already read into `attested_user_id`; the binding
  rule is enforced at enrollment (Q3: owner-match
  or team-roster membership); blob enrollment under
  the same gate.
- **SR-4 (PR #404, merged 7637cd1)** — the developer
  route split + production absence: the passphrase
  paths moved behind `/api/dev/authorize` +
  `/api/dev/enroll` on the same deployment (proof
  semantics verbatim — evaluateLogin, the lockout,
  the shared budget, the fail-closed on unset); the
  handoff's browser leg lands on the dev route, so
  builder agents keep recovering production
  connections through it (Q5 as clarified); the
  public class renders no passphrase field in any
  state (the attested journey when configured, the
  interim notice until then) and a posted passphrase
  is never evaluated there; `ADMIN_PASSPHRASE` stays
  configured in production, gating the dev route
  (Q1 as clarified); the repo's developer-access
  documentation deliverable (the 18:48 MST
  requirement: AGENTS.md section +
  docs/DEVELOPER-ACCESS.md).

## Grandfathering (dossier section 7.4)

Existing connections are untouched. Stored rows are
never rewritten; derivations apply at next consent.
The token endpoint contains no passphrase path, so
every live connection keeps refreshing and rotating
after cutover — including the owner's current seat
until he chooses to reconnect. Cutover changes only
how *new* consents are proven. Existing account rows
are untouched except the additive `attested_user_id`
column, backfilled by recheck (below) — a
read-derived lift, never a credential change. DCR
client records are unaffected; the Muse client
document (CIMD) is byte-identical, so the
Add-connector sheet step at acceptance is the same
paste as the 2026-11-01 reconnect.

## The migration leg — coordinator runbook (dossier section 5.5 step 1)

Owner: the coordinator. Precondition: SR-3's
promotion is live (SR-3 is the card that made the
recheck path persist attestation).

1. Run `vercel_recheck_token` on the owner's Door-2
   (DPGA) account row. The recheck re-probes the
   token (route `user`, team-path probe — its
   identity leg is load-bearing there) and, since
   SR-3, persists the identity it reads into the
   row's `attested_user_id`. No token re-paste; no
   action from the owner.
2. Read back: confirm via `vercel_list_connections`
   / the whoami-facing surfaces that the row's
   `attested_user_id` is populated. **Only when the
   read-back shows the column populated is the
   sitting scheduled.**
3. Fallback, if any leg cannot attest: the owner
   re-enrolls the same token once through the
   identity-gated enrollment branch inside his
   acceptance journey (an upsert — a rotation;
   nothing else changes). Still one sitting, one
   extra paste at worst.

## Corrected owner steps (the sitting; supersede dossier section 8.2)

Owner: Chris. Per SR-4's card, which records the
18:40 MST clarification:

1. **Create the Sign in with Vercel App** in the
   Robinson AI Systems team's Settings -> Apps:
   callback
   `https://vercel.robinsonaisystems.com/api/oauth/vercel/callback`;
   Permissions `openid`, `profile`, `email` (NOT
   `offline_access`); Sign-In Access left at the
   default ("anyone with a Vercel account").
2. **Set the App's client id + secret as production
   env** on the vercel-mcp project (Q2: client
   secret; the secret is set by the owner and never
   seen by the agent — the same pattern as
   `ADMIN_PASSPHRASE` and `TOKEN_ENCRYPTION_KEY`
   today).
3. **Do NOT remove `ADMIN_PASSPHRASE` from
   production.** The dossier's original section 8.2
   step 3 is superseded: the passphrase gates the
   developer route on the production deployment.
4. **The acceptance reconnect** — the sitting's
   final leg (below).

## The open remainder (recorded, not claimed)

Each leg names its owner and its precondition.
None runs in this card.

**The migration run** — the runbook above. Owner:
the coordinator. Precondition: SR-3 live; runs
before the sitting is scheduled.

**The absence battery** — dossier section 8.3 legs
2-3, adapted to the clarified shape by SR-4. Owner:
the coordinator. Precondition: SR-4's promotion is
live AND owner steps 1-2 above are done (the App
exists and the client configuration is set).

1. Configured public authorize GET renders no
   passphrase field (the detour to Vercel fires
   instead).
2. A passphrase POSTed to the public authorize and
   enroll routes is refused; nothing is journaled
   as a login attempt against them.
3. Enroll without an attested flow detours/refuses.
4. The dev route serves the legacy form and honors
   the passphrase, lockout intact; the handoff start
   completes a recovery through it end to end.
5. `/api/vercel/setup` still 404s; `/api/health`
   answers ok with `deployed_source_sha` at the
   promoted head; keyless `/api/mcp` still 401s
   with the resource pointer; one RTC pass read
   still authenticates.
6. The detour reaches Vercel's real sign-in/consent
   screens naming our App (render captured, filed
   as evidence).
7. Error paths against the real AS (section 8.3
   leg 3's second half): bad state -> our refusal
   page; `access_denied` round-trip.

**The sitting** — owner steps 1-4. Owner: Chris.
Precondition: the migration read-back shows
`attested_user_id` populated, and owner steps 1-2
are done.

## O-2.7's closure criterion

O-2.7 closes on the acceptance reconnect's evidence,
and on nothing less: Chris disconnects the Vercel
connector in Muse and reconnects — sheet -> our
authorize -> **Vercel's own sign-in** -> consent
picker showing the Robinson row (attested) ->
connection minted — with read-backs `vercel_whoami`
(scope full, mode production, DPGA last-4: the same
seat, re-proven through the public path) and
`vercel_list_connections` showing the new row on
the branded origin. On that evidence the gate
report's Correction Addendum hold on the
production-ready declaration lifts. Until then the
gate item stands open with the build complete: the
declaration waits on the owner using the public
production login himself, by his ruling — a
dev-only door never counted as testing production.

## Copy lockstep in this card

- `api/connection.js` (the public "My connection"
  page): the connect section gains the honest
  sentence as its own paragraph, in house voice —
  signing in is Vercel's own, start to finish, and
  this server has no sign-in password of its own;
  enrolling is different: bringing a credential of
  your own, a token made in Vercel's dashboard.
  The AUD-AK frozen texts (the section 7(b)
  disclaimer block and the as-is sentence) are not
  edited, and no pinned string moves.
- `docs/OWNER-GUIDE.md`: the coding-agent access
  section's SR-4 paragraph gains the lockstep
  sentence for the owner/operator reader — on the
  public surface, enrolling a token of your own
  happens inside the sign-in and binds to the
  identity it attests (your own account, or a team
  you belong to); the developer route keeps its
  own passphrase-gated enrollment for operator
  work.
- No `src/tools/` change: no tool added, removed
  or renamed; registry unchanged at 253;
  TOOL-CATALOG untouched. Checklist B is satisfied
  by this card + the STATUS bullet. The connector
  doc in the coordinator's own workspace is
  updated by the coordinator separately, not by
  this card.
- The section 7.1 nicety (renaming the strictness
  journal label "Owner passphrase verified") is
  deliberately **not** taken here: it is copy
  inside journal-writing code, outside this card's
  record + page/guide-copy scope, and the label is
  operator-facing history text, not public copy.
  It remains available to any later card; nothing
  depends on it.

## Verification

Bench: the connection-page suite targeted (the copy
change's surface); full `npm test`; `npm run check`
with BASE_SHA=origin/main against the committed
range; pre-push conflict-marker grep clean. Live
exercise is the open remainder above — listed, not
claimed. Batches with the release train.
