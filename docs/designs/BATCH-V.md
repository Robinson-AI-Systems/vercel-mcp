# Design — Batch V: Developer tools (build and test with Vercel)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch V.
Cards V-1 … V-5. Depends on Batches D and E. Tool list: `docs/TOOL-CATALOG.md` section Developer tools. Follows
Robinson Tool Contract §10 (manifest `devTools: true`).

Everything here is **preview only**: every `vercel_dev_*` tool refuses a production target before reading anything else
(a production deployment, a production variable target, a production domain, a live project's settings). These are the
jobs a developer does while *building* on Vercel — for any project — not the jobs of running a live site.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| V1 | Deployments accept `meta` key/values on create (used to tag `rtc_run=<runId>`) and list can filter by it or the run's IDs are enough | `node scripts/openapi-find.mjs "create deployment"`; read `meta` |
| V2 | Env variables accept a `comment` (used to tag `rtc_run=<runId>`) and a `gitBranch` for branch-only preview values | read the env create body |
| V3 | Sandbox operations at the snapshot: create (`POST /v4/sandboxes` or the newest listed), sessions get/stop/extend, `POST /v2/sandboxes/sessions/{id}/cmd`, `GET …/cmd/{cmdId}/logs`, `fs/read`, `fs/write`, `fs/mkdir`; default session timeout 5 minutes; Pro max 24 h; Hobby max 45 min | `node scripts/openapi-find.mjs "sandbox"`; `https://vercel.com/docs/sandbox/pricing` |
| V4 | Vercel webhook deliveries are signed with header `x-vercel-signature` = hex HMAC-SHA1 of the raw body with the webhook secret; payload `{ id, type, createdAt, payload, region }` | `https://vercel.com/docs/webhooks/webhooks-api#securing-webhooks` (record the exact algorithm and URL in the PR) |
| V5 | Protection bypass secrets are created with `PATCH /v1/projects/{idOrName}/protection-bypass` and used with header `x-vercel-protection-bypass` | research §11 (Protection Bypass for Automation) |

## 1. Decisions

**V1. Runs, recorded and tagged** (contract §10). Every object a dev tool creates belongs to a run (`dev_runs`) and is
recorded (`dev_run_objects`): preview deployments, preview variables, aliases, bypass secrets, scratch projects, sandbox
sessions, test-webhook receivers' secrets. Tags: deployment `meta.rtc_run`, env `comment: "rtc_run=<runId>"`, project
name prefix `rtc-<runId>-` for scratch projects. A caller may pass its own `runId` (the hub does, to tie one environment
together across servers); otherwise one is made (`run_<date>_<6 chars>`).

**V2. Cleanup is precise.** `vercel_dev_cleanup(runId | 'all-runs')` previews then (with `confirm`) removes exactly the
recorded objects, newest first: deletes preview deployments and aliases, deletes preview variables, revokes bypass
secrets, stops sandboxes, deletes scratch projects. It never searches by tag (a tag alone proves nothing), skips any
object that has since become production (reported, not touched), and reports per object.

**V3. Preview per branch.** `vercel_dev_preview_branch(project, branch | sha, runId?)` deploys a preview from Git, waits
up to 45 s, returns the URL and state. It refuses a branch a project profile marks as no-preview (Appliance Desk:
`ai/**`, `transfer/**`, `recovery/**`, to keep cost down) unless `outsideApp: true`.

**V4. Env wiring for previews.** `vercel_dev_wire_preview_env(project, branch?, vars, runId?)` sets preview-only
variables (branch-only when a branch is given), values per Batch E E2 (`pendingInputId`, `generate`, or non-secret
`value`); a hub workflow may pass a value it got from another server without it entering chat (ROADMAP: hub writes a
Neon branch URL straight into a preview variable). A target list containing `production` is refused.

**V5. Aliases for previews** get names under the team's `vercel.app` preview space or a domain the profile marks as a
preview domain; any production domain is refused.

**V6. Automated access to protected previews.** `vercel_dev_create_bypass(project, note, runId?)` creates a bypass
secret, shows it once on the setup page, records it for cleanup. `vercel_dev_fetch_preview` uses an existing bypass
secret **server-side** (looked up, never shown) to fetch up to 10 paths; returns status, timing, key headers and the
first 4 KB of each body (key-shaped strings hidden); refuses non-preview URLs and private/loopback addresses.

**V7. Build diagnosis.** `vercel_dev_diagnose_build` reads the deployment's events and matches the first error against
`src/dev/build-failures.js` (missing variable; Node version mismatch; install failure/lockfile; TypeScript or lint
error; out of memory; command not found; ignored build step skipped; framework mis-detected; file size limits). Each
rule has a plain cause and fix; unknown errors return the first error block verbatim (shaped).

**V8. Sandboxes are metered.** **Owner amendment 2026-10-17 (IN-13)**: the original 60-minute mandatory per-account/day
quota was a development-era restriction, not an end-user policy. Record estimated requested minutes atomically in
`dev_sandbox_usage` for transparency, **without refusing a valid user-authorized operation at a daily threshold**.
The legacy `sandbox_minutes_per_day` column is unused by dispatch and receives no default on new schemas.
Default session timeout is 10 minutes; the request may use Vercel's supported session duration (currently up to
24 hours on Pro; providers/plans may impose lower limits). Every session is recorded and stopped by cleanup. Commands
run with a 45 s wait; longer commands continue in the session and are read with the next call.

**V9. Test webhooks for integration builders.** `vercel_dev_send_test_webhook(url, type, runId?)` builds a realistic
sample event (`deployment.created`, `deployment.succeeded`, `deployment.error`, `deployment.promoted`,
`project.created`, `project.env-variable.created`, …) and POSTs it signed per V4 with a per-run secret shown once on the
setup page (the developer puts it in the app as its webhook secret). Public HTTPS URLs only; private, loopback and
metadata addresses refused. Reports the status code.

**V10. Seed scenarios** (`src/dev/scenarios.js`): `static-site` (one HTML page), `nextjs-hello` (a minimal Next.js app
from inline files), `api-function` (one function returning JSON), `cron-demo` (a function plus a `vercel.json` cron —
crons only run in production, so the scenario says the cron will not fire on a preview). `vercel_dev_seed(scenario |
description)` creates a scratch project `rtc-<runId>-<scenario>`, deploys a preview, and records both.

**V11. Integration check.** `vercel_dev_check_integration(spec)` with `spec = { project, envNames: { production?:[],
preview?:[], development?:[] }, domains?:[], crons?:[], nodeVersion?, framework?, protection?: 'any'|'vercel-auth'|...,
needsBypass?: boolean, integrations?:[] }` reads and reports each item ok / missing (with the exact tool or guided steps
to fix). It changes nothing.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS dev_runs (id TEXT PRIMARY KEY, vercel_account TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  connection TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'active', cleaned_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS dev_run_objects (run_id TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
  project_id TEXT, detail JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), cleaned BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (run_id, object_type, object_id));
CREATE TABLE IF NOT EXISTS dev_sandbox_usage (vercel_account TEXT NOT NULL, day DATE NOT NULL, minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vercel_account, day));
```

`dev_sandbox_usage` is updated with one atomic `INSERT … ON CONFLICT … DO UPDATE SET minutes = minutes + $n RETURNING minutes`.

## 4. Work units (each: production-refusal test per tool; write-contract per write; request-shape tests)

### V-1 — Runs, seed, cleanup (L, medium effort)
Tools: `vercel_dev_seed`, `vercel_dev_list_runs`, `vercel_dev_cleanup`. Tests: every created ID recorded; seeding twice
with the same `requestKey` creates nothing new; cleanup touches only recorded objects (an untracked deployment with the
same `meta.rtc_run` is left alone); an object promoted to production since is skipped and reported; partial failure
reported per object.
### V-2 — Preview per branch, env wiring, aliases, bypass (M, medium effort)
Tools: `vercel_dev_preview_branch`, `vercel_dev_wire_preview_env`, `vercel_dev_alias_preview`, `vercel_dev_create_bypass`.
Tests: production targets refused; profile no-preview branch refused without `outsideApp`; bypass secret only on the
one-time page.
### V-3 — Logs tail, diagnosis, preview fetch, integration check (M)
Tools: `vercel_dev_tail_logs`, `vercel_dev_diagnose_build`, `vercel_dev_fetch_preview`, `vercel_dev_check_integration`.
Tests: each diagnosis rule on a recorded build-event fixture; fetch refuses production URLs and private addresses; the
bypass secret never appears in the result; tail cursor returns only new lines.
### V-4 — Sandboxes (M, medium effort)
Tools: the five `vercel_dev_sandbox_*` tools. Tests: overlapping account usage records are atomic and allow totals above the old 60-minute limit (real database); sessions recorded; cleanup stops them.
### V-5 — Test webhook sender (S)
Tool: `vercel_dev_send_test_webhook`. Tests: signature verifies with the documented algorithm and the run's secret;
private URLs refused; secret never in a result.

## 5. Stop-and-ask points

1. Any V0 row false: amend before that card.
2. **Superseded IN-13 on 2026-10-17:** No developer-imposed daily quota or estimated-cost stop-and-ask for end users. Disclose metered exposure; respect user-selected policy and actual provider limits. This does not permit the implementation agent to spend.

## 6. Acceptance mapping

| PLAN Batch V line | Evidence |
|---|---|
| Preview only, everywhere | production-refusal test per tool |
| Cleanup touches only recorded objects | `tests/unit/dev-cleanup.test.js` |
| Diagnosis rules and signed test webhooks | `tests/unit/dev-diagnose.test.js`, `tests/unit/dev-webhook.test.js` |
| Sandbox usage recorded atomically across instances without an artificial cap | `tests/db/dev-sandbox-budget.test.js` |

## Amendments

(Dated entries only.)

**2026-10-17 — V-4 scoped end-user cost approval (owner clarification 2026-10-16).** The 60-minute/day counter remains an atomic quota, not a monetary authorization. The precise finite Sandbox shape (1 vCPU, 2 GB, bounded session timeout, no persistence, deny-all outbound network) supports a separately authenticated owner approval for variable usage even though an advisory dollar value cannot be enforced as a provider billing limit. This is explicitly one operation `vercel_dev_sandbox_create`, using signed-in owner acknowledgment and one-use payload-bound grant; no other generic metered operation is implicitly enabled. This corrects the product's permanent developer-agent-limit leakage while preserving the implementation agent's $0 spend and nonproduction-only fixture policy. Provider execution/charge acceptance is not claimed.
