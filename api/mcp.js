import { createDb } from '../src/db.js';
import { createMcpHandler } from '../src/core/mcp-server.js';
import { registry } from '../src/tools/index.js';
import { vercelErrorResult } from '../src/tools/errors.js';
import { shapeStoredMcpResult } from '../src/vercel/result-delivery.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const db = createDb();
    await db.initSchema();
    return await createMcpHandler({ db, registry, formatError: vercelErrorResult, shapeResult: shapeStoredMcpResult })(req, res);
  } catch {
    if (!res.headersSent) {
      return res.status(503).json({
        error: 'temporarily_unavailable',
        error_description: 'Vercel MCP is not configured or its database is unavailable'
      });
    }
  }
}
