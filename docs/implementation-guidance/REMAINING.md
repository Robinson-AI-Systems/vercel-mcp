# Remaining-work map — recipes, not distant execution cards

Baseline and existing paths: [README](README.md). Sequence: C → D → E → V → N → F → M → O → P → W → U → R → X.
Use work-index and MASTER-ROADMAP for eligibility; design §0 checks dependencies at each batch boundary.

**Re-based 2026-10-26 at HEAD `03b1e4b` (registry: 123 tools after the N-1 branch work).** This map was written 2026-10-11 against an
empty-ish repository, so several rows below still say **proposed** for modules that now exist. The rows that are
**implemented** at this head: B-8b, C-1, C-2, D-1…D-4, E-1…E-4, V-1…V-5, O-1 (reads + 3 tools), U-1 (discovery and flag
reads only), R-1/R-2 (read-only passes/doors only). N-1 (domains) is implemented on branch
`marley/audit-vercel-mcp-20261025` (source only; live acceptance pending). Genuinely still **proposed** (no implementation): N-2, N-3, F-1…F-3, M-1…M-4,
O-2…O-5, P-1…P-3, W-1…W-6, the write side of U-1 (`vercel_api_write`), R-1 write-capable passes, R-3, X-1, X-2 and
CAP-1…CAP-5. Where a row below contradicts this paragraph, this paragraph and `work-index.json` win.

**Re-based 2026-10-30 at HEAD `8978607b` (registry: 128 tools; catalog: 241, of which 113 unimplemented).** Since
the 2026-10-26 re-base: N-1 is merged (all 11 `vercel_domain_*` tools registered); the AUD account layer is built
(AUD-AA `vercel_remove_account`; AUD-AB `vercel_account_teams`, `vercel_team_create`, `vercel_team_delete`); the
2026-10-30 audit fixes AUD-AE…AUD-AI are merged. O-3 note: `vercel_token_create` / `vercel_token_delete` remain
**proposed** — only `vercel_check_token` exists. Where a row below contradicts this paragraph, this paragraph and
`work-index.json` win.

**Re-based 2026-10-31 at main `8fb9e83` (documentation audit AUD-AN; registry: 240 tools; catalog: 241, of which
1 unimplemented).** The 2026-10-30 build-out completed every batch: N-2/N-3, F-1…F-3, M-1…M-4, O-2…O-5, P-1…P-3,
W-1…W-6, X-1 (`vercel_undo_change`) and R-1W (write-capable RTC passes) are all merged, and O-3 shipped —
`vercel_token_create` / `vercel_token_delete` exist (PR #314); the U-1 row's `vercel_api_write` and
`src/vercel/spend-operations.js` are built (PR #297), and the R row's write-capable passes are built (R-1W).
The one unbuilt catalog row, `vercel_admin_overview`, is closed by owner ruling IN-16 and will not be built.
Genuinely remaining: the live acceptance program (`docs/STATUS.md`), R-2's separate HTTP write-contract leg,
R-3 conformance, the X-2 scratch run, and CAP-5/UA-18 two-tenant live acceptance. Where a row below contradicts
this paragraph, this paragraph wins. Tests/operations
are selected JIT from the actual predecessor, catalog and snapshot; this map does not pin unverified future API versions
or add scope. All paths marked **proposed** below were absent at the inspected baseline (2026-10-11); check the current
tree before treating any of them as still absent.

## Context foundation

| Unit / design | Existing anchors → proposed integration | Concrete fixture / completion / inheritance |
|---|---|---|
| B-8b, BATCH-B B8/§4 | **Completed #40**: owner setup, encrypted approval requests, real write guards and three MCP proposal tools | Real owner authorization and tenant/concurrency invariants are established; C-2/R-2 must not invent a bypass |
| C-1, BATCH-C C3–C5 | `compact`, `shapeVercelResult`, `shapeMcpResult`, `createDb`, registry → **implemented** `src/tools/summaries.js`, `src/core/result-rules.js`, result_store SQL, get-result tool (merged #41–#43) | 100 deployments incl nested fake secrets; >8 KB produces handle/count/summary; env full detail still omits value; owner A handle unreadable by B; expired/consumed cases. Successor inherits central fields/detail injection and 24h scoped retrieval |
| C-2, BATCH-C C1/C2/C6 | profile predicate/MCP/budget script → **implemented** `src/core/meta.js`, `src/tools/meta.js`, guarded dispatch/listing, pinned tokenizer (merged #44–#46) | catalog vs compact same connection; compact <5000, everyday <20000, schemas <1500; planted 161-char failure; ≤10 read-only batch rejects a write; vercel_call same guards by name. Successor inherits real provider ctx and door tests, not just metadata |

C-1 mapping: output summary/full → redaction → field projection → size cap → handle storage; handle/page/fields →
SQL scope+expiry filter → safe page. Current MCP auth lacks a stable connection ID: resolve handle ownership explicitly
(also needed by B-8b/R) before schema/door work; caller-supplied handle owner is never trusted. Handle cleanup must cap
100 expired rows as design C4 says; generic current 8 KB refusal is not a handle implementation.
C-2 must reconcile SDK types, missing `area/audience` metadata and current allowlist; no arbitrary write admission to
make meta dispatch pass. Add tests on actual registered tools and real budget fixtures. Result bodies never store secrets.

## Area tools (only client/OPS or the explicit Blob exception)

Use provider-read/write recipes. For each operation, card records **input → path/query/body → safe before → read-back**;
new tests assert fake recorded request and snapshot validation. Future area tests are **proposed**, not runnable today.
Common test naming: `tests/unit/<area>.test.js`; `tests/emulate/<area>.test.js` only where supported.

| Unit / design decisions | Proposed modules; existing reusable anchors | Mandatory mapping and fixture focus |
|---|---|---|
| D-1…D-4, BATCH-D D1–D8 | **implemented** `src/tools/projects.js`, `deployments.js`, `release-*.js` (merged through #205); reuse client, production helpers, self/app guards; C summaries | project input → verified project path; stored Git/target → deploy body. Live project settings = production; READY preview vs previously-serving production vs current live fixture. Redeploy keeps original target, rollback selects earlier production, live deploy delete refused; alias read-back ≤45 s; 5000-line logs summarized; files total ≤2 MB; crons read/guided only |
| E-1…E-4, BATCH-E E1–E8 | **implemented** `src/tools/project-env-*.js`, `shared-env-write.js`, `custom-environment-*.js`, `globalconfig-*.js` (merged through #202); reuse `resolveVercelInput`, vault, production `envTouchesProduction`; inherits D target reads | key/required targets/type/branch → verified env body; pendingInput kind env_value → internal value. Plain/config/encrypted/Secret fixtures; no values even full/handles/audit; copy/compare server-only; Secret source cannot decrypt. Production custom/shared targets classify; no implicit redeploy. Global Config token list drops planted token; schema validates current items before write |
| N-1…N-3, BATCH-N N1–N6 | N-1 **implemented** on branch `marley/audit-vercel-mcp-20261025` (`src/tools/domains.js`, 11 tools, fake-provider tests; live acceptance pending); N-2/N-3 **proposed** `src/tools/dns.js`, `registrar.js`; reuse production/spend/input helpers; inherits D project ownership | Domain branch/custom target → attach body/read config; DNS fields → exact zone diff/read-back. Fixture CNAME conflict, duplicate SPF/MX, attached aliases; removal blocked until detached. Every DNS/cert/nameserver write production. Quote 1125 cents → buy expectedPrice in API's documented units (verify JIT); changed quote fails; $0 cap/no purchases; transfer codes through vault |
| F-1…F-3, BATCH-F F1–F6 | **proposed** `src/tools/protection.js`, `firewall.js`, routing tools; reuse stored before/inverse/vault | Protection before/after → access classification; pending password kind deploy_password; bypass created secret never raw result. Firewall structured condition → PATCH action, version read-back and inverse; stale config not full PUT. Route stage vs publish; attack expiry ≤24h default; invalidate vs dangerous delete distinguished |
| M-1…M-3, BATCH-M M1–M5 | **proposed** log/drain/webhook/integration/storage tools; reuse C summaries and spend/protection | Window/filter → verified bounded query (default 1h/max7d, ≤50 rows). Destination HTTPS host → tested public-address validation; preview data/project/env scope. Installation removal lists resources/injected vars; future secret fields hidden before audit; analytics on = spend, off = P |
| M-4, BATCH-M M6 | **proposed** `src/vercel/blob.js`, file tool module + encrypted store settings; existing vault/db guards | Exact pinned official @vercel/blob types → adapter inputs; ≤4 MB put; overwrite requires flag; delete ≤100 exact paths, no glob/prefix; only configured stores IN-15. Fake package client, no contents returned, app-owned/live store guards; no REST snapshot fiction for Blob |

## Developer and owner tools

| Unit / design | Existing → proposed | Fixture, SQL/API invariant and successor evidence |
|---|---|---|
| V-1…V-5, BATCH-V V1–V11 | D/E/C wrapped tools + vault → **implemented** `src/dev/scenarios.js`, `build-failures.js`, `src/tools/dev-*.js`; `dev_runs/dev_run_objects/dev_sandbox_usage` additive SQL (merged through #216) | runId → recorded object IDs+account, not tags as authority; cleanup exact tracked IDs newest first, untracked same tag untouched, promoted object skipped, partial errors per object. Preview-only refusal per tool before other reads. Public preview URL/private DNS/redirect cases for fetch. Recorded diagnosis fixture per rule; webhook raw bytes/signature per current official reference; two overlapping sandbox requests share minutes cap. IN-13 answered 2026-10-17 (no daily cap); no real sandbox/spend |
| O-1…O-5, BATCH-O O1–O8 | B-8b owner boundary, `src/data/dashboard-map.js`, C summaries → O-1 **partially implemented** (`src/tools/teams.js`, `team-profile-write.js`, `team-security-write.js`, `team-default-protection.js`, #144–#147); O-2…O-5 **proposed** team/member/token/billing/admin modules | Security diff → who can access; all owner writes production/full/confirm. Paid invite price from stored seat setting, last Owner and server user/token protected; concurrent demotions tested. FOCUS charge mapping uses exact source units → integer cents → display, period sums fixture incl credits; billing read-only. Overview marks unreadable/guided correctly, no fabricated success; map read-back references only shipped tools |

V-1 migration includes its run tables; V-4 owns usage-budget changes if split. Later cards inherit durable run/object
identity and cleanup outcomes, not permission to delete by inferred tags. Public URL validation is **not** an existing
helper: the first V/M card needing it must own a reusable tested implementation (DNS rebinding/redirect/private-range
cases); later cards reuse it. Do not present this helper as shipped today.

## Profiles, workflows and remaining doors

| Unit / design | Existing → proposed | Concrete completion and inheritance |
|---|---|---|
| P-1…P-3, BATCH-P P1–P6 | `checkApp` hook and APP-NEEDS doc → **proposed** known_apps SQL, profile/readiness/setup tools | Two app profiles in same account; targets → all ownership match rules; managed env/DNS/stores denied without outsideApp. Branch-release promote blocked, emergency rollback labelled; profile draft data only. Setup twice no duplicates; missing values request input, never invent; IN-11 retained |
| W-1…W-6, BATCH-W W1–W7 | C dispatcher + shipped area/dev/profile tools → **proposed** workflow modules | Named wrapped tool dependencies validated first. Combined dryRun preview → confirmed ordered steps; stop first failure, exact continuation after 45s, safe inverse per completed step. Normal/empty/multipage/time-budget fixture per workflow; production ship requires READY/checks/smoke and profile release rule; no direct client calls |
| U-1, BATCH-U U1–U8 | Pinned snapshot/validator/client/guards → **partially implemented**: `src/tools/universal.js`, `src/vercel/openapi-index.js`, `src/vercel/hand-built-map.js` exist (discovery + flag reads merged #148–#165); `vercel_api_write` and the spend table `src/vercel/spend-operations.js` are **proposed, not present** | Current client accepts only OPS IDs: arbitrary documented operation support must be designed/tested, not assumed. Search/describe → snapshot operation; GET/HEAD vs write classification; unknown fields/path denied; credential-returning operations refused in universal path. Hand-built operation delegates to its wrapped handler; unknown live/billing change conservatively guarded |
| R-1…R-3, BATCH-R R1–R3 | OAuth/db/dispatch → **partially implemented**: read-only passes, `api/tools` routes, manifest/OpenAPI exist (merged through #219); write-capable passes, R-3 conformance and the design's `rate_limits` SQL table are **proposed, not present** — rate limiting is window columns on `rtc_passes` (`src/db.js`), not a separate table (see the dated BATCH-R schema drift note in STATUS 2026-10-26) | Narrow default preview/read-only/24h/$0; one-time secret issuance. New settings copied on refresh (`CONNECTION_FIELDS`). Exactly 120/150 overlapping calls across two handler instances with shared DB; configured cap5 rejects6th. Connector bearer not accepted as pass, pass read_only cannot write via meta/HTTPS; same write-contract through new door. IN-10 and RTC conformance evidence |
| X-1…X-2, BATCH-X X1/X2 | Safe audit/inverse + every shipped handler → **proposed** undo module, smoke-readonly script | change ID → account-scoped safe stored inverse → same guarded dispatch; irreversible purchase/delete/secret reveal explains opposite, no invented restoration. Undo of undo; production blocked on preview. IN-06 owner-provided scratch scope before real write run; documented failures/gaps, never a broad live sweep |

Each successor inherits **tested exports**, request mappings, summary/secret policy, guard ctx and unresolved limitations
via its card or CHANGES-SINCE-DESIGN. Batch close-out retains PLAN acceptance evidence and all owner/live gates.
