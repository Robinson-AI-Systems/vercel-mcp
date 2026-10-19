# PLAN — remaining scope and acceptance

Written 2026-10-10 for an empty repository. Order is in [MASTER-ROADMAP](MASTER-ROADMAP.md); current head and blockers in
[STATUS](STATUS.md). AGENTS owns workflow rules. This file owns acceptance; designs own semantic decisions; cards own the
next bounded implementation.

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
- [ ] CI runs check, unit, database and emulate jobs on every PR; a failing test turns it red.
- [ ] Connector login with account, mode (preview only until enabled), profile and listing; lockout after 5 tries in 15 minutes (database-counted); tokens stored hashed; settings survive refresh.
- [ ] Vercel tokens stored only encrypted; added only on the setup page; scope probed; full-account tokens refused by default; key-scan test passes.
- [ ] One Vercel client through an operation table whose every entry is in the vendored snapshot; safe retries without idempotency keys; rate limits respected.
- [ ] One-time-secret page and pending inputs work (each used once, then gone); protected resources seeded.
- [ ] `docs/DEPLOY.md` followable by Chris.

## Batch B — Trust layer (`designs/BATCH-B.md`)
- [ ] `defineWrite` with production, spend, access, secret and target declarations; dollar preview; spend limit; read-back/verify; inverse.
- [ ] Production guard with two-step enable; self-protection; profile-guard hook; plain-English errors; shaping that hides every secret; profiles.
- [ ] `check-writes` fails on every missing declaration.
- [ ] Server tools (change log, connections, spend limit, production enable/disable, token check, protected-resource list, where-is-setting).

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
- [ ] Runs recorded and tagged; cleanup touches only recorded objects.
- [ ] Preview per branch, preview env wiring, preview aliases, bypass for automation, build diagnosis, log tail, preview fetch, integration check, Sandboxes with atomic usage visibility but no mandatory daily quota (IN-13 owner amendment 2026-10-17), signed test webhooks.
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
- [ ] Four `vercel_api_*` tools; requests validated against the snapshot; spend, production and secret detection with safe defaults; hand-built tools win; same guards.

## Batch R — standalone RTC 1 doors (`designs/BATCH-R.md`)

**October 19 owner clarification:** Completion requires RTC 1 conformance, truthful provider-owned direct MCP/HTTPS endpoints, correctly scoped authentication and independent real deployed **direct** acceptance (including denial/revocation). Hub discovery, Hub-managed OAuth consent, Hub-routed calls, relay and Sandbox proof belong to the Hub and cannot block this standalone server. The Hub connection profile's additional OAuth path is optional to frozen RTC 1; if we claim it, independently verify it. All original R-1/R-2/R-3 checks remain.
- [ ] Passes per RTC §2; HTTPS tool API, manifest and OpenAPI per RTC §1/§7; rate limit per pass shared across instances.
- [ ] Same eight write-contract checks through MCP, `vercel_call` and HTTPS.
- [ ] RTC 1 conformance green in CI (when the hub's package exists; never a blocker before).

## Batch X — Undo, smoke test (`designs/BATCH-X.md`)
- [ ] Undo for every clean opposite; read-only smoke report against the real team; scratch-project write run (IN-06).
