// OAuth route composition boundary: reusable handlers are dependency-injected.
import { createDb } from '../db.js';
import { createOAuthHandlers } from '../core/oauth-handlers.js';
import { createVercelLoginService } from '../vercel/login.js';

export async function handleOAuth(which, req, res) {
  try {
    const db = createDb();
    await db.initSchema();
    const service = createVercelLoginService(db);
    return await createOAuthHandlers({ db, env: process.env, service })[which](req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      error: 'temporarily_unavailable',
      error_description: 'OAuth is not configured or the database is unavailable'
    });
  }
}
