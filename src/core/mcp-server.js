// Default-deny MCP boundary: only explicitly read-only handlers may run before Batch B.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpToken } from './mcp-auth.js';
import { visibleToProfile, listProfileTools, profileToolCounts as countByProfile } from './profiles.js';

// Explicit local owner operations are the only writes permitted before the general gateway.
const LOCAL_OWNER_TOOLS = ['vercel_enable_production', 'vercel_disable_production'];
export const listMcpTools = (registry, connection) =>
  listProfileTools(registry, connection?.profile, { localOwnerTools: LOCAL_OWNER_TOOLS });
export const profileToolCounts = registry =>
  countByProfile(registry, { localOwnerTools: LOCAL_OWNER_TOOLS });
function mayUse(tool, connection) {
  return visibleToProfile(tool, connection?.profile, { localOwnerTools: LOCAL_OWNER_TOOLS });
}
export async function dispatchReadOnlyTool({ registry, name, args, connection, db, formatError, shapeResult }) {
  const item = registry.tools.find((tool) => tool.name === name);
  if (!mayUse(item, connection)) {
    return { isError: true, content: [{ type: 'text', text: 'Tool unavailable for this connection' }] };
  }
  const handler = registry.handlers[name];
  if (typeof handler !== 'function') {
    return { isError: true, content: [{ type: 'text', text: 'Tool unavailable' }] };
  }
  try {
    const result = await handler(args || {}, { connection, db });
    return typeof shapeResult === 'function' ? shapeResult(result, { connection, tool: name }) : result;
  } catch (caught) {
    if (typeof formatError === 'function') {
      try {
        const retry = caught?.retryAfterMs;
        return formatError(caught, {
          team: connection?.account, operation: name,
          projectScoped: connection?.projectScoped === true,
          project: connection?.projectName,
          resetAtMs: Number.isFinite(retry) && retry >= 0 ? Date.now() + retry : undefined
        });
      } catch { /* safe default below */ }
    }
    return { isError: true, content: [{ type: 'text', text: 'Could not read account details; check server setup' }] };
  }
}

export function createMcpHandler({ db, registry, env = process.env, formatError, shapeResult }) {
  return async function mcp(req, res) {
    const connection = await requireMcpToken(req, res, db, env);
    if (!connection) return;
    const server = new Server({ name: 'robinson-vercel-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: listMcpTools(registry, connection)
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      dispatchReadOnlyTool({
        registry,
        name: request.params?.name,
        args: request.params?.arguments,
        connection,
        db, formatError, shapeResult
      })
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on?.('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}
