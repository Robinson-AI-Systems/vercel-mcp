import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('registers only two read-only account tools', () => {
    expect(registry.tools.map(x => x.name)).toEqual(['vercel_whoami', 'vercel_list_accounts', 'vercel_enable_production', 'vercel_disable_production']);
    expect(registry.tools.filter(x=>x.writes===true).map(x=>x.localAdmin)).toEqual([true, true]);
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
