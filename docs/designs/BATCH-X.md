# Design — Batch X: Undo, real-account smoke test, toolkit decision

Status: **APPROVED DESIGN pending IN-00**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch X.
Cards X-1 … X-3.

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

**X3. Toolkit decision note:** one page for Chris — keep the old toolkit's `vercel` namespace for local use, retire it,
or point its compound tools at this server through the hub; the work each needs. Chris decides (IN-14); a later card in
the hub does it.

## 4. Work units

### X-1 — Undo (M)
Tool: `vercel_undo_change`. Tests: each clean opposite on fake Vercel; deletion and purchase refuse with the suggested
opposite; undo of an undo; production undo refused on a preview connection.
### X-2 — Read-only smoke test and scratch-project write run (M)
Done when: report committed; every failure fixed or listed as a known gap with its card.
### X-3 — Toolkit decision note (S, docs)

## 5. Stop-and-ask points

1. IN-06 not answered: X-2 runs the read-only part only and says so.

## 6. Acceptance mapping

| PLAN Batch X line | Evidence |
|---|---|
| Undo for every clean opposite | `tests/unit/undo.test.js` |
| Read-only smoke and scratch run | `docs/audits/smoke-<date>.md` |
| Toolkit note delivered | X-3 PR |

## Amendments

(Dated entries only.)
