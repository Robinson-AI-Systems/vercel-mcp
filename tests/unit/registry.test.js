import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('registers safe read and owner-only operations with explicit allowlist', () => {
    expect(registry.tools.map(x => x.name)).toEqual(['vercel_whoami', 'vercel_list_accounts', 'vercel_check_token', 'vercel_get_result', 'vercel_enable_production', 'vercel_disable_production', 'vercel_list_protected_resources', 'vercel_list_connections', 'vercel_recent_changes', 'vercel_where_is_setting', 'vercel_set_default_account', 'vercel_set_spend_limit', 'vercel_revoke_connection', 'vercel_search_tools', 'vercel_call', 'vercel_batch', 'vercel_describe_tool']);
    expect(registry.tools.filter(x=>x.writes===true).map(x=>x.localAdmin)).toEqual([true, true, true, true, true]);
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
