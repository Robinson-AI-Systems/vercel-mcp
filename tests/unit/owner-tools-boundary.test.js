// AUD-Z — owner-tools boundary: every tool the registry declares
// localAdmin must be reachable by the owner (full-profile) connection
// through the REAL MCP boundary — listMcpTools and dispatchReadOnlyTool
// from src/core/mcp-server.js, which consult the REAL LOCAL_OWNER_TOOLS
// in that module. No test-local copy of the owner list is used anywhere
// in this file: AUD-I S4 shipped vercel_set_working_box unreachable
// because its tests exercised a private copy of the list instead of
// this seam (VMCP-026 A-8, facet 2). The registry is also the real one
// (src/tools/index.js), so a future localAdmin tool added without the
// matching boundary entry fails here, loudly, by construction.
import { describe, it, expect } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { listMcpTools, dispatchReadOnlyTool } from '../../src/core/mcp-server.js';

// The owner operations as filed (AUD-Z card, extended by AUD-AA): the
// six pre-existing LOCAL_OWNER_TOOLS entries plus vercel_set_working_box
// and vercel_remove_account.
const OWNER_TOOLS = ['vercel_enable_production', 'vercel_disable_production',
  'vercel_set_default_account', 'vercel_set_spend_limit', 'vercel_revoke_connection',
  'vercel_create_pass', 'vercel_set_working_box', 'vercel_remove_account'];

const listed = (profile) =>
  listMcpTools(registry, { profile, listing: 'catalog' }).map(t => t.name);

describe('AUD-Z: owner tools are reachable at the real MCP boundary', () => {
  it('the registry declares exactly the filed owner set as localAdmin', () => {
    const declared = registry.tools.filter(t => t.localAdmin === true).map(t => t.name);
    expect(declared.sort()).toEqual([...OWNER_TOOLS].sort());
  });

  it('lists every owner tool for a full-profile connection', () => {
    const full = listed('full');
    for (const name of OWNER_TOOLS) expect(full).toContain(name);
  });

  it('keeps every owner tool invisible to everyday and read_only profiles', () => {
    for (const profile of ['everyday', 'read_only']) {
      const names = listed(profile);
      for (const name of OWNER_TOOLS) expect(names).not.toContain(name);
    }
  });

  it('lets a full-profile invocation of vercel_set_working_box past the gate', async () => {
    // The gate's refusal text is 'Tool unavailable for this connection'
    // (mayUse in mcp-server.js). A same-mode flip is a handler no-op, so
    // a passing call proves discovery AND invocation reach the handler
    // through the real list — no db writes occur.
    const connection = { profile: 'full', account: 'team_FAKE', mode: 'preview',
      connectionId: 'conn_0123456789abcdef01' };
    const db = { setOwnConnectionMode: async () => { throw new Error('must not be called'); } };
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_set_working_box',
      args: { mode: 'preview', confirm: true }, connection, db, env: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ flipped: false, mode: 'preview' });
  });

  it('still refuses vercel_set_working_box by name for a non-owner profile', async () => {
    const connection = { profile: 'everyday', account: 'team_FAKE', mode: 'preview',
      connectionId: 'conn_0123456789abcdef01' };
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_set_working_box',
      args: { mode: 'preview', confirm: true }, connection, db: {}, env: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Tool unavailable for this connection');
  });
});
