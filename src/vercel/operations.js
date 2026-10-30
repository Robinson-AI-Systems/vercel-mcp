// Canonical, version-pinned Vercel REST operations. Add entries only after checking
// the exact method and path in vendor/vercel-openapi/openapi-2026-10-11.json.
export const OPS = Object.freeze({
  user_get: Object.freeze({ method: 'GET', path: '/v2/user' }),
  // AUD-I S1b: the personal-install probe reads identity without a
  // team scope — the installer's own account is the scope.
  user_get_unscoped: Object.freeze({ method: 'GET', path: '/v2/user', teamScoped: false }),
  teams_list: Object.freeze({ method: 'GET', path: '/v2/teams' }),
  // Preserve existing token probes while the owner list uses no team query.
  teams_list_unscoped: Object.freeze({ method: 'GET', path: '/v2/teams', teamScoped: false }),
  teams_get: Object.freeze({ method: 'GET', path: '/v2/teams/{teamId}', teamScoped: false }),
  teams_patch: Object.freeze({ method: 'PATCH', path: '/v2/teams/{teamId}', teamScoped: false }),
  // AUD-AB: the account-layer lifecycle lives at /v1 in the pinned snapshot
  // (create/delete), while list/get stay at /v2. Unscoped: the bearer token
  // acts as the user; no team query may be attached to an account-layer act.
  teams_create: Object.freeze({ method: 'POST', path: '/v1/teams', teamScoped: false }),
  teams_delete: Object.freeze({ method: 'DELETE', path: '/v1/teams/{teamId}', teamScoped: false }),
  // Exact team ID comes only from the stored account, not the caller. This
  // endpoint takes teamId in the path, not as a redundant query parameter.
  teams_members_list: Object.freeze({ method: 'GET', path: '/v3/teams/{teamId}/members', teamScoped: false }),
  projects_list: Object.freeze({ method: 'GET', path: '/v10/projects' }),
  // Scope-inferred variants for the AUD-F project-scoped enrollment probe:
  // Vercel infers a scoped token's scope, and teamId applies only to
  // full-account tokens, so these reads must not attach it.
  projects_list_unscoped: Object.freeze({ method: 'GET', path: '/v10/projects', teamScoped: false }),
  rolling_billing_get: Object.freeze({ method: 'GET', path: '/v1/projects/{idOrName}/rolling-release/billing' }),
  rolling_config_get: Object.freeze({ method: 'GET', path: '/v1/projects/{idOrName}/rolling-release/config' }),
  rolling_active_get: Object.freeze({ method: 'GET', path: '/v1/projects/{idOrName}/rolling-release' }),
  rolling_config_update: Object.freeze({ method: 'PATCH', path: '/v1/projects/{idOrName}/rolling-release/config' }),
  rolling_config_delete: Object.freeze({ method: 'DELETE', path: '/v1/projects/{idOrName}/rolling-release/config' }),
  rolling_start: Object.freeze({ method: 'POST', path: '/v1/projects/{idOrName}/rolling-release/start' }),
  rolling_approve: Object.freeze({ method: 'POST', path: '/v1/projects/{idOrName}/rolling-release/approve-stage' }),
  rolling_complete: Object.freeze({ method: 'POST', path: '/v1/projects/{idOrName}/rolling-release/complete' }),
  release_promote: Object.freeze({ method: 'POST', path: '/v10/projects/{projectId}/promote/{deploymentId}' }),
  release_rollback: Object.freeze({ method: 'POST', path: '/v1/projects/{projectId}/rollback/{deploymentId}' }),
  release_promote_aliases: Object.freeze({ method: 'GET', path: '/v1/projects/{projectId}/promote/aliases' }),
  release_aliases_list: Object.freeze({ method: 'GET', path: '/v4/aliases' }),
  release_alias_get: Object.freeze({ method: 'GET', path: '/v4/aliases/{idOrAlias}' }),
  release_alias_assign: Object.freeze({ method: 'POST', path: '/v2/deployments/{id}/aliases' }),
  release_alias_delete: Object.freeze({ method: 'DELETE', path: '/v2/aliases/{aliasId}' }),
  deployments_list: Object.freeze({ method: 'GET', path: '/v7/deployments' }),
  deployments_get: Object.freeze({ method: 'GET', path: '/v13/deployments/{idOrUrl}' }),
  deployments_create: Object.freeze({ method: 'POST', path: '/v13/deployments' }),
  deployments_file_upload: Object.freeze({ method: 'POST', path: '/v2/files' }),
  deployments_cancel: Object.freeze({ method: 'PATCH', path: '/v12/deployments/{id}/cancel' }),
  deployments_delete: Object.freeze({ method: 'DELETE', path: '/v13/deployments/{id}' }),
  runtime_logs_get: Object.freeze({ method: 'GET', path: '/v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs' }),
  observability_query: Object.freeze({ method: 'POST', path: '/v2/observability/query', teamScoped: false, readOnly: true }),
  web_analytics_aggregate: Object.freeze({ method: 'GET', path: '/v1/query/web-analytics/visits/aggregate' }),
  web_insights_toggle: Object.freeze({ method: 'POST', path: '/web/insights/toggle', teamScoped: false }),
  speed_insights_toggle: Object.freeze({ method: 'POST', path: '/speed-insights/toggle', teamScoped: false }),
  deployments_events: Object.freeze({ method: 'GET', path: '/v3/deployments/{idOrUrl}/events' }),
  deployments_files_list: Object.freeze({ method: 'GET', path: '/v6/deployments/{id}/files' }),
  deployments_file_get: Object.freeze({ method: 'GET', path: '/v8/deployments/{id}/files/{fileId}' }),
  checks_runs_list: Object.freeze({ method: 'GET', path: '/v2/deployments/{deploymentId}/check-runs' }),
  checks_run_get: Object.freeze({ method: 'GET', path: '/v2/deployments/{deploymentId}/check-runs/{checkRunId}' }),
  checks_project_list: Object.freeze({ method: 'GET', path: '/v2/projects/{projectIdOrName}/checks' }),
  projects_get: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}' }),
  projects_get_unscoped: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}', teamScoped: false }),
  project_env_list: Object.freeze({ method: 'GET', path: '/v10/projects/{idOrName}/env' }),
  project_env_get: Object.freeze({ method: 'GET', path: '/v1/projects/{idOrName}/env/{id}' }),
  project_env_create: Object.freeze({ method: 'POST', path: '/v10/projects/{idOrName}/env' }),
  project_protection_bypass_update: Object.freeze({ method: 'PATCH', path: '/v1/projects/{idOrName}/protection-bypass' }),
  // F-1: shareable links and per-URL bypass live on the alias surface
  // (pinned snapshot: PATCH /aliases/{id}/protection-bypass).
  aliases_protection_bypass_update: Object.freeze({ method: 'PATCH', path: '/aliases/{id}/protection-bypass' }),
  // F-2: firewall configuration, attack mode and events (pinned snapshot:
  // /v1/security/*). The config DELETE operation is deliberately NOT
  // registered — the catalog has no delete-version tool (dossier §2.4).
  firewall_config_get: Object.freeze({ method: 'GET', path: '/v1/security/firewall/config' }),
  firewall_config_get_version: Object.freeze({ method: 'GET', path: '/v1/security/firewall/config/{configVersion}' }),
  firewall_config_patch: Object.freeze({ method: 'PATCH', path: '/v1/security/firewall/config' }),
  firewall_config_activate: Object.freeze({ method: 'POST', path: '/v1/security/firewall/config/{configVersion}/activate' }),
  firewall_attack_status: Object.freeze({ method: 'GET', path: '/v1/security/firewall/attack-status' }),
  attack_mode_update: Object.freeze({ method: 'POST', path: '/v1/security/attack-mode' }),
  firewall_events_list: Object.freeze({ method: 'GET', path: '/v1/security/firewall/events' }),
  // Batch F-3 routes / bulk redirects / edge cache. The
  // dangerously-delete-by-* edge-cache operations are deliberately NOT
  // registered (design F5) — invalidation only.
  project_routes_list: Object.freeze({ method: 'GET', path: '/v1/projects/{projectId}/routes' }),
  project_routes_stage: Object.freeze({ method: 'PUT', path: '/v1/projects/{projectId}/routes' }),
  project_routes_add: Object.freeze({ method: 'POST', path: '/v1/projects/{projectId}/routes' }),
  project_routes_delete: Object.freeze({ method: 'DELETE', path: '/v1/projects/{projectId}/routes' }),
  project_route_update: Object.freeze({ method: 'PATCH', path: '/v1/projects/{projectId}/routes/{routeId}' }),
  project_routes_versions_list: Object.freeze({ method: 'GET', path: '/v1/projects/{projectId}/routes/versions' }),
  project_routes_versions_update: Object.freeze({ method: 'POST', path: '/v1/projects/{projectId}/routes/versions' }),
  bulk_redirects_list: Object.freeze({ method: 'GET', path: '/v1/bulk-redirects' }),
  bulk_redirects_stage: Object.freeze({ method: 'PUT', path: '/v1/bulk-redirects' }),
  bulk_redirects_update: Object.freeze({ method: 'PATCH', path: '/v1/bulk-redirects' }),
  bulk_redirects_delete: Object.freeze({ method: 'DELETE', path: '/v1/bulk-redirects' }),
  bulk_redirects_restore_items: Object.freeze({ method: 'POST', path: '/v1/bulk-redirects/restore' }),
  bulk_redirects_versions_list: Object.freeze({ method: 'GET', path: '/v1/bulk-redirects/versions' }),
  bulk_redirects_versions_update: Object.freeze({ method: 'POST', path: '/v1/bulk-redirects/versions' }),
  edge_cache_invalidate_tags: Object.freeze({ method: 'POST', path: '/v1/edge-cache/invalidate-by-tags' }),
  edge_cache_invalidate_src_images: Object.freeze({ method: 'POST', path: '/v1/edge-cache/invalidate-by-src-images' }),
  global_config_list: Object.freeze({ method: 'GET', path: '/v1/global-config' }),
  global_config_get: Object.freeze({ method: 'GET', path: '/v1/global-config/{edgeConfigId}' }),
  global_config_items: Object.freeze({ method: 'GET', path: '/v1/global-config/{edgeConfigId}/items' }),
  global_config_create: Object.freeze({ method: 'POST', path: '/v1/global-config' }),
  global_config_patch_items: Object.freeze({ method: 'PATCH', path: '/v1/global-config/{edgeConfigId}/items' }),
  global_config_delete: Object.freeze({ method: 'DELETE', path: '/v1/global-config/{edgeConfigId}' }),
  global_config_create_token: Object.freeze({ method: 'POST', path: '/v1/global-config/{edgeConfigId}/token' }),
  global_config_tokens: Object.freeze({ method: 'GET', path: '/v1/global-config/{edgeConfigId}/tokens' }),
  global_config_delete_tokens: Object.freeze({ method: 'DELETE', path: '/v1/global-config/{edgeConfigId}/tokens' }),
  global_config_schema_get: Object.freeze({ method: 'GET', path: '/v1/global-config/{edgeConfigId}/schema' }),
  global_config_schema_set: Object.freeze({ method: 'POST', path: '/v1/global-config/{edgeConfigId}/schema' }),
  global_config_schema_delete: Object.freeze({ method: 'DELETE', path: '/v1/global-config/{edgeConfigId}/schema' }),
  global_config_backups: Object.freeze({ method: 'GET', path: '/v1/global-config/{edgeConfigId}/backups' }),
  global_config_backup_get: Object.freeze({ method: 'GET', path: '/v1/global-config/{edgeConfigId}/backups/{edgeConfigBackupVersionId}' }),
  global_config_restore_backup: Object.freeze({ method: 'POST', path: '/v1/global-config/{edgeConfigId}/backups/{edgeConfigBackupVersionId}/restore' }),
  shared_env_list: Object.freeze({ method: 'GET', path: '/v1/env' }),
  shared_env_create: Object.freeze({ method: 'POST', path: '/v1/env' }),
  shared_env_update: Object.freeze({ method: 'PATCH', path: '/v1/env' }),
  shared_env_delete: Object.freeze({ method: 'DELETE', path: '/v1/env' }),
  shared_env_unlink: Object.freeze({ method: 'PATCH', path: '/v1/env/{id}/unlink/{projectId}' }),
  custom_environments_list: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}/custom-environments' }),
  custom_environments_create: Object.freeze({ method: 'POST', path: '/v9/projects/{idOrName}/custom-environments' }),
  custom_environments_get: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}' }),
  custom_environments_update: Object.freeze({ method: 'PATCH', path: '/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}' }),
  custom_environments_delete: Object.freeze({ method: 'DELETE', path: '/v9/projects/{idOrName}/custom-environments/{environmentSlugOrId}' }),
  project_env_update: Object.freeze({ method: 'PATCH', path: '/v9/projects/{idOrName}/env/{id}' }),
  project_env_delete: Object.freeze({ method: 'DELETE', path: '/v9/projects/{idOrName}/env/{id}' }),
  project_env_delete_batch: Object.freeze({ method: 'DELETE', path: '/v1/projects/{idOrName}/env' }),
  projects_members_list: Object.freeze({ method: 'GET', path: '/v1/projects/{idOrName}/members' }),
  projects_members_add: Object.freeze({ method: 'POST', path: '/v1/projects/{idOrName}/members' }),
  projects_members_remove: Object.freeze({ method: 'DELETE', path: '/v1/projects/{idOrName}/members/{uid}' }),
  // AUD-K: the Door-1 enrollment/recheck probe reads the installation's
  // own configuration (pinned snapshot: GET /v1/integrations/configuration/{id},
  // id in the path, teamId in the query) — the read an installation token
  // is actually granted (integration-configuration scope), unlike the
  // teams list it cannot call.
  integrations_configuration_get: Object.freeze({ method: 'GET', path: '/v1/integrations/configuration/{id}' }),
  git_namespaces: Object.freeze({ method: 'GET', path: '/v1/integrations/git-namespaces', teamScoped: false }),
  git_repos_search: Object.freeze({ method: 'GET', path: '/v1/integrations/search-repo' }),
  projects_create: Object.freeze({ method: 'POST', path: '/v11/projects' }),
  projects_update: Object.freeze({ method: 'PATCH', path: '/v9/projects/{idOrName}' }),
  projects_pause: Object.freeze({ method: 'POST', path: '/v1/projects/{projectId}/pause' }),
  projects_unpause: Object.freeze({ method: 'POST', path: '/v1/projects/{projectId}/unpause' }),
  projects_domains_list: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}/domains' }),
  projects_domains_get: Object.freeze({ method: 'GET', path: '/v9/projects/{idOrName}/domains/{domain}' }),
  projects_domains_add: Object.freeze({ method: 'POST', path: '/v10/projects/{idOrName}/domains' }),
  projects_domains_update: Object.freeze({ method: 'PATCH', path: '/v9/projects/{idOrName}/domains/{domain}' }),
  projects_domains_remove: Object.freeze({ method: 'DELETE', path: '/v9/projects/{idOrName}/domains/{domain}' }),
  projects_domains_verify: Object.freeze({ method: 'POST', path: '/v9/projects/{idOrName}/domains/{domain}/verify' }),
  domains_list: Object.freeze({ method: 'GET', path: '/v5/domains' }),
  domains_get: Object.freeze({ method: 'GET', path: '/v5/domains/{domain}' }),
  domains_add: Object.freeze({ method: 'POST', path: '/v7/domains' }),
  domains_update: Object.freeze({ method: 'PATCH', path: '/v3/domains/{domain}' }),
  domains_remove: Object.freeze({ method: 'DELETE', path: '/v6/domains/{domain}' }),
  domains_config: Object.freeze({ method: 'GET', path: '/v6/domains/{domain}/config' }),
  domains_verification: Object.freeze({ method: 'GET', path: '/v9/domains/{domain}/verification' }),
  projects_env_list: Object.freeze({ method: 'GET', path: '/v10/projects/{idOrName}/env' }),
  projects_transfer_request: Object.freeze({ method: 'POST', path: '/projects/{idOrName}/transfer-request' }),
  // V-4 exact paths from the 2026-10-11 sandbox REST surface; the binary
  // filesystem endpoints have their own bounded transport in sandbox-binary.
  sandbox_create: Object.freeze({ method: 'POST', path: '/v4/sandboxes' }),
  sandbox_session_get: Object.freeze({ method: 'GET', path: '/v2/sandboxes/sessions/{sessionId}' }),
  sandbox_command_run: Object.freeze({ method: 'POST', path: '/v2/sandboxes/sessions/{sessionId}/cmd' }),
  sandbox_command_get: Object.freeze({ method: 'GET', path: '/v2/sandboxes/sessions/{sessionId}/cmd/{cmdId}' }),
  sandbox_stop: Object.freeze({ method: 'POST', path: '/v2/sandboxes/sessions/{sessionId}/stop' }),
  projects_delete: Object.freeze({ method: 'DELETE', path: '/v9/projects/{idOrName}' })
});

export function operation(id) {
  if (!Object.hasOwn(OPS, id)) throw new TypeError('Unknown Vercel operation');
  return OPS[id];
}
