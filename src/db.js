// Database schema and the only SQL entry point for Robinson Vercel MCP.
// Additive by design: schema initialization never drops or rewrites existing data.
import { neon } from '@neondatabase/serverless';
import { hashToken } from './core/oauth.js';
import { randomUUID } from 'node:crypto';

export const SCHEMA_TABLES = Object.freeze([
  'vercel_accounts', 'oauth_clients', 'oauth_codes', 'oauth_tokens', 'login_attempts',
  'change_log', 'one_time_secrets', 'pending_inputs', 'protected_resources', 'request_replay'
]);

export const CONNECTION_FIELDS = Object.freeze(['vercel_account', 'mode', 'profile', 'listing']);

export function connectionSettings(row) {
  if (!row || typeof row !== 'object') throw new TypeError('A connection row is required');
  return Object.fromEntries(CONNECTION_FIELDS.map((field) => [field, row[field]]));
}

export function createDb(query) {
  if (query !== undefined && typeof query !== 'function') {
    throw new TypeError('createDb expects a Neon-shaped query function');
  }
  let sql = query;
  function getSql() {
    if (sql) return sql;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not configured. Set DATABASE_URL before using the database.');
    sql = neon(connectionString);
    return sql;
  }

  return {
    async listVercelAccounts() {
      const run = getSql();
      return run`SELECT id, team_id, team_slug, label, scope, project_id, project_name,
        production_enabled, is_default FROM vercel_accounts ORDER BY is_default DESC, label ASC`;
    },
    async createOAuthClient({ clientId, clientSecret, redirectUris, clientName }) {
      if (!clientId || !clientSecret || !Array.isArray(redirectUris) || !redirectUris.length) {
        throw new TypeError('Missing OAuth client registration fields');
      }
      const run = getSql();
      const data = JSON.stringify({
        client_secret_hash: hashToken(clientSecret),
        redirect_uris: redirectUris,
        client_name: clientName || null
      });
      await run`INSERT INTO oauth_clients (client_id, data) VALUES (${clientId}, ${data}::jsonb)`;
    },
    async getOAuthClient(clientId) {
      const run = getSql();
      const rows = await run`SELECT client_id, data FROM oauth_clients WHERE client_id = ${clientId}`;
      return rows[0] ? { client_id: rows[0].client_id, ...rows[0].data } : null;
    },
    async createAuthCode({
      code, clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256',
      vercelAccount = null, mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 600
    }) {
      const run = getSql();
      const data = JSON.stringify({
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod
      });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await run`INSERT INTO oauth_codes
        (code, client_id, data, vercel_account, mode, profile, listing, expires_at)
        VALUES (${hashToken(code)}, ${clientId}, ${data}::jsonb, ${vercelAccount},
          ${mode}, ${profile}, ${listing}, ${expiresAt})`;
    },
    async consumeAuthCode(code) {
      if (typeof code !== 'string' || !code) return null;
      const run = getSql();
      const rows = await run`DELETE FROM oauth_codes WHERE code = ${hashToken(code)}
        AND expires_at > now()
        RETURNING client_id, data, vercel_account, mode, profile, listing`;
      const row = rows[0];
      return row ? { client_id: row.client_id, ...row.data, ...connectionSettings(row) } : null;
    },
    async createAccessToken({
      accessToken, refreshToken, clientId, vercelAccount = null,
      mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 3600
    }) {
      const run = getSql();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await run`INSERT INTO oauth_tokens
        (token_hash, refresh_hash, client_id, vercel_account, mode, profile, listing, expires_at)
        VALUES (${hashToken(accessToken)}, ${refreshToken ? hashToken(refreshToken) : null},
          ${clientId}, ${vercelAccount}, ${mode}, ${profile}, ${listing}, ${expiresAt})`;
    },
    async getAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return null;
      const run = getSql();
      const rows = await run`SELECT client_id, vercel_account, mode, profile, listing, kind,
        expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ${hashToken(accessToken)}
        AND expires_at > now() AND revoked_at IS NULL AND kind = 'connector'`;
      return rows[0] || null;
    },
    async getTokenByRefreshToken(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken) return null;
      const run = getSql();
      const rows = await run`SELECT client_id, vercel_account, mode, profile, listing
        FROM oauth_tokens WHERE refresh_hash = ${hashToken(refreshToken)}
        AND revoked_at IS NULL AND kind = 'connector'`;
      return rows[0] || null;
    },
    async rotateRefreshToken({
      refreshToken, clientId, accessToken, newRefreshToken, ttlSeconds = 3600
    }) {
      const run = getSql();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const rows = await run`UPDATE oauth_tokens SET
        token_hash = ${hashToken(accessToken)}, refresh_hash = ${hashToken(newRefreshToken)},
        expires_at = ${expiresAt}, last_used_at = NULL
        WHERE refresh_hash = ${hashToken(refreshToken)} AND client_id = ${clientId}
          AND revoked_at IS NULL AND kind = 'connector'
        RETURNING client_id, vercel_account, mode, profile, listing`;
      return rows[0] || null;
    },
    async revokeAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return false;
      const run = getSql();
      const rows = await run`UPDATE oauth_tokens SET revoked_at = now()
        WHERE token_hash = ${hashToken(accessToken)} AND revoked_at IS NULL
        RETURNING token_hash`;
      return rows.length > 0;
    },
    async recordLoginAttempt(ip) {
      const run = getSql();
      const rows = await run`INSERT INTO login_attempts (ip, success) VALUES (${ip}, FALSE) RETURNING id`;
      return rows[0].id;
    },
    async markLoginAttemptSucceeded(id) {
      const run = getSql();
      await run`UPDATE login_attempts SET success = TRUE WHERE id = ${id}`;
    },
    async countRecentFailedLogins(ip, minutes = 15) {
      const run = getSql();
      const rows = await run`SELECT count(*)::integer AS count FROM login_attempts
        WHERE ip = ${ip} AND success = FALSE
          AND attempted_at > now() - ${minutes} * interval '1 minute'`;
      return rows[0].count;
    },
    // Atomic, cross-instance reservation: a timed-out write stays pending, not blindly retried.
    requestReplayStore() {
      return {
        async claim({ key, account, mode, tool, ttlMs = 600000 }) {
          if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(key)) {
            throw new TypeError('Invalid write replay key');
          }
          if (!account || !tool || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 600000) {
            throw new TypeError('Invalid write replay scope or lifetime');
          }
          const run = getSql();
          const claimId = randomUUID();
          const expiresAt = new Date(Date.now() + ttlMs);
          // A unique constraint serializes racing callers, even on separate serverless instances.
          const rows = await run`INSERT INTO request_replay
            (request_key, vercel_account, mode, tool, claim_id, expires_at, status)
            VALUES (${key}, ${account}, ${mode}, ${tool}, ${claimId}, ${expiresAt}, 'pending')
            ON CONFLICT (request_key) DO UPDATE SET
              claim_id = EXCLUDED.claim_id, expires_at = EXCLUDED.expires_at,
              vercel_account = EXCLUDED.vercel_account, mode = EXCLUDED.mode,
              tool = EXCLUDED.tool, status = 'pending', result = NULL
            WHERE request_replay.expires_at <= now()
            RETURNING claim_id`;
          if (rows.length) return { state: 'claimed', claimId };
          const existing = await run`SELECT status, result FROM request_replay
            WHERE request_key = ${key} AND expires_at > now()`;
          if (existing[0]?.status === 'completed') return { state: 'completed', result: existing[0].result };
          return { state: 'pending' };
        },
        async complete({ key, claimId, result }) {
          if (!claimId || result === undefined) throw new TypeError('Missing replay claim or shaped result');
          const serialized = JSON.stringify(result);
          if (!serialized || Buffer.byteLength(serialized) > 8192) {
            throw new TypeError('Replay result exceeds the safe storage limit');
          }
          const run = getSql();
          const rows = await run`UPDATE request_replay SET
            status = 'completed', result = ${serialized}::jsonb
            WHERE request_key = ${key} AND claim_id = ${claimId} AND status = 'pending'
            RETURNING request_key`;
          if (!rows.length) throw new Error('The replay claim expired or was replaced; verify the write before retry');
        }
      };
    },
    async initSchema() {
      const run = getSql();
      await run`CREATE TABLE IF NOT EXISTS vercel_accounts (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL, team_slug TEXT NOT NULL, label TEXT NOT NULL,
        scope TEXT NOT NULL, project_id TEXT, project_name TEXT, token_enc TEXT NOT NULL, token_last4 TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ, token_checked_at TIMESTAMPTZ, token_probe JSONB,
        production_enabled BOOLEAN NOT NULL DEFAULT FALSE, spend_limit_cents INTEGER NOT NULL DEFAULT 0,
        sandbox_minutes_per_day INTEGER NOT NULL DEFAULT 60, is_default BOOLEAN NOT NULL DEFAULT FALSE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await run`CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await run`CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY, client_id TEXT NOT NULL, data JSONB NOT NULL, vercel_account TEXT,
        mode TEXT NOT NULL DEFAULT 'preview', profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'catalog', expires_at TIMESTAMPTZ NOT NULL)`;
      await run`CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY, client_id TEXT, refresh_hash TEXT, vercel_account TEXT,
        mode TEXT NOT NULL DEFAULT 'preview', profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'catalog', kind TEXT NOT NULL DEFAULT 'connector',
        expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await run`CREATE TABLE IF NOT EXISTS login_attempts (
        id BIGSERIAL PRIMARY KEY, ip TEXT NOT NULL, attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        success BOOLEAN NOT NULL)`;
      await run`CREATE TABLE IF NOT EXISTS change_log (
        id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), vercel_account TEXT, mode TEXT,
        connection TEXT, tool TEXT NOT NULL, project_id TEXT, target TEXT, summary TEXT NOT NULL,
        before JSONB, after JSONB, dry_run BOOLEAN NOT NULL DEFAULT FALSE, production BOOLEAN NOT NULL DEFAULT FALSE,
        spend_cents BIGINT, request_key TEXT, result JSONB, inverse JSONB, undone_by BIGINT)`;
      await run`CREATE TABLE IF NOT EXISTS one_time_secrets (
        id TEXT PRIMARY KEY, vercel_account TEXT, kind TEXT NOT NULL, label TEXT, ciphertext TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, viewed_at TIMESTAMPTZ)`;
      await run`CREATE TABLE IF NOT EXISTS pending_inputs (
        id TEXT PRIMARY KEY, vercel_account TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
        ciphertext TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ)`;
      await run`CREATE TABLE IF NOT EXISTS protected_resources (
        id BIGSERIAL PRIMARY KEY, vercel_account TEXT, kind TEXT NOT NULL, match TEXT NOT NULL, note TEXT,
        source TEXT NOT NULL DEFAULT 'default', added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE NULLS NOT DISTINCT (vercel_account, kind, match))`;

      await run`CREATE TABLE IF NOT EXISTS request_replay (
        request_key TEXT PRIMARY KEY, vercel_account TEXT NOT NULL, mode TEXT NOT NULL,
        tool TEXT NOT NULL, claim_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ NOT NULL, result JSONB)`;

      await run`CREATE INDEX IF NOT EXISTS change_log_request_key ON change_log (request_key, at)`;
      await run`CREATE INDEX IF NOT EXISTS oauth_codes_expires_at ON oauth_codes (expires_at)`;
      await run`CREATE INDEX IF NOT EXISTS oauth_tokens_refresh_hash ON oauth_tokens (refresh_hash)`;
      await run`CREATE INDEX IF NOT EXISTS oauth_tokens_expires_at ON oauth_tokens (expires_at)`;
      await run`CREATE INDEX IF NOT EXISTS login_attempts_ip_attempted_at ON login_attempts (ip, attempted_at)`;
      await run`CREATE INDEX IF NOT EXISTS change_log_account_at ON change_log (vercel_account, at DESC)`;
      await run`CREATE INDEX IF NOT EXISTS one_time_secrets_expires_at ON one_time_secrets (expires_at)`;
      await run`CREATE INDEX IF NOT EXISTS pending_inputs_expires_at ON pending_inputs (expires_at)`;
    }
  };
}

export const initSchema = () => createDb().initSchema();
