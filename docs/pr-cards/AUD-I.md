# AUD-I — "Log in with Vercel": OAuth login tier, dynamic box choice at sign-in, explicit god-mode tier (VMCP-026 / IN-16)

Status: CARDED 2026-10-28 (design + acceptance filed ahead of the build, S5 pattern) — build starts when VMCP-023 closes, per the owner's sequencing ruling 2026-10-28 (this build next; the narrowed remainders VMCP-003/011/016 and VMCP-025 follow). VMCP-026 stays **open** until its acceptance probes pass live.

**Why this card exists:** IN-16 (owner direction, 2026-10-28) ruled that when development and testing are done, end-user onboarding becomes a normal sign-in: the user logs into THEIR OWN Vercel account, the way the GitHub MCP links a GitHub account — a connection page, the provider authenticates them, and the server receives a scoped credential without the user ever handling a raw key. The same day's addenda completed the shape: the SAME two-tier authority as the GitHub MCP (standard login tier + owner-chosen god mode), and a **dynamic box choice at sign-in** (the user picks one project / a team / the whole account, in plain words, and the backing credential changes to match). Current state, verified in the shipped code: enrollment is token-paste only (`src/vercel/setup.js`, "Add or rotate a Vercel token"); no Vercel OAuth sign-in exists anywhere in the product.

## Design

### Step 0 — platform verification spike (blocking, before any build)

Verify against Vercel's **current** documentation, and amend this card with the findings before building: the Sign in with Vercel / integration OAuth surface — authorization and token endpoints, the permissions/scopes an integration declares, the issued token's shape, lifetime and refresh behavior, team install semantics (including what the user picks on Vercel's side), personal-account (non-team) handling, redirect URI registration, and revocation/uninstall behavior. The repo's prior research (`docs/audits/2026-10-10-research.md` §4) is the starting point, not the authority: it records integration (OAuth) tokens as carrying the integration's declared permissions and per-team install semantics, and its "not needed for Chris's own server" verdict is superseded for onboarding by IN-16. **If a load-bearing assumption fails** — e.g. the OAuth tier cannot yield a usable API credential for a user-chosen team — the spike stops and the card returns to the owner with the evidence and the nearest honest shape, rather than improvising a different product.

### The one flow

A connection page on this server's origin presents the two tiers in plain words, in one flow:

1. **Pick your box** — one project / a team / the whole account — each with what it lets the agent reach, stated plainly at the moment of choice.
2. **The credential follows the choice** (mapping below). Where Vercel's own step already makes part of the choice (the team picked at install), the flow honors that pick as the user's choice and records it — the user is never asked twice for the same decision, and never silently re-boxed.
3. **The connection binds as today** — the existing consent machinery (account, mode, profile, listing) completes the connection; the standard login tier lands on the server's standard profiles, where the restraint lives (the platform credential is broad inside its install scope; IN-16 addendum).

### Box → credential mapping

| Box (plain words) | Credential | Account record |
|---|---|---|
| One project | Tier 1 OAuth sign-in, installed on the containing team; the user then names the project | Existing `team/project` key; the connection is pinned to that project by our machinery |
| A team | Tier 1 OAuth sign-in, installed on the chosen team | Existing `team` key |
| The whole account | **Tier 2 token enrollment** — a full-account token behind the existing IN-04 explicit checkbox | Existing `team` key with the full-account credential enrolled |

Whole account routes to the token tier because Vercel's sign-in installs per team; whole-account reach is a token property. The flow says so in plain words at the choice — *why* this box uses a token — never a silent tier switch. Personal projects (no team) are settled by the spike: if the platform flow supports a personal scope, it keys and labels honestly; if it cannot, the flow says so and offers the team/token paths, rather than pretending.

### The declared box is the record

The account stores the user's **declared box** (the plain-words choice) alongside the existing probe result. `vercel_whoami` shows both: declared box, probed scope, mode, profile. The probe remains corroboration with its honesty intact (`scopeVerified: false` — REST reads cannot prove a token's complete privilege set; the recorded label is a visibility heuristic, e.g. a single-team owner's full-account token can probe as `team`). A probe showing **broader** than the declared box surfaces a plain warning at enrollment time; a probe showing narrower states plainly that the credential reaches less than the box promises. Neither is silently adjusted.

### Tier 2 made explicit (no behavior change underneath)

The setup page's enrollment section is re-presented in plain words as the **god-mode tier**: what it is (a token you create with everything on), what it unlocks, the scope boxes, the expiry choice **including never** (IN-04: the key owner's choice; the server's duty is warn-ahead — the 14-day warning already in `vercel_whoami` / `vercel_admin_overview`), and the explicit broader-account checkbox as the deliberate act it is. Probe, storage, encryption and journaling are unchanged.

### Revocation from both sides

- **In-product:** disconnecting an account deletes its stored credential (journaled like every account change); connections bound to it fail honestly afterward.
- **At Vercel:** revoking the token or uninstalling the integration makes the credential dead; the next use fails honestly and the account's posture surfaces it as dead — no silent success, no stale "connected" claim.

### Operator secrets

The OAuth app's client credentials are server environment values set by the operator (the `ADMIN_PASSPHRASE` pattern): never in the repo, never in chat, never returned by any tool. The redirect URI is this server's own origin.

## Scope

**In:** the Step-0 spike + card amendment; the connection page flow (box choice in plain words, tier routing); the Vercel OAuth round trip and token receipt, enrolled through the existing probe/store path with the declared box recorded; the Tier 2 setup section's plain-words re-presentation (labels and explanation only); declared-box display in `vercel_whoami`; disconnect (in-product revocation) for OAuth-enrolled accounts if not already uniform across account kinds; tests with fakes modeled on the spike's **documented real shapes** for the OAuth exchange and install reads; register/STATUS/DECISIONS updates in the implementation PR.

**Out:** per-permission user dials (Vercel's per-resource permission model is private beta — the GA switch stays roadmapped, not built); any change to IN-04's rules, the purchase policy, production rules, or existing accounts'/connections' behavior; any new MCP tool or front-door change (this is a web surface — the OP-1 token budget is unaffected); migrating the owner's own god-mode enrollment (his Tier 2 posture is decided and proceeds independently of this build).

## Acceptance (live probes — merged code never closes the finding)

- **A-1 (team box):** a fresh end-user-shaped sign-in: no pre-enrolled token; the user signs in with Vercel, picks **a team**, completes the standard connection; `vercel_whoami` shows the declared box (team), the standard profile, and the agent performs standard-tier work on that team.
- **A-2 (project box):** the same flow picking **one project**: the connection's reach is the named project — a read outside it is refused (by the credential or the pinning) and the refusal says so plainly.
- **A-3 (whole-account box):** the flow routes to the token tier with the reason stated; after enrollment with the explicit choice, the account reads back its declared box (whole account) and its expiry posture.
- **A-4 (the credential follows the choice):** changing the box re-issues/re-enrolls the credential to match; the prior credential's state is verified dead or honestly reported.
- **A-5 (revocation, both sides):** in-product disconnect → the stored credential is gone on read-back and later calls fail honestly; Vercel-side revoke/uninstall → the next call fails honestly and the posture shows the credential dead.
- **A-6 (no regression):** existing token enrollments (team/project), DCR clients, the Muse client-metadata path (AUD-G), and every other client connect and behave as before; `npm run check` and the full suite green at the implementation head; the front-door listing/token budget unchanged.
- **A-7 (fixture discipline):** live probes run against scratch-class accounts/projects created for the probe and torn down with deletion verified (rtc-scratch discipline). The owner's real accounts and connections are never probe fixtures.

## Build notes

- Additive or it doesn't ship: like AUD-G, every existing path must keep working byte-for-byte for existing accounts and clients; the new surface is a new door into the same account machinery, not a replacement of it.
- The account store already keys `team` and `team/project` and already records probe + scope; the declared box is an additive field in that same shape, with the same journaling discipline as every other account change.
- Fake-first development is how this fleet keeps shipping fixture blindness (PR #223, VMCP-022, VMCP-023): every new fake for this build cites the spike's documented shape it models, in the test or its fixture file.
