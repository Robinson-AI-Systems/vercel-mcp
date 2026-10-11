import { describe, expect, it, vi } from 'vitest';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { vercelErrorResult } from '../../src/tools/errors.js';

const connection = { clientId: 'client_fixture', account: 'team_fixture', mode: 'preview', profile: 'everyday', listing: 'catalog' };

describe('default-deny MCP tool dispatch', () => {
  it('refuses unknown and write tools before invoking handlers', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'should not run' }] }));
    const registry = {
      tools: [{ name: 'vercel_write', writes: true, profiles: ['everyday'] }],
      handlers: { vercel_write: handler }
    };
    expect(await dispatchReadOnlyTool({ registry, name: 'missing', connection })).toMatchObject({ isError: true });
    expect(await dispatchReadOnlyTool({ registry, name: 'vercel_write', connection })).toMatchObject({ isError: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispatches only read tools allowed for the connection profile', async () => {
    const handler = vi.fn(async (args, context) => ({
      content: [{ type: 'text', text: args.project + ':' + context.connection.account }]
    }));
    const registry = {
      tools: [{ name: 'vercel_project_get', writes: false, profiles: ['everyday'] }],
      handlers: { vercel_project_get: handler }
    };
    const result = await dispatchReadOnlyTool({
      registry, name: 'vercel_project_get', args: { project: 'fixture' }, connection, db: {}
    });
    expect(result.content[0].text).toBe('fixture:team_fixture');
    expect(handler).toHaveBeenCalledTimes(1);
    const blocked = await dispatchReadOnlyTool({
      registry, name: 'vercel_project_get', args: {}, connection: { ...connection, profile: 'read_only_other' }
    });
    expect(blocked).toMatchObject({ isError: true });
  });

  it('formats provider errors with safe actionable guidance when configured', async () => {
    const registry = {
      tools: [{ name: 'vercel_project_get', writes: false, profiles: ['everyday'] }],
      handlers: { vercel_project_get: async () => {
        throw Object.assign(new Error('vcp_FAKEprovider-secret'), { code: 'rate_limited', status: 429 });
      } }
    };
    const result = await dispatchReadOnlyTool({ registry, name:'vercel_project_get',
      connection, db:{}, formatError:vercelErrorResult });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('temporarily limited');
    expect(result.content[0].text).toContain('operation vercel_project_get');
    expect(result.content[0].text).toContain('HTTP 429');
    expect(result.content[0].text).not.toContain('vcp_FAKEprovider-secret');
  });
  it('hides handler errors from tool callers', async () => {
    const registry = {
      tools: [{ name: 'vercel_project_get', writes: false, profiles: ['everyday'] }],
      handlers: { vercel_project_get: async () => { throw new Error('internal database detail'); } }
    };
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_project_get', connection, db: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('internal database detail');
  });
});
