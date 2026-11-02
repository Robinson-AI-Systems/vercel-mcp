import { handleSigninCallback } from '../../../src/vercel/signin.js';
import { createDb } from '../../../src/db.js';

// SR-1 (gate O-2.7): the Sign in with Vercel callback route.
// The handler lives with the provider module (the handleConnect
// precedent); this file only composes the store and the
// failure shape the OAuth surface uses.
export default async function handler(req, res) {
  try {
    const db = createDb();
    await db.initSchema();
    return await handleSigninCallback({ db, env: process.env }, req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      error: 'temporarily_unavailable',
      error_description: 'Sign-in is not configured or the database is unavailable'
    });
  }
}
