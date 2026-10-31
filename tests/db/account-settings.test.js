// AUD-AT: the account tools against real Postgres — each envelope
// family goes proposal (tool) → cross-account refusal (unconsumed) →
// inspect (tool, non-consuming) → apply (tool) → the db setter's own
// journaled application, and a replayed reference refuses. The
// direct tools run against the same store: the export's journal row
// and stored result, the protection add, the Blob disconnect. The
// tokenVersion binding is proven at this layer too: a rotation
// between proposal and application surfaces unverified.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { registry } from '../../src/tools/index.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery }
  from '../../test/helpers/pg-neon-adapter.js';

let db;
const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const VERSION = '11111111-2222-3333-4444-555555555555';
const ROTATED = '22222222-3333-4444-5555-666666666666';
const RESULT_OWNER = 'resown_' + 'a'.repeat(64);
const parse = result => JSON.parse(result.content[0].text);
const connectorFor = account =>
  ({ kind: 'connector', account, profile: 'full', mode: 'production',
    listing: 'catalog', resultOwner: RESULT_OWNER });
const call = (name, account, args) =>
  registry.handlers[name](args, { connection: connectorFor(account), db, env, registry });
const propose = async (name, account, args) => {
  const out = parse(await call(name, account, { ...args, confirm: true }));
  expect(out.status).toBe('awaiting_owner_approval');
  return out.reference;
};
const applyRef = (account, reference, extra = { confirm: true }) =>
  call('vercel_apply_owner_approval', account, { reference, ...extra });

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname))
    throw new Error('Disposable localhost PostgreSQL required');
  await openIsolatedSchema(url);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts (id,team_id,team_slug,label,scope,token_enc,token_last4,token_version) VALUES " +
    "('team_ALPHA','team_ALPHA','alpha','Alpha','team','cipher_FAKE_a','1234','" + VERSION + "')," +
    "('team_BETA','team_BETA','beta','Beta','team','cipher_FAKE_b','5678','" + VERSION + "')");
});
afterAll(async () => closeIsolatedSchema());

describe('AUD-AT envelope families on real Postgres', () => {
  it('purchase policy: propose → inspect → apply → journaled; replay and cross-account refuse', async () => {
    const reference = await propose('vercel_set_purchase_policy', 'team_ALPHA',
      { budgetCents: 2500, grantRequired: true });
    expect(parse(await applyRef('team_BETA', reference)).status).toBe('refused_by_guard');
    const dry = parse(await applyRef('team_ALPHA', reference, { dryRun: true }));
    expect(dry).toMatchObject({ status: 'preview', family: 'owner_account_setting',
      summary: 'Set team_ALPHA purchase policy: agent budget $25.00; per-purchase grant required. No spending, purchase or production access is authorized.' });
    const applied = parse(await applyRef('team_ALPHA', reference));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true,
      family: 'owner_account_setting', action: 'purchase_policy' });
    expect(await db.getPurchasePolicy('team_ALPHA')).toEqual(
      { budgetCents: 2500, grantRequired: true });
    // The family's application row is the db setter's own (the
    // proposal's write-path audit shares the tool name; AUD-AS's
    // isolation rule: filter by the setter's exact summary).
    const logs = await rawQuery("SELECT summary FROM change_log WHERE tool='vercel_set_purchase_policy' AND vercel_account='team_ALPHA' AND summary LIKE 'Owner set the purchase policy:%'");
    expect(logs).toHaveLength(1);
    expect(logs[0].summary).toContain('agent budget $25.00; per-purchase grant required');
    expect(parse(await applyRef('team_ALPHA', reference)).status).toBe('refused_by_guard');
  });

  it('token no-expiry: applies bound to the version; a mid-flight rotation is unverified', async () => {
    const first = await propose('vercel_set_token_no_expiry', 'team_ALPHA', { noExpiry: true });
    const applied = parse(await applyRef('team_ALPHA', first));
    expect(applied).toMatchObject({ status: 'applied', action: 'token_no_expiry' });
    expect(await db.getTokenNoExpiry('team_ALPHA')).toBe(true);

    const second = await propose('vercel_set_token_no_expiry', 'team_ALPHA', { noExpiry: false });
    await rawQuery("UPDATE vercel_accounts SET token_version='" + ROTATED + "' WHERE id='team_ALPHA'");
    const out = parse(await applyRef('team_ALPHA', second));
    expect(out).toMatchObject({ status: 'unverified', confirmed: false,
      family: 'owner_account_setting' });
    // The rotated token never inherited a changed attestation.
    expect(await db.getTokenNoExpiry('team_ALPHA')).toBe(true);
    const row = (await rawQuery("SELECT token_version FROM vercel_accounts WHERE id='team_ALPHA'"))[0];
    expect(row.token_version).toBe(ROTATED);
  });

  it('production strictness: applies and journals under the page\'s tool name', async () => {
    const reference = await propose('vercel_set_production_strictness', 'team_BETA',
      { strictness: 'passphrase' });
    const applied = parse(await applyRef('team_BETA', reference));
    expect(applied).toMatchObject({ status: 'applied', action: 'production_strictness' });
    expect(await db.getProductionEnableStrictness('team_BETA')).toBe('passphrase');
    const logs = await rawQuery("SELECT summary FROM change_log WHERE tool='vercel_enable_production' AND vercel_account='team_BETA' AND summary LIKE 'Owner set the production enable strictness%'");
    expect(logs).toHaveLength(1);
  });

  it('clear protected: removes the account\'s project rules and the global defaults, keeps other accounts\' rules', async () => {
    await db.addProtectedResource({ account: 'team_ALPHA', kind: 'project', match: 'alpha-app', note: 'A' });
    await db.addProtectedResource({ account: 'team_BETA', kind: 'project', match: 'beta-app', note: 'B' });
    await rawQuery("INSERT INTO protected_resources (vercel_account,kind,match,note,source) VALUES (NULL,'project','legacy-global','Legacy','setup_page')");
    const reference = await propose('vercel_clear_protected_resources', 'team_ALPHA', {});
    const applied = parse(await applyRef('team_ALPHA', reference));
    expect(applied).toMatchObject({ status: 'applied', action: 'clear_protected' });
    const alpha = await db.listProtectedResources('team_ALPHA');
    expect(alpha.some(r => r.kind === 'project')).toBe(false);
    const beta = await db.listProtectedResources('team_BETA');
    expect(beta.some(r => r.match === 'beta-app')).toBe(true);
    const logs = await rawQuery("SELECT summary FROM change_log WHERE tool='vercel_clear_project_protections' AND vercel_account='team_ALPHA'");
    expect(logs).toHaveLength(1);
  });
});

describe('AUD-AT direct tools on real Postgres', () => {
  it('export: the journal row and the stored result both land, journal first, no token material inside', async () => {
    const out = parse(await call('vercel_export_owner_data', 'team_ALPHA', { confirm: true }));
    expect(out).toMatchObject({ status: 'stored', confirmed: true });
    const logs = await rawQuery("SELECT id FROM change_log WHERE tool='vercel_owner_export_data' AND vercel_account='team_ALPHA'");
    expect(logs).toHaveLength(1);
    const stored = await rawQuery("SELECT body::text AS body, summary FROM result_store WHERE vercel_account='team_ALPHA'");
    expect(stored).toHaveLength(1);
    expect(stored[0].summary).toBe('Owner data export for team_ALPHA');
    expect(stored[0].body).toContain('vercel-by-robinson-ai-systems-owner-export');
    expect(stored[0].body).not.toContain('cipher_FAKE_a');
    expect(stored[0].body).not.toContain('token_enc');
  });

  it('add protected: the rule lands with the db\'s setup_page source and the tool journal row', async () => {
    const out = parse(await call('vercel_add_protected_resource', 'team_BETA',
      { projectName: 'beta-keep', confirm: true }));
    expect(out).toMatchObject({ status: 'applied', confirmed: true });
    const rules = await rawQuery("SELECT note, source FROM protected_resources WHERE vercel_account='team_BETA' AND match='beta-keep'");
    expect(rules).toEqual([{ note: 'Owner protected via owner connection', source: 'setup_page' }]);
    const logs = await rawQuery("SELECT summary FROM change_log WHERE tool='vercel_add_protected_resource' AND vercel_account='team_BETA'");
    expect(logs).toEqual([{ summary: 'Owner added project protection: beta-keep' }]);
  });

  it('disconnect blob store: the connection row is deleted, files untouched by construction', async () => {
    await db.insertBlobStoreConnection({ account: 'team_BETA', storeId: 'store_FAKE9',
      label: 'Uploads', access: 'public', ciphertext: 'cipher_FAKE_blob', tokenLast4: 'FAKE' });
    const out = parse(await call('vercel_disconnect_blob_store', 'team_BETA',
      { storeId: 'store_FAKE9', confirm: true }));
    expect(out).toMatchObject({ status: 'disconnected', confirmed: true });
    expect(await db.listBlobStoreConnections('team_BETA')).toHaveLength(0);
    const again = parse(await call('vercel_disconnect_blob_store', 'team_BETA',
      { storeId: 'store_FAKE9', confirm: true }));
    expect(again).toMatchObject({ status: 'not_found', confirmed: false });
  });
});
