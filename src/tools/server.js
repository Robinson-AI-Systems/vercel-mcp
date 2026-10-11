// Account-information tools: strict read-only, never return credentials.
import { recheckStoredToken } from '../vercel/tokens.js';
const PROFILES = ['read_only', 'everyday', 'full'];
const asText = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
function safe(row) {
  return { id: row.id, team: row.team_slug, label: row.label,
    scope: row.scope, project: row.project_name || null,
    productionEnabled: Boolean(row.production_enabled),
    lastFour: row.token_last4 || null, tokenExpiresAt: row.token_expires_at || null };
}
export const serverTools = {
  tools: [
    { name: 'vercel_whoami',
      description: 'Show your Vercel team, account scope, connection profile and safe token metadata.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }, writes: false, profiles: PROFILES },
    { name: 'vercel_list_accounts',
      description: 'List configured Vercel teams and project accounts without exposing credentials.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }, writes: false, profiles: PROFILES },
    { name: 'vercel_check_token',
      description: 'Safely recheck stored Vercel token read access; does not prove write permissions.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }, writes: false, profiles: PROFILES }
  ],
  handlers: {
    async vercel_whoami(_args, { connection, db }) {
      const accounts = await db.listVercelAccounts();
      const row = accounts.find(account => account.id === connection.account);
      if (!row) return { isError: true,
        content: [{ type: 'text', text: 'No Vercel account is connected' }] };
      const spent = typeof db.getTodaySpendCents === 'function'
        ? await db.getTodaySpendCents(row.id) : null;
      const expiry = row.token_expires_at && new Date(row.token_expires_at).getTime();
      const daysLeft = Number.isFinite(expiry) ? Math.ceil((expiry - Date.now()) / 86400000) : null;
      const tokenWarning = daysLeft === null ? null : daysLeft <= 0 ?
        'Vercel token expired; rotate it using the authenticated owner setup page.' :
        daysLeft <= 14 ? 'Vercel token expires within ' + daysLeft +
          ' days; verify renewal through owner setup.' : null;
      return asText({ account: safe(row), mode: connection.mode,
        profile: connection.profile, listing: connection.listing,
        spendLimitCents: Number(row.spend_limit_cents || 0), spentTodayCents: spent,
        tokenWarning });
    },
    async vercel_list_accounts(args, { connection, db }) {
      // A connector is bound to one Vercel account. The owner setup page,
      // not an arbitrary OAuth connection, can enumerate every configured team.
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).length !== 0) {
        return { isError: true, content: [{ type: 'text', text: 'This tool takes no arguments' }] };
      }
      if (typeof connection?.account !== 'string' || !connection.account ||
          typeof db.getVercelAccountSafe !== 'function') {
        throw new Error('Authenticated account lookup unavailable');
      }
      const account = await db.getVercelAccountSafe(connection.account);
      if (!account) return { isError: true, content: [{ type: 'text',
        text: 'No Vercel account is connected' }] };
      return asText({ accounts: [safe(account)], count: 1 });
    },
    async vercel_check_token(args, { connection, db, env, fetchImpl }) {
      // The MCP dispatcher does not currently enforce argument schemas itself.
      // Reject every caller-supplied token, account selector and privilege flag.
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).length !== 0) {
        return { isError: true, content: [{ type: 'text', text: 'This tool takes no arguments' }] };
      }
      if (typeof connection?.account !== 'string') throw new Error('Connection account unavailable');
      return asText(await recheckStoredToken({
        db, accountId: connection.account, env, fetchImpl
      }));
    }
  }
};
