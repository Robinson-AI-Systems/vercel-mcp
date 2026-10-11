# STATUS — current work, blockers and next action

Updated 2026-10-11. **A-2 schema is merged in PR #6; A-3a OAuth primitives/store are complete in PR #7, retargeted to main and awaiting its final CI after documentation reconciliation.** No real Neon database has been created or initialized, no Vercel token has been added, and nothing is deployed or live.

## Next

- **Current: finish A-3a PR #7** (final docs/check run, then merge). Next: A-3b — connector endpoints, completing A-3. Then A-4 … A-6 are written just in time.
- **Answered 2026-10-10 (Chris):** IN-00 — plan approved ("I approve the plans"); IN-01 — **no automated review** ("I don't want the automated review at this time"); the repository stays public as Chris created it; the implementer self-reviews every diff.
- **Queue:** A → B → C → D → E → V → N → F → M → O → P → W → U → R → X (`MASTER-ROADMAP.md`).

## What works today (A-1)

| Command | What it proves |
|---|---|
| `npm run check` | secret scan of every tracked file, docs reconciliation, work-index validation, lint, catalog consistency (236 tools), write-safety, core-imports, token budgets |
| `npm test` | unit suite: fake Vercel API, registry, every check script against planted violations, db contract on the fake |
| `npm run test:db` | the db contract on throwaway Postgres (CI service; locally a disposable cluster from local binaries) |
| `npm run test:emulate` | Vercel Labs' `emulate` 0.12.1 started on localhost, Vercel-shaped reads answered, stopped afterwards |

CI (`.github/workflows/ci.yml`): jobs `check`, `unit`, `db`, `emulate`; the aggregate job **`ci`** is the single merge
gate and fails unless all four succeeded. Proof it turns red: [run 38077445050](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38077445050) — a deliberately failing unit
test made `unit` and `ci` red while `check`, `db` and `emulate` passed; the test was then removed. Final green run:
linked in PR #1.

## Environment

- Repo: `Robinson-AI-Systems/vercel-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; CI must be green at the exact head before merge.
- Vercel project, Neon database and Vercel tokens for this server: not created yet (IN-02, IN-03, IN-04). Not needed
  until A-5 is tried for real.

## Recent merges and implementation checkpoints (newest first)

**2026-10-11 — A-3a OAuth primitives and store (PR #7):** added portable OAuth primitives, hashed OAuth client/code/access/refresh storage, single-use authorization codes, atomic refresh-token rotation, revocation, and database-counted login attempts. Unit and throwaway-Postgres tests pass. CI run [38139755344](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38139755344) passed `check`, `unit`, `db`, `emulate`, and aggregate `ci` at head `959ff763b1b72b0a50c2b07b9b04f86642b65b46`. PR #7 was retargeted to `main` after A-2 PR #6 merged; documentation reconciliation is running through CI.


**2026-10-11 — A-2 database schema (PR #6, merged as `0cd2e1e11154603049e4bb6a514f83df6fc15837`):** nine additive tables and eight indexes; lazy Neon configuration; frozen connection-field contract; fake and throwaway-Postgres schema tests. CI run [38139075567](https://github.com/Robinson-AI-Systems/vercel-mcp/actions/runs/38139075567) passed all four jobs and aggregate `ci` at head `330dda3367e80a26b958faf579051ac88cae4fe3`. No real Neon database was created or initialized.


**2026-10-10 — CI cadence (docs + CI config PR):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation (PR #1, branch `ai/claude/a-1-foundation`):** Node 24 ESM package with committed lockfile
and exact versions; `scripts/check-secrets.mjs` (tracked files, planted-token test), `check-docs-updated`,
`check-catalog`, `check-writes`, `check-budgets`, `check-core-imports`; empty registry (`mergeNamespaces`);
`test/helpers/fake-vercel.js`; throwaway-Postgres harness; pinned `emulate` runner; four CI jobs plus `ci`.

**2026-10-10 — Gap check against prior toolkits:** every Vercel tool name from Chris's earlier toolkits mapped in
`audits/2026-10-10-prior-tools.md` — 273 unique names: 211 covered, 7 universal, 44 dropped with reasons, 9 tools added
(E-4, M-2, M-4 with IN-15). Catalog 232 hand-built + 4 universal = 236; work index 59 cards (old-toolkit decision note dropped).

**2026-10-10 — Plan written:** research audit, TOOL-CATALOG, 15 batch designs, AGENTS, START-HERE, SESSION-START,
PLAYBOOK, drift protocol, PLAN, MASTER-ROADMAP, owner inputs, go-live checklist, decisions, roadmap, owner guide,
Appliance Desk project profile, work index with validator, card A-1.

## Blocked

Nothing in engineering. Owner inputs open: IN-02 … IN-15 except IN-14 (answered: not needed) (`OWNER-INPUTS.md`); none
blocks A-2 … A-4.
