import { describe, it, expect } from 'vitest';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { registry } from '../../src/tools/index.js';
const rows = [{ id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture Team', scope: 'team',
  production_enabled: false, token_last4: '1234', token_expires_at: null,
  spend_limit_cents: 0, purchase_budget_cents: 2500, purchase_grant_required: true,
  token_enc: 'DO_NOT_EXPOSE_CIPHERTEXT' }];
const db = { listVercelAccounts: async () => rows, getTodaySpendCents: async () => 235,
  getVercelAccountSafe: async id => rows.find(row => row.id === id) || null };
const conn = { account: 'team_FAKE', mode: 'preview', profile: 'read_only', listing: 'compact' };
const call = (name, connection = conn) => dispatchReadOnlyTool({ registry, name, connection, db });
describe('A-5 account read tools', () => {
  it('whoami shows scope and spend but never encrypted data', async () => {
    const result = await call('vercel_whoami');
    expect(JSON.parse(result.content[0].text).account.team).toBe('fixture');
    expect(JSON.parse(result.content[0].text).spentTodayCents).toBe(235);
    expect(result.content[0].text).not.toContain('DO_NOT_EXPOSE_CIPHERTEXT');
  });
  it('whoami reports the standing purchase policy beside the spend fields (AUD-A1)', async () => {
    const parsed = JSON.parse((await call('vercel_whoami')).content[0].text);
    expect(parsed.spendLimitCents).toBe(0);
    expect(parsed.purchaseBudgetCents).toBe(2500);
    expect(parsed.purchaseGrantRequired).toBe(true);
  });
  it('whoami reports a null budget and no grant opt-in when no policy is set (AUD-A1)', async () => {
    const bare = [{ id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture Team', scope: 'team',
      production_enabled: false, token_last4: '1234', token_expires_at: null,
      spend_limit_cents: 0 }];
    const bareDb = { listVercelAccounts: async () => bare,
      getTodaySpendCents: async () => 0,
      getVercelAccountSafe: async id => bare.find(row => row.id === id) || null };
    const result = await dispatchReadOnlyTool({ registry, name: 'vercel_whoami', connection: conn, db: bareDb });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.purchaseBudgetCents).toBeNull();
    expect(parsed.purchaseGrantRequired).toBe(false);
  });
  it('whoami reports an expiring token with daysLeft, posture and the existing warning (AUD-E)', async () => {
    const expiring = [{ id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture Team', scope: 'team',
      production_enabled: false, token_last4: '1234',
      token_expires_at: new Date(Date.now() + 10 * 86400000).toISOString(),
      spend_limit_cents: 0 }];
    const expDb = { listVercelAccounts: async () => expiring,
      getTodaySpendCents: async () => 0,
      getVercelAccountSafe: async id => expiring.find(row => row.id === id) || null };
    const parsed = JSON.parse((await dispatchReadOnlyTool({
      registry, name: 'vercel_whoami', connection: conn, db: expDb })).content[0].text);
    expect(parsed.expiryPosture).toBe('expiring');
    expect(parsed.daysLeft).toBe(10);
    expect(parsed.expiresAt).toBe(expiring[0].token_expires_at);
    expect(parsed.expiresAtLocal).toBeTruthy();
    expect(parsed.account.tokenExpiresAt).toBe(expiring[0].token_expires_at);
    expect(parsed.tokenWarning).toBe(
      'Vercel token expires within 10 days; verify renewal through the enrollment step of the sign-in flow.');
  });
  it('whoami reports a token expiring in 30 days with posture fields but no warning (AUD-E)', async () => {
    const later = [{ id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture Team', scope: 'team',
      production_enabled: false, token_last4: '1234',
      token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      spend_limit_cents: 0 }];
    const laterDb = { listVercelAccounts: async () => later,
      getTodaySpendCents: async () => 0,
      getVercelAccountSafe: async id => later.find(row => row.id === id) || null };
    const parsed = JSON.parse((await dispatchReadOnlyTool({
      registry, name: 'vercel_whoami', connection: conn, db: laterDb })).content[0].text);
    expect(parsed.expiryPosture).toBe('expiring');
    expect(parsed.daysLeft).toBe(30);
    expect(parsed.tokenWarning).toBeNull();
  });
  it('whoami reports an expired token with the expired posture and warning intact (AUD-E)', async () => {
    const expired = [{ id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture Team', scope: 'team',
      production_enabled: false, token_last4: '1234',
      token_expires_at: new Date(Date.now() - 86400000).toISOString(),
      spend_limit_cents: 0 }];
    const expDb = { listVercelAccounts: async () => expired,
      getTodaySpendCents: async () => 0,
      getVercelAccountSafe: async id => expired.find(row => row.id === id) || null };
    const parsed = JSON.parse((await dispatchReadOnlyTool({
      registry, name: 'vercel_whoami', connection: conn, db: expDb })).content[0].text);
    expect(parsed.expiryPosture).toBe('expired');
    expect(parsed.daysLeft).toBeLessThanOrEqual(0);
    expect(parsed.tokenWarning).toBe(
      'Vercel token expired; rotate it through the enrollment step of the sign-in flow.');
  });
  it('whoami reports an attested never-expiring token as no_expiry — owner choice, no warning (AUD-E)', async () => {
    const attested = [{ id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture Team', scope: 'team',
      production_enabled: false, token_last4: '1234', token_expires_at: null,
      token_no_expiry: true, spend_limit_cents: 0 }];
    const attDb = { listVercelAccounts: async () => attested,
      getTodaySpendCents: async () => 0,
      getVercelAccountSafe: async id => attested.find(row => row.id === id) || null };
    const parsed = JSON.parse((await dispatchReadOnlyTool({
      registry, name: 'vercel_whoami', connection: conn, db: attDb })).content[0].text);
    expect(parsed.expiryPosture).toBe('no_expiry');
    expect(parsed.expiryPostureText).toBe("no expiry — owner's choice");
    expect(parsed.expiresAt).toBeNull();
    expect(parsed.daysLeft).toBeNull();
    expect(parsed.tokenWarning).toBeNull();
    expect(parsed.account.tokenNoExpiry).toBe(true);
  });
  it('whoami reports an unattested null-expiry token as unknown, never owner choice (AUD-E regression)', async () => {
    // The default fixture row is exactly today's enrollment shape:
    // token_expires_at null (storeToken writes null unconditionally) and
    // no attestation recorded.
    const parsed = JSON.parse((await call('vercel_whoami')).content[0].text);
    expect(parsed.expiryPosture).toBe('unknown');
    expect(parsed.expiryPostureText).toBe('expiry not recorded for this token');
    expect(parsed.expiryPostureText).not.toContain("owner's choice");
    expect(parsed.expiresAt).toBeNull();
    expect(parsed.daysLeft).toBeNull();
    expect(parsed.tokenWarning).toBeNull();
  });
  it('the no-expiry attestation is proposal-only over MCP — an agent call never sets it (AUD-E, as amended by AUD-AT)', async () => {
    // AUD-E's property was that no agent action can attest. AUD-AT
    // keeps it in envelope form: vercel_set_token_no_expiry only
    // proposes (approvalOnly, bound to the token version); the
    // attestation lands solely when the owner applies the envelope
    // through vercel_apply_owner_approval. Behavioral proof lives
    // in tests/unit/account-settings.test.js and
    // tests/db/account-settings.test.js.
    const attempt = await dispatchReadOnlyTool({
      registry, name: 'vercel_set_token_no_expiry',
      args: { attested: true }, connection: conn, db });
    expect(attempt.isError).toBe(true);
    // And a well-formed call on a full connection still only
    // proposes: an envelope is issued and the db setter — the only
    // path that could attest — is never called by the tool itself.
    const secrets = new Map();
    const proposalDb = {
      listVercelAccounts: async () => [{ id: 'team_FAKE',
        token_version: '11111111-2222-3333-4444-555555555555' }],
      listProtectedResources: async () => [],
      recordChange: async () => 1,
      requestReplayStore: () => ({
        claim: async () => ({ state: 'claimed', claimId: 'FAKE' }),
        complete: async () => {}, release: async () => {} }),
      insertOneTimeSecret: async row => {
        secrets.set(row.id, { ...row, vercel_account: row.account,
          expires_at: row.expiresAt, viewed_at: null });
      },
      getAccountSettingRequest: async ({ account, reference }) => {
        const row = secrets.get(reference);
        return row && row.kind === 'owner_account_setting' &&
          row.vercel_account === account && !row.viewed_at &&
          new Date(row.expires_at).getTime() > Date.now() ? row : null;
      },
      consumeOneTimeSecret: async ({ id, account }) => {
        const row = secrets.get(id);
        if (!row || row.vercel_account !== account || row.viewed_at ||
          new Date(row.expires_at).getTime() <= Date.now()) return null;
        row.viewed_at = new Date(); return row;
      },
      setTokenNoExpiry: async () => {
        throw new Error('a proposal must never call the setter');
      }
    };
    const proposed = await dispatchReadOnlyTool({
      registry, name: 'vercel_set_token_no_expiry',
      args: { noExpiry: true, confirm: true },
      connection: { account: 'team_FAKE', mode: 'production', profile: 'full',
        listing: 'catalog', kind: 'connector' },
      db: proposalDb,
      env: { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: '00'.repeat(32) } });
    expect(JSON.parse(proposed.content[0].text).status).toBe('awaiting_owner_approval');
    expect(secrets.size).toBe(1);
  });
  it('TEST whoami never loads account records or provider resources',async()=>{
    const noAccounts={listVercelAccounts:async()=>{throw new Error('must not query');}};
    const result=await dispatchReadOnlyTool({registry,name:'vercel_whoami',
      args:{},connection:{...conn,mode:'test'},db:noAccounts});
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      rtc:1,mode:'test',scope:'service_only',providerAccess:false});
    expect(result.content[0].text).not.toContain('team_FAKE');
  });
  it('does not enumerate other account names, tokens or settings through an OAuth connection',async()=>{
    const extra = {id:'team_OTHER',team_slug:'other-private',label:'DO_NOT_LEAK_OTHER_ACCOUNT',
      scope:'full',token_enc:'DO_NOT_LEAK_CIPHERTEXT',spend_limit_cents:999999};
    rows.push(extra);
    try {
      const result=await call('vercel_list_accounts');
      expect(JSON.parse(result.content[0].text).count).toBe(1);
      expect(result.content[0].text).not.toContain('team_OTHER');
      expect(result.content[0].text).not.toContain('DO_NOT_LEAK');
      expect(result.content[0].text).not.toContain('999999');
      const reverse=await call('vercel_list_accounts',{...conn,account:'team_OTHER'});
      expect(JSON.parse(reverse.content[0].text).accounts[0].id).toBe('team_OTHER');
    } finally {rows.pop();}
  });
  it('rejects argument-based enumeration before account lookup',async()=>{
    const invalid=await dispatchReadOnlyTool({
      registry,name:'vercel_list_accounts',args:{account:'team_OTHER'},connection:conn,db
    });
    expect(invalid.isError).toBe(true);
  });
  it('lists safe metadata and rejects missing connections', async () => {
    const result = await call('vercel_list_accounts');
    expect(JSON.parse(result.content[0].text).count).toBe(1);
    expect(result.content[0].text).not.toContain('DO_NOT_EXPOSE_CIPHERTEXT');
    expect((await call('vercel_list_accounts',{...conn,account:'unknown'})).isError).toBe(true);
    expect((await call('vercel_whoami', { ...conn, account: 'unknown' })).isError).toBe(true);
    expect((await call('vercel_unknown')).isError).toBe(true);
  });
});
