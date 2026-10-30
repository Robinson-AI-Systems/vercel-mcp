import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('registers safe read and owner-only operations with explicit allowlist', () => {
    expect(registry.tools.map(x => x.name)).toEqual(['vercel_whoami', 'vercel_list_accounts', 'vercel_check_token', 'vercel_set_working_box', 'vercel_get_result', 'vercel_enable_production', 'vercel_disable_production', 'vercel_list_protected_resources', 'vercel_list_connections', 'vercel_recent_changes', 'vercel_where_is_setting', 'vercel_set_default_account', 'vercel_set_spend_limit', 'vercel_revoke_connection', 'vercel_remove_account', 'vercel_search_tools', 'vercel_call', 'vercel_batch', 'vercel_describe_tool', 'vercel_project_list', 'vercel_project_get', 'vercel_project_list_members', 'vercel_git_list_namespaces', 'vercel_git_search_repos', 'vercel_cron_list', 'vercel_project_create', 'vercel_project_update_settings', 'vercel_project_add_member', 'vercel_project_remove_member', 'vercel_project_pause', 'vercel_project_unpause', 'vercel_project_delete','vercel_project_transfer','vercel_project_set_build_resources','vercel_deploy_list','vercel_deploy_get','vercel_deploy_get_build_logs','vercel_deploy_get_runtime_logs','vercel_deploy_wait','vercel_deploy_get_file','vercel_deploy_list_files','vercel_deploy_list_promote_aliases','vercel_alias_list','vercel_alias_get','vercel_rolling_get','vercel_rolling_update_config','vercel_rolling_start','vercel_rolling_approve_stage','vercel_rolling_complete','vercel_deploy_promote','vercel_deploy_rollback','vercel_alias_assign','vercel_alias_delete','vercel_deploy_cancel','vercel_deploy_delete','vercel_deploy_redeploy','vercel_deploy_create_from_git','vercel_deploy_create_from_files','vercel_shared_env_list','vercel_environment_list','vercel_shared_env_set','vercel_shared_env_delete','vercel_globalconfig_list','vercel_globalconfig_list_items','vercel_globalconfig_create','vercel_globalconfig_patch_items','vercel_globalconfig_delete','vercel_globalconfig_create_token','vercel_globalconfig_restore_backup','vercel_globalconfig_list_tokens','vercel_globalconfig_revoke_tokens','vercel_globalconfig_get_schema','vercel_globalconfig_set_schema','vercel_environment_create','vercel_environment_update','vercel_environment_delete','vercel_check_list_runs','vercel_check_get_run','vercel_check_list_project_checks','vercel_env_list','vercel_env_get','vercel_env_compare','vercel_env_export_names','vercel_env_set','vercel_env_delete','vercel_env_copy','vercel_env_set_many','vercel_env_delete_many','vercel_team_list','vercel_team_get','vercel_account_teams','vercel_team_update_profile','vercel_team_create','vercel_team_delete', 'vercel_team_update_security', 'vercel_team_set_default_protection', 'vercel_api_search', 'vercel_api_describe', 'vercel_api_read', 'vercel_create_pass','vercel_dev_seed','vercel_dev_list_runs','vercel_dev_cleanup','vercel_dev_preview_branch','vercel_dev_wire_preview_env','vercel_dev_alias_preview','vercel_dev_create_bypass','vercel_dev_tail_logs','vercel_dev_diagnose_build','vercel_dev_fetch_preview','vercel_dev_check_integration',
      'vercel_dev_send_test_webhook','vercel_dev_sandbox_create','vercel_dev_sandbox_run',
      'vercel_dev_sandbox_write_files','vercel_dev_sandbox_read_file','vercel_dev_sandbox_stop',
      'vercel_domain_list','vercel_domain_get','vercel_domain_check_config','vercel_domain_add_to_team',
      'vercel_domain_update','vercel_domain_remove_from_team','vercel_domain_list_project_domains',
      'vercel_domain_attach_to_project','vercel_domain_update_project_domain',
      'vercel_domain_detach_from_project','vercel_domain_verify_project_domain',
      'vercel_logs_query','vercel_logs_errors_summary','vercel_analytics_pageviews',
      'vercel_analytics_set_web_analytics','vercel_analytics_set_speed_insights',
      'vercel_protection_get','vercel_protection_list_bypass','vercel_protection_set_vercel_auth',
      'vercel_protection_set_password','vercel_protection_set_trusted_ips',
      'vercel_protection_create_bypass','vercel_protection_revoke_bypass',
      'vercel_alias_set_shareable_link']);
    expect(registry.tools.filter(x=>x.localAdmin===true)).toHaveLength(8);
    expect(registry.tools.filter(x=>x.writes===true && x.guardedWrite===true).map(x=>x.name))
      .toEqual(['vercel_project_create', 'vercel_project_update_settings', 'vercel_project_add_member', 'vercel_project_remove_member', 'vercel_project_pause', 'vercel_project_unpause', 'vercel_project_delete','vercel_project_transfer','vercel_project_set_build_resources','vercel_rolling_update_config','vercel_rolling_start','vercel_rolling_approve_stage','vercel_rolling_complete','vercel_deploy_promote','vercel_deploy_rollback','vercel_alias_assign','vercel_alias_delete','vercel_deploy_cancel','vercel_deploy_delete','vercel_deploy_redeploy','vercel_deploy_create_from_git','vercel_deploy_create_from_files','vercel_shared_env_set','vercel_shared_env_delete','vercel_globalconfig_create','vercel_globalconfig_patch_items','vercel_globalconfig_delete','vercel_globalconfig_create_token','vercel_globalconfig_restore_backup','vercel_globalconfig_revoke_tokens','vercel_globalconfig_set_schema','vercel_environment_create','vercel_environment_update','vercel_environment_delete','vercel_env_set','vercel_env_delete','vercel_env_copy','vercel_env_set_many','vercel_env_delete_many','vercel_team_update_profile','vercel_team_create','vercel_team_delete', 'vercel_team_update_security', 'vercel_team_set_default_protection','vercel_dev_seed','vercel_dev_cleanup','vercel_dev_preview_branch','vercel_dev_wire_preview_env','vercel_dev_alias_preview','vercel_dev_create_bypass','vercel_dev_send_test_webhook',
      'vercel_dev_sandbox_create','vercel_dev_sandbox_run','vercel_dev_sandbox_write_files',
      'vercel_dev_sandbox_stop','vercel_domain_add_to_team','vercel_domain_update',
      'vercel_domain_remove_from_team','vercel_domain_attach_to_project',
      'vercel_domain_update_project_domain','vercel_domain_detach_from_project',
      'vercel_domain_verify_project_domain','vercel_analytics_set_web_analytics',
      'vercel_analytics_set_speed_insights','vercel_protection_set_vercel_auth',
      'vercel_protection_set_password','vercel_protection_set_trusted_ips',
      'vercel_protection_create_bypass','vercel_protection_revoke_bypass',
      'vercel_alias_set_shareable_link']);
  });
  it('refuses fabricated routine-write contracts and unbound handlers', () => {
    const tool={name:'vercel_fake_mutation',writes:true,guardedWrite:true,
      writeContract:{production:true,targets:true}};
    expect(()=>mergeNamespaces([{tools:[tool],handlers:{[tool.name]:async()=>null}}]))
      .toThrow(/Untrusted guarded-write/);
  });
  it('merges namespaces and keeps each handler', () => {
    const merged = mergeNamespaces([make('vercel_a'), make('vercel_b')]);
    expect(merged.tools.map((t) => t.name)).toEqual(['vercel_a', 'vercel_b']);
    expect(typeof merged.handlers.vercel_b).toBe('function');
  });
  it('refuses duplicate tool names across namespaces', () => {
    expect(() => mergeNamespaces([make('vercel_example'), make('vercel_example')])).toThrow(/Duplicate/);
  });
  it('refuses a registered tool without a handler (old toolkit bug T1)', () => {
    expect(() => mergeNamespaces([{ tools: [{ name: 'vercel_broken' }], handlers: {} }])).toThrow(/Missing handler/);
  });
  it('refuses a tool without a name', () => {
    expect(() => mergeNamespaces([{ tools: [{}], handlers: {} }])).toThrow(/invalid tool name/);
  });
});
