# SR-4 — The developer route split + production absence (gate O-2.7)

Date: 2026-11-01
Gate: O-2.7 (sign-in replacement; dossier
`signin-replacement-dossier-2026-11-01.md`, sections 6,
7.1-7.4, 8.1) **as amended by the dossier's closing
addendum (owner rulings 2026-11-01 18:40 + 18:48 MST),
which governs wherever the dossier's Option A text
conflicts with it.** SR-1 (PR #401) built the sign-in
leg dark; SR-2 (PR #402) wired consent on attested
identity; SR-3 (PR #403) re-gated enrollment and made
the probes persist attestation. This card performs the
surface split those cards sequenced.

## The owner's clarified shape (binding)

Per the 18:40 MST clarification, NO separate deployment
is stood up (dossier Option A is not built, and its
section 8.2 owner step "remove ADMIN_PASSPHRASE from
the production environment" is **superseded** — see
the corrected owner steps below). The dev door lives
on the SAME production deployment as a developer-only
backend route: a distinct namespace, not linked from
the public pages, not part of the public connection
journey, passphrase-gated exactly as today. The
developer handoff STAYS reachable through it — builder
agents recover production connections with it — and
`ADMIN_PASSPHRASE` STAYS configured in production,
gating the dev route. What retires is the passphrase's
presence on the PUBLIC surface, not its existence.

## The developer route

- **`/api/dev/authorize`** and **`/api/dev/enroll`**
  (new route files dispatching to new `devAuthorize` /
  `devEnroll` handlers in `src/core/oauth-handlers.js`)
  serve the legacy passphrase handlers — SR-2/SR-3's
  `authorizeLegacy` / the AUD-AR enroll branch — on
  **every** deployment class, with their in-journey
  links re-based onto the dev namespace (the dev
  authorize page's enrollment link and the dev enroll
  page's back/continue links stay inside the route).
  The public-class handlers keep the public paths, so
  the dev class's shipped pages are byte-for-byte
  unchanged.
- **Proof semantics move verbatim.** `evaluateLogin`,
  the lockout (more than 5 failures in 15 minutes ->
  429 + `Retry-After: 900`), the shared per-IP budget
  and the 503-on-unset-passphrase fail-closed are the
  same code on the same store; this card changes
  routing and presentation only. The budget now spans
  exactly the dev route's two POSTs, because the
  public POSTs no longer evaluate a passphrase at all.
- **The developer handoff's browser leg lands on the
  dev route.** `createHandoff`'s start response now
  builds its `authorization_url` on
  `/api/dev/authorize` instead of the public authorize
  path, so a handoff consent is proven by the
  developer door on every class — including the
  configured public class, where the public authorize
  path would detour to Vercel sign-in and an agent
  could not complete it. The handoff endpoint itself
  (start/poll/callback) does not move: it is already
  a developer-only, unlinked, machine route, and its
  registered callback is a stored client value that
  existing registrations name verbatim — moving it
  would strand them. It stays absent from the public
  routes: no public page links or names it (the
  AUD-AW section 1C scan still pins that), and the
  public authorize/enroll handlers never serve it.

## The public surface after this card

The two dispatch points SR-3 named (authorize +
enroll, both keyed on `deploymentClass(env) ===
'public'` and `signinReady()`) now resolve three ways:

| Class | Authorize | Enroll |
|---|---|---|
| Public, leg configured | Attested journey (SR-2/SR-3, unchanged) | Attested branch (SR-3, unchanged) |
| Public, leg unconfigured | **Interim notice (new)** | **Interim notice (new)** |
| Dev (any non-production deployment) | Legacy passphrase (unchanged) | Legacy passphrase (unchanged) |

**The interim notice replaces SR-2's interim fallback
on the public class.** SR-2 recorded that while the
SiwV App does not exist, the public class keeps the
working passphrase path "so no existing user can be
stranded mid-consent", retiring at SR-4/section 8.2.
The retirement lands here, in the only form the
owner's clarification permits: the public authorize
GET renders a notice page — the connected accounts
with their derivation captions, the enrollment and
connect links, and plain words that sign-in is moving
to Vercel's own sign-in and is not switched on yet —
with **no form and no passphrase field in any state**;
a POST to the public authorize or enroll route is
refused in plain words and a posted passphrase is
never evaluated. The public enroll GET renders the
matching notice (no token form either — an ungated
enrollment form would be worse than none).

**Why this cannot strand a consent.** (1) Existing
connections never touch a consent page: the token
endpoint has no passphrase path and keeps refreshing
and rotating every live connection, in every state.
(2) The only thing the interim state cannot do is
mint a NEW connection through the public journey —
and in the interim state that journey's intended
proof (Vercel sign-in) does not exist yet either, so
no completable public consent is taken away; what is
removed is only the passphrase substitute the ruling
retired from this surface. (3) Nobody is locked out
of the server: the operator's working door is the
developer route, on this same deployment, honoring
the passphrase with the lockout intact — enrollment
and connection recovery (including the handoff)
remain fully possible there throughout the interim.
(4) The state is self-announcing and self-ending:
the notice names the state and the remedy, and the
moment the owner creates the App and sets the client
configuration (the SR-5 owner steps), the same URLs
serve the attested journey with no further code
change. The absence guarantees bind the configured
public surface and the public pages' content in all
states: no passphrase field presented as part of the
public journey, no dev links, no dev path named.

## The documentation deliverable (owner, 18:48 MST)

Any agent that works in this repository must be able
to learn where the developer-only backend access
exists and how to use it **from the repo itself**:

- `AGENTS.md` gains a **Developer-only backend
  access** section naming the route and pointing at
  the docs page.
- **`docs/DEVELOPER-ACCESS.md`** (new) carries the
  full record: the routes, what the door is for
  (developer/operator work, incl. builder agents
  recovering production connections through the
  handoff), how an agent authenticates (the
  passphrase, obtained ONLY through the owner's
  secure credential route — the value appears in no
  doc, chat, code or commit), and its limits.
- `docs/OWNER-GUIDE.md`'s coding-agent access section
  gains the pointer for the owner/operator reader.

The public pages stay silent about the route, per
the Q1 ruling; the repo's internal documentation
does not.

## Copy shadow in this card

- `api/connection.js` (the public "My connection"
  page): the sign-in paragraph no longer instructs
  the public to enter the administrator passphrase —
  it describes the public journey as it now stands
  (sign in with your own Vercel account, pick the
  account; enrollment is bringing your own
  credential). It names no dev route, field or link.
  (SR-5's lockstep copy pass still owns the final
  wording once the App exists.)
- No `src/tools/` change: no tool added, removed or
  renamed, registry unchanged at 253, TOOL-CATALOG
  untouched. Checklist B is satisfied by this card +
  the STATUS bullet + the documentation deliverable.

## Fixtures — the absence suite

`tests/unit/dev-route-split.test.js`, against the
real handlers + real login service + SR-1's fake AS:

- Configured public class: authorize GET is the
  detour (302 to Vercel) and renders nothing; the
  attested consent page carries no passphrase field;
  a passphrase POSTed to the public authorize and to
  the public enroll is refused and never evaluated
  (the login-attempt store records nothing).
- Interim public class: authorize GET renders the
  notice with no form, no passphrase field and no
  dev-route reference; enroll GET likewise; POSTs
  to both refuse in plain words.
- The dev route on the public class (configured and
  interim) and on the dev class: GET serves the
  legacy form with its links inside the dev
  namespace; the correct passphrase is honored (an
  auth code is issued); wrong passphrases accumulate
  into the lockout (429 + Retry-After) exactly as
  before; dev enroll honors the passphrase and its
  continue link returns to the dev authorize.
- The handoff: a start's `authorization_url` lands
  on the dev authorize route, and the public pages'
  no-reference scan (AUD-AW) still passes.
- The legacy suites (`oauth-handlers`, `oauth-enroll`,
  `signin-journey`, `enrollment-identity`,
  `developer-handoff`, `health-endpoint`) pin the
  untouched paths, incl. the AS-metadata pin.

## Recorded for SR-5 / the sitting (not run here)

The post-promotion absence-probe battery, run after
this card's promotion AND after the owner creates
the SiwV App (dossier section 8.3 legs 2-3, adapted
to the clarified shape):

1. Configured public authorize GET renders no
   passphrase field (the detour fires instead).
2. A passphrase POSTed to the public authorize and
   enroll routes is refused; nothing is journaled
   as a login attempt against them.
3. Enroll without an attested flow detours/refuses.
4. The dev route serves the legacy form and honors
   the passphrase, lockout intact; the handoff start
   completes a recovery through it end to end.
5. `/api/vercel/setup` still 404s; `/api/health`
   answers ok with `deployed_source_sha` at the
   promoted head; keyless `/api/mcp` still 401s with
   the resource pointer; one RTC pass read still
   authenticates.
6. The detour reaches Vercel's real sign-in/consent
   screens naming our App (render captured).

**Corrected owner steps for SR-5** (superseding
dossier section 8.2 step 3): (1) create the SiwV App
(callback on the branded origin; `openid profile
email`, NOT `offline_access`); (2) set the App's
client id + secret as production env (Q2: client
secret); (3) **do NOT remove `ADMIN_PASSPHRASE` from
production** — it gates the developer route there;
(4) the acceptance reconnect through Vercel's own
sign-in, which closes O-2.7.

Live exercise is the battery above — listed, not
claimed. Batches with the release train.
