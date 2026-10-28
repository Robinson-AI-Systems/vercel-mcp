# Design — Batch X: Undo, real-account smoke test

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch X.
Cards X-1 … X-2.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| X1 | Every write tool with a clean opposite stores `inverse` in the change log | `grep -n "inverse" src/tools/*.js \| head -50` |
| X2 | IN-06 answered: a scratch project with a project-scoped token exists and is added on the setup page | `docs/OWNER-INPUTS.md` IN-06 status |

## 1. Decisions

**X1. Undo** (`vercel_undo_change(change_id)`): runs the stored `inverse` with preview and confirm, through the same
guards (an undo of a production change needs a production connection). Clean opposites: pause ↔ unpause; promote ↔
rollback to the recorded previous deployment; a newly created env variable ↔ delete it; a changed variable's targets,
branch or comment ↔ restore them (a changed **value** cannot be restored: Vercel keeps no history and this server never
stores values — the undo says "set it again from the setup page"); DNS record create ↔ delete, update ↔ restore, delete ↔ re-create from
`before`; firewall change ↔ restore previous version; routes/redirects publish ↔ restore previous version; alias assign
↔ previous target; protection settings ↔ previous settings; Global Config items ↔ previous values; member role ↔
previous role. No inverse (says the right opposite action): deletions of projects, deployments, stores, tokens; domain
purchases, renewals and transfers; invitations sent; secrets shown; cache invalidations.

**X2. Smoke test** (`scripts/smoke-readonly.mjs`): every `writes: false` tool with minimal arguments against Chris's
real team on a **preview-mode** connection (refuses production mode), with a read-only token or pass; report
`docs/audits/smoke-<date>.md` (tool, ok/failed, error in words, time). Writes are exercised for real only in the scratch
project (IN-06): seed → preview deploy → env wiring → alias → bypass → fetch → cleanup, recorded in the same report.


## 4. Work units

### X-1 — Undo (M)
Tool: `vercel_undo_change`. Tests: each clean opposite on fake Vercel; deletion and purchase refuse with the suggested
opposite; undo of an undo; production undo refused on a preview connection.
### X-2 — Read-only smoke test and scratch-project write run (M)
Done when: report committed; every failure fixed or listed as a known gap with its card.
## 5. Stop-and-ask points

1. IN-06 not answered, or answered but the scratch fixture not yet created: X-2 runs the read-only part only and says so. (IN-06 answered YES 2026-10-27; creating the scratch project and its project key is the remaining owner step.)

## 6. Acceptance mapping

| PLAN Batch X line | Evidence |
|---|---|
| Undo for every clean opposite | `tests/unit/undo.test.js` |
| Read-only smoke and scratch run | `docs/audits/smoke-<date>.md` |

## Amendments

(Dated entries only.)

**2026-10-27 — Undo needs no new capture machinery (audit VMCP-012).** Assumption X1 is verified at the audit baseline (216b83a9): every guarded write already stores its `inverse` in the change log through the write executor. X-1 therefore needs only the `vercel_undo_change` tool itself — no new capture work — and is the first build of this batch, ahead of the workflow compounds; each then joins the default front-door listing under the OP-1 budget (`docs/designs/BATCH-C.md`, D-C amendment). X-1's acceptance stands as written, with one addition: undoing a purchase executed under the D-A delegation model follows the same delegation policy and journals as its own change-log row — an undo never deletes or rewrites the original row.
