# AUD-BQ — RTC door flattens a guarded write's refusal into a 503 (fix)

Filed from the 2026-11-01 post-promotion pack leg (i) (AUD-BM3): a
full-profile write pass (preview mode, areas [server, deployments,
projects, env], ceiling $0.00, project-restricted) calling
`vercel_deploy_create_from_files` at the RTC HTTPS door received
**503 `service_error`** ("The service could not complete the read")
deterministically, including on dryRun, while the identical call
planned and applied through the owner OAuth connection and pass
reads at the same door returned real provider data. The diagnosis
dossier (coordinator, 2026-11-01) narrowed it to the connection
object and specified a discriminating experiment; this card ran it.

## The experiment (ran first, before any fix)

Harness: the real registry, `dispatchReadOnlyTool` called exactly
as the door's `invoke()` calls it (same `formatError`, same
`shapeResult`), the provider behind `makeFakeVercel`, `loadToken`
mocked — the `tests/unit/deployment-git-create.test.js` seams. Two
connections, each lifted verbatim from its minting site:

- **Pass-shaped** — `src/rtc/door.js` requirePass: `{account,
  profile:'full', mode:'preview', listing, clientId: <pass id>,
  kind:'pass', passAllowWrites:true, passSpendLimitCents:0,
  passProjectIds:[<project>]}`, frozen, `resultOwner` as minted.
- **OAuth-shaped** — `src/core/mcp-auth.js` requireMcpToken:
  `{clientId, account, mode:'preview', profile:'full', listing,
  kind:'connector', readOnly:false}`, frozen, both hidden fields.

Same dryRun args for `vercel_deploy_create_from_files` under both.
Captured dispatch responses:

- **PASS** → `isError:true`, payload
  `{"status":"refused_by_guard","confirmed":false,"reason":"Recurring
  or unquantified spend cannot be delegated to a pass; it needs the
  account owner directly"}`. Provider calls: the projects_get read
  only — preflight ran end to end and refused deterministically in
  write-preflight's pass spend branch (the tool's spend declaration
  is `{cents:null, recurring:true}`; R-1W: recurring or
  unquantified spend is never delegable to a pass).
- **OAUTH** → `isError:false`, payload `{"status":"preview",
  "mode":"PREVIEW", "dryRun":true, ...}` — the same write plans.

## The conviction

The refusal is **correct policy, correctly produced** — the shared
executor and preflight are healthy, and the OAuth door proves it.
The defect is the last hop: `src/rtc/door.js` `invoke()` returns
null for **any** dispatch response with `isError` set, and the
invoke route answers `fail(res,'service_error')`. A guarded
write's structured refusal — a policy answer the MCP door returns
to its caller as data — is thereby misreported at the RTC door as
a service failure, and its status and reason are discarded. The
door's own vocabulary already carries the right code
(`refused_by_guard`, 403, "This pass cannot execute the requested
operation"); it was applied to route-level checks only, never to
a dispatch refusal. Every guarded-write refusal a pass can earn
(ceiling, recurring/unquantified class, project restriction,
authority shape) flattened the same way.

Deliberately not remapped: `outcome_unknown` payloads keep today's
flattening. That status is a write *outcome* (confirmed:null plus
the requestKey a read-back needs), not a refusal; whether the door
should return it as data is a separate contract question, recorded
here as an adjacent observation for a later card, not decided by
this one.

## The fix

`src/rtc/door.js`, two seams, no other file:

- `invoke()` parses the single text payload as before (plain-text
  successes still pass through; unparseable error payloads still
  return null) and, when the dispatch is an error whose payload
  parses to an object with `status:'refused_by_guard'`, returns
  that object instead of null. Prose provider errors
  (`vercelErrorResult` carries no JSON status) are untouched.
- The invoke route answers a `refused_by_guard` payload with
  `fail(res,'refused_by_guard')` — HTTP 403 in the door's canned
  vocabulary, as with every other door refusal. The executor's
  specific reason stays on the MCP surface; the door's error
  dialect is code-canned by design (the AUD-BG pin discipline).

## The fixture gap this closes (named)

`tests/unit/rtc-write-passes.test.js` (R-1W) exercises the door
against a **fixture registry**: five `vercel_fixture_*` writes
with canned spend shapes behind a fixtureContext (stubbed
guards/checkSpend, no provider). No test anywhere dispatched a
**real registry tool** under the connection the door mints — the
real tools' own contexts (provider bind, real spend declarations,
guarded-write output mapping) never ran under a pass. And the
door-level refusal assertions were `error?.code` **truthy** —
which a 503 service_error satisfies — so the flattening was
invisible to the suite that should have caught it. The new suite
(`tests/unit/rtc-door-refusal.test.js`) drives the real registry
through the real door with the live AUD-BM3 pass shape and
asserts the exact code (403 / `refused_by_guard`); negative
control: with the door fix stashed, its first test fails (the
refusal comes back 503).

## Side capture (for the record)

Pack leg (i) also saw `vercel_env_create` and
`vercel_project_update` answer 404 at the door. Neither name
exists in the registry (the real rows are `vercel_env_set` and
`vercel_project_update_settings`): the 404 is the door's catalog
`named()` lookup answering for a nonexistent tool — the invoke
route is never reached and no defect attaches. The probe used
wrong names; the regression suite pins the 404 in executable form
so the fact survives.

## Verification (PC bench, this branch)

- New suite `tests/unit/rtc-door-refusal.test.js`: **4/4**,
  including the negative control above.
- RTC/pass targeted run (rtc-door-refusal, rtc-write-passes,
  rtc-http, rtc-api, rtc-manifest, pass-proposals-write):
  **54/54 across 6 files**.
- Full `npm test`: **174 files, 1695 tests, all passed** (exit 0;
  1691 pre-existing + this suite's 4, across 173 + 1 files).
- `BASE_SHA=$(git rev-parse origin/main)` (= 8672415c)
  `npm run check` against the committed range: **exit 0**.
- Pre-push conflict-marker grep
  (`git grep -n -E '^(<{7}|\|{7}|>{7})' -- .`): clean.

## Scope / catalog judgment

No tool added, removed or renamed; no schema or contract change
beyond the door's error mapping for one payload class. The change
is in `src/rtc/`, not `src/tools/`, so DRIFT-PROTOCOL checklist B
is satisfied by this card + the STATUS bullet; TOOL-CATALOG is
untouched (no tool module changed). Registry unchanged.

## Closure (not in this PR)

Live closure stays coordinator work after this fix promotes on
the nightly train: re-run AUD-BM3's remaining atoms (one guarded
write through the door preview → confirm → applied with
read-back; the spend-classified refusal now observable as 403
`refused_by_guard`; journal sampling showing basis=pass).
AUD-BM1's parked door-#3 suite (PR #392) absorbs this repro when
it runs. Listed, not claimed here.
