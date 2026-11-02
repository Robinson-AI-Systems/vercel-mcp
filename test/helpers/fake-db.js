// Copied from Robinson-AI-Systems/stripe-mcp test/helpers/fake-db.js @ 6cb3f64 (extended for Vercel MCP A-2/A-3a).
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { SCHEMA_TABLES, connectionSettings } from '../../src/db.js';
import { hashToken } from '../../src/core/oauth.js';

// The public connection id, derived exactly as the real db derives it
// in SQL: 'conn_' || LEFT(md5(token_hash), 20).
const connectionIdOf = (row) =>
  'conn_' + createHash('md5').update(row.token_hash).digest('hex').slice(0, 20);

export function createFakeDb({ clock = () => Date.now(), accounts = [] } = {}) {
  const rows = new Map();
  const blobRows = new Map();
  const accountRows = new Map(accounts.map((account) => [account.id, structuredClone(account)]));
  const tables = new Set();
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();
  const attempts = [];
  const signinFlows = new Map();
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

    // Mirrors the real upsertVercelAccount (src/db.js): the same
    // validation, and the AUD-E semantics — every enrollment resets
    // token_no_expiry and mints a fresh token_version, so a rotated
    // token never inherits the previous key's attestation. AUD-BD:
    // a NEW row is born with production_enabled true (the real
    // upsert writes it explicitly on insert); an existing row's
    // switch is preserved, as the real ON CONFLICT update omits it.
    async upsertVercelAccount({ id, teamId, teamSlug, label, scope, projectId = null,
      projectName = null, tokenEnc, tokenLast4, expiresAt = null, probe }) {
      if (!id || !teamId || !teamSlug || !label ||
        !['team', 'project', 'full'].includes(scope) || !tokenEnc ||
        !/^[a-zA-Z0-9]{4}$/.test(tokenLast4) ||
        (scope === 'project' && !projectId)) throw new TypeError('Invalid Vercel account');
      const existing = accountRows.get(id);
      accountRows.set(id, {
        ...(existing || { production_enabled: true, is_default: false,
          spend_limit_cents: 0, purchase_budget_cents: null, purchase_grant_required: false,
          production_enable_strictness: 'word' }),
        id, team_id: teamId, team_slug: teamSlug, label, scope,
        project_id: projectId, project_name: projectName,
        token_enc: tokenEnc, token_last4: tokenLast4,
        token_expires_at: expiresAt, token_no_expiry: false,
        token_version: randomUUID(), token_probe: probe
      });
    },
    async getAccountCredential(id) {
      if (typeof id !== 'string' || !id) return null;
      const account = accountRows.get(id);
      if (!account) return null;
      return { id: account.id, team_id: account.team_id, scope: account.scope,
        project_id: account.project_id, token_enc: account.token_enc,
        token_expires_at: account.token_expires_at, token_probe: account.token_probe };
    },

    // Mirrors the real Blob store connection methods (src/db.js):
    // the list projection never carries the ciphertext.
    async insertBlobStoreConnection({ account, storeId, label, access = 'public',
      ciphertext, tokenLast4 }) {
      if (!account || !storeId || !label || !ciphertext ||
        !['public', 'private'].includes(access) ||
        !/^[a-zA-Z0-9]{4}$/.test(tokenLast4 || '')) {
        throw new TypeError('Invalid Blob store connection');
      }
      const key = account + '\n' + storeId;
      const existing = blobRows.get(key);
      blobRows.set(key, { account, storeId, label, access, ciphertext, tokenLast4,
        createdAt: existing?.createdAt ?? new Date(clock()), updatedAt: new Date(clock()) });
    },
    async listBlobStoreConnections(account = null) {
      return [...blobRows.values()]
        .filter((row) => account === null || row.account === account)
        .map((row) => ({ account: row.account, storeId: row.storeId, label: row.label,
          access: row.access, tokenLast4: row.tokenLast4,
          createdAt: row.createdAt, updatedAt: row.updatedAt }));
    },
    async getBlobStoreConnectionCiphertext({ account, storeId }) {
      if (!account || !storeId) return null;
      return blobRows.get(account + '\n' + storeId)?.ciphertext ?? null;
    },
    async deleteBlobStoreConnection({ account, storeId }) {
      if (!account || !storeId) return false;
      return blobRows.delete(account + '\n' + storeId);
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

    // SR-1: mirrors the real signin_flows methods (src/db.js) -
    // hash-keyed records, ten-minute TTL on the fake clock, the
    // guarded attest/consume transitions.
    async createSigninFlow({
      handle, clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256',
      clientState = null, resource = null, vercelCodeVerifier, nonce,
      browserBindingHash = null, ttlSeconds = 600
    }) {
      if (!handle || !clientId || !redirectUri || !codeChallenge ||
        codeChallengeMethod !== 'S256' || !vercelCodeVerifier || !nonce ||
        !Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
        throw new TypeError('Invalid sign-in flow');
      }
      signinFlows.set(hashToken(handle), {
        handle_hash: hashToken(handle), client_id: clientId, redirect_uri: redirectUri,
        code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod,
        client_state: clientState, resource, vercel_code_verifier: vercelCodeVerifier,
        nonce, browser_binding_hash: browserBindingHash,
        attested_user_id: null, attested_claims: null, chosen_account: null,
        vercel_state_consumed_at: null, consumed_at: null,
        created_at: clock(), expires_at: clock() + ttlSeconds * 1000
      });
    },
    async getSigninFlow(handle) {
      if (typeof handle !== 'string' || !handle) return null;
      const row = signinFlows.get(hashToken(handle));
      return row ? structuredClone(row) : null;
    },
    async attestSigninFlow({ handle, userId, claims = null }) {
      if (!handle || !userId) throw new TypeError('Invalid sign-in attestation');
      const row = signinFlows.get(hashToken(handle));
      if (!row || row.vercel_state_consumed_at !== null || row.consumed_at !== null ||
        row.expires_at <= clock()) return false;
      row.attested_user_id = userId;
      row.attested_claims = claims === null ? null : structuredClone(claims);
      row.vercel_state_consumed_at = clock();
      return true;
    },
    async consumeSigninFlow({ handle, chosenAccount }) {
      if (!handle || !chosenAccount) return null;
      const row = signinFlows.get(hashToken(handle));
      if (!row || row.consumed_at !== null || row.attested_user_id === null ||
        row.expires_at <= clock()) return null;
      row.consumed_at = clock();
      row.chosen_account = chosenAccount;
      return structuredClone({
        client_id: row.client_id, redirect_uri: row.redirect_uri,
        code_challenge: row.code_challenge,
        code_challenge_method: row.code_challenge_method,
        client_state: row.client_state, resource: row.resource,
        attested_user_id: row.attested_user_id, chosen_account: row.chosen_account
      });
    },

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
        read_only: false,
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
        read_only: row.read_only === true,
        connection_id: connectionIdOf(row),
        expires_at: new Date(row.expires_at),
        revoked_at: null
      };
    },
    async setOwnConnectionReadOnly({ account, connectionId, readOnly }) {
      if (typeof account !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
        typeof connectionId !== 'string' || !/^conn_[a-f0-9]{20}$/.test(connectionId) ||
        typeof readOnly !== 'boolean') {
        throw new TypeError('Invalid connection read-only flip');
      }
      const row = [...tokens.values()].find((item) => item.vercel_account === account &&
        item.kind === 'connector' && !item.revoked_at && item.expires_at > clock() &&
        connectionIdOf(item) === connectionId);
      if (!row) return null;
      const from = row.read_only === true;
      row.read_only = readOnly;
      return { from, to: readOnly };
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
