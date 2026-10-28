// Copied from Robinson-AI-Systems/stripe-mcp test/helpers/fake-db.js @ 6cb3f64 (extended for Vercel MCP A-2/A-3a).
import { SCHEMA_TABLES, connectionSettings } from '../../src/db.js';
import { hashToken } from '../../src/core/oauth.js';

export function createFakeDb({ clock = () => Date.now(), accounts = [] } = {}) {
  const rows = new Map();
  const accountRows = new Map(accounts.map((account) => [account.id, structuredClone(account)]));
  const tables = new Set();
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();
  const attempts = [];
  return {
    async initSchema() { for (const table of SCHEMA_TABLES) tables.add(table); },
    listTables() { return [...tables].sort(); },
    async put(key, value) { rows.set(key, structuredClone(value)); },
    async get(key) { return rows.has(key) ? structuredClone(rows.get(key)) : null; },
    async listVercelAccounts() {
      return [...accountRows.values()].map((account) => ({
        id: account.id, team_id: account.team_id, team_slug: account.team_slug,
        label: account.label, scope: account.scope, project_id: account.project_id,
        project_name: account.project_name, production_enabled: Boolean(account.production_enabled),
        is_default: Boolean(account.is_default)
      }));
    },

    async createOAuthClient({ clientId, clientSecret, redirectUris, clientName,
      tokenEndpointAuthMethod = 'client_secret_post' }) {
      if (!clientId || !Array.isArray(redirectUris) || !redirectUris.length ||
        !['client_secret_post','none'].includes(tokenEndpointAuthMethod) ||
        (tokenEndpointAuthMethod === 'none' ? clientSecret !== null :
          typeof clientSecret !== 'string' || clientSecret.length < 1)) {
        throw new TypeError('Missing OAuth client registration fields');
      }
      if (clients.has(clientId)) throw new Error('duplicate client');
      clients.set(clientId, {
        client_id: clientId,
        client_secret_hash: tokenEndpointAuthMethod === 'none' ? null : hashToken(clientSecret),
        token_endpoint_auth_method: tokenEndpointAuthMethod,
        redirect_uris: structuredClone(redirectUris),
        client_name: clientName || null
      });
    },
    async getOAuthClient(clientId) { return structuredClone(clients.get(clientId) || null); },

    async createAuthCode({
      code, clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256',
      vercelAccount = null, mode = 'preview', profile = 'everyday', listing = 'front_door', ttlSeconds = 600
    }) {
      codes.set(hashToken(code), {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        vercel_account: vercelAccount,
        mode,
        profile,
        listing,
        expires_at: clock() + ttlSeconds * 1000
      });
    },
    async consumeAuthCode(code) {
      if (typeof code !== 'string' || !code) return null;
      const key = hashToken(code);
      const row = codes.get(key);
      codes.delete(key);
      return row && row.expires_at > clock()
        ? structuredClone({ client_id: row.client_id, redirect_uri: row.redirect_uri,
          code_challenge: row.code_challenge, code_challenge_method: row.code_challenge_method,
          ...connectionSettings(row) })
        : null;
    },

    async createAccessToken({
      accessToken, refreshToken, clientId, vercelAccount = null,
      mode = 'preview', profile = 'everyday', listing = 'front_door', ttlSeconds = 3600
    }) {
      tokens.set(hashToken(accessToken), {
        token_hash: hashToken(accessToken),
        refresh_hash: refreshToken ? hashToken(refreshToken) : null,
        client_id: clientId,
        vercel_account: vercelAccount,
        mode,
        profile,
        listing,
        kind: 'connector',
        expires_at: clock() + ttlSeconds * 1000,
        revoked_at: null,
        last_used_at: null
      });
    },
    async getAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return null;
      const row = tokens.get(hashToken(accessToken));
      if (!row || row.revoked_at || row.expires_at <= clock() || row.kind !== 'connector') return null;
      return {
        client_id: row.client_id,
        ...connectionSettings(row),
        kind: row.kind,
        expires_at: new Date(row.expires_at),
        revoked_at: null
      };
    },
    async getTokenByRefreshToken(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken) return null;
      const hash = hashToken(refreshToken);
      const row = [...tokens.values()].find((item) => item.refresh_hash === hash &&
        !item.revoked_at && item.kind === 'connector');
      return row ? { client_id: row.client_id, ...connectionSettings(row) } : null;
    },
    async rotateRefreshToken({ refreshToken, clientId, accessToken, newRefreshToken, ttlSeconds = 3600 }) {
      const oldHash = hashToken(refreshToken);
      const row = [...tokens.values()].find((item) => item.refresh_hash === oldHash &&
        item.client_id === clientId && !item.revoked_at && item.kind === 'connector');
      if (!row) return null;
      tokens.delete(row.token_hash);
      row.token_hash = hashToken(accessToken);
      row.refresh_hash = hashToken(newRefreshToken);
      row.expires_at = clock() + ttlSeconds * 1000;
      row.last_used_at = null;
      tokens.set(row.token_hash, row);
      return { client_id: row.client_id, ...connectionSettings(row) };
    },
    async revokeOAuthToken({token,clientId}) {
      if(typeof token!=='string'||!token||typeof clientId!=='string'||!clientId)
        throw new TypeError('Token and authenticated OAuth client required');
      const hash=hashToken(token);
      const row=[...tokens.values()].find(x=>x.client_id===clientId&&
        x.kind==='connector'&&!x.revoked_at&&(x.token_hash===hash||x.refresh_hash===hash));
      if(!row)return false;
      row.revoked_at=clock()||1;
      return true;
    },
    async revokeAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return false;
      const row = tokens.get(hashToken(accessToken));
      if (!row || row.revoked_at) return false;
      row.revoked_at = clock();
      return true;
    },
    async recordLoginAttempt(ip) {
      const id = attempts.length + 1;
      attempts.push({ id, ip, success: false, at: clock() });
      return id;
    },
    async markLoginAttemptSucceeded(id) {
      const row = attempts.find((attempt) => attempt.id === id);
      if (row) row.success = true;
    },
    async countRecentFailedLogins(ip, minutes = 15) {
      return attempts.filter((attempt) => attempt.ip === ip && !attempt.success &&
        attempt.at > clock() - minutes * 60_000).length;
    }
  };
}
