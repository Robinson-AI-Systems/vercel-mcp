# Prior tools gap check — Vercel (2026-10-10)

Chris asked (2026-10-10) to check every Vercel tool he had **built or planned** across his Robinson's Toolkit repositories
(and outside his organization) and close any gaps in this plan. This audit lists every prior tool name, says where each
one lives now, and records the tools added because of it. Read-only research; nothing in the source repositories was
changed. Counts were produced by a script over the files named below (one row per unique name after normalizing
obvious respellings).

## 1. Sources read (local clones; personal-account copies `christcr2012/*` have the same HEAD as the org copies)

| Code | Repository and files | Commit |
|---|---|---|
| TK | `Robinson-AI-Systems/robinsons-toolkit-mcp`: `registry/vercel.json` (181 tools), `handlers/vercel.js` (1,456 lines; handler names match the registry), `registry/compound.json` (15 compound tools that call Vercel), `inverses.js`, `EXPANSION_ROADMAP.md` ("Vercel (150 tools) — Needs Admin/Account Tools"), `EXPANSION_INDEX.md`, `TOOLS_REFERENCE.md`, `ClaudeBuildPlan.md` (planned compound tools), `Creation Docs/` (5 planning documents: only names already in the registry, plus the create → cancel inverse pair) | `6c590f9c` (2026-05-23) |
| MS | `Robinson-AI-Systems/robinsonai-mcp-servers` `packages/robinsons-toolkit-mcp`: `src/categories/vercel/tools.ts` + `handlers.ts` (150 tools), the generated lists `temp-vercel-*.txt` / `temp-vercel-mcp.ts` (same 150), `test-results-vercel.json` (150 "OK" — handlers were stubs/paths not checked against Vercel), `generate-vercel-handlers.js`, `implement-vercel-handlers.py`; repo-wide grep of planning docs (`TOOL-NAMING-*`, `SIMPLIFIED_ARCHITECTURE.md`, `.augment/`), `free-agent-mcp` / `paid-agent-mcp` (mention Vercel only in prompts and code-generation hints, no tool calls) | `8d84fa13` (2025-11-16) |
| API | `Robinson-AI-Systems/robinsons-toolkit-api`: `api/tools.js` + `TOOLS-REGISTRY.json` (150 Vercel entries, same names as MS), `api/handlers/vercel.js` and `implemented-tools.txt` (34 implemented), `lib/vercel.js` (3 cases), `api/vercel/projects*`, `openapi*.{json,yaml}` (generic `/vercel/projects` routes) | `d7f7d9f7` (2025-11-10) |
| OPT | `robinsonai-mcp-servers` `archived/credit-optimizer-mcp/src/tools-index.json`: a generated create/get/list/update/delete grid over 10 nouns (51 names), most of them respellings of real tools | same as MS |
| DOC | Names that appear only in planning documents: `vercel_deploy`, `vercel_set_env_vars`, `vercel_get_deployment_status` (Agent Cortex seed SQL), `vercel_build` (optimizer README), `vercel_deploy_project` (naming plan), `vercel_project_create/get/list`, `vercel_search_projects` (naming standard examples), `vercel_deploy_workflow` (audit) | same as MS |
| Apps | `christcr2012/appliance-desk` (covered by `docs/APP-NEEDS-APPLIANCE-DESK.md`), `Cortiware` (`vercel.json` ×5, `.github/workflows/*`, `ops/vercel/*`, `.env.vercel.template`, `packages/kv`), `oldReplit` (`vercel.json`, `replit.md`, `.env.example`), `Household-Assistant` (`READ_ME.txt`) | `574fe981`, `49aca911`, `9395352e`, `ab896d24` |

Fragments that are not tool names (`vercel_token_here`, `vercel_projects__project_id_`, `vercel_blob_de` from a truncated
line, `vercel_cron` in a decision table, `vercel_ip` in the Cloudflare server) were excluded.

Evidence for "no such operation" verdicts: the 2026-10-10 reference index (research §1.2, 438 operations) and the
official generated SDK `@vercel/sdk` 1.28.43 from npm (434 operation functions; downloaded 2026-10-10, not vendored).

## 2. Summary

| | Count |
|---|---|
| Raw prior names (TK 181 · MS 150 · API 158 · OPT 51 · DOC 10, overlapping) | 301 |
| **Unique prior names** after normalizing respellings (28 OPT/DOC respellings folded into the real name) | **273** |
| Covered by a planned tool (including `vercel_where_is_setting` guided steps) | 211 |
| Covered only by the universal tools (`vercel_api_read` / `vercel_api_write`) | 7 |
| Deliberately dropped: 25 no public operation (invented or dashboard-less) · 10 removed products (KV, Postgres) · 4 removed endpoint (legacy secrets) · 2 deprecated/obsolete · 3 unsafe | 44 |
| **Gap → added** (11 prior names) | **9 new tools** |
| Cross-service compound tools that call Vercel (TK `compound.json`) | 15 — hub workflows (§5) |

**Added tools** (catalog, designs and work index updated in the same commit):

| New tool | Card | Prior name(s) | Why it is a real gap |
|---|---|---|---|
| `vercel_globalconfig_list_tokens` | E-4 (new) | `vercel_list_edge_config_tokens` | Knowing which read tokens exist for a store is a security question; `GET /v1/global-config/{id}/tokens` |
| `vercel_globalconfig_revoke_tokens` | E-4 | `vercel_delete_edge_config_token` | A leaked store token can only be stopped by revoking it; `DELETE /v1/global-config/{id}/tokens` |
| `vercel_globalconfig_get_schema` | E-4 | `vercel_get_edge_config_schema` | The schema decides which item writes Vercel accepts; `GET /v1/global-config/{id}/schema` |
| `vercel_globalconfig_set_schema` | E-4 | `vercel_update_edge_config_schema` | Protects live configuration from a malformed write; `PATCH`/`DELETE /v1/global-config/{id}/schema` |
| `vercel_drain_update` | M-2 | `vercel_pause_log_drain`, `vercel_resume_log_drain`, `vercel_update_log` | Pausing a costly or noisy drain without deleting it; `PATCH /v1/drains/{id}` (`status`, projects, sources, sampling) — listed in BATCH-M M2 but had no tool |
| `vercel_blob_list` | M-4 (new) | `vercel_blob_list` | Files in a Blob store (Appliance Desk has three stores); Blob API, not the REST reference |
| `vercel_blob_head` | M-4 | `vercel_blob_head` | One file's size, type and dates without downloading it |
| `vercel_blob_put` | M-4 | `vercel_blob_put` | Upload a small test or seed file while building |
| `vercel_blob_delete` | M-4 | `vercel_blob_delete` | Remove named files; destructive, refused on profiled apps' stores (Appliance Desk's runbook forbids casual deletion) |

Blob file tools were on the ROADMAP (BATCH-M M5) because they need a per-store credential; the gap check moves them into
scope as card M-4 with an owner input (IN-15) for which stores the server may reach and how their credential is entered
(setup page only). Since 2026-06-01 new Blob connections default to short-lived OIDC tokens
([changelog](https://vercel.com/changelog/vercel-blob-now-supports-oidc-authentication)), so M-4 starts with a
verify-before-starting check on how a server outside the app's project can reach a store (BATCH-M §0 M4).

**Notable findings**

- The MS/API generation (150 tools, all "OK" in `test-results-vercel.json`) contains **22 names for operations Vercel
  has no public API for** (middleware ×5, comments ×5, storage export/import/clone/optimize, uptime, integration
  logs/sync, alert creation, cron create/update/delete, Git sync), all dropped, plus deployment pause/resume (no such
  operation; mapped to project pause). The test file recorded "OK" without calling Vercel — the same
  overclaiming the Definition of Done forbids.
- **Preview comments** (toolbar threads) are the one capability with real value and no public API: the official Vercel
  connector exposes them, but neither the REST reference nor `@vercel/sdk` 1.28.43 has the operations. Recorded in
  ROADMAP; not faked.
- **Vercel KV and Vercel Postgres** tools (10 names) target products that moved to the Marketplace (Upstash Redis, Neon)
  in December 2024 ([Neon transition guide](https://neon.com/docs/guides/vercel-postgres-transition-guide)); covered by
  `vercel_integration_*` and the Neon server.
- **Legacy secrets** (4 names) and **Checks v1** (create/update/rerequest) are removed or deprecated endpoints.
- Unsafe prior tools stay dropped: decrypted env values (`vercel_get_env_var_value`, `vercel_pull_env_vars`) and the
  project OIDC token (`vercel_get_oidc_token`).

## 3. Mapping: every prior name → where it lives now

Origin codes as in §1. "covered" names the planned tool(s); "universal" means only `vercel_api_*` reaches it.

| Prior name | Origin | Verdict | New home | Note |
|---|---|---|---|---|
| `vercel_add_domain` (also `vercel_create_domain`) | TK MS API OPT | covered | `vercel_domain_add_to_team`, `vercel_domain_attach_to_project` |  |
| `vercel_add_project_member` | TK | covered | `vercel_project_add_member` |  |
| `vercel_add_protection_bypass` | TK | covered | `vercel_protection_create_bypass` | secret now shown once on the setup page (T3) |
| `vercel_assign_alias` (also `vercel_create_alias`) | TK MS API OPT | covered | `vercel_alias_assign` |  |
| `vercel_audit_project_config` | TK | covered | `vercel_workflow_project_health`, `vercel_dev_check_integration` |  |
| `vercel_blob_delete` | MS API | GAP → added | `vercel_blob_delete` (M-4) | Blob API `del` |
| `vercel_blob_head` | MS API | GAP → added | `vercel_blob_head` (M-4) | Blob API `head` |
| `vercel_blob_list` | MS API | GAP → added | `vercel_blob_list` (M-4) | Blob API (`@vercel/blob` `list`), not the REST reference |
| `vercel_blob_put` | MS API | GAP → added | `vercel_blob_put` (M-4) | Blob API `put` |
| `vercel_block_ip` | TK MS API | covered | `vercel_firewall_block_ip` |  |
| `vercel_bulk_create_env_vars` (also `vercel_set_env_vars`) | TK MS API DOC | covered | `vercel_env_set_many` |  |
| `vercel_bulk_delete_env_vars` | TK | covered | `vercel_env_delete_many` |  |
| `vercel_buy_domain` | TK | covered | `vercel_registrar_buy` | now `$` with quote, confirm and spend limit (T2) |
| `vercel_cancel_deployment` | TK MS API | covered | `vercel_deploy_cancel` |  |
| `vercel_check_domain_availability` | TK | covered | `vercel_registrar_search` |  |
| `vercel_clone_storage` | MS API | dropped | — | invented: no such operations in the REST reference or the Blob API |
| `vercel_connect_git_repository` | MS API | covered | `vercel_where_is_setting` (guided) | no API to connect/disconnect Git on an existing project (research §1.4); create-time link via `vercel_project_create` |
| `vercel_copy_env_var` | TK | covered | `vercel_env_copy` | server-side copy; Secrets refused (T11) |
| `vercel_copy_project_env_vars` | TK | covered | `vercel_env_copy` | server-side copy; Secrets refused (T11) |
| `vercel_cost_forecast` | TK | covered | `vercel_workflow_cost_check`, `vercel_admin_cost_review` |  |
| `vercel_create_alert` | MS API | dropped | — | no alert-creation operation in the REST reference (`@vercel/sdk` 1.28.43 has none); spend alerts are guided (IN-12) |
| `vercel_create_cert` | OPT | covered | `vercel_cert_issue` |  |
| `vercel_create_check` | TK MS API | universal | `vercel_api_write` | Checks V2 run writes are for integration providers (their own token); v1 checks deprecated (`@vercel/sdk` 1.28.43 marks them `@deprecated`) |
| `vercel_create_comment` | MS API | dropped | — | no public API: preview comments (toolbar threads) are absent from the REST reference and `@vercel/sdk` 1.28.43; the official connector reaches them through its own backend (ROADMAP) |
| `vercel_create_cron_job` | MS API | dropped | — | no API: crons are defined in `vercel.json` in the app's code (change them with the GitHub server); enable/disable is guided |
| `vercel_create_custom_header` | MS API | covered | `vercel_route_stage` + `vercel_route_publish` |  |
| `vercel_create_deployment` (also `vercel_build`, `vercel_deploy`, `vercel_deploy_project`) | TK MS API OPT DOC | covered | `vercel_deploy_create_from_git`, `vercel_deploy_create_from_files` |  |
| `vercel_create_deployment_hook` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation (research §1.4) |
| `vercel_create_dns_record` | TK MS API | covered | `vercel_dns_create_record` |  |
| `vercel_create_edge_config` | TK MS API | covered | `vercel_globalconfig_create` |  |
| `vercel_create_edge_config_token` | TK | covered | `vercel_globalconfig_create_token` |  |
| `vercel_create_env_var` | TK MS API OPT | covered | `vercel_env_set` | target now required; Secret by default (T6) |
| `vercel_create_firewall_rule` | MS API | covered | `vercel_firewall_add_rule` |  |
| `vercel_create_log_drain` (also `vercel_create_log`) | TK OPT | covered | `vercel_drain_create` |  |
| `vercel_create_project` (also `vercel_project_create`) | TK MS API OPT DOC | covered | `vercel_project_create` |  |
| `vercel_create_redirect` | MS API | covered | `vercel_redirect_stage` + `vercel_redirect_publish` |  |
| `vercel_create_secret` | TK MS API | dropped | — | removed endpoint: legacy `/v2/secrets`, `/v3/secrets` sunset and absent from the reference (research §2.3); Secret-kind env vars replace them |
| `vercel_create_team` | TK API OPT | universal | `vercel_api_write` | each connection is bound to one team (A-3); a new team gets its own login; rare |
| `vercel_create_webhook` | TK MS API OPT | covered | `vercel_webhook_create` |  |
| `vercel_delete_alias` | TK MS API OPT | covered | `vercel_alias_delete` |  |
| `vercel_delete_cert` | OPT | covered | `vercel_cert_remove` |  |
| `vercel_delete_comment` | MS API | dropped | — | no public API: preview comments (toolbar threads) are absent from the REST reference and `@vercel/sdk` 1.28.43; the official connector reaches them through its own backend (ROADMAP) |
| `vercel_delete_cron_job` | MS API | dropped | — | no API: crons are defined in `vercel.json` in the app's code (change them with the GitHub server); enable/disable is guided |
| `vercel_delete_custom_header` | MS API | covered | `vercel_route_stage` + `vercel_route_publish` |  |
| `vercel_delete_deployment` | TK MS API OPT | covered | `vercel_deploy_delete` |  |
| `vercel_delete_deployment_hook` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation (research §1.4) |
| `vercel_delete_dns_record` | TK MS API | covered | `vercel_dns_delete_record` |  |
| `vercel_delete_edge_config` | TK | covered | `vercel_globalconfig_delete` |  |
| `vercel_delete_edge_config_items` | TK | covered | `vercel_globalconfig_patch_items` |  |
| `vercel_delete_edge_config_token` | TK | GAP → added | `vercel_globalconfig_revoke_tokens` (E-4) | `DELETE /v1/global-config/{id}/tokens` |
| `vercel_delete_env_var` | TK MS API OPT | covered | `vercel_env_delete` |  |
| `vercel_delete_firewall_rule` | MS API | covered | `vercel_firewall_remove_rule` |  |
| `vercel_delete_log_drain` (also `vercel_delete_log`) | TK OPT | covered | `vercel_drain_delete` |  |
| `vercel_delete_project` | TK MS API OPT | covered | `vercel_project_delete` |  |
| `vercel_delete_protection_bypass` | TK | covered | `vercel_protection_revoke_bypass` |  |
| `vercel_delete_redirect` | MS API | covered | `vercel_redirect_stage` + `vercel_redirect_publish` |  |
| `vercel_delete_secret` | TK MS API | dropped | — | removed endpoint: legacy `/v2/secrets`, `/v3/secrets` sunset and absent from the reference (research §2.3); Secret-kind env vars replace them |
| `vercel_delete_team` | API OPT | covered | `vercel_where_is_setting` (guided) | API exists; deliberately never automated (research §1.4) |
| `vercel_delete_webhook` | TK MS API OPT | covered | `vercel_webhook_delete` |  |
| `vercel_deploy_and_wait` | TK | covered | `vercel_workflow_deploy_and_wait` |  |
| `vercel_deploy_middleware` | MS API | dropped | — | invented: no middleware operations exist; middleware ships inside a deployment, its logs are runtime logs (`vercel_deploy_get_runtime_logs`, `vercel_logs_query`) |
| `vercel_deploy_workflow` | DOC | covered | `vercel_workflow_deploy_and_wait` | name from a planning audit |
| `vercel_disconnect_git_repository` | MS API | covered | `vercel_where_is_setting` (guided) | no API to connect/disconnect Git on an existing project (research §1.4); create-time link via `vercel_project_create` |
| `vercel_emergency_rollback` | TK | covered | `vercel_workflow_emergency_rollback` |  |
| `vercel_enable_attack_challenge_mode` | MS API | covered | `vercel_firewall_set_attack_mode` |  |
| `vercel_encrypt_env_var` | TK | dropped | — | obsolete: env kinds are now Config/Secret, chosen in `vercel_env_set` (research §1.3) |
| `vercel_export_audit_logs` | MS API | covered | `vercel_activity_list`; audit log via Audit Log Drains (`vercel_drain_*`) and guided | old paths invented; audit log export moved to Audit Log Drains 2026-06-30 (research §1.4) |
| `vercel_export_blob_data` | MS API | dropped | — | invented: no such operations in the REST reference or the Blob API |
| `vercel_export_usage_report` | MS API | covered | `vercel_billing_summary`, `vercel_billing_list_charges` | FOCUS charges; old paths invented (T9) |
| `vercel_find_deployment_by_url` | TK | covered | `vercel_deploy_get` (by URL), `vercel_workflow_find` |  |
| `vercel_full_deployment_report` | TK | covered | `vercel_deploy_get`, `vercel_workflow_why_did_build_fail` |  |
| `vercel_get_access_group` | TK | covered | `vercel_access_group_get` |  |
| `vercel_get_alias` | TK API OPT | covered | `vercel_alias_get` |  |
| `vercel_get_attack_challenge_mode` | TK | covered | `vercel_firewall_attack_status` |  |
| `vercel_get_audit_log` | MS API | covered | `vercel_activity_list`; audit log via Audit Log Drains (`vercel_drain_*`) and guided | old paths invented; audit log export moved to Audit Log Drains 2026-06-30 (research §1.4) |
| `vercel_get_bandwidth_usage` | TK MS API | covered | `vercel_logs_query` | Observability query (`POST /v2/observability/query`); old paths were invented (§2.3) |
| `vercel_get_billing_summary` | TK MS API | covered | `vercel_billing_summary`, `vercel_billing_list_charges` | FOCUS charges; old paths invented (T9) |
| `vercel_get_build_logs` | TK MS API | covered | `vercel_deploy_get_build_logs` |  |
| `vercel_get_cache_metrics` | MS API | covered | `vercel_logs_query` | Observability query (`POST /v2/observability/query`); old paths were invented (§2.3) |
| `vercel_get_cert` | OPT | covered | `vercel_cert_list` |  |
| `vercel_get_compliance_report` | MS API | covered | `vercel_activity_list`; audit log via Audit Log Drains (`vercel_drain_*`) and guided | old paths invented; audit log export moved to Audit Log Drains 2026-06-30 (research §1.4) |
| `vercel_get_cost_breakdown` | MS API | covered | `vercel_billing_summary`, `vercel_billing_list_charges` | FOCUS charges; old paths invented (T9) |
| `vercel_get_cron_job` | TK | covered | `vercel_cron_list` |  |
| `vercel_get_deployment` (also `vercel_get_deployment_status`) | TK MS API OPT DOC | covered | `vercel_deploy_get` |  |
| `vercel_get_deployment_aliases` | TK | covered | `vercel_alias_list` (by deployment) |  |
| `vercel_get_deployment_checks` | TK | covered | `vercel_check_list_runs`, `vercel_check_get_run`, `vercel_check_list_project_checks` |  |
| `vercel_get_deployment_diff` | MS API | covered | `vercel_workflow_release_status` + `vercel_deploy_get` | no Vercel "compare deployments" operation; commits waiting and both deployments' details cover it |
| `vercel_get_deployment_events` | TK MS API | covered | `vercel_deploy_get_build_logs` |  |
| `vercel_get_deployment_file` | MS API | covered | `vercel_deploy_get_file` |  |
| `vercel_get_deployment_health` | TK MS API | covered | `vercel_workflow_project_health` |  |
| `vercel_get_deployment_logs` | TK MS API OPT | covered | `vercel_deploy_get_runtime_logs` |  |
| `vercel_get_domain` | TK MS API OPT | covered | `vercel_domain_get` |  |
| `vercel_get_domain_config` | TK API | covered | `vercel_domain_check_config` |  |
| `vercel_get_domain_price` | TK | covered | `vercel_registrar_get_price` |  |
| `vercel_get_domain_ssl` | TK | covered | `vercel_cert_list` |  |
| `vercel_get_edge_config` | TK | covered | `vercel_globalconfig_list` |  |
| `vercel_get_edge_config_item` | TK | covered | `vercel_globalconfig_list_items` |  |
| `vercel_get_edge_config_items` | TK MS API | covered | `vercel_globalconfig_list_items` |  |
| `vercel_get_edge_config_schema` | TK | GAP → added | `vercel_globalconfig_get_schema` (E-4) | `GET /v1/global-config/{id}/schema` |
| `vercel_get_env_var` | TK API OPT | covered | `vercel_env_get` (metadata only) |  |
| `vercel_get_env_var_value` | TK | dropped | — | unsafe: returns decrypted secret values to the agent (T3, E1); names-only `vercel_env_export_names` covers the safe part; viewing a value is a guided step on the setup page |
| `vercel_get_error_logs` | MS API | covered | `vercel_logs_errors_summary`, `vercel_logs_query` |  |
| `vercel_get_error_rate` | MS API | covered | `vercel_logs_errors_summary`, `vercel_logs_query` |  |
| `vercel_get_firewall_analytics` | MS API | covered | `vercel_firewall_list_events` |  |
| `vercel_get_firewall_config` | TK | covered | `vercel_firewall_get` |  |
| `vercel_get_function_invocations` | TK MS API | covered | `vercel_logs_query` | Observability query (`POST /v2/observability/query`); old paths were invented (§2.3) |
| `vercel_get_git_integration_status` | TK MS API | covered | `vercel_project_get` (Git repo and production branch) |  |
| `vercel_get_integration` | TK MS API OPT | covered | `vercel_integration_get` |  |
| `vercel_get_integration_logs` | MS API | dropped | — | invented: no such operations |
| `vercel_get_invoice` | MS API | covered | `vercel_where_is_setting` (guided) | no REST operation for invoices as documents, payment methods or plan changes (research §1.4) |
| `vercel_get_kv_store` | TK | dropped | — | removed product: Vercel KV moved to Upstash Redis on the Marketplace (Dec 2024); stores are reached through `vercel_integration_*` and the Upstash API |
| `vercel_get_latest_deployment` | TK | covered | `vercel_deploy_list` |  |
| `vercel_get_log_drain` (also `vercel_get_log`) | TK OPT | covered | `vercel_drain_list` |  |
| `vercel_get_middleware_logs` | MS API | dropped | — | invented: no middleware operations exist; middleware ships inside a deployment, its logs are runtime logs (`vercel_deploy_get_runtime_logs`, `vercel_logs_query`) |
| `vercel_get_middleware_metrics` | MS API | dropped | — | invented: no middleware operations exist; middleware ships inside a deployment, its logs are runtime logs (`vercel_deploy_get_runtime_logs`, `vercel_logs_query`) |
| `vercel_get_notification_settings` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation |
| `vercel_get_oidc_token` | TK | dropped | — | unsafe: returns a credential (`POST /v1/projects/{id}/token`), never wrapped (research §1.2) |
| `vercel_get_payment_methods` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation for invoices as documents, payment methods or plan changes (research §1.4) |
| `vercel_get_performance_insights` | MS API | covered | `vercel_logs_query` | Observability query (`POST /v2/observability/query`); old paths were invented (§2.3) |
| `vercel_get_project` (also `vercel_project_get`) | TK MS API OPT DOC | covered | `vercel_project_get` |  |
| `vercel_get_project_analytics` | TK MS API | covered | `vercel_analytics_pageviews` |  |
| `vercel_get_project_domain` | TK | covered | `vercel_domain_list_project_domains` |  |
| `vercel_get_project_domains_config` | TK | covered | `vercel_domain_check_config` |  |
| `vercel_get_project_env_by_key` | TK | covered | `vercel_env_get` (metadata only) |  |
| `vercel_get_project_git_info` | TK | covered | `vercel_project_get` |  |
| `vercel_get_project_protection` | TK | covered | `vercel_protection_get` |  |
| `vercel_get_project_summary` | TK | covered | `vercel_project_get` |  |
| `vercel_get_response_time` | MS API | covered | `vercel_logs_query` | Observability query (`POST /v2/observability/query`); old paths were invented (§2.3) |
| `vercel_get_runtime_logs` | TK | covered | `vercel_deploy_get_runtime_logs` |  |
| `vercel_get_runtime_logs_stream` | MS API | covered | `vercel_dev_tail_logs` | no streaming in a serverless call; cursor-based tail instead |
| `vercel_get_security_events` | MS API | covered | `vercel_firewall_list_events` |  |
| `vercel_get_security_headers` | MS API | covered | `vercel_route_list` | headers are routing rules (Project Routes) |
| `vercel_get_skew_protection` | TK | covered | `vercel_project_get` / `vercel_project_update_settings` |  |
| `vercel_get_speed_insights` | TK | covered | `vercel_analytics_set_speed_insights` (toggle) | no REST read of Speed Insights data; scores are read in the dashboard or through a drain |
| `vercel_get_spend_summary` | TK | covered | `vercel_billing_summary`, `vercel_billing_list_charges` | FOCUS charges; old paths invented (T9) |
| `vercel_get_spending_limits` | MS API | covered | `vercel_where_is_setting` (guided Spend Management, IN-12) | no REST operation |
| `vercel_get_storage_usage` | MS API | covered | `vercel_storage_get_store`, `vercel_billing_list_charges` |  |
| `vercel_get_team` | TK MS API OPT | covered | `vercel_team_get` |  |
| `vercel_get_team_access_requests` | TK | universal | `vercel_api_read` | `GET /v1/teams/{teamId}/request/{userId}`; approving is `vercel_member_update_role` |
| `vercel_get_team_activity` | MS API | covered | `vercel_activity_list` |  |
| `vercel_get_team_audit_log` | TK | covered | `vercel_activity_list`; audit log via Audit Log Drains (`vercel_drain_*`) and guided | old paths invented; audit log export moved to Audit Log Drains 2026-06-30 (research §1.4) |
| `vercel_get_team_billing_plan` | TK | covered | `vercel_team_get` |  |
| `vercel_get_team_config` | TK | covered | `vercel_team_get` |  |
| `vercel_get_team_invoice` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation for invoices as documents, payment methods or plan changes (research §1.4) |
| `vercel_get_team_saml_config` | TK | covered | `vercel_team_get` / `vercel_team_update_security` (`saml.enforced`); IdP connection guided |  |
| `vercel_get_team_usage` | MS API | covered | `vercel_billing_summary`, `vercel_billing_list_charges` | FOCUS charges; old paths invented (T9) |
| `vercel_get_top_pages` | TK | covered | `vercel_analytics_pageviews` |  |
| `vercel_get_traces` | MS API | universal | `vercel_api_read` | real op is `GET /v1/projects/traces` by CLI request ID (narrow; ROADMAP) |
| `vercel_get_uptime_metrics` | MS API | dropped | — | invented: Vercel has no uptime metric; `vercel_dev_fetch_preview` / `vercel_logs_query` (5xx rate) cover the need |
| `vercel_get_usage_metrics` | TK MS API | covered | `vercel_logs_query` | Observability query (`POST /v2/observability/query`); old paths were invented (§2.3) |
| `vercel_get_user` | TK | covered | `vercel_whoami`, `vercel_check_token` |  |
| `vercel_get_waf_active_rules` | TK | covered | `vercel_firewall_get` |  |
| `vercel_get_web_vitals` | TK MS API | covered | `vercel_analytics_set_speed_insights` (toggle) | no REST read of Speed Insights data; scores are read in the dashboard or through a drain |
| `vercel_get_webhook` | OPT | covered | `vercel_webhook_list` |  |
| `vercel_import_blob_data` | MS API | dropped | — | invented: no such operations in the REST reference or the Blob API |
| `vercel_install_integration` (also `vercel_create_integration`) | MS API OPT | covered | `vercel_integration_create_store`; consent-screen installs guided (M4) |  |
| `vercel_invite_team_member` | TK MS API | covered | `vercel_member_invite` |  |
| `vercel_issue_domain_ssl` | TK | covered | `vercel_cert_issue` |  |
| `vercel_kv_delete` | MS API | dropped | — | removed product: Vercel KV moved to Upstash Redis on the Marketplace (Dec 2024); stores are reached through `vercel_integration_*` and the Upstash API |
| `vercel_kv_get` | MS API | dropped | — | removed product: Vercel KV moved to Upstash Redis on the Marketplace (Dec 2024); stores are reached through `vercel_integration_*` and the Upstash API |
| `vercel_kv_list_keys` | MS API | dropped | — | removed product: Vercel KV moved to Upstash Redis on the Marketplace (Dec 2024); stores are reached through `vercel_integration_*` and the Upstash API |
| `vercel_kv_set` | MS API | dropped | — | removed product: Vercel KV moved to Upstash Redis on the Marketplace (Dec 2024); stores are reached through `vercel_integration_*` and the Upstash API |
| `vercel_link_git_repository` | TK | covered | `vercel_where_is_setting` (guided) | no API to connect/disconnect Git on an existing project (research §1.4); create-time link via `vercel_project_create` |
| `vercel_list_access_events` | MS API | covered | `vercel_activity_list`; audit log via Audit Log Drains (`vercel_drain_*`) and guided | old paths invented; audit log export moved to Audit Log Drains 2026-06-30 (research §1.4) |
| `vercel_list_access_groups` | TK | covered | `vercel_access_group_list` |  |
| `vercel_list_aliases` (also `vercel_list_alias`) | TK MS API OPT | covered | `vercel_alias_list` |  |
| `vercel_list_attack_events` | TK | covered | `vercel_firewall_list_events` |  |
| `vercel_list_audit_logs` | MS API | covered | `vercel_activity_list`; audit log via Audit Log Drains (`vercel_drain_*`) and guided | old paths invented; audit log export moved to Audit Log Drains 2026-06-30 (research §1.4) |
| `vercel_list_blocked_ips` | TK MS API | covered | `vercel_firewall_get` (IP blocks) |  |
| `vercel_list_cert` | OPT | covered | `vercel_cert_list` |  |
| `vercel_list_checks` | TK MS API | covered | `vercel_check_list_runs`, `vercel_check_get_run`, `vercel_check_list_project_checks` |  |
| `vercel_list_comments` | MS API | dropped | — | no public API: preview comments (toolbar threads) are absent from the REST reference and `@vercel/sdk` 1.28.43; the official connector reaches them through its own backend (ROADMAP) |
| `vercel_list_cron_jobs` | TK MS API | covered | `vercel_cron_list` |  |
| `vercel_list_custom_headers` | MS API | covered | `vercel_route_list` | headers are routing rules (Project Routes) |
| `vercel_list_deployment_files` | TK MS API | covered | `vercel_deploy_list_files` |  |
| `vercel_list_deployment_hooks` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation (research §1.4) |
| `vercel_list_deployment_regions` | TK | covered | `vercel_deploy_get` |  |
| `vercel_list_deployments` (also `vercel_list_deployment`) | TK MS API OPT | covered | `vercel_deploy_list` |  |
| `vercel_list_deployments_for_commit` | TK | covered | `vercel_deploy_list` |  |
| `vercel_list_dns_records` | TK MS API | covered | `vercel_dns_list` |  |
| `vercel_list_domain_nameservers` | TK | covered | `vercel_domain_get` |  |
| `vercel_list_domains` (also `vercel_list_domain`) | TK MS API OPT | covered | `vercel_domain_list` |  |
| `vercel_list_edge_config_tokens` | TK | GAP → added | `vercel_globalconfig_list_tokens` (E-4) | `GET /v1/global-config/{id}/tokens` |
| `vercel_list_edge_configs` | TK MS API | covered | `vercel_globalconfig_list` |  |
| `vercel_list_env_vars` (also `vercel_list_env_var`) | TK MS API OPT | covered | `vercel_env_list` |  |
| `vercel_list_firewall_rules` | MS API | covered | `vercel_firewall_get` |  |
| `vercel_list_git_repositories` | TK MS API | covered | `vercel_git_list_namespaces`, `vercel_git_search_repos` |  |
| `vercel_list_integration_configurations` | MS API | covered | `vercel_integration_list` |  |
| `vercel_list_integrations` (also `vercel_list_integration`) | TK MS API OPT | covered | `vercel_integration_list` |  |
| `vercel_list_invoices` | TK MS API | covered | `vercel_where_is_setting` (guided) | no REST operation for invoices as documents, payment methods or plan changes (research §1.4) |
| `vercel_list_kv_stores` | TK | dropped | — | removed product: Vercel KV moved to Upstash Redis on the Marketplace (Dec 2024); stores are reached through `vercel_integration_*` and the Upstash API |
| `vercel_list_log_drains` (also `vercel_list_log`) | TK OPT | covered | `vercel_drain_list` |  |
| `vercel_list_middleware` | MS API | dropped | — | invented: no middleware operations exist; middleware ships inside a deployment, its logs are runtime logs (`vercel_deploy_get_runtime_logs`, `vercel_logs_query`) |
| `vercel_list_page_views` | TK | covered | `vercel_analytics_pageviews` |  |
| `vercel_list_project_activity` | TK | covered | `vercel_activity_list` (project filter) |  |
| `vercel_list_project_builds` | TK | covered | `vercel_deploy_list` |  |
| `vercel_list_project_domains` | TK | covered | `vercel_domain_list_project_domains` |  |
| `vercel_list_project_members` | TK | covered | `vercel_project_list_members` |  |
| `vercel_list_projects` (also `vercel_list_project`, `vercel_project_list`, `vercel_search_projects`) | TK MS API OPT DOC | covered | `vercel_project_list` |  |
| `vercel_list_protection_bypasses` | TK | covered | `vercel_protection_list_bypass` |  |
| `vercel_list_redirects` | MS API | covered | `vercel_redirect_list` |  |
| `vercel_list_secrets` | TK MS API | dropped | — | removed endpoint: legacy `/v2/secrets`, `/v3/secrets` sunset and absent from the reference (research §2.3); Secret-kind env vars replace them |
| `vercel_list_team_members` (also `vercel_get_team_members`) | TK MS API | covered | `vercel_member_list` |  |
| `vercel_list_teams` (also `vercel_list_team`) | TK MS API OPT | covered | `vercel_team_list` |  |
| `vercel_list_user_events` | TK | covered | `vercel_activity_list` |  |
| `vercel_list_webhooks` (also `vercel_list_webhook`) | TK MS API OPT | covered | `vercel_webhook_list` |  |
| `vercel_optimize_storage` | MS API | dropped | — | invented: no such operations in the REST reference or the Blob API |
| `vercel_pause_deployment` | MS API | covered | `vercel_project_pause` / `vercel_project_unpause` | Vercel pauses projects, not single deployments |
| `vercel_pause_log_drain` | TK | GAP → added | `vercel_drain_update` (M-2) | `PATCH /v1/drains/{id}` `status` enabled/disabled |
| `vercel_pause_project` | TK API | covered | `vercel_project_pause` |  |
| `vercel_postgres_create_database` | MS API | dropped | — | removed product: Vercel Postgres moved to Neon (Neon transition guide); covered by the Neon server and `vercel_integration_*`; a connection string is a secret |
| `vercel_postgres_delete_database` | MS API | dropped | — | removed product: Vercel Postgres moved to Neon (Neon transition guide); covered by the Neon server and `vercel_integration_*`; a connection string is a secret |
| `vercel_postgres_get_connection_string` | MS API | dropped | — | removed product: Vercel Postgres moved to Neon (Neon transition guide); covered by the Neon server and `vercel_integration_*`; a connection string is a secret |
| `vercel_postgres_list_databases` | MS API | dropped | — | removed product: Vercel Postgres moved to Neon (Neon transition guide); covered by the Neon server and `vercel_integration_*`; a connection string is a secret |
| `vercel_promote_deployment` | TK MS API | covered | `vercel_deploy_promote` |  |
| `vercel_promote_env_var_to_production` | TK | covered | `vercel_env_copy` | server-side copy; Secrets refused (T11) |
| `vercel_pull_env_vars` | TK | dropped | — | unsafe: returns decrypted secret values to the agent (T3, E1); names-only `vercel_env_export_names` covers the safe part; viewing a value is a guided step on the setup page |
| `vercel_redeploy` | TK MS API | covered | `vercel_deploy_redeploy` | old one hit the wrong endpoint and defaulted to production (T4) |
| `vercel_remove_domain` (also `vercel_delete_domain`) | TK MS API OPT | covered | `vercel_domain_remove_from_team`, `vercel_domain_detach_from_project` |  |
| `vercel_remove_project_member` | TK | covered | `vercel_project_remove_member` |  |
| `vercel_remove_team_member` | TK MS API | covered | `vercel_member_remove` |  |
| `vercel_rename_secret` | MS API | dropped | — | removed endpoint: legacy `/v2/secrets`, `/v3/secrets` sunset and absent from the reference (research §2.3); Secret-kind env vars replace them |
| `vercel_rerun_deployment_check` | TK | dropped | — | only on deprecated Checks v1 (`POST /v1/deployments/{id}/checks/{checkId}/rerequest`, `@deprecated` in `@vercel/sdk` 1.28.43); Checks V2 has no rerequest — `vercel_deploy_redeploy` reruns checks |
| `vercel_resolve_comment` | MS API | dropped | — | no public API: preview comments (toolbar threads) are absent from the REST reference and `@vercel/sdk` 1.28.43; the official connector reaches them through its own backend (ROADMAP) |
| `vercel_resume_deployment` | MS API | covered | `vercel_project_pause` / `vercel_project_unpause` | Vercel pauses projects, not single deployments |
| `vercel_resume_log_drain` | TK | GAP → added | `vercel_drain_update` (M-2) | `PATCH /v1/drains/{id}` `status` enabled/disabled |
| `vercel_rollback_deployment` | TK MS API | covered | `vercel_deploy_rollback` | old one used promote and guessed (T5) |
| `vercel_rotate_env_and_redeploy` | TK | covered | `vercel_workflow_rotate_secret` |  |
| `vercel_safe_promote_to_production` | TK | covered | `vercel_workflow_ship_to_production` |  |
| `vercel_scan_deployment_security` | MS API | covered | `vercel_workflow_security_audit`, `vercel_admin_review_security` |  |
| `vercel_security_audit` | TK | covered | `vercel_workflow_security_audit`, `vercel_admin_review_security` |  |
| `vercel_setup_custom_domain` | TK | covered | `vercel_workflow_setup_custom_domain` |  |
| `vercel_sync_env_between_targets` | TK | covered | `vercel_workflow_env_sync` |  |
| `vercel_sync_git_repository` | MS API | dropped | — | invented: no such Vercel operation; a push or `vercel_deploy_create_from_git` is the real thing |
| `vercel_test_middleware` | MS API | dropped | — | invented: no middleware operations exist; middleware ships inside a deployment, its logs are runtime logs (`vercel_deploy_get_runtime_logs`, `vercel_logs_query`) |
| `vercel_transfer_domain` | TK | covered | `vercel_registrar_transfer_in` |  |
| `vercel_trigger_cron_job` | TK MS API | covered | `vercel_where_is_setting` (guided "run now") | no REST operation (research §1.4); handler was unreachable (T1) |
| `vercel_trigger_integration_sync` | MS API | dropped | — | invented: no such operations |
| `vercel_unblock_ip` | TK MS API | covered | `vercel_firewall_unblock_ip` |  |
| `vercel_uninstall_integration` (also `vercel_delete_integration`) | MS API OPT | covered | `vercel_integration_remove` |  |
| `vercel_unlink_git_repository` | TK | covered | `vercel_where_is_setting` (guided) | no API to connect/disconnect Git on an existing project (research §1.4); create-time link via `vercel_project_create` |
| `vercel_unpause_project` | TK API | covered | `vercel_project_unpause` |  |
| `vercel_update_alias` | OPT | covered | `vercel_alias_assign` | no alias update operation; re-assign |
| `vercel_update_attack_challenge_mode` | TK | covered | `vercel_firewall_set_attack_mode` |  |
| `vercel_update_cert` | OPT | dropped | — | no certificate update operation (Certs section: list/get/issue/upload/remove); re-issue instead |
| `vercel_update_check` | TK MS API | universal | `vercel_api_write` | Checks V2 run writes are for integration providers (their own token); v1 checks deprecated (`@vercel/sdk` 1.28.43 marks them `@deprecated`) |
| `vercel_update_comment` | MS API | dropped | — | no public API: preview comments (toolbar threads) are absent from the REST reference and `@vercel/sdk` 1.28.43; the official connector reaches them through its own backend (ROADMAP) |
| `vercel_update_cron_job` | MS API | dropped | — | no API: crons are defined in `vercel.json` in the app's code (change them with the GitHub server); enable/disable is guided |
| `vercel_update_deployment` | OPT | dropped | — | no such operation: deployments are immutable |
| `vercel_update_dns_record` | TK | covered | `vercel_dns_update_record` |  |
| `vercel_update_domain` | OPT | covered | `vercel_domain_update` |  |
| `vercel_update_edge_config_items` | TK MS API | covered | `vercel_globalconfig_patch_items` |  |
| `vercel_update_edge_config_schema` | TK | GAP → added | `vercel_globalconfig_set_schema` (E-4) | `PATCH`/`DELETE /v1/global-config/{id}/schema` |
| `vercel_update_env_var` | TK MS API OPT | covered | `vercel_env_set` | target now required; Secret by default (T6) |
| `vercel_update_firewall_rule` | TK MS API | covered | `vercel_firewall_update_rule` |  |
| `vercel_update_integration` | OPT | universal | `vercel_api_write` | rare; provider-specific |
| `vercel_update_integration_configuration` | MS API | universal | `vercel_api_write` | rare; provider-specific |
| `vercel_update_log` | OPT | GAP → added | `vercel_drain_update` (M-2) | synthetic CRUD name for a log drain update |
| `vercel_update_notification_settings` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation |
| `vercel_update_project` | TK MS API OPT | covered | `vercel_project_update_settings` | build resources split out to `vercel_project_set_build_resources` |
| `vercel_update_project_domain` | TK | covered | `vercel_domain_update_project_domain` |  |
| `vercel_update_project_protection` | TK | covered | `vercel_protection_set_vercel_auth`, `vercel_protection_set_password`, `vercel_protection_set_trusted_ips` |  |
| `vercel_update_security_headers` | MS API | covered | `vercel_route_stage` + `vercel_route_publish` |  |
| `vercel_update_skew_protection` | TK | covered | `vercel_project_get` / `vercel_project_update_settings` |  |
| `vercel_update_spending_limits` | MS API | covered | `vercel_where_is_setting` (guided Spend Management, IN-12) | no REST operation |
| `vercel_update_team` | API OPT | covered | `vercel_team_update_profile` |  |
| `vercel_update_team_config` | TK | covered | `vercel_team_update_security`, `vercel_team_set_default_protection` |  |
| `vercel_update_team_member_role` (also `vercel_update_team_member`) | TK MS API | covered | `vercel_member_update_role` |  |
| `vercel_update_team_saml_config` | TK | covered | `vercel_team_get` / `vercel_team_update_security` (`saml.enforced`); IdP connection guided |  |
| `vercel_update_webhook` | OPT | dropped | — | no webhook update operation (Webhooks: list/get/create/delete); delete and re-create |
| `vercel_upgrade_plan` | TK | covered | `vercel_where_is_setting` (guided) | no REST operation for invoices as documents, payment methods or plan changes (research §1.4) |
| `vercel_verify_domain` | TK MS API | covered | `vercel_domain_verify_project_domain` |  |
| `vercel_wait_for_deployment` | TK | covered | `vercel_deploy_wait` |  |

## 4. Needs found in other projects

| Project | What it needs from Vercel | Covered by |
|---|---|---|
| **Appliance Desk** | Full table in `docs/APP-NEEDS-APPLIANCE-DESK.md` (release by `live` branch, build-time migrations, ignored builds and no-preview branches, ten crons, three Blob stores, injected Blob tokens, persistent Sandbox) | Batch P profile; the new Blob file tools respect its "never clean up a store by browsing and deleting" rule (`vercel_blob_delete` refused on its stores without `outsideApp`) |
| **Cortiware** (monorepo, 4–5 Vercel projects) | One project per app with **root directory** `apps/<name>` and `turbo-ignore` ignored-build commands; cross-project **rewrites** and a permanent **redirect** in `vercel.json`; **wildcard domain** `*.cortiware.com` on the tenant app (needs Vercel nameservers); **crons** (4 at the root, 1 in provider-portal); the same session secrets in several projects ("env groups"); CI waits for the Vercel preview then runs E2E (`wait-for-vercel-preview`), a scheduled smoke test against the `git-main` branch URL; Redis through `@vercel/kv` / `KV_REDIS_URL` | `vercel_project_create` / `vercel_project_update_settings` (root directory, ignored-build step); rewrites/redirects stay in code (or `vercel_route_*` / `vercel_redirect_*`); `vercel_domain_attach_to_project` + `vercel_workflow_setup_custom_domain` (wildcard: the preview says Vercel DNS is required); `vercel_cron_list`; `vercel_shared_env_*`; `vercel_deploy_wait`, `vercel_dev_preview_branch`, `vercel_dev_fetch_preview`; KV → Upstash via `vercel_integration_*`. No gap. |
| **oldReplit** (Mountain Vista) | One cron in `vercel.json`; env names for Stripe, OpenAI, SendGrid, Twilio, a cron token; "GitHub/Vercel/Neon workflow" | `vercel_cron_list`, `vercel_env_*`, `vercel_profile_draft`. No gap. |
| **Household-Assistant** | Design document only (Google/Apple login, multi-tenant assistant); no Vercel configuration or need stated | Nothing to add |

## 5. Compound tools that call Vercel (TK `registry/compound.json`, ClaudeBuildPlan)

`compound_safe_deploy`, `compound_incident_response`, `compound_project_health_check`, `compound_deploy_and_release`,
`compound_validate_env_vars`, `compound_full_health_dashboard`, `compound_standup_summary`, `compound_deploy_and_announce`,
`compound_full_feature_deploy`, `compound_hotfix_deploy`, `compound_staging_refresh`, `compound_provision_new_project`,
`compound_weekly_engineering_report`, `compound_deploy_with_auto_rollback`, `compound_pipeline_status` (15). Each
combines several services, so each is a **hub workflow** (hub Batch C), not a tool here. Their Vercel steps are all
covered: deploy/wait (`vercel_workflow_deploy_and_wait`), latest deployment and state (`vercel_deploy_list`,
`vercel_deploy_get`), rollback on failure (`vercel_workflow_emergency_rollback`; a failed build is never promoted by
`vercel_workflow_ship_to_production`), env wiring for a new project (`vercel_workflow_project_setup`, `vercel_env_set`
with a value from `pending_inputs`), required-variable check (`vercel_dev_check_integration`), health
(`vercel_workflow_project_health`), cost (`vercel_workflow_cost_check`). ClaudeBuildPlan's planned
`compound_setup_monitoring` (Vercel log drain) maps to `vercel_drain_create`; `compound_cost_audit` to
`vercel_admin_cost_review`.

## 6. Reproduce

The inventory and table were produced by a Python script over the files in §1 (lists of names extracted with `grep -o
"vercel_[a-z0-9_]*"` and the registries' `name` fields), with one hand-written verdict per name. Re-run it if any source
repository changes; the counts in §2 must match.
