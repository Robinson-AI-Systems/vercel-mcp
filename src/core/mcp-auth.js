import { createHash } from 'node:crypto';
// Contract-generic MCP bearer authentication. Never forwards the bearer to a provider.
import { publicOrigin, send } from './http.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const LISTINGS = ['catalog', 'compact', 'front_door'];
const MODES = ['preview', 'production'];

function reject(res, challenge, code, description) {
  res.setHeader('WWW-Authenticate', challenge + (code === 'invalid_token' ? ', error="invalid_token"' : ''));
  send(res, 401, description ? { error: code, error_description: description } : { error: code });
  return null;
}

export async function requireMcpToken(req, res, db, env = process.env) {
  const origin = publicOrigin(env);
  const challenge = 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource"';
  const match = /^Bearer ([A-Za-z0-9_-]{30,256})$/.exec(String(req.headers?.authorization || ''));
  if (!match) return reject(res, challenge, 'unauthorized', 'A valid connection is required');

  const record = await db.getAccessToken(match[1]);
  if (!record || !PROFILES.includes(record.profile) || !LISTINGS.includes(record.listing) ||
    !MODES.includes(record.mode) || (record.mode === 'production' && env.VERCEL_ENV !== 'production')) {
    return reject(res, challenge, 'invalid_token');
  }
  if (record.mode === 'production') {
    const accounts = await db.listVercelAccounts();
    const account = accounts.find((item) => item.id === record.vercel_account);
    if (!account || !account.production_enabled) return reject(res, challenge, 'invalid_token');
  }
  const context = {
    clientId: record.client_id,
    account: record.vercel_account,
    mode: record.mode,
    profile: record.profile,
    listing: record.listing,
    // Server-minted connection classification (AUD-A2): getAccessToken only
    // returns oauth_tokens rows with kind 'connector' — the account owner's
    // own connector/OAuth connection. The purchase policy branch keys off
    // this; delegated RTC passes carry kind 'pass' instead.
    kind: record.kind,
    // AUD-AQ: the read-only end-user switch, read from the token row the
    // bearer proved. Pass connections are minted by the RTC door without
    // this field, so the switch gates only ever see it on OAuth
    // connections — a pass's scope stays the pass row's own business.
    readOnly: record.read_only === true
  };
  Object.defineProperty(context,'resultOwner',{value:'resown_'+
    createHash('sha256').update('rmcp-result-owner-v1:').update(match[1]).digest('hex')});
  // AUD-I S4: the caller's own public connection id, non-enumerable
  // like resultOwner — a self-service key for the working-box flip,
  // never serialized into tool output.
  Object.defineProperty(context,'connectionId',{value:record.connection_id});
  return Object.freeze(context);
}
