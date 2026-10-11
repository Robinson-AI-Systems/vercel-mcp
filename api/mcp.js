import { createDb } from '../src/db.js';
import { createMcpHandler } from '../src/core/mcp-server.js';
import { registry } from '../src/tools/index.js';
import { send } from '../src/core/http.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const db = createDb();
    await db.initSchema();
    return await createMcpHandler({ db, registry })(req, res);
  } catch {
    if (!res.headersSent) {
      send(res, 503, {
        error: 'temporarily_unavailable',
        error_description: 'MCP authentication or database setup is unavailable'
      });
    }
  }
}
