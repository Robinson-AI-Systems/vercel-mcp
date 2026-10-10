# Design — Batch P: Project profiles (any app that runs its own Vercel setup)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` → Batch P.
Cards P-1 … P-3. Depends on Batches B, D, E, N, F, M.

The Vercel MCP is a general development tool. An app Chris builds may manage parts of its own Vercel setup in its
repository and workflows — release branches, cron schedules, an ignored-build-step script, branches that must never get
previews, stores and variables injected by integrations, email DNS records. For such an app the server must know what
the app owns, or it will fight it. A **project profile** holds exactly that. Profiles are **optional**; Appliance Desk is
the first example (`docs/APP-NEEDS-APPLIANCE-DESK.md`), used to prove the design complete, not to shape it.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| P1 | `docs/APP-NEEDS-APPLIANCE-DESK.md` still matches the app | in `christcr2012/appliance-desk` (read only): `cat vercel.json`; `grep -n '"vercel-build"\|engines' package.json`; `sed -n '1,40p' docs/ARCHITECTURE.md`; `grep -n "IN-68" docs/OWNER-INPUTS.md` |
| P2 | The profile-guard hook (B-3) is called with every write's `targets()` | `grep -n "checkApp" src/tools/app-guard.js src/core/write.js` |

## 1. Decisions

**P1. A profile is data, not code.** One row in `known_apps` per app, plus one human-readable file
`docs/APP-NEEDS-<APP>.md`. Adding an app = one data row + one doc + one test fixture; no new tools.

**P2. What a profile holds** (JSON in `known_apps.profile`):
`id`, `name`, `vercel_account` (team slug; IDs added on the setup page, never committed), `projects` (names),
`production_branch` (e.g. `live`), `release_rule` (`'promote'` default | `'branch'` — production changes only by moving
the production branch; then `vercel_deploy_promote`, `vercel_rolling_start` and production `vercel_deploy_create_*` on the
project need `outsideApp`, while `vercel_deploy_rollback` stays allowed with confirm and is labelled "emergency
rollback; the app's release workflow will move forward again on its next release"), `rollback_caution` (text shown in
rollback previews, e.g. migrations run at build), `no_preview_branches` (globs), `managed_env` (keys an integration or
store injects — writes need `outsideApp`), `expected_env` (`{ production: [], preview: [], development: [] }`, names
only), `owned_domains`, `owned_dns_records` (match rules by type/name/value prefix, e.g. MX for mail), `owned_stores`
(Blob/Global Config store names), `expected_crons` (path + schedule), `node_version`, `framework`,
`protected_sandboxes` (names never stopped or deleted), `cost_target_cents`, `dashboard_settings` (guided items with
recommended values), `record_links` (none for Vercel today).

**P3. Ownership is per profile.** `checkApp(targets, ctx)` checks every profile on the connection's account and names
the owning app; no profile → allowed. Reads are never blocked; read results mark profiled resources
(`"app": "appliance-desk"`).

**P4. `vercel_workflow_app_readiness(app | spec)`** checks every row of a profile — or an inline `spec` with the same
fields for an app being built today — and returns per row: `done` / `fixed` (with confirm, through the area tool) /
`needs_you` (structured steps) / `needs_decision` (`IN-xx`). It may fix (each previewed and confirmed): missing variable
**names** (it never invents values: it asks for a pending input), Node version, a no-preview branch rule missing from
`commandForIgnoringBuildStep` (report only — the rule lives in the app's repo), domain verification, missing preview
bypass. It never changes `managed_env`, owned DNS records or stores, and never promotes for a `branch` release rule.

**P5. `vercel_workflow_project_setup(description)`** is for a **new** project: from a short description (name, repo,
framework, domains, which variables by name per target, protection wanted, preview policy, crons expected) it previews
and then creates what is needed: project (from Git), framework/commands/Node version, custom environments, variable
names (values via pending inputs or `generate`), project domains (DNS steps), protection settings. Production parts need
a production connection and confirm. It is idempotent (run twice → nothing new) and ends with a draft profile row
(`status: 'draft'`) and the `APP-NEEDS-<APP>.md` text for Chris or the project's agent to commit in that project's repo.

**P6. `vercel_profile_draft(findings)`** turns what an agent found in a codebase (`vercel.json`, `package.json` scripts
and engines, `.env.example` names, cron routes, release workflows) into a draft profile and `APP-NEEDS` text. It never
fetches code itself.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS known_apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  profile JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
```

Seed (P-1): the Appliance Desk profile, generated from `docs/APP-NEEDS-APPLIANCE-DESK.md`.

## 4. Work units

### P-1 — `known_apps`, Appliance Desk seed, profile guard, profile reads (M, medium effort)
Tools: `vercel_profile_list`, `vercel_profile_get`. Tests: ownership reported per app; two profiles on one account;
no profile → allowed; promote refused for a `branch` release rule without `outsideApp`, rollback allowed and labelled;
managed variable write refused; owned MX record refused; owned store delete refused; no-preview branch refused in
`vercel_dev_preview_branch`; a test lists every seeded item with the appliance-desk file it came from (PR table).
### P-2 — `vercel_workflow_app_readiness` (L, medium effort)
Tests with fixtures for every row of the Appliance Desk table: missing variable name → pending-input request; Node
version mismatch → confirmed fix; branch tracking not `live` → guided with read-back; spend management → guided, not
readable; preview database isolation (production and preview `DATABASE_URL` the same) → `needs_attention` via
`vercel_env_compare`, never a value.
### P-3 — `vercel_workflow_project_setup` and `vercel_profile_draft` (M)
Tests: run twice → nothing new; production parts refused on a preview connection; draft profile and doc text returned,
never committed elsewhere; findings with an unknown key reported, not guessed; readiness with an inline spec behaves like
a profile.

## 5. Stop-and-ask points

1. P1 shows the app changed its Vercel use: update the profile and the APP-NEEDS file in the same PR.

## 6. Acceptance mapping

| PLAN Batch P line | Evidence |
|---|---|
| Appliance Desk profile complete and traceable | P-1 table in PR |
| Readiness covers every row | `tests/unit/workflow-app-readiness.test.js` |
| New-project setup idempotent and app-aware | `tests/unit/workflow-project-setup.test.js` |

## Amendments

(Dated entries only.)
