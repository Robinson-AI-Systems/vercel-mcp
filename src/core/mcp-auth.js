// Contract-generic MCP bearer authentication. Never forwards the bearer to the provider.
import { publicOrigin, send } from './http.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const LISTINGS = ['catalog', 'compact'];
const MODES = ['preview', 'production'];

export async function requireMcpToken(req, res, db, env = process.env) {
  const origin = publicOrigin(env);
  const challenge = 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource"';
  const match = /^Bearer ([A-Za-z0-9_-]{30,256})$/.exec(String(req.headers?.authorization || ''));
  if (!match) {
    res.setHeader('WWW-Authenticate', challenge);
    send(res, 401, { error: 'unauthorized', error_description: 'A valid connection is required' });
    return null;
  }

  const record = await db.getAccessToken(match[1]);
  const validShape = record && PROFILES.includes(record.profile) &&
    LISTINGS.includes(record.listing) && MODES.includes(record.mode);
  if (!validShape) {
    res.setHeader('WWW-Authenticate', challenge + ', error="invalid_token"');
    send(res, 401, { error: 'invalid_token' });
    return null;
  }

  if (record.mode === 'production') {
    if (env.VERCEL_ENV !== 'production' || typeof db.listVercelAccounts !== 'function') {
      res.setHeader('WWW-Authenticate', challenge + ', error="invalid_token"');
      send(res, 401, { error: 'invalid_token' });
      return null;
    }
    const accounts = await db.listVercelAccounts();
    const account = accounts.find((item) => item.id === record.vercel_account);
    if (!account || account.production_enabled !== true) {
      res.setHeader('WWW-Authenticate', challenge + ', error="invalid_token"');
      send(res, 401, { error: 'invalid_token' });
      return null;
    }
  }

  return Object.freeze({
    clientId: record.client_id,
    account: record.vercel_account,
    mode: record.mode,
    profile: record.profile,
    listing: record.listing
  });
}
