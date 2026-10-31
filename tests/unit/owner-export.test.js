import { describe, it, expect, vi } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { buildOwnerExport } from '../../src/vercel/owner-export.js';
import { handleSetup } from '../../src/vercel/setup.js';

const env = { TOKEN_ENCRYPTION_KEY: '00'.repeat(32), VERCEL_ENV: 'production',
  ADMIN_PASSPHRASE: 'fixture-owner-passphrase' };
const ACCOUNT = 'acct_1';
// Planted secret-shaped values: none of these may appear anywhere in an
// export, in any section, under any key.
const PLANTED = ['vcp_' + 'PLANTEDTOKENVALUE', 'ciphertext-PLANTED-9876',
  'hash-PLANTED-5432', 'rtc_pass_PLANTEDBEARER'];

function stubDb(overrides = {}) {
  return {
    listVercelAccounts: async () => [{
      id: ACCOUNT, team_id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture',
      scope: 'team', project_id: null, project_name: null,
      production_enabled: true, is_default: true, token_last4: 'FAKE',
      token_expires_at: null, token_no_expiry: true, spend_limit_cents: 0,
      purchase_budget_cents: null, purchase_grant_required: false,
      token_ciphertext: PLANTED[1], token: PLANTED[0]
    }],
    listAccountConnections: async () => [{
      id: 'conn_0123456789abcdef01', client_id: 'client_FAKE',
      vercel_account: ACCOUNT, mode: 'production', profile: 'full',
      listing: 'front_door', kind: 'connector', created_at: '2026-10-01T00:00:00.000Z',
      last_used_at: null, expires_at: '2026-11-01T00:00:00.000Z', revoked_at: null,
      token_hash: PLANTED[2], access_token: PLANTED[0]
    }],
    listRtcPasses: async () => [{
      pass_id: 'pass_0123456789abcdef01', mode: 'preview', areas: ['server'],
      rate_limit_per_minute: 120, expires_at: '2026-10-31T00:00:00.000Z',
      revoked_at: null, created_at: '2026-10-30T00:00:00.000Z',
      token_hash: PLANTED[2], bearer: PLANTED[3]
    }],
    listProtectedResources: async () => [
      { kind: 'project', match: 'fixture-app', note: 'Owner protected', source: 'owner' }],
    listKnownApps: async () => [{
      id: 'app_fixture', name: 'Fixture App', status: 'active', account: ACCOUNT,
      source: 'owner', profile: { projects: ['fixture-app'] },
      updatedAt: '2026-10-30T00:00:00.000Z' }],
    listBlobStoreConnections: async () => [{
      account: ACCOUNT, storeId: 'store_FAKE1', label: 'Uploads', access: 'public',
      tokenLast4: 'FAKE', createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z', ciphertext: PLANTED[1] }],
    getPurchasePolicy: async () => ({ budgetCents: 2500, grantRequired: false }),
    getProductionEnableStrictness: async () => 'word',
    exportChanges: async () => ({ total: 2, rows: [
      { id: 9, at: '2026-10-30T00:00:00.000Z', tool: 'vercel_env_set',
        project_id: 'prj_FAKE', mode: 'preview', summary: 'Set one variable',
        dry_run: false, production: false, spend_cents: null,
        before: { value: PLANTED[0] } },
      { id: 8, at: '2026-10-29T00:00:00.000Z', tool: 'vercel_deploy_create',
        project_id: 'prj_FAKE', mode: 'preview', summary: 'Created a preview',
        dry_run: false, production: false, spend_cents: null }] }),
    ...overrides
  };
}

describe('buildOwnerExport', () => {
  it('composes every section through the allowlist projections', async () => {
    const out = await buildOwnerExport({ db: stubDb(), account: ACCOUNT,
      now: () => new Date('2026-10-30T12:00:00.000Z') });
    expect(out.format).toBe('vercel-by-robinson-ai-systems-owner-export');
    expect(out.exportedAt).toBe('2026-10-30T12:00:00.000Z');
    expect(out.subject.token_last4).toBe('FAKE');
    expect(out.connections.rows).toHaveLength(1);
    expect(out.connections.rows[0].profile).toBe('full');
    expect(out.passes[0].pass_id).toBe('pass_0123456789abcdef01');
    expect(out.protectedResources[0].match).toBe('fixture-app');
    expect(out.settings).toEqual({ purchaseBudgetCents: 2500,
      purchaseGrantRequired: false, productionEnableStrictness: 'word' });
    expect(out.knownApps[0].profile).toEqual({ projects: ['fixture-app'] });
    expect(out.blobStores[0].tokenLast4).toBe('FAKE');
    expect(out.changes.total).toBe(2);
    expect(out.changes.included).toBe(2);
    expect(out.changes.truncated).toBe(false);
    const serialized = JSON.stringify(out);
    for (const planted of PLANTED) expect(serialized).not.toContain(planted);
    expect(serialized).not.toContain('token_ciphertext');
    expect(serialized).not.toContain('token_hash');
  });

  it('refuses an unknown or malformed account', async () => {
    await expect(buildOwnerExport({ db: stubDb(), account: 'acct_missing' }))
      .rejects.toThrow('Owner export account unavailable');
    await expect(buildOwnerExport({ db: stubDb(), account: 'x' }))
      .rejects.toThrow('Owner export unavailable');
  });

  it('marks one failed section unavailable and keeps the rest honest', async () => {
    const db = stubDb({ listRtcPasses: async () => { throw new Error('db down'); } });
    const out = await buildOwnerExport({ db, account: ACCOUNT });
    expect(out.passes).toEqual({ unavailable: true, reason: 'read_failed' });
    expect(out.subject.id).toBe(ACCOUNT);
    expect(out.changes.total).toBe(2);
  });

  it('states truncation when the journal exceeds the cap', async () => {
    const db = stubDb({ exportChanges: async () => ({ total: 900, rows: [
      { id: 1, at: '2026-10-30T00:00:00.000Z', tool: 'vercel_env_set',
        project_id: null, mode: 'preview', summary: 'x', dry_run: false,
        production: false, spend_cents: null }] }) });
    const out = await buildOwnerExport({ db, account: ACCOUNT });
    expect(out.changes.truncated).toBe(true);
    expect(out.changes.included).toBe(1);
  });
});

function response() {
  const headers = {};
  return { headers, statusCode: 200, body: '',
    setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    send(v) { this.body = v; return this; },
    json(v) { this.body = JSON.stringify(v); return this; },
    end() { return this; } };
}
function harness() {
  const db = createFakeDb({ accounts: [{ id: ACCOUNT, team_id: 'team_FAKE',
    team_slug: 'fixture', label: 'Fixture', scope: 'team' }] });
  const journal = [];
  Object.assign(db, {
    listAccountConnections: async () => (await stubDb().listAccountConnections()),
    listRtcPasses: async () => (await stubDb().listRtcPasses()),
    listProtectedResources: async () => (await stubDb().listProtectedResources()),
    listKnownApps: async () => (await stubDb().listKnownApps()),
    listBlobStoreConnections: async () => (await stubDb().listBlobStoreConnections()),
    exportChanges: async () => (await stubDb().exportChanges()),
    recordChange: async (entry) => { journal.push(entry); }
  });
  const call = async (method, body, cookie) => {
    const res = response();
    await handleSetup({ method, body, query: {}, headers: {
      'x-real-ip': '127.0.0.1', ...(cookie ? { cookie } : {}) } }, res,
      { db, env, storeTokenFn: vi.fn() });
    return res;
  };
  return { db, call, journal };
}
async function signIn(h) {
  const logged = await h.call('POST', { action: 'login',
    passphrase: env.ADMIN_PASSPHRASE });
  const cookie = logged.headers['set-cookie'].split(';')[0];
  const page = await h.call('GET', null, cookie);
  const csrf = page.body.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
  return { cookie, csrf, page };
}

describe('setup owner export action', () => {
  it('renders the export section on the signed-in panel', async () => {
    const h = harness();
    const { page } = await signIn(h);
    expect(page.body).toContain('Export your data');
    expect(page.body).toContain('export_owner_data');
  });

  it('refuses without a session and with a wrong passphrase', async () => {
    const h = harness();
    const anon = await h.call('POST', { action: 'export_owner_data',
      account: ACCOUNT, confirm: 'yes', passphrase: env.ADMIN_PASSPHRASE });
    expect(anon.statusCode).toBe(403);
    const { cookie, csrf } = await signIn(h);
    const wrong = await h.call('POST', { action: 'export_owner_data', csrf,
      account: ACCOUNT, confirm: 'yes', passphrase: 'not-the-passphrase' }, cookie);
    expect(wrong.statusCode).toBe(401);
    expect(h.journal).toHaveLength(0);
  });

  it('downloads the journaled export with no planted secret anywhere', async () => {
    const h = harness();
    const { cookie, csrf } = await signIn(h);
    const res = await h.call('POST', { action: 'export_owner_data', csrf,
      account: ACCOUNT, confirm: 'yes', passphrase: env.ADMIN_PASSPHRASE }, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="owner-export-acct_1-\d{4}-\d{2}-\d{2}\.json"$/);
    const parsed = JSON.parse(res.body);
    expect(parsed.format).toBe('vercel-by-robinson-ai-systems-owner-export');
    expect(parsed.subject.id).toBe(ACCOUNT);
    for (const planted of PLANTED) expect(res.body).not.toContain(planted);
    expect(h.journal).toHaveLength(1);
    expect(h.journal[0].tool).toBe('vercel_owner_export_data');
    expect(h.journal[0].account).toBe(ACCOUNT);
  });
});
