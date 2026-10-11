// Default-deny MCP boundary: only explicitly read-only handlers may run before Batch B.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpToken } from './mcp-auth.js';

// Only these two internal owner administrative switches are eligible before
// the general write-tool gateway exists. They never call a Vercel write API.
const LOCAL_OWNER_TOOLS = new Set(['vercel_enable_production', 'vercel_disable_production']);
function mayUse(tool, connection) {
  if (!tool?.profiles?.includes(connection?.profile)) return false;
  if (tool.writes === false) return true;
  return tool.writes === true && tool.localAdmin === true &&
    LOCAL_OWNER_TOOLS.has(tool.name) && connection.profile === 'full';
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
      tools: registry.tools
        .filter((tool) => mayUse(tool, connection))
        .map((tool) => Object.fromEntries(Object.entries(tool).filter(([key]) => !['writes','profiles','localAdmin','writeContract'].includes(key))))
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
