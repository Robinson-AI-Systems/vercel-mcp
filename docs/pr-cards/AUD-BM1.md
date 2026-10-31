# AUD-BM1 — The write-contract leg through the HTTPS door (door #3)

**Baseline inspected:** main `a104d234` (AUD-BH, #377).
**Commission:** the AUD-BM dossier (`r2-write-capable-pass-dossier-2026-10-31.md`,
audit goal workspace) §3, card AUD-BM1 — the first of the three cards that
dispose of R-2's remainder. R-2's frozen acceptance line (BATCH-R §4 /
`docs/designs/BATCH-R.md` Tests line): "write-contract helper through HTTPS
(door #3); envelope and error codes per RTC §7".

## What this card is

TEST WORK ONLY. A named suite — `tests/unit/rtc-write-contract.test.js` —
that runs the BATCH-B §3 write-contract checks **through the RTC HTTPS
door** (`src/rtc/door.js`) against the fake provider, with a write-capable
RTC pass as the credential, plus the pass-specific negatives. No runtime
change is expected or made. If the suite convicts a real door defect, this
card stops at the conviction and files it as its own fix card rather than
fixing inside an acceptance card (the AUD-AL/AUD-AM conviction pattern).

**Catalog judgment:** no tool is added, removed, renamed or re-described;
the registry and `docs/TOOL-CATALOG.md` are untouched. The suite's fixture
tools (`vercel_fixture_*`) exist only inside the test file's own registry,
exactly as in `tests/unit/rtc-write-passes.test.js`.

## The seam (extend, don't fork)

The §3 helper (`tests/helpers/write-contract.js`) asserts against
`tool.run(args, ctx)` — door #1 (direct handler) — and, via other suites,
`vercel_call` (door #2). This suite reuses the helper's own fixture factory
(`sampleWrite`, same spec semantics: `name`/`live`/`protected`/`appOwned`/
`mismatch` argument conventions, the same spend/access declaration shapes)
and binds its writes with `defineWrite` + `bindGuardedWrite` under the
**production output convention** every shipped write tool uses
(`isError` on `refused_by_guard`/`outcome_unknown`), in a fixture registry
following `tests/unit/rtc-write-passes.test.js`. Calls enter through
`rtcDoor`'s invoke route, so the pass authorization, the minted frozen
connection, the shared dispatcher and the door's own response shaping are
all in the path — the same §3 checks, a third door.

## Coverage map — BATCH-B §3 at door #3

1. **Dry run** → preview only: no provider call; a preview change-log row
   (`dryRun: true`).
2. **Confirmation required** → without `confirm`, nothing changes;
   `needs_confirmation` with the plain preview summary.
3. **Durable replay / no double-apply** → with `confirm`, exactly one
   provider call and a change-log row carrying the request key; the same
   request again returns the stored result — no second call, no second row.
4. **Read-back verification** → a verify mismatch reports
   `confirmed: false`; an unreadable verify reports `confirmed: null`;
   neither is ever reported confirmed.
5. **Refusal integrity (guards)** → a protected target and an app-owned
   target each refuse at the door as a refusal — HTTP 403, envelope
   `error.code: 'refused_by_guard'`, the guard's plain-words reason in the
   payload — never applied, never a generic service error.
6. **Production discipline** → a production-classified write on a
   preview-mode pass refuses at the door as a refusal (same envelope as
   check 5); on a production-mode pass it needs `confirm`, then applies
   with `mode: 'PRODUCTION'`.
7. **Spend declaration truth** → the preview's dollar line names the
   declared amount and the pass ceiling (amount from the declaration,
   never from arguments); a fixed price exactly **at** the ceiling applies
   journaled as a pass delegation (`basis: 'pass'`); one cent **over**
   refuses at the door as a refusal whose payload names the ceiling rule.
8. **Access widening + profile refusal** → a widening write needs
   `confirm`, then applies; a read-only pass invoking any write refuses
   `outside_scope` (the door-#3 form of "read-only profile cannot write").

**Journal completeness** (across the checks): the preview row and the
applied row share the request key; the applied spend row carries
`spendCents` and the pass delegation; refused writes add no change-log row.

**Pass-specific negatives:**
- a write call inside `_batch` refuses `refused_by_guard` (the batch route
  stays read-only even for a write pass);
- a pass revoked mid-sequence refuses the **next** call `pass_revoked`;
  likewise an expired pass refuses the next call `pass_expired`;
- a project-restricted pass: an in-list target applies; an out-of-list
  target refuses at the door as a refusal naming the restriction; a target
  that resolves to **no project at all** (and an empty target set) refuses
  the same way — scope unprovable.

## Non-scope

No runtime change; no live calls (the suite runs against the repo's own
fake-provider harness, like every R-1W proof); R-1/R-2 bookkeeping is
AUD-BM2; live acceptance of a write pass is AUD-BM3. R-2's index entry
stays IN_PROGRESS until BM1 and BM3 land.

## Acceptance

- [x] The named suite green locally and in CI at the exact head, OR the
      card stops at a documented conviction (below). — **Stopped at a
      conviction; see Outcome.**
- [x] Neighboring suites (`write-contract`, `rtc-write-passes`,
      `rtc-http`, `rtc-api`) unharmed — 4 files, 64 tests, all pass.
- [x] `npm run check` exit 0 read directly with `BASE_SHA` at origin/main
      (`a104d234`).

## Outcome — STOPPED AT A CONVICTION (2026-10-31)

The suite was built as specified and run. **8 of 12 tests pass; the 4
failures share one signature and convict one defect in shipped code.**
Per this card's own rule, the card stops here: the defect is NOT fixed
in this card; it files as its own fix card (below). This PR stays draft
as the conviction's evidence and is not merged.

### What passes (door #3 lifecycle is sound)

§3.1 dry-run preview + preview change-log row; §3.2 confirmation
required; §3.3 durable replay (exactly one provider call, stored result
on repeat, one journal row); §3.4 read-back mismatch `confirmed:false`
and unreadable read-back `confirmed:null`; §3.7's preview dollar line
(declaration + ceiling named; a decoy `cents` argument does not move
it) and its at-ceiling application journaled `basis:'pass'`; §3.8
access-widening confirmation and the read-only pass's `outside_scope`;
journal completeness (preview/applied rows share the request key,
refusals add no row); the batch negative (`refused_by_guard`, batch
stays read-only); revoked-mid-sequence `pass_revoked` and expired
`pass_expired` on the next call; the project restriction's in-list
application; §3.6's production-pass legs (confirmation, then applied
`mode:'PRODUCTION'`).

### The conviction: the door destroys every executor refusal

Every leg whose expected outcome is an **executor refusal** fails the
same way — the door answers **HTTP 503** where the RTC §7 envelope
requires the refusal's own code at its mapped status:

| Leg | Expected | Received |
|---|---|---|
| §3.5 protected target | 403 `refused_by_guard`, "Protected resource" | 503 `service_error` |
| §3.5 app-owned target | 403 `refused_by_guard`, "App-owned resource" | 503 `service_error` |
| §3.6 production write, preview pass | 403 `refused_by_guard` | 503 `service_error` |
| §3.7 one cent over the ceiling | 403 `refused_by_guard`, ceiling named | 503 `service_error` |
| Project restriction: out-of-list target | 403 `refused_by_guard`, restriction named | 503 `service_error` |
| Project restriction: unresolvable / empty targets | 403 `refused_by_guard` | 503 `service_error` |

The full received body for the protected-target leg, verbatim:

```json
{"ok":false,"error":{"code":"service_error",
 "what":"The service could not complete the read",
 "cause":"The service could not complete the read",
 "todo":"Check the pass, scope or requested operation.","technical":""}}
```

The refusal's code, its 403 mapping and its plain-words reason are all
lost; the caller is told a *read* failed and is invited to check the
pass or scope — for a write the safety layer deliberately refused.
`outcome_unknown` write results take the same path, which is worse:
the shape that exists to stop blind retries is replaced by a generic
failure that invites one.

**Root cause (three links, all in shipped code):**

1. Every shipped write tool's output mapper marks executor results
   with status `refused_by_guard` / `outcome_unknown` as MCP error
   results (`isError: true`) — correct at the MCP door, where the
   caller reads the JSON body. E.g. `src/tools/blob.js` `resultMapper`;
   the same line is in `access-groups.js`, `account-settings.js`,
   `custom-environment-*.js`, `deployment-*.js`, `dns.js`,
   `domains.js`, `firewall.js`, `globalconfig-create.js`, and the rest.
2. `src/rtc/door.js` `invoke()` treats **any** `isError` dispatch
   response as a transport failure: `if(response?.isError||…) return null;`
3. The door handler converts that null into `fail(res,'service_error')`
   — HTTP 503 with the generic text above.

The door's *own* refusals (scope preview, batch rule, pass state) map
correctly through `fail()`; only refusals that arrive via the shared
dispatcher as error results are destroyed. This is not fixture-only:
the suite's mapper is the shipped convention verbatim, the door code
path is tool-agnostic, so **every guarded write that the executor
refuses is unrefusable-looking at door #3 in production** — a pass
holder cannot distinguish "refused: protected resource" from a server
fault. R-1W's door suite did not catch it because its refusal
assertions were `error?.code` *truthy* (which `service_error`
satisfies) and `result?.status` *not applied*; BM1's §3 assertions pin
the code, the status and the reason, which is what the frozen R-2
acceptance line ("envelope and error codes per RTC §7") requires.

### The fix card this files (sketch, for the coordinator to issue)

Teach the door's invoke path to distinguish a write executor's
*result* (an `isError` response whose single text part parses to a
guarded-write result object with a known status) from a transport
failure: surface it through the door's envelope with the refusal's own
code (`refused_by_guard` → 403; `outcome_unknown` → its honest shape)
and the refusal's plain-words reason carried in the envelope, per
AUD-AH's rule that typed refusal reasons travel verbatim. BM1's suite
is the acceptance test: it goes green exactly when the fix is right,
and this card then completes and merges. No BM1 assertion needs to
change for the fix — the assertions state the contract, not the bug.

### Evidence

- Local: `npx vitest run tests/unit/rtc-write-contract.test.js` —
  12 tests, 8 passed / 4 failed; each failure's first assertion is
  `expected 503 to be 403` at the refusal leg (test lines 186, 200,
  226, 295). Assertions behind the first failure in §3.6 (the
  production-pass legs) were verified separately against the same
  harness and pass.
- The suite touches no shipped code: one new test file, this card,
  the STATUS bullet.
