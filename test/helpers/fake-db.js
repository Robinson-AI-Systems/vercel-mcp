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
        production_enable_strictness: account.production_enable_strictness === 'passphrase' ?
          'passphrase' : 'word',
        is_default: Boolean(account.is_default),
        spend_limit_cents: account.spend_limit_cents ?? 0,
        purchase_budget_cents: account.purchase_budget_cents ?? null,
        purchase_grant_required: Boolean(account.purchase_grant_required),
        token_last4: account.token_last4 ?? null,
        token_expires_at: account.token_expires_at ?? null,
        token_no_expiry: Boolean(account.token_no_expiry),
        token_version: account.token_version ?? null,
        // The real listVercelAccounts SELECT carries token_probe
        // (src/db.js); AUD-AZ's door derivation reads its source,
        // so the fake's projection must carry it too.
        token_probe: account.token_probe ?? null
      }));
    },

    async getTokenNoExpiry(id) {
      const account = accountRows.get(id);
      if (!account) return null;
      return Boolean(account.token_no_expiry);
    },

    async setTokenNoExpiry(id, attested, expectedVersion) {
      if (typeof attested !== 'boolean' ||
        typeof expectedVersion !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedVersion)) {
        throw new TypeError('Invalid account or no-expiry attestation');
      }
      const account = accountRows.get(id);
      if (!account || account.token_version !== expectedVersion) return false;
      account.token_no_expiry = attested;
      return true;
    },

    async getPurchasePolicy(id) {
      const account = accountRows.get(id);
      if (!account) return null;
      return { budgetCents: account.purchase_budget_cents ?? null,
        grantRequired: Boolean(account.purchase_grant_required) };
    },

    async getProductionEnableStrictness(id) {
      const account = accountRows.get(id);
      if (!account) return null;
      return account.production_enable_strictness === 'passphrase' ?
        'passphrase' : 'word';
    },

    async setProductionEnableStrictness(id, strictness) {
      if (!['word', 'passphrase'].includes(strictness)) {
        throw new TypeError('Invalid account or production enable strictness');
      }
      const account = accountRows.get(id);
      if (!account) return false;
      account.production_enable_strictness = strictness;
      return true;
    },

    async setPurchasePolicy(id, policy) {
      const { budgetCents, grantRequired } = policy ?? {};
      if (!(budgetCents === null || (Number.isInteger(budgetCents) &&
          budgetCents >= 0 && budgetCents <= 2147483647)) ||
        typeof grantRequired !== 'boolean') {
        throw new TypeError('Invalid account or purchase policy');
      }
      const account = accountRows.get(id);
      if (!account) return false;
      account.purchase_budget_cents = budgetCents;
      account.purchase_grant_required = grantRequired;
      return true;
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
