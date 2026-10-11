import { describe, it, expect } from 'vitest';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { registry } from '../../src/tools/index.js';
const rows = [{ id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture Team', scope: 'team',
  production_enabled: false, token_last4: '1234', token_expires_at: null,
  spend_limit_cents: 0, token_enc: 'DO_NOT_EXPOSE_CIPHERTEXT' }];
const db = { listVercelAccounts: async () => rows, getTodaySpendCents: async () => 235 };
const conn = { account: 'team_FAKE', mode: 'preview', profile: 'read_only', listing: 'compact' };
const call = (name, connection = conn) => dispatchReadOnlyTool({ registry, name, connection, db });
describe('A-5 account read tools', () => {
  it('whoami shows scope and spend but never encrypted data', async () => {
    const result = await call('vercel_whoami');
    expect(JSON.parse(result.content[0].text).account.team).toBe('fixture');
    expect(JSON.parse(result.content[0].text).spentTodayCents).toBe(235);
    expect(result.content[0].text).not.toContain('DO_NOT_EXPOSE_CIPHERTEXT');
  });
  it('lists safe metadata and rejects missing connections', async () => {
    const result = await call('vercel_list_accounts');
    expect(JSON.parse(result.content[0].text).count).toBe(1);
    expect(result.content[0].text).not.toContain('DO_NOT_EXPOSE_CIPHERTEXT');
    expect((await call('vercel_whoami', { ...conn, account: 'unknown' })).isError).toBe(true);
    expect((await call('vercel_unknown')).isError).toBe(true);
  });
});
