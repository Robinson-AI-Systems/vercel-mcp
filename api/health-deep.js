import { handleDeepHealth } from '../src/health.js';
// AUD-BY: GET /api/health/deep (vercel.json rewrites that path to this
// function). Authenticated deep health — the deliberate store probe.
export default (req, res) => handleDeepHealth(req, res);
