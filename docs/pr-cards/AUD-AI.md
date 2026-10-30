# AUD-AI — Recheck conviction: leg-named classification, the refusal fingerprint, and ungated scope derivation

**Baseline inspected:** main `45edf31` (AUD-AH, #289). Dossier:
`recheck-conviction-dossier-2026-10-30.md` in the audit goal
workspace — written before code, per the research-first rule: the
user-token recheck's full call graph and scope-derivation rule,
the classification trace from a probe leg to the tool surface,
and the pinned snapshot's error-envelope contract for the three
probe endpoints.

**The live fact.** On the promoted build, 2026-10-30 ~08:42 MDT,
`vercel_check_token` on the owner's seat returned the same opaque
result twice — "Vercel unknown_error | operation
vercel_check_token", no HTTP status — and `vercel_recent_changes`
carried no journal row explaining it. The recheck is the gate for
the A-13 cross-team read leg: the seat's account row records
scope `team`, so the AUD-AB `vercel_account_teams` read refuses,
and whether the Full Account token's recorded scope under-states
its real reach was unprovable because the corrector itself erred
opaquely.

**Two convictions from the dossier (code, not contract).**

1. **Derivation trap.** `probeTeamVisible` derives scope from
   reach — `broad = visibleTeams > 1 || (projectId && another
   project visible)`; `scope = broad ? 'full' : …` — so a token
   whose `teams_list` returns two teams derives `'full'`. But
   derivation is gated by the caller's `allowFull`, and the
   recheck passed `allowFull: stored scope === 'full'`. A recheck
   could therefore never report a scope broader than the stored
   row: any row recorded below `full` whose credential's reach
   later grows (the owner's account gained a second team on
   2026-10-30, after the Oct-28 enrollment recorded `team`)
   refuses with `broad_visibility` instead of reporting the
   drift. The derived scope was not in the recheck's result at
   all — only the stored scope and the counts.
2. **Classification gap.** The pinned snapshot documents the
   error envelope for `GET /v2/user`, `GET /v2/teams` and
   `GET /v10/projects` as `{error: {code: string, message:
   string}}` with `code` a free string (`VercelBaseError`) and
   no enumerated values — no documented provider code is missing
   from the classifier. The gap is product-internal: the probe
   legs re-wrap client errors via `transportFail`, which dropped
   the client's `.status` (it survived only inside the message
   text), and `errors.js` `normalized()` had no class for the
   probe layer's curated, legged errors (plain `Error`s — the
   VMCP-030 own-message path is `TypeError`-only). Every probe
   refusal through this tool — identity 401s, teams/projects
   403s, `visibleRows` shape refusals, `broad_visibility` —
   collapsed into `unknown_error` with no status. The AUD-F leg
   identifiers existed precisely to name the leg; the setup page
   reads them, the MCP surface discarded them.

## What ships

- **tokens.js — status preservation.** `probeFail` gains an
  extras bag; `transportFail` and `installationReadFail` attach
  the client's integer status to the probe error. No message
  text changes anywhere (the setup page's readings are
  byte-identical).
- **errors.js — probe classification.** `normalized()` recognizes
  an error carrying a well-formed `probeLeg`
  (`/^[a-z][a-z_]{0,29}$/`) before the generic fall-through and
  returns `{code: 'recheck_failed', status, leg}`.
  `explainVercelError` gains a `recheck_failed` branch: *what*
  names the leg from a fixed in-repo label table, *why* refines
  by status class when present (401 token not accepted, 403
  refused, 404 not found, 429 rate-limited, 5xx provider
  trouble; no status = the check itself refused), *next* points
  at the journaled fingerprint and owner setup. Provider text
  is never surfaced; the leg is an in-repo fact from the code
  path. Every non-probe error's classification is byte-identical
  to before.
- **tokens.js — ungated derivation + derivedScope.**
  `recheckStoredToken` probes with `allowFull: true` on the
  user and personal routes and returns `derivedScope` additively
  beside `storedScope`. Rationale: the credential was already
  owner-approved for this row and the recheck persists nothing
  (`persisted: false` stands); the enrollment consent gate keeps
  its meaning in `storeToken`/`storePersonalToken`, untouched.
  Drift is now a reported fact with an owner remedy.
- **tokens.js — the journal fingerprint.** `recheckStoredToken`
  wraps load + scope check + probe dispatch; on any throw it
  best-effort journals one `change_log` row — the AUD-M2 shape
  `{account, mode: 'preview', tool: 'vercel_check_token',
  summary, dryRun: false, production: false}`, guarded by
  `typeof db.recordChange === 'function'` and a try/catch that
  rethrows the original error untouched — then the error
  propagates. Summary grammar, verdict first under the read's
  160-char bound:
  `SHAPE-FP recheck failed=[<leg>:<status|absent>:<code|absent>] route:<user|personal|installation> stored:<team|project|full|absent>`.
  Leg from `err.probeLeg` when well-formed, else the phase
  (`load`/`probe`); code screened to a strict pattern, else
  `absent`. Never values: no token material, no team/project
  IDs, no provider message.

**Catalog judgment (drift checklist B).** `src/tools/errors.js`
changes (a `src/tools/` module), so this card carries a
TOOL-CATALOG note in the first commit. `tokens.js` itself is
`src/vercel/`; the catalog note covers the `vercel_check_token`
behavior change (derived scope, named failures) regardless of
which module carries the mechanism.

## Verification

- New `tests/unit/recheck-conviction.test.js` (13 tests):
  one-team success derives `team` and journals nothing; two-team
  success derives `full` against a stored `team` scope (drift
  reported, read-only preserved); an identity 401 through the
  real dispatch (with the live door's `formatError`) names the
  identity leg, carries `recheck_failed` + HTTP 401, and
  journals `failed=[identity:401:absent]`; a duplicate-ID shape
  refusal journals `teams:absent:absent`; a missing credential
  journals the `load` phase with zero provider calls; a throwing
  `recordChange` leaves the outcome untouched (same probe error,
  journal attempted once); provider message text, token material
  and IDs are asserted absent from both the result and the
  journal; the fingerprint grammar's screens and its ≤160-char
  bound are pinned directly; `errors.js` units pin the leg
  naming, the unchanged `unknown_error` for unlegged errors, and
  the fall-through for a malformed `probeLeg`.
- One pre-existing expectation changed, deliberately:
  `account-controls.test.js`'s broad-visibility fixture (stored
  `project`, two teams) now succeeds and reports
  `derivedScope: 'full'` — the behavior the dossier convicts.
  Its other pinned properties (read-only, no upsert, no token
  in the result) are re-pinned under the new behavior; the
  incomplete/missing/expired refusal cases are unchanged.
- Token family suites (account-controls, integration-install,
  revocation-posture, token-pagination, token-scoped-probe,
  token-store), errors, mcp-server, write-stored-result and
  setup-page suites all green; full `npm run check` at the PR
  head recorded in the PR's self-review.

**Live conviction path.** After the nightly promotion, one
`vercel_check_token` on the owner's seat either succeeds —
reporting `derivedScope: 'full'` against `storedScope: 'team'`,
which unblocks the A-13 cross-team read leg's scope question —
or journals the fingerprint that names the failing leg, which
the coordinator reads back through `vercel_recent_changes`. No
live recheck was run by this card (fakes only).
