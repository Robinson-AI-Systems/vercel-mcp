// Default-deny MCP boundary: only explicitly read-only handlers may run before Batch B.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpToken } from './mcp-auth.js';

export async function dispatchReadOnlyTool({ registry, name, args, connection, db }) {
  const item = registry.tools.find((tool) => tool.name === name);
  if (!item || item.writes !== false || !item.profiles?.includes(connection.profile)) {
    return { isError: true, content: [{ type: 'text', text: 'Tool unavailable for this connection' }] };
  }
  const handler = registry.handlers[name];
  if (typeof handler !== 'function') {
    return { isError: true, content: [{ type: 'text', text: 'Tool unavailable' }] };
  }
  try {
    return await handler(args || {}, { connection, db });
  } catch {
    return { isError: true, content: [{ type: 'text', text: 'Could not read account details; check server setup' }] };
  }
}

export function createMcpHandler({ db, registry, env = process.env }) {
  return async function mcp(req, res) {
    const connection = await requireMcpToken(req, res, db, env);
    if (!connection) return;
    const server = new Server({ name: 'robinson-vercel-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: registry.tools
        .filter((tool) => tool.writes === false && tool.profiles?.includes(connection.profile))
        .map((tool) => Object.fromEntries(Object.entries(tool).filter(([key]) => key !== 'writes' && key !== 'profiles')))
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      dispatchReadOnlyTool({
        registry,
        name: request.params?.name,
        args: request.params?.arguments,
        connection,
        db
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
