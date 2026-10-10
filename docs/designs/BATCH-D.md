# Design — Batch D: Projects and deployments (projects, Git, crons, deployments, logs, releases)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch D.
Cards D-1 … D-4. Depends on Batches B and C. Tool list: `docs/TOOL-CATALOG.md` sections Projects, crons and Git;
Deployments: reads, logs and checks; Deployments: changes; Releases.

"Port" means: take the matching old toolkit tool (`robinsons-toolkit-mcp` `handlers/vercel.js`) only as a reminder of
the job; rebuild through `src/vercel/client.js` against the operation the vendored OpenAPI snapshot documents. Never copy
its `v()` wrapper; never use an endpoint from research §2.3.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| D1 | Operations at the snapshot: projects `GET /v10/projects`, `POST /v11/projects`, `GET\|PATCH\|DELETE /v9/projects/{idOrName}`, pause/unpause `/v1/projects/{projectId}/pause\|unpause`, transfer `POST /projects/{idOrName}/transfer-request`, members `/v1/projects/{idOrName}/members` | `node scripts/openapi-find.mjs "project"` |
| D2 | Deployments: `GET /v7/deployments`, `GET /v13/deployments/{idOrUrl}`, `POST /v13/deployments` (with `gitSource`, `files`, or `deploymentId` for redeploy; `target`), `PATCH /v12/deployments/{id}/cancel`, `DELETE /v13/deployments/{id}`, `GET /v3/deployments/{idOrUrl}/events`, `GET /v6/deployments/{id}/files`, `GET /v8/deployments/{id}/files/{fileId}`, `POST /v2/files`, runtime logs `GET /v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs` | same tool |
| D3 | Releases: `POST /v10/projects/{projectId}/promote/{deploymentId}`, `POST /v1/projects/{projectId}/rollback/{deploymentId}`, `GET /v1/projects/{projectId}/promote/aliases`, rolling release under `/v1/projects/{idOrName}/rolling-release*`, aliases `/v2/deployments/{id}/aliases`, `/v4/aliases`, `DELETE /v2/aliases/{aliasId}` | same tool |
| D4 | Checks V2 reads: `GET /v2/deployments/{deploymentId}/check-runs[/{id}]`, `GET /v2/projects/{projectIdOrName}/checks` | same tool |
| D5 | Cron definitions are readable from the project or its production deployment (`crons` on the project response or the deployment's config) | read the project and deployment response schemas (≤150 lines each) |
| D6 | Git: `GET /v1/integrations/git-namespaces`, `GET /v1/integrations/search-repo` | same tool |
| D7 | Runtime logs are streamed (newline-delimited JSON) and may run long | read the operation; test against `emulate` if it supports it, else a recorded fixture |

## 1. Decisions

**D1. Production is explicit.** `vercel_deploy_create_from_git` and `vercel_deploy_create_from_files` default to a
preview; `target: 'production'` (or a production custom environment) makes them `PR`. `vercel_deploy_redeploy` keeps
the original deployment's target (never "production by default", audit T4) and uses `POST /v13/deployments` with
`deploymentId`.

**D2. Promote and rollback read first.** The preview names what is live now (deployment, commit, time), what will be
live, the aliases that will move, and — when a profile marks `rollback_caution` — the warning text. Rollback uses the
rollback operation (never promote, audit T5); with no deployment given it picks the newest **earlier production**
deployment that was previously serving, and says which. Read-back polls `promote/aliases` until every alias moved (≤45 s,
then `confirmed: null` with how to check).

**D3. Waiting is bounded.** No tool waits more than 45 seconds (Vercel functions have time limits; audit T7).
`vercel_deploy_wait` returns `{ state, done, waitedSeconds, next: 'call again with the same id' }`.

**D4. Logs are summaries first** (Batch C C3): build logs from deployment events; runtime logs filtered by level,
status, path and a time window (default last 30 minutes, max 24 hours per call); full text via handle. Secrets that
leak into logs are hidden by shaping (B9).

**D5. Deleting is guarded twice.** `vercel_deploy_delete` refuses the deployment currently serving production
(it says to roll back or promote first). `vercel_project_delete` refuses protected projects (B6) and profiled projects
without `outsideApp`, and its preview lists domains, env var count, crons and storage connections that go with it.

**D6. Crons are read-only here.** `vercel_cron_list` shows path, schedule (UTC and Denver), and whether crons are
enabled, from the production configuration. Enabling, disabling and "run now" have no REST operation (research §1.4):
`vercel_where_is_setting("cron")` returns the steps; running a cron by calling its URL would need the app's
`CRON_SECRET`, which this server never reads.

**D7. Build resources are spend.** `vercel_project_set_build_resources` (build machine, concurrency, function memory,
duration, region, fluid) is `$`: no price is knowable per change, so the preview links Vercel's pricing page and needs
confirm (B3).

**D8. Files deploys are small.** `vercel_deploy_create_from_files` accepts at most 2 MB total inline (upload each file
with `POST /v2/files` by SHA, then create); bigger projects deploy from Git.

## 4. Work units (each: unit tests, write-contract for every write, request-shape test against the snapshot for every
call, `emulate` test where `emulate` covers the operation, TOOL-CATALOG marks)

### D-1 — Projects, members, crons, Git (M)
Tools: the 15 tools of "Projects, crons and Git". Extra tests: `vercel_project_update_settings` on a live project is
production (needs production connection + confirm), on a project without a production deployment is `P`; rename
preview names the URL change; delete preview lists what goes with it; transfer code goes to the one-time page.

### D-2 — Deployment reads, logs, checks (M)
Tools: the 10 tools of "Deployments: reads, logs and checks". Extra tests: build-log summary on a 5,000-line fixture is
under 8 KB with a handle; runtime logs stop at the window; `vercel_deploy_get` by URL and by ID give the same summary.

### D-3 — Deployment changes (M, medium effort)
Tools: the 5 tools of "Deployments: changes". Extra tests: redeploy keeps the original target; production deploy on a
preview connection refused; delete of the live production deployment refused; files deploy over 2 MB refused in words.

### D-4 — Production releases: promote, rollback, aliases, rolling releases (L, medium effort)
Tools: the 12 tools of "Releases". Extra tests: rollback picks the previous production deployment, not the second-newest
READY one when that never served; alias assign of a production domain is production; rolling-release config preview
shows billing status; every tool here refuses on a preview connection.

## 5. Stop-and-ask points

1. Any D0 row false: amend before that card.
2. An operation the catalog names does not exist at the snapshot: drop the tool, record it, point
   `vercel_where_is_setting` or Batch U at it.

## 6. Acceptance mapping

| PLAN Batch D line | Evidence |
|---|---|
| Every listed tool built, catalog marked | TOOL-CATALOG Card column `built #n` |
| Production explicit; redeploy and rollback correct (audit T4, T5) | `tests/unit/deploy-*.test.js` regression cases |
| Waits bounded, logs summarized | `tests/unit/deploy-wait.test.js`, `tests/unit/logs-summary.test.js` |

## Amendments

(Dated entries only.)
