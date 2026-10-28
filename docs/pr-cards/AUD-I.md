# AUD-I — "Log in with Vercel": OAuth login tier, dynamic box choice at sign-in, explicit god-mode tier (VMCP-026 / IN-16)

Status: CARDED 2026-10-28 (design + acceptance filed ahead of the build, S5 pattern) — build starts when VMCP-023 closes, per the owner's sequencing ruling 2026-10-28 (this build next; the narrowed remainders VMCP-003/011/016 and VMCP-025 follow). VMCP-026 stays **open** until its acceptance probes pass live. Design addendum the same day: the two-layer box model (granted ceiling / working box) — see "The box is two layers" below.

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

The account stores the user's **declared box** (the plain-words choice) alongside the existing probe result. `vercel_whoami` shows both: declared box, probed scope, mode, profile. The probe remains corroboration with its honesty intact (`scopeVerified: false` — REST reads cannot prove a token's complete privilege set; the recorded label is a visibility heuristic, e.g. a single-team owner's full-account token can probe as `team`). A probe showing **broader** than the declared box surfaces a plain warning at enrollment time; a probe showing narrower states plainly that the credential reaches less than the box promises. Neither is silently adjusted. (The declared box is the *initial* selection — the next section makes it a setting, not a sentence.)

### The box is two layers: granted ceiling + working box (owner addendum, 2026-10-28)

**One login serves every box.** The same sign-in must serve a project box, a team box and the whole account; the box picked at sign-in is the initial selection, not a permanent binding. **Membership, not ownership, is the fence:** a user who belongs to a team — any role — can point a connection at that team, and their reach inside it is exactly their role's reach, enforced by their credential. The server never exceeds the credential behind the connection; it also never demands ownership the platform doesn't.

The box is modeled as two layers:

- **The granted ceiling** — the widest credential the user has given the server: per team, the OAuth install; or an enrolled token's scope. The ceiling is the *grant*.
- **The working box** — a per-connection, server-side setting. It can be **narrowed freely** at any time (a team credential, a project working box for safe testing) and **widened instantly up to the granted ceiling** — flipped by the agent through a tool, on the user's say-so, with **no re-login**. Every flip is journaled like every other connection change. Restraint is a *setting*; the ceiling is the grant.

**Widening beyond the granted ceiling is the only move that needs a new grant** (install/sign-in for that team, or a wider token). There the agent must say so plainly and walk the user through the one-time step — never silently fail, never pretend the flip happened, never narrow the answer into a generic error.

Copy consequence, binding on the enrollment and OAuth surfaces this card builds: because the working box can always be narrowed afterward, the copy **encourages granting the widest ceiling the user is comfortable with**, disclosed in plain words at the grant moment — what it reaches, and that narrowing afterward is free and instant.

**The agent must know and say.** The connection's self-description (`vercel_whoami` or its successor) reports, in plain language any agent can relay verbatim: the current **working box**, the **granted ceiling**, **which flips are instant**, and **which flips need a one-time grant** — so a freshly connected agent proactively tells its user: *"You're pointed at one project; you can widen to the team or your whole account, just say the word"* (naming a grant step instead, where that's the truth). This is a requirement on the output text, not a hope about agent behavior.

Tool surface: the flip is an agent-called tool. It ships reachable through the catalog (`vercel_call`) at minimum; promotion into the front door happens only if the OP-1 budget (5,000 tokens; 4,670 at the last measurement) fits it, measured at build time — this card does not pre-spend that budget.

### Tier 2 made explicit (no behavior change underneath)

The setup page's enrollment section is re-presented in plain words as the **god-mode tier**: what it is (a token you create with everything on), what it unlocks, the scope boxes, the expiry choice **including never** (IN-04: the key owner's choice; the server's duty is warn-ahead — the 14-day warning already in `vercel_whoami` / `vercel_admin_overview`), and the explicit broader-account checkbox as the deliberate act it is. Probe, storage, encryption and journaling are unchanged.

### Revocation from both sides

- **In-product:** disconnecting an account deletes its stored credential (journaled like every account change); connections bound to it fail honestly afterward.
- **At Vercel:** revoking the token or uninstalling the integration makes the credential dead; the next use fails honestly and the account's posture surfaces it as dead — no silent success, no stale "connected" claim.

### Operator secrets

The OAuth app's client credentials are server environment values set by the operator (the `ADMIN_PASSPHRASE` pattern): never in the repo, never in chat, never returned by any tool. The redirect URI is this server's own origin.

## Scope

**In:** the Step-0 spike + card amendment; the connection page flow (box choice in plain words, tier routing); the Vercel OAuth round trip and token receipt, enrolled through the existing probe/store path with the declared box recorded; the Tier 2 setup section's plain-words re-presentation (labels and explanation only); declared-box display in `vercel_whoami`; disconnect (in-product revocation) for OAuth-enrolled accounts if not already uniform across account kinds; **the two-layer box model: the per-connection working-box setting, the agent-called flip tool (catalog-reachable at minimum; front-door only inside the measured OP-1 budget), the plain-language ceiling/flip reporting in the connection's self-description, and the widest-ceiling copy on the grant surfaces**; tests with fakes modeled on the spike's **documented real shapes** for the OAuth exchange and install reads; register/STATUS/DECISIONS updates in the implementation PR.

**Out:** per-permission user dials (Vercel's per-resource permission model is private beta — the GA switch stays roadmapped, not built); any change to IN-04's rules, the purchase policy, production rules, or existing accounts'/connections' behavior; **any front-door change beyond the flip tool's conditional promotion above, and any other new MCP tool**; migrating the owner's own god-mode enrollment (his Tier 2 posture is decided and proceeds independently of this build).

## Acceptance (live probes — merged code never closes the finding)

- **A-1 (team box):** a fresh end-user-shaped sign-in: no pre-enrolled token; the user signs in with Vercel, picks **a team**, completes the standard connection; `vercel_whoami` shows the declared box (team), the standard profile, and the agent performs standard-tier work on that team.
- **A-2 (project box):** the same flow picking **one project**: the connection's reach is the named project — a read outside it is refused (by the credential or the pinning) and the refusal says so plainly.
- **A-3 (whole-account box):** the flow routes to the token tier with the reason stated; after enrollment with the explicit choice, the account reads back its declared box (whole account) and its expiry posture.
- **A-4 (the credential follows the choice):** changing the box re-issues/re-enrolls the credential to match; the prior credential's state is verified dead or honestly reported.
- **A-5 (revocation, both sides):** in-product disconnect → the stored credential is gone on read-back and later calls fail honestly; Vercel-side revoke/uninstall → the next call fails honestly and the posture shows the credential dead.
- **A-6 (no regression):** existing token enrollments (team/project), DCR clients, the Muse client-metadata path (AUD-G), and every other client connect and behave as before; `npm run check` and the full suite green at the implementation head; the front-door listing/token budget unchanged.
- **A-7 (fixture discipline):** live probes run against scratch-class accounts/projects created for the probe and torn down with deletion verified (rtc-scratch discipline). The owner's real accounts and connections are never probe fixtures.
- **A-8 (flips inside the ceiling are instant):** on a connection whose granted ceiling is a team, the agent flips the working box team → one project → team on the user's word, with no re-login and no new grant; each state reads back correctly in the self-description, each flip is journaled, and a read outside the narrowed project box while it is set is refused plainly.
- **A-9 (beyond the ceiling is honest, then walkable):** the agent attempts to widen beyond the granted ceiling (e.g. to a team never installed, or to the whole account on an OAuth-only grant): the answer names, in plain words, the one-time grant step required — no silent failure, no pretended flip, no generic error. After the user completes that one grant, the same flip succeeds without re-login of the existing connection.
- **A-10 (the agent can say it unprompted):** a freshly connected agent, given only the connection's self-description output, can state in plain language: the current working box, the granted ceiling, which flips are instant and which need a one-time grant. The probe is run cold — the relay text is judged from the output alone, not from documentation.

## Build notes

- Additive or it doesn't ship: like AUD-G, every existing path must keep working byte-for-byte for existing accounts and clients; the new surface is a new door into the same account machinery, not a replacement of it.
- The account store already keys `team` and `team/project` and already records probe + scope; the declared box is an additive field in that same shape, with the same journaling discipline as every other account change.
- Fake-first development is how this fleet keeps shipping fixture blindness (PR #223, VMCP-022, VMCP-023): every new fake for this build cites the spike's documented shape it models, in the test or its fixture file.
