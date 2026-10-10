# Design — Batch W: Workflows in Chris's language

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch W.
Cards W-1 … W-6. Depends on Batches D, E, V, N, F, M, O, P. Tool list: `docs/TOOL-CATALOG.md` section Workflows.

Each workflow does a whole job server-side and answers in plain English, with `structuredContent` for agents (Batch C).
Read-only workflows are in `read_only`. Write workflows preview everything first and confirm before production changes.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| W1 | `paginate` and a time-budget helper exist | `grep -n "export" src/vercel/client.js src/core/util.js` |
| W2 | Every tool a workflow calls exists and passes its write-contract | `grep -n "<tool name>" src/tools/*.js` per workflow |

## 1. Decisions

**W1. Workflows call tools through the registry** (the wrapped handlers), never `src/vercel/client.js` directly, so
guards apply once and consistently.

**W2. Time budget 45 s.** Out of time → return what is done, with a note and the exact call to continue.

**W3. One preview, one confirm.** A write workflow first runs every step with `dryRun` and shows one combined preview
(each step's own preview line); with `confirm` it runs the steps in order and stops at the first failure, reporting what
was done and the undo for each done step.

**W4. Shipping is gated.** `vercel_workflow_ship_to_production` refuses unless the deployment is READY, its checks
passed (Checks V2), and a smoke fetch of the given paths returned 2xx/3xx; it records the previous production deployment
as the inverse; it respects the profile's release rule (P2).

**W5. Emergency rollback is fast and honest.** `vercel_workflow_emergency_rollback(project, reason)` picks the last
production deployment that served without errors (from the deployment list and `vercel_logs_errors_summary` for the
current one), shows the profile's `rollback_caution`, confirms, rolls back, reads back the aliases, and reports what
changed and what is still broken if errors continue.

**W6. Secrets rotate without anyone seeing them.** `vercel_workflow_rotate_secret(project, key, targets)` generates a
new random value on the server (B5), sets it, redeploys the live deployment (production confirm) and reports which
other systems must learn the new value (e.g. "Vercel Cron sends this automatically"; "paste into Stripe" is never the
case for a generated secret). It refuses `managed_env` keys.

**W7. Cost check uses real charges.** `vercel_workflow_cost_check` reads FOCUS charges for the period, counts builds by
day and branch (deployment list), lists build machines, analytics add-ons, drains, sandbox minutes and rolling releases,
and compares with the target (setting; Appliance Desk profile's `cost_target_cents`).

## 4. Work units (tests: normal case, empty team, more than one page, time budget exceeded)

| Card | Workflow(s) | Notes |
|---|---|---|
| W-1 (M) | `vercel_workflow_project_health`, `vercel_workflow_release_status`, `vercel_workflow_find` | release status compares the production branch head (from the latest production deployment's Git metadata) with what is live; find recognizes URL, `dpl_`, `prj_`, domain, 7–40 hex SHA, branch, env key |
| W-2 (M) | `vercel_workflow_why_did_build_fail`, `vercel_workflow_deploy_and_wait` | reuses V-3 diagnosis rules; deploy-and-wait is preview unless production asked |
| W-3 (M, medium effort) | `vercel_workflow_ship_to_production`, `vercel_workflow_emergency_rollback` | W4, W5; profile release rule respected |
| W-4 (M) | `vercel_workflow_setup_custom_domain` | attach → config → DNS records on Vercel DNS (production confirm) or exact records for another DNS host → verify → certificate; run twice changes nothing |
| W-5 (M, medium effort) | `vercel_workflow_env_sync`, `vercel_workflow_rotate_secret` | values copied server-side; Secret-kind sources reported; rotate W6 |
| W-6 (M) | `vercel_workflow_cost_check`, `vercel_workflow_security_audit` | W7; security audit flags `NEXT_PUBLIC_*` names that look secret, bypass secrets older than 90 days, protection off on previews |

## 5. Stop-and-ask points

1. A workflow would need a tool that does not exist: build the tool in its area batch first (or use Batch U), never
   inline Vercel calls in a workflow.

## 6. Acceptance mapping

| PLAN Batch W line | Evidence |
|---|---|
| All 12 workflows; one preview, one confirm | `tests/unit/workflow-*.test.js` |
| Shipping gated; rollback honest | `tests/unit/workflow-ship.test.js`, `tests/unit/workflow-rollback.test.js` |
| All writes confirmed and logged | write-contract via `vercel_call` for each write workflow |

## Amendments

(Dated entries only.)
