# Execution recipes

Read only the matching section. Existing interfaces below are verified at the [baseline](README.md).
Suggested new names are proposals for the current JIT card, not new exports or permission changes.

## 1. Card-writing recipe

1. Fetch main, inspect open PR heads/reviews/resume notes; use STATUS and work index for the eligible unit.
2. Read one design work-unit heading, its numbered decisions and PLAN acceptance. Diff only dependency paths against
   the predecessor/card baseline. Copy actual signatures from source, not target names in PLAYBOOK.
3. Use this compact block inside the normal 40–100-line card (split a card if it has too many independent risks):

```text
Baseline inspected: <SHA>; prerequisite <card/PR/test>; owner gate <IN or none>
Existing: <path>: <export/signature> — reuse <specific branch/behavior>
Proposed: <path/export> — responsibility; migration owner <card or none>
Mapping: <input> → <operation ID/method/path> → <path/query/body or SQL column>
Before: <safe snapshot>; after: <independent observable condition>; unknown: <response>
Steps: 1 fixture+validation; 2 helper+test; 3 handler+mapping; 4 door+registry; 5 docs
Fixtures: <exact values and setup>; outcome: <status/call count/row count>
Failures: <missing/invalid/forbidden/concurrent/provider uncertainty>; forbidden: <side effects>
Run: <existing exact targeted commands; proposed tests only when created>
Done: <acceptance → test names + exact-head CI>; successor inherits: <paths/contracts/gaps>
```

4. If an operation/policy cannot be safely mapped, record its specific drift and proposed amendment before coding that
   slice. Continue independent eligible work; do not invent a weaker production/spend/auth boundary.
5. Keep distant scope in REMAINING/design/work-index. Planning guidance never changes an in-flight card or its status.

## 2. Provider-read recipe

**Existing anchor:** token probe and `tests/unit/vercel-client.test.js`; no area read tool is shipped yet.

| Mapping | Existing concrete example |
|---|---|
| Server-selected account | `{id:'account_FAKE',team_id:'team_FAKE'}` passed to `makeVercelClient` |
| Operation selection | `projects_list` → `GET /v10/projects` in `OPS` |
| Inputs | `request('projects_list',{query:{limit:20}})`; client adds `teamId` from account |
| Provider result | `{projects:[{id:'prj_FAKE',name:'fixture'}],pagination:{next:null}}` |
| Safe output | Explicit summary fields; C-1 result rules once implemented; never return raw provider object |

1. Finder: `node scripts/openapi-find.mjs "list projects"`; inspect only the matching schema and official reference
   (AGENTS requires current external facts cited for new calls). Add/version a new `OPS` entry only after verification.
2. Runtime input validation: reject unknown args, invalid enums/IDs/limits before I/O. `fields/detail` are server
   presentation options and must not be copied into provider query/body.
3. Inject fake fetch; register the exact method/path using `makeFakeVercel().when(...).resolves(...)`. Assert recorded
   `params/query/body`, injected team, masked authorization, response selection and `fake.verify()`.
4. Test empty result, missing object, 403, 429 beyond 5 s, malformed response and pagination. Current `paginate` uses
   `limit`/`until` and recognized collection keys; APIs using another cursor need their own bounded adapter, not blind
   reuse. Return a next cursor rather than silently claiming capped records are complete.
5. Wire module metadata/handler in `src/tools/index.js`; use same profile predicate for discovery and invocation.
   Test the handler through MCP as well as directly. Update catalog built marks only for shipped names.

Focused existing regressions: `npx vitest run tests/unit/vercel-client.test.js tests/unit/openapi-validate.test.js
 tests/unit/registry.test.js tests/unit/profiles.test.js` (one shell line). Add the new area test file to the card.
`tests/unit/request-shapes.test.js` in PLAYBOOK is a target path, **absent** today; existing shape tests use
`tests/unit/openapi-validate.test.js`. Emulate only operations it supports, not invented mock success.

## 3. Provider-write recipe

**Existing anchor:** `src/core/write.js`, `write-preflight.js`, `tests/helpers/write-contract.js`.
No production area write is wired through MCP yet. Keep the gateway fail-closed until its own tests pass.

| Actual spec member | Required behavior |
|---|---|
| `before(args,ctx)` | Read authoritative safe target state; fail closed if required ownership/state absent |
| `preview(args,ctx,before)` | Plain string summary of the change (DB audit expects a string) |
| `production(args,ctx,before)` | `{production:boolean,why:string}` using B2 rules, not caller's guess |
| `targets(args,before,ctx)` | Nonempty identities including parent project for child resources; real guard rejects unknown kinds |
| `apply(args,ctx,before,requestKey)` | Exactly the intended provider call; no retries of POST/PUT/PATCH |
| `verify(args,ctx,before,providerResult)` | Make independent read-back; return `{confirmed:true/false/null,...safeFacts}` |
| `spend(args,ctx,before)` | Required for `$`; `{cents,recurring,description}` from provider/stored setting |
| `access(args,before,ctx)` | Required for `A`; `{widens,who,what}`; confirmation does not prove owner approval |
| `inverse(args,before,providerResult,ctx)` | Safe opposite `{tool,args}` or null; never store secret values |

Required ctx: verified `connection`, `audit`, `shape`, `guardProtected`, `guardApp`, durable `replayStore`; `checkSpend`
for paid writes. Production composition belongs outside `src/core`: `db.recordChange`, `db.requestReplayStore`,
`checkProtected`, `checkApp`, Vercel shaping/spend helpers. Never inject permissive test guards into production.

1. Fixture both before and read-back; assert dryRun/no-confirm invoke **zero** mutations (reads/audit may occur).
2. Implement spec+unit tests, then wire runtime ctx at the door. Metadata `writeContract` is declaration checking,
   not proof the handler uses that executor. Test the actual handler.
3. Reconcile **two existing replay layers** in the current card: executor claims a logical scoped key; client claims a
   transport key. Passing the same key/store to both can refuse the operation as pending. Do not disable either gate:
   document distinct logical/transport scopes and test one apply across concurrent invocations, completed replay,
   pending/unknown result and safe persisted payloads. Current key helpers have different override behavior.
4. Read-back mismatch → `confirmed:false`; unreadable/time-budget hit → null. Core currently returns no automatic
   mismatch warning text: operation/door must give the designed explanation without calling another mutation.
5. Wire annotations/profile/registry/catalog and test every existing door. Future doors add the same cases, not a
   bypass calling `apply` directly. `outsideApp` never bypasses self-protection; read_only never writes.

**Helper limitation:** actual signature is `runWriteContract(label,factory=sampleWrite)`. Factory yields
`{spec,tool,ctx,provider,audits,rows}`; implement factory over the real tool with valid args. Categories 4 (unknown),
7 (spend) and 8 (access) partly instantiate `sampleWrite` internally, so passing it is insufficient per-tool evidence.
Add concrete tests for your tool's unknown read-back, spend and access behaviors; don't weaken generic tests.

Existing regressions: `npx vitest run tests/unit/write-contract.test.js tests/unit/production-spend.test.js
 tests/unit/self-guard.test.js tests/unit/write-declarations.test.js` (one line). New tool tests must assert call count,
query/body, forbidden account/resource writes, audit/replay contents, and actual guards under MCP.

## 4. Database and owner-control recipe

**Existing anchor:** `src/db.js`; DB test pattern in `tests/db/account-observability.test.js`.

1. Put every SQL method in `createDb`, using parameterized tagged templates. Add corresponding behavior to
   `test/helpers/fake-db.js` only when needed; implement correct snake_case return rows so tests catch mapping drift.
2. Use `openIsolatedSchema(TEST_DATABASE_URL)` + `createDb(neonShapedQuery())` + `initSchema()`, with localhost check and
   `closeIsolatedSchema()` teardown. Never substitute DATABASE_URL/Neon for disposable tests.
3. Fixture A/B tenants; assert A cannot read/update B, no SELECT credential/hash columns in metadata, no invalid-input
   SQL call. For additive schema, initialize twice, preserve a planted row; update `SCHEMA_TABLES` when adding a table.
4. For counters, last-owner checks, single defaults and one-use approval: run overlapping calls with `Promise.all` on
   separate adapters/handlers sharing Postgres. Read-then-write in JS is insufficient; use atomic SQL/constraints or a
   supported transaction within this repository's query adapter. Record SQL policy in the JIT card first.
5. Owner forms remain behind `handleSetup` cookie/CSRF, escaped HTML, no-store/security headers. `paramsOf` caps string bodies at 16 KiB but currently accepts parsed
   objects without a byte-size check: test and address that gap when adding owner actions; do not claim all bodies bounded.
   Sensitive approvals reenter passphrase through `evaluateLogin` (five failures/15 minutes); `confirm:true` from an AI
   is never a substitute. A missing trusted owner/connection identity is a design gap, not a field to accept from args.
6. Any new connection-setting column extends `CONNECTION_FIELDS`, refresh copy and real Postgres refresh tests;
   account switch/default does not silently rewrite issued connections. Verify token revocation also refuses refresh.

Focused existing regressions: `npx vitest run tests/unit/setup-page.test.js tests/unit/production-approval.test.js
 tests/unit/oauth-core.test.js`; `npm run test:db -- tests/db/oauth.test.js tests/db/production-switch.test.js`.
No local database binaries: report exit 2 and rely on green CI db job; never say the local DB tests passed.

## 5. Secret-input/output recipe

Reuse `resolveVercelInput` in `src/vercel/shape.js` (backed by `src/core/pending-inputs.js`) for pending reference / generate / validated plain config.
Use encrypted `oneTimeSecrets(...).issue/reveal` for created secrets; SQL consumption is atomic DELETE RETURNING.
Check kind, account, expiry and one-use behavior. No plaintext credential accepted by an MCP token-probe argument.
Never place raw provider secret output in audit/replay/result-store before redaction. Core secret declarations are
metadata; tools must actually resolve/route values. Env values of **every** type are omitted even with full detail.

Fixtures: `vcp_FAKE...` credentials, a nested planted `value`, `decryptedValue`, `token`, arbitrary credential-shaped
string, pending ID from A used on B, expired and consumed ID. Assert no leak in result, stored audit/replay/handle body,
provider error or HTML error message; valid owner reveal displays once and second attempt fails.
Existing checks: `npx vitest run tests/unit/secret-input.test.js tests/unit/secret-vault.test.js
 tests/unit/result-shape.test.js`; `npm run test:db -- tests/db/secret-vault.test.js`.

## 6. Completion evidence

Keep test names and exact commands in the PR; don't replace evidence with “implemented” or a generic green suite.
Use this table alongside drift A and self-review, then follow PLAYBOOK's one-push/CI-cycle and expected-head merge.

| Claim | Evidence to record |
|---|---|
| Mapping correct | Operation finder result/reference + recorded request assertions / parameterized SQL test |
| Safe before and after | Named dry-run, confirmed read-back, mismatch, unknown and no-forbidden-side-effect tests |
| Tenant and door boundaries | Two-tenant DB and direct/MCP tests; add meta/HTTPS tests only when those doors exist |
| Concurrent behavior | Real Postgres overlapping replay/revocation/counter/default invariant |
| Complete unit | PLAN acceptance → concrete test names; deferred portion → named owner card, still open |
| Docs reconcile | STATUS, card/index, changed catalog rows, architecture/new switches; successor signatures or CHANGES entry |
| Reviewed | Whole diff inspected; applicable AI-PR-READ-FIRST constraints honored; each finding disposition |
| Merge ready | All four jobs + aggregate `ci` success at exact PR head; expected-head merge; post-merge check |

No code features, live activation, paid resources or broadened defaults are authorized by these recipes.
