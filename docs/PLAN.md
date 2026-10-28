# PLAN — remaining scope and acceptance

## Maximum legitimate authority — owner-approved 2026-10-21

[MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) adds five indexed APPROVED,
NOT IMPLEMENTED units CAP-1..CAP-5: operation inventory; ordinary fullest authority;
secure additional credential lifecycle; advanced functional gaps; independent proof.
Existing acceptance and unfinished original cards retain priority. Named-tool counts
do not establish provider API coverage. No runtime grant or release change is implied.


Written 2026-10-10 for an empty repository. Order is in [MASTER-ROADMAP](MASTER-ROADMAP.md); current head and blockers in
[STATUS](STATUS.md). AGENTS owns workflow rules. This file owns acceptance; designs own semantic decisions; cards own the
next bounded implementation.

**Checkbox meaning (2026-10-26):** `[x]` means the source is merged *and* its CI checks pass at the head; it does not by
itself claim live provider acceptance — that is tracked per item in the STATUS.md acceptance queue. Batches A and B were
merged before this convention was written down, so their boxes were checked retroactively against `work-index.json`
(A-1…A-6 MERGED, B-1…B-8 MERGED) on 2026-10-26. D, E, V, O-1, U-1 and R-1/R-2 stay `[ ]` here until their live acceptance
rows pass, even where the source is merged.

## Rules that apply to every batch

- Every write tool passes the eight write-contract checks (`docs/designs/BATCH-B.md` §3) through every door that exists.
- Every Vercel request validates against the vendored OpenAPI snapshot; core areas also pass against `emulate`.
- Database code passes on throwaway Postgres; schema changes are additive and idempotent.
- `npm run check` green: secret scan, docs check, index validation, lint, write-safety, core imports, token budgets.
- No secret in code, docs, tests, logs, PR text or tool results (key-scan test; planted-value env test).
- **Development/test agent only:** No real Vercel writes outside authorized scratch fixtures, no production changes, no purchases (AGENTS hard limits). This must NOT restrict authenticated end users and their delegated agents. See END-USER-AUTHORITY.md.
- Owner inputs are inputs, not things to invent: build the mechanism, keep the dependent behavior off, list the `IN-xx`.
- Money shown in dollars and cents, stored in cents; times shown America/Denver, stored UTC.
- The PR description carries the card's acceptance checklist with evidence.

## Batch A — Foundation (`designs/BATCH-A.md`)
- [x] CI runs check, unit, database and emulate jobs on every PR; a failing test turns it red.
- [x] Connector login with account, mode (preview only until enabled), profile and listing; lockout on the 6th failed try in 15 minutes (database-counted, `MAX_FAILED_LOGINS=5`, lock when the count exceeds 5 — `src/core/oauth.js`); tokens stored hashed; settings survive refresh.
- [x] Vercel tokens stored only encrypted; added only on the setup page; scope probed; full-account tokens refused by default; key-scan test passes.
- [x] One Vercel client through an operation table whose every entry is in the vendored snapshot; safe retries without idempotency keys; rate limits respected.
- [x] One-time-secret page and pending inputs work (each used once, then gone); protected resources seeded.
- [x] `docs/DEPLOY.md` followable by Chris.

## Batch B — Trust layer (`designs/BATCH-B.md`)
- [x] `defineWrite` with production, spend, access, secret and target declarations; dollar preview; spend limit; read-back/verify; inverse.
- [x] Production guard with two-step enable; self-protection; profile-guard hook; plain-English errors; shaping that hides every secret; profiles.
- [x] `check-writes` fails on every missing declaration.
- [ ] Server tools (change log, connections, spend limit, production enable/disable, token check, protected-resource list, where-is-setting). Source merged, but `work-index.json` says B-8 MERGED while `docs/designs/B-8B-OWNER-BOUNDARY.md` §5 says B-8 remains IN_PROGRESS: the MCP tools are proposals-only (applied on the setup page) and targeted revocation and spend-limit setting are still future work. This line stays unchecked until that contradiction is resolved by an amendment.

## Batch C — Cheap on context (`designs/BATCH-C.md`)
- [x] Summaries (env summaries never carry values), `fields`, `detail`, handles, annotations, structured output; logs summarized.
- [x] Catalog and compact listing; meta-tools route through the wrapped handlers.
- [x] Budgets enforced in CI: compact <5,000 tokens, everyday catalog <20,000, descriptions ≤160 characters, results ≤8 KB or a handle.

## Batch D — Projects and deployments (`designs/BATCH-D.md`)
- [ ] Every tool in TOOL-CATALOG sections Projects, crons and Git; Deployments (both); Releases built and marked.
- [ ] Production explicit on deploys; redeploy keeps its target; rollback uses the rollback operation (audit T4, T5 regression tests).
- [ ] Waits bounded at 45 s; logs summarized with handles.

## Batch E — Environment variables and configuration (`designs/BATCH-E.md`)
- [ ] Every listed tool built; no environment variable value in any result, log or change-log row (planted-value test).
- [ ] Values only from the setup page, server-side `generate`, or non-secret `value`; targets required; Secret by default.
- [ ] Global Config on `/v1/global-config/*` only; Global Config tokens never returned; schema changes previewed against current items (E-4).

## Batch V — Developer tools (`designs/BATCH-V.md`)
- [ ] Runs recorded and tagged; cleanup touches only recorded objects. (V-1 source merged #206; live acceptance pending.)
- [ ] Preview per branch, preview env wiring, preview aliases, bypass for automation, build diagnosis, log tail, preview fetch, integration check. (V-2/V-3 source merged #207/#209; live acceptance pending.)
- [ ] Sandboxes with atomic usage visibility but no mandatory daily quota (IN-13 owner amendment 2026-10-17), signed test webhooks. (V-4/V-5 source merged #216; live acceptance pending — IN-13 was answered 2026-10-17, not unanswered.)
- [ ] Every tool refuses production.

## Batch N — Domains, DNS, certificates, registrar (`designs/BATCH-N.md`)
- [ ] Every listed tool built; every DNS/nameserver/certificate write production-guarded with full previews and inverses.
- [ ] Registrar purchases quote → confirm with `expectedPrice`, spend limit enforced; no auth code or private key through chat.

## Batch F — Firewall, protection and traffic (`designs/BATCH-F.md`)
- [ ] Every listed tool built; protection loosening is an access change; passwords and bypass secrets never in chat.
- [ ] Firewall changes previewed in words with undo; routes/redirects staged vs published.

## Batch M — Monitoring, integrations and storage (`designs/BATCH-M.md`)
- [ ] Every listed tool built; bounded queries; drains, analytics and stores spend- and confirm-guarded; webhook secrets on the one-time page.
- [ ] Blob files (M-4): only stores connected on the setup page; no file contents or store credentials in any result; deletes previewed per file and refused on profiled stores.

## Batch O — Owner and administration (`designs/BATCH-O.md`)
- [ ] Team, security, members, access groups, tokens, billing and activity tools built; owner writes guarded and logged; nobody locked out.
- [ ] Owner side complete: admin overview, security and cost reviews; every dashboard settings page in the map as structured guided steps with read-back where possible (contract §11).

## Batch P — Project profiles (`designs/BATCH-P.md`)
- [ ] `known_apps` with the Appliance Desk profile, each item traceable to the app's files.
- [ ] Profile guard names the owning app; release rule, managed variables, owned DNS records and stores respected.
- [ ] `vercel_workflow_app_readiness` covers every row of the example profile and works with an inline spec; `vercel_workflow_project_setup` idempotent; `vercel_profile_draft` from codebase findings.

## Batch W — Workflows (`designs/BATCH-W.md`)
- [ ] All 12 workflows; one preview and one confirm per write workflow; shipping gated; rollback honest; all writes logged.

## Batch U — Universal tools (`designs/BATCH-U.md`)
- [ ] Three of four `vercel_api_*` tools built (`vercel_api_search`, `vercel_api_describe`, `vercel_api_read` — flag reads only); requests validated against the snapshot; spend, production and secret detection with safe defaults; hand-built tools win; same guards. **`vercel_api_write` is not built** — there is no write handler in `src/` and no `src/vercel/spend-operations.js` table; the write side of U-1 remains open work.

## Batch R — standalone RTC 1 doors (`designs/BATCH-R.md`)

**October 19 owner clarification:** Completion requires RTC 1 conformance, truthful provider-owned direct MCP/HTTPS endpoints, correctly scoped authentication and independent real deployed **direct** acceptance (including denial/revocation). Hub discovery, Hub-managed OAuth consent, Hub-routed calls, relay and Sandbox proof belong to the Hub and cannot block this standalone server. The Hub connection profile's additional OAuth path is optional to frozen RTC 1; if we claim it, independently verify it. All original R-1/R-2/R-3 checks remain.
- [ ] Passes per RTC §2; HTTPS tool API, manifest and OpenAPI per RTC §1/§7; rate limit per pass shared across instances.
- [ ] Same eight write-contract checks through MCP, `vercel_call` and HTTPS.
- [ ] RTC 1 conformance green in CI (when the hub's package exists; never a blocker before).

## Batch X — Undo, smoke test (`designs/BATCH-X.md`)
- [ ] Undo for every clean opposite; read-only smoke report against the real team; scratch-project write run (IN-06).

## Maximum-authority acceptance (all open)

- [ ] **CAP-1:** Operation and credential coverage inventory; full criteria in MAXIMUM-AUTHORITY.
- [ ] **CAP-2:** Standard fullest authorization and effective-access recovery; full criteria in MAXIMUM-AUTHORITY.
- [ ] **CAP-3:** Guided additional authority lifecycle; full criteria in MAXIMUM-AUTHORITY.
- [ ] **CAP-4:** Advanced functional workflow gap closure; full criteria in MAXIMUM-AUTHORITY.
- [ ] **CAP-5:** Independent authority acceptance and coverage reporting; full criteria in MAXIMUM-AUTHORITY.
