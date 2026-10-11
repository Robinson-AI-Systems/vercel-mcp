import { createDb } from '../../src/db.js';
import { handleSetup } from '../../src/vercel/setup.js';

export default async function handler(req, res) {
  try {
    const db = createDb();
    await db.initSchema();
    return await handleSetup(req, res, { db });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'setup_unavailable' });
  }
}
