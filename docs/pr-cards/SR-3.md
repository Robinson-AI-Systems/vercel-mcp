# SR-3 — Enrollment under identity + attestation capture (gate O-2.7)

Date: 2026-11-01
Gate: O-2.7 (sign-in replacement; dossier
`signin-replacement-dossier-2026-11-01.md`, sections 5.4,
5.5, 7.2, 7.5, 8.1, 9 U-1 + the 2026-11-01 18:40 MST
rulings addendum: Q3 = owner-match OR roster membership).
SR-1 (PR #401) built the Vercel sign-in leg dark; SR-2
(PR #402) wired consent on attested identity and built the
binding rule (`bindableAccounts`) — reading an
`attested_user_id` column nothing populated yet. This card
populates it and re-gates the enrollment branch on the
public class. SR-4 formally splits the developer route;
nothing in this card touches that split.

## Attestation capture — the probe persists what it reads

Every enrollment and recheck probe already *reads* the
credential's owner identity and discards it (dossier
section 4.5). The probes now return it, and the stores
persist it into SR-1's additive `attested_user_id` column
through the upsert (which gains the parameter; the fake db
already carried it):

- **Team/full pasted token** (`probeTeamVisible`): the
  identity leg's `user.id` — load-bearing there already.
- **Project-scoped pasted token** (`probeProjectScoped`):
  identity was deliberately never load-bearing on this
  path; capture is **best-effort** — one unscoped identity
  attempt whose answer is recorded when it comes and null
  when it does not. A refusal changes nothing about the
  project proof.
- **Personal install** (`probePersonalToken`): the row
  keys on the user id and the probe cross-checks the
  credential against it — attested by construction.
- **Team install** (`probeInstallationToken`): the
  exchange's `user_id`, the value the probe record already
  persists as `installerUserId` — lifted into the column.

Upsert semantics are AUD-E's, mirrored from the fake db:
a fresh enrollment's attestation (including null) replaces
the row's — a rotated credential never inherits the
previous key's attested owner.

## The recheck backfills (the section 5.5 mechanism)

`recheckStoredToken` now persists the identity its probe
read, through the new `recordAccountAttestation` db
method — the coordinator-run recheck in section 5.5 step 1
depends on exactly this. The write is deliberately
narrow: one additive identity column on this server,
derived from the recheck's own reads; no credential, no
scope and nothing at the provider is written (every
provider call stays a GET), and the AUD-AI ungated scope
derivation is untouched. It is best-effort like the
refusal journal — a failed write is reported on the
result (`attestedUserId`, `attestationPersisted`), never
changes the recheck's verdict, and SR-5's read-back is
the verification that it landed. This supersedes the
AUD-AI/AUD-BI record's "the recheck persists nothing"
for the identity column only; the dated note in
TOOL-CATALOG carries the same correction. A legacy
Door-2 row — the DPGA shape: no stored owner identity —
becomes bindable by its owner at consent after one
recheck, with no token re-paste (the journey is pinned
by test, below).

## Enrollment re-gated on the public class

The AUD-AR branch is still passphrase-gated on every
class at SR-2's close. On the **public class with the
sign-in leg configured**, enrollment now requires the
attested sign-in flow (the same record SR-2's consent
validates: live, attested, unconsumed, browser-bound):

- **GET without a usable flow detours first** (dossier
  section 7.2): with the client parameters present it
  302s into the authorize detour (Vercel sign-in, then
  the consent's enrollment link, which now carries the
  flow handle); without them it refuses in plain words,
  naming the route in.
- **GET with a flow** renders the enrollment page with
  **no passphrase field**; the Blob form offers only
  accounts the signer may bind.
- **POST** is authorized by the flow record alone — a
  posted passphrase is never evaluated on this class —
  and dispatches with the signer's attested identity:
  - *Token enrollment* enforces the section 5.4 binding
    rule **before anything is stored** (the service
    probes first): owner match — the probe's attested
    owner is the signer — or roster membership read
    with the enrolling credential itself naming the
    signer on the target team. Neither limb: refusal
    in plain words, and **nothing is stored** (the
    existing row for that team, if any, is untouched).
  - *Blob enrollment* requires the target account to
    be in the signer's bindable set (the service's
    `bindableAccounts`, reused — eligibility is never
    re-derived).
- Continue/back links on this class return to the
  attested consent (`authorize?flow=…`).

The **dev class** and the **interim public class** (leg
unconfigured — SR-2's recorded judgment) keep the
passphrase gate byte-for-byte: the legacy branch is
untouched below the class dispatch.

## Per-scope-class roster outcomes (U-1's remainder)

SR-2 verified limb 2's operation against the pinned
snapshot and pinned its shape + fail-closed posture.
This card pins the behavior **per credential class**,
executing the members read with the account's own
stored credential:

| Credential class | Members read | Limb 2 |
|---|---|---|
| Team / full user token | Answers | Grants when the signer is named |
| Project-scoped token | Refused (403) | Never grants — owner-match only |
| Installation (install-arm) token | Refused (403) | Never grants — owner-match only |

Fail closed in every class: an unreadable roster is the
absence of a grant, never an error and never a pass.
Where a class cannot read a roster, that class binds
owner-match only — the named degradation section 5.4
prescribes, now evidenced per class instead of assumed.

## Fixtures

`tests/unit/enrollment-identity.test.js`: attestation
capture per store path (team probe persists the identity
it reads; project path best-effort — attested when the
unscoped read answers, null when it refuses, enrollment
unaffected either way; personal and installation stores
lift their installer identity); the recheck backfill
journey (legacy Door-2 row, attested nowhere → recheck →
column populated → the account renders bindable for its
owner); the per-scope-class roster table above, keyed
by the stored credential the fake provider sees; and
the handler journey on the configured public class —
detour-first GET, flow-authorized page with no
passphrase field and a bindable-only Blob select,
owner-match enrollment stored + attested, stranger
enrollment refused with nothing stored, roster-limb
enrollment stored, flow-less POST refused, Blob on a
non-bindable account refused. The legacy suites
(`oauth-enroll`, `signin-journey`, `tokens`,
`recheck-conviction`) pin the untouched paths.

Catalog judgment: no tool added, removed or renamed and
nothing under `src/tools/` changes; the recheck's
identity persistence is recorded as a dated note on the
existing `vercel_check_token` catalog entry (its row
text is unchanged — it already states the re-probe and
the report; the note corrects the AUD-AI note's
"persists nothing" for the identity column). Checklist
B is satisfied by this card + the STATUS bullet +
that note. Registry unchanged at 253.

Live exercise is the section 8.3 acceptance battery —
listed, not claimed. Batches with the release train.
