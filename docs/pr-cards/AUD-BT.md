# AUD-BT — Pass-door plans flatten to 503 on a production pass (fix)

Filed from AUD-BM3 (2026-11-02): through a **production** write
pass, `vercel_project_update_settings` (rename dryRun) and
`vercel_registrar_buy` (dryRun) answered **503 `service_error`**
deterministically, while the identical project-settings call
planned cleanly on the owner connection. AUD-BQ had fixed the
door's flattening for `refused_by_guard` payloads; this card is
the residual it named.

## The experiment (ran first, before any fix)

The AUD-BQ harness (real registry, real door, fake provider),
with the pass in AUD-BM3's exact shape — profile full, mode
**production**, areas [server, deployments, projects, env,
registrar], ceiling $0.00, project-restricted — reproduced the
live answers (door: 503 for both tools) and printed the raw
dispatch payloads, which split the failure in two:

1. **The production envelope hides the refusal.** The result
   shaper wraps every payload from a production-mode connection
   in `{mode:'PRODUCTION', banner, result}` (`shapeVercelResult`).
   The executor's refusal therefore sits at `data.result.status`,
   while the door's AUD-BQ check reads `data.status` — so on a
   production pass every structured refusal misses the check and
   falls through to the 503. AUD-BQ's suite used a **preview**
   pass, where payloads stay bare; the envelope was never
   exercised at the door. (The same nesting hid `stored` write
   results from the route's stored branch.)
2. **The rename target carries no project identity.**
   `vercel_project_update_settings`' `targets()` returns the
   rename destination as `{kind:'project', id:<newName>}` — the
   project's future *name* in the id slot. The executor's pass
   project-restriction resolves a target's project identity
   (`projectId` first, then kind/id) and so judged the rename
   outside a pass restricted to that very project: a guaranteed
   `refused_by_guard` for every rename under a restricted pass,
   on top of defect 1's 503.

`vercel_registrar_buy`'s own outcome is by design: its before()
refuses immediately (AUD-AV/D9 — the registrant contact has no
supply path; the dashboard remedy is in the refusal reason). The
defect is only that the door flattened that typed refusal into a
503 claiming a service failure. (The coordinator's BM3 note
guessed its before() priced the domain first; it does not — the
refusal precedes any provider call.)

## Fix

- `src/rtc/door.js` — `invoke()` unwraps the production envelope
  (exact shape: `mode:'PRODUCTION'` + string banner + object
  result) before judging the payload, for the two statuses the
  route dispatches on: an error payload whose inner status is
  `refused_by_guard` surfaces as the door's 403, and a stored
  write result reaches the route's stored branch in production
  mode as it does in preview. Ordinary results keep today's
  shape in both modes; `outcome_unknown` payloads deliberately
  keep AUD-BQ's flattening (a write outcome, not a refusal).
- `src/tools/project-settings.js` — the rename target now also
  declares `projectId: before.id`: it is the same project under
  its new name, and the restriction resolves `projectId` first.
  The guards still screen the target's id/name exactly as before.

## Fixture gap, named

AUD-BQ's door suite exercised a preview-mode pass only, so the
production envelope never appeared; and no suite composed a
project-restricted pass with a rename. The new suite
`tests/unit/rtc-door-production-pass.test.js` drives the real
registry through the real door in the AUD-BM3 production-pass
shape: the in-scope rename plans (200, preview inside the
envelope), the out-of-scope rename refuses 403, the registrar
buy's by-design refusal surfaces 403 with no provider call, and
the AUD-BQ files-create refusal now also surfaces under a
production pass. Negative control: with the door fix reverted,
the production-pass refusal cases fail 503.

## Acceptance

AUD-BT's filed acceptance: both convicted tools plan through a
pass door with typed outcomes (this PR, in fixtures), the
rtc-door suite extended (this PR), and AUD-BM3's priced-refusal
atom — a fixed positive price against a $0 pass ceiling — proven
through the door. The atom's fixture form rides this suite (the
files-create production-pass refusal is the same preflight
branch); its live form rides the next coordinator pass session
after this fix promotes. No tool added, removed or renamed;
registry unchanged at 253. Batches with the release train.
