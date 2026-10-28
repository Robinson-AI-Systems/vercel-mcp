# Implementation guidance — read one recipe, then the current card

Execution aids for Sol 5.6; no new product scope or approval. Authority remains AGENTS, PLAN, approved designs,
current cards and drift protocol. Baseline inspected: `fad643a011171fee5766be9d05c0e4aa602e9ba9` (2026-10-11).
PR #24 is merged; all five main checks passed; no open PRs at inspection. B-8b is next, then C-1/C-2.
Recheck GitHub before selecting work. Branch names from merged PRs are not unfinished work by themselves.

**Re-based 2026-10-26 at HEAD `03b1e4b`:** the 2026-10-11 baseline above is historical. B-8b, C-1, C-2, D-1…D-4,
E-1…E-4, V-1…V-5 are merged; the registry has 123 tools (not 8); N-1 is implemented on branch
`marley/audit-vercel-mcp-20261025`. The "Existing code map" below is the 2026-10-11 snapshot — verify current modules
and signatures before following its examples; `src/tools/index.js` now lists many more than four modules.

**Current security update (#56):** §7 of [RECIPES](RECIPES.md#7-grouped-operations-and-security-first-throughput-d-1-onward) governs cohesive multi-operation PRs; the runtime authenticates the `defineWrite` origin and guarded handler, partitions transport replay per mutation and preserves write classification in MCP metadata. The older baseline map below is historical; verify current modules and signatures before following its examples.

## Choose the smallest reading route

| Current task | Read | Then inspect |
|---|---|---|
| Write a JIT card | [Recipes §1](RECIPES.md#1-card-writing-recipe) | Current card/design heading + its exact dependencies |
| B-8b account administration | [Worked example](B-8b.md) | B-8 remaining scope, owner inputs IN-07/IN-08 |
| Provider read / write | [Recipes §2–3](RECIPES.md#2-provider-read-recipe) | Operation finder + named source/test patterns |
| SQL / owner controls / secrets | [Recipes §4–5](RECIPES.md#4-database-and-owner-control-recipe) | Current schema + setup boundary |
| Later batch | One row of [remaining-work map](REMAINING.md) | That row's design section; create only current/immediate-successor card |
| Finish/review a PR | [Recipes §6](RECIPES.md#6-completion-evidence) | PLAYBOOK Steps 4–10 + drift checklist B |

## What repeatedly costs discovery time

| Observed friction | Concrete shortcut / limit |
|---|---|
| Target code map mistaken for shipped code | Existing map below; proposed paths are explicitly labelled in remaining-work map |
| Design helper names predate implementation | Use actual `defineWrite` signatures; no `plan/readAfter/guard/gone` exports today |
| Every provider operation needs fresh path research | Finder → `OPS` → `validateRequest` → fake recorded call; record the complete mapping in the card |
| Generic write tests mistaken for per-tool coverage | Adapt the factory and add real tool cases: helper categories 4/7/8 partly construct generic samples |
| Listing permission mistaken for owner approval | `full` is a profile, not passphrase proof; setup reentry is a separate trust boundary |
| Schema/security gaps rediscovered during B-8b | Worked example records absent owner identity, rotating connection IDs and missing mutations |
| Future test paths copied as runnable commands | Existing command list below; future commands in cards only after the test file is created |
| Queue docs lag merges | STATUS chooses next; recheck PR state, then reconcile MASTER-ROADMAP/work index at PR boundary |

## Existing code map (verified; not the target architecture)

| Concern | Existing path and interface | Existing evidence |
|---|---|---|
| Registry | `src/core/registry.js`: `mergeNamespaces(modules)` → `{tools, handlers}`; modules `{tools:[], handlers:{}}`; `src/tools/index.js` lists four modules | `tests/unit/registry.test.js` |
| Profile boundary | `src/core/profiles.js`: `visibleToProfile(tool, profile, {localOwnerTools})`; `src/core/mcp-server.js`: `dispatchReadOnlyTool({registry,name,args,connection,db,formatError,shapeResult})` | `tests/unit/profiles.test.js`, `mcp-server.test.js` |
| Caller | `src/core/mcp-auth.js`: `requireMcpToken(req,res,db,env)` → frozen `{clientId,account,mode,profile,listing}` | `tests/unit/mcp-auth.test.js` |
| Write contract | `src/core/write.js`: `defineWrite(spec)` → `{run(args,ctx),writeContract}`; `writeRequestKey(name,args,connection,now)` | `tests/unit/write-contract.test.js`, `tests/helpers/write-contract.js` |
| Provider | `src/vercel/client.js`: `makeVercelClient({token,account,fetchImpl,baseUrl,replayStore,now,sleep})` → `{request,paginate}` | `tests/unit/vercel-client.test.js`, `tests/emulate/vercel-client.test.js` |
| Request validation | `src/vercel/operations.js`: `OPS`, `operation(id)`; `src/vercel/openapi-validation.js`: `validateRequest(id,{path,query,body})` | `tests/unit/openapi-validate.test.js`, `openapi-snapshot.test.js` |
| Credentials | `src/vercel/tokens.js`: `probeToken`, `storeToken`, `loadToken` | `tests/unit/token-store.test.js`, `tests/db/token-store.test.js` |
| Owner page | `api/vercel/setup.js` → `src/vercel/setup.js`: `handleSetup(req,res,{db,env,now,storeTokenFn})` | `tests/unit/setup-page.test.js`, `protected-setup.test.js`, `production-approval.test.js` |
| SQL | `src/db.js`: `createDb(query?)`; lazy configuration; tagged-template SQL only | `tests/db/schema.test.js`, `account-observability.test.js` |
| Protection | `src/tools/self-guard.js`: `checkProtected(targets,{db,connection,env})`; `src/tools/app-guard.js`: `checkApp(targets,ctx)` | `tests/unit/self-guard.test.js`, `tests/db/self-guard.test.js` |
| Output | `src/core/util.js`: `compact`; `src/vercel/shape.js`: `shapeVercelResult`; `src/tools/errors.js`: `explainVercelError` | `tests/unit/result-shape.test.js`, `errors.test.js` |
| Secret references | `src/core/pending-inputs.js`, `one-time-secrets.js`, `secret-box.js` | `tests/unit/secret-input.test.js`, `tests/db/secret-vault.test.js` |
| Test adapters | `test/helpers/fake-vercel.js`, `fake-db.js`, `pg-neon-adapter.js` (note singular `test`); write helper under plural `tests/helpers` | `tests/unit/fake-vercel.test.js`, `db-contract.test.js` |

## Important missing pieces

The registry has **8 tools**, not all 236 catalog tools. No area-tool modules, generic provider write gateway,
`vercel_call`, HTTPS tool door, passes, result-store, known-app data or dev-run tables exist yet.
`checkApp` deliberately allows while no app profiles exist (B-3 hook); it is not P-1 ownership enforcement.
`shapeVercelResult` refuses oversized output today; it does not store handles (C-1). The budget check estimates JSON
length / 4; pinned tokenizer/profile/default-result budgets belong to C-2. Do not claim these future contracts pass.

MCP lists/calls reads and **only** allowlisted local production switches. It does not build a provider client or
supply write safety services; changing a comment or adding registry metadata cannot enable safe provider writes.
`dispatchReadOnlyTool` does not itself validate arbitrary argument schemas; new handlers need runtime validation.

## Existing baseline commands

Run from repo root; use `set -o pipefail` for piped output and PLAYBOOK bounded timeouts. `npm ci` once per checkout.

```bash
npm run check
npm test
npx vitest run tests/unit/token-store.test.js tests/unit/account-observability.test.js tests/unit/write-contract.test.js
npm run test:db -- tests/db/account-observability.test.js
npm run test:emulate -- tests/emulate/vercel-client.test.js
node scripts/openapi-find.mjs "list projects"
```

`npm run check` includes index/catalog/write/budget checks; new Markdown must be tracked before the secret scan.
For documentation-only PRs, verify paths/links, run the quick gate and unit suite, and retain all five CI checks.
No local Postgres → record exit 2, use CI's disposable Postgres. No live services or credentials needed here.
