import { handleConnect } from '../../src/vercel/connect.js';

export default async function handler(req, res) {
  try {
    return await handleConnect(req, res, {});
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'connect_unavailable' });
  }
}
