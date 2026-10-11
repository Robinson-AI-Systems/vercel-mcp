// Database schema and the only SQL entry point for Robinson Vercel MCP.
// Additive by design: schema initialization never drops or rewrites existing data.
import { neon } from '@neondatabase/serverless';

export const SCHEMA_TABLES = Object.freeze([
  'vercel_accounts', 'oauth_clients', 'oauth_codes', 'oauth_tokens', 'login_attempts',
  'change_log', 'one_time_secrets', 'pending_inputs', 'protected_resources'
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
