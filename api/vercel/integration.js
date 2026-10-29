import { createDb } from '../../src/db.js';
import { handleIntegrationCallback } from '../../src/vercel/integration.js';

export default async function handler(req, res) {
  try {
    const db = createDb();
    await db.initSchema();
    return await handleIntegrationCallback(req, res, { db });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'integration_unavailable' });
  }
}
