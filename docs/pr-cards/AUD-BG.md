# AUD-BG — R-3 executed under disposition (b): the frozen RTC 1 conformance suite, wired in CI

**Baseline inspected:** main `a104d234` (AUD-BH, #377).
**Authority:** the owner's composite ruling of 2026-10-31 (~16:32 MDT),
all five RTC 2 decisions as recommended, following the AUD-BF judgment
dossier (`r3-conformance-judgment-2026-10-31.md`, audit goal files).
Primary record: the hub repo's `docs/DECISIONS.md` (PR #251), entry
"2026-10-31 — RTC 2 adopted as RTC 1's §9 successor; the RTC 1 freeze
holds (R-3 disposition)"; mirrored in this repo by AUD-BH (#377).
D5 is the composite: the RTC 1 freeze HOLDS — option (b), no shipped
dialect is amended to chase the hub suite's unversioned post-freeze
drift — AND RTC 2 is adopted by that dated decision as RTC 1's §9
successor. This card is R-3's build under (b). The roadmap card is
`docs/pr-cards/R-3.md`; BATCH-R §R3, §4 (R-3 done-when) and §6
(acceptance mapping: "RTC 1 conformance → CI job `conformance`")
govern scope.

## What is built

- **`scripts/rtc-conformance-ci.mjs`** — the conformance harness. It
  starts the pinned `emulate` fake-Vercel with the repo's seed
  fixture, discovers the seeded team, creates a throwaway database
  state through this server's own `src/db.js` on a real Postgres
  (account row seeded with the emulator token through the server's
  own encryption, `encryptSecret` under `'token:' + accountId`),
  issues the role passes through the server's own issuance functions
  (a full write pass via `issueWriteRtcPass`; read-only, expired and
  revoked passes via `issueReadOnlyRtcPass` plus the row surgery the
  db tests use; a dedicated low-limit pass for the two-instance leg),
  starts **two independent door processes** (`--serve` children
  hosting `src/rtc/door.js` over a pg-backed query — the production
  route shape, minus the Neon transport the local database cannot
  speak), builds the OAuth refresh-settings adapter over this
  server's own OAuth store (below), and calls the hub suite's
  `runConformance` **at the pin** (`e76b1f8bc76e4658f404263ee47a9edbcbeda625`,
  `packages/conformance/src/run.js`).
- **A `conformance` job in `.github/workflows/ci.yml`** (Postgres
  service, hub checkout at the pin into `rtc-hub/`, `npm ci`, the
  harness), added to the `ci` gate's needs; `scripts/check-ci-layout.mjs`
  policy admits it at the standard 10-minute cap. A harness failure
  fails `ci` (BATCH-R §R3). The unit job and the offline check are
  untouched.
- **The divergence record** in `docs/RTC-HUB-INTEGRATION.md`: pin vs
  hub HEAD `e6cfb98`, the two changed dialects (catalog pagination —
  HEAD walks `page=N` to exhaustion, the pin and the shipped door
  speak one cursor-offset page; result recovery — HEAD expects
  content pages, the shipped door returns CONTRACT §7 record pages),
  the CONTRACT §9 basis, the composite ruling that resolves it, and
  which named checks run where.

## The named subset asserted (legs 1–7 of the dossier sketch)

The harness asserts each of these pin-suite checks is `ok` and not
skipped; anything else fails the run:

1. `manifest`, `manifest.openapi`
2. `passes`
3. `passes.read_only`, `passes.expired`, `passes.revoked`
4. `limits.two_instance` (two door processes, one throwaway
   Postgres, a dedicated pass with limit 10)
5. `oauth.refresh_settings` (adapter below)
6. `catalog` (pin dialect: one `limit=100` page, validated as
   returned — the dialect the shipped door speaks)
7. `budget`, `safety`, `meta`

## Dispositioned, not chased: `reads` / `writes`

At the pin these two probes hardcode fake-server semantics no real
server can satisfy (positional tool choice off the returned page; a
generic read must echo a stored `value`; write recovery must return
the written payload in a shape CONTRACT §7 does not carry — the
dossier's §3.2 reproduces the probe logic). They are run for the
record and printed, never asserted. Under (b) their behavior is
covered by the interim coverage BATCH-R §R3 names — "this server's
own write-contract tests over MCP, `vercel_call` and HTTPS":
`tests/unit/write-contract.test.js` (the eight write-contract checks
through every door), `tests/unit/purchase-delegation.test.js`,
`tests/unit/rtc-write-passes.test.js` and
`tests/db/rtc-write-passes.test.js` (write-capable passes at the
door, preview → confirmation → apply), `tests/unit/rtc-http.test.js`
and `tests/unit/rtc-api.test.js` (the HTTPS door suites). This is
recorded in `docs/RTC-HUB-INTEGRATION.md` with the divergence.

## Sketch-vs-code disagreements, noted per the build instruction

1. **The sketch's `VERCEL_API_BASE` seam does not exist in shipped
   code.** Nothing under `src/` reads that variable; the provider
   binds `makeVercelClient` without a `baseUrl`, whose default is
   the production API origin. The shipped seam that reaches the
   client is the door's `fetchImpl` (rtcDoor → dispatcher ctx →
   provider bind → client), which production leaves unset. The
   harness's door processes pass a `fetchImpl` that rewrites the
   production origin to the local emulator — exercising the shipped
   door, registry, handlers, provider and client unmodified. No
   base-URL override was added to shipped code (that would be a
   surface change outside this card).
2. **The sketch names the OAuth leg's store `storeToken`.** In the
   code, `storeToken` (`src/vercel/tokens.js`) stores the
   Vercel-side enrollment token. The server's OAuth connector-token
   store in `src/db.js` is `createAccessToken` /
   `getTokenByRefreshToken` / `getAccessToken` /
   `rotateRefreshToken`; the adapter is built over those, exactly as
   the leg definition intends (inspect settings, rotate, inspect
   again — settings unchanged). Connector tokens carry no `areas`
   field (`CONNECTION_FIELDS` in `src/db.js`); the adapter reports
   `areas: null` on both inspections — the honest projection, not a
   fixture convenience.
3. **The suite's reference pass.** The suite selects its reference
   read/write/guarded tools from the first catalog page the full
   pass receives, and the door's page is the shipped 8 KiB
   envelope-bounded prefix of the pass-visible catalog — a
   server-scoped page can never satisfy selection (that area's
   visible rows are all reads; its connection tools are not
   pass-visible writes). The harness therefore issues the reference
   pass scoped to the projects area (the first page carrying all
   three kinds: `vercel_project_list`,
   `vercel_project_update_settings`, `vercel_project_create`) with
   its listing set to `catalog` by row surgery: issued passes are
   born with the schema's `compact` listing, the suite searches
   without a listing parameter (which the door scopes to the pass's
   own listing), and a catalog-listing pass is a record shape the
   door validates and the offline check's fixture pass already
   models. Fixture hygiene in a reused throwaway database also
   deletes the fixture account row before enrollment: the emulator
   assigns its seed team a fresh id per start and the enrollment
   upsert's ON CONFLICT path deliberately preserves an existing
   row's team identity.
4. **`passes.read_only` refusal code.** The frozen probe requires a
   read-only pass's write attempt to be refused with
   `refused_by_guard`; the shipped door answered `outside_scope`
   (the tool is invisible to the pass, so `named()` misses and the
   door reports scope). The probe text is freeze-era — identical at
   the pin and at hub HEAD, so this is not the post-freeze drift the
   ruling protects the dialects against; it is a latent mismatch the
   suite was never in a position to expose (PR #115 could only run
   the three no-pass checks). Minimal correction in this card, in
   `src/rtc/door.js`'s invoke route only: when a pass that cannot
   write (`allowWrites !== true`) invokes an existing write tool,
   the refusal is `refused_by_guard`. Visibility semantics are
   unchanged everywhere else (list/describe still answer
   `outside_scope`; a write pass invoking outside its areas still
   answers `outside_scope`; nothing is dispatched in any of these
   cases). The R-1W unit test's invoke expectation is updated to the
   corrected code with a dated note; its describe expectation and
   its nothing-was-applied assertion are unchanged. No dialect is
   amended: catalog pagination and result recovery are untouched.
5. **The `MOVES MONEY:` listing prefix (a data finding, leg 7's
   empirical case, as the dossier anticipated).** CONTRACT §3
   requires a money tool's listing text to lead with
   `MOVES MONEY:`; the `catalog` probe asserts it, and no tool
   definition in this repo carried the prefix — the catalog check
   failed on `vercel_project_create`, the first money tool on the
   reference page. Fixed at the derivation seam: `rtcMetadata` in
   `src/core/rtc-contract.js` — the single funnel behind every RTC
   catalog row — now applies the prefix for money tools (capped at
   the 160-character listing bound). The MCP listing surface, whose
   descriptions and token budgets are separately governed, is
   untouched; no tool definition changed.

## Not in this card

- **RTC 2 adoption** (content pages, `page=N` catalog walk, the
  RTC 2 manifest) is a separate later card under the adopted
  contract — never a chase of the unversioned suite. The pin stays
  `e76b1f8`; nothing re-pins to hub HEAD.
- **Hosted/live D-4 certification** stays a separate pending
  acceptance row (owner-gated, IN-06); this harness is local CI
  evidence only. No promotion, no live calls.

## Catalog judgment

No tool added, removed or renamed; the registry and
`docs/TOOL-CATALOG.md` are untouched. The shipped-code changes are
the two corrections above — the door's invoke refusal code and the
RTC catalog's money-prefix derivation; neither changes a tool
surface. The rest is the harness script, the CI job, the layout
policy, the integration record and paperwork.

## Evidence

(Filled at completion — harness results named check by named check,
local and CI, recorded here and in the PR's self-review.)
