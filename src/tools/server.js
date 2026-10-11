// Account-information tools: strict read-only, never return credentials.
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
      return asText({ account: safe(row), mode: connection.mode,
        profile: connection.profile, listing: connection.listing,
        spendLimitCents: Number(row.spend_limit_cents || 0), spentTodayCents: spent });
    },
    async vercel_list_accounts(_args, { db }) {
      const accounts = await db.listVercelAccounts();
      return asText({ accounts: accounts.map(safe), count: accounts.length });
    }
  }
};
