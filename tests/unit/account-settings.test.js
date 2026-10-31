// AUD-AT: account tools for the form-only owner actions (sign-in
// cleanup dossier §2.5). Unit level: per-tool parity with the
// setup-page actions (their suites are tests/unit/setup-page.test.js
// and tests/unit/protected-setup.test.js), the export's journal-first
// invariant, the envelope families end-to-end through
// vercel_apply_owner_approval over an in-memory store, the
// tokenVersion binding (stale-version refusal both ways) and the
// pass-kind boundary at the real dispatch boundary. The same
// families against real Postgres live in
// tests/db/account-settings.test.js.
import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { encryptSecret } from '../../src/core/secret-box.js';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { accountSettingsTools } from '../../src/tools/account-settings.js';
import { ownerApplyTools } from '../../src/tools/owner-apply.js';
import { buildOwnerExport } from '../../src/vercel/owner-export.js';

const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const VERSION = '11111111-2222-3333-4444-555555555555';
const STALE_VERSION = '99999999-8888-7777-6666-555555555555';
const RESULT_OWNER = 'resown_' + 'a'.repeat(64);
const connector = { kind: 'connector', account: 'team_FAKE', profile: 'full',
  mode: 'production', listing: 'catalog', resultOwner: RESULT_OWNER };
const fullPass = { kind: 'pass', account: 'team_FAKE', profile: 'full',
  mode: 'production', listing: 'catalog', resultOwner: RESULT_OWNER };
const H = accountSettingsTools.handlers;
const applyHandler = ownerApplyTools.handlers.vercel_apply_owner_approval;
const parse = result => JSON.parse(result.content[0].text);
// Planted secret-shaped values (owner-export.test.js): none may
// appear in a stored export, in any section, under any key.
const PLANTED = ['vcp_' + 'PLANTEDTOKENVALUE', 'ciphertext-PLANTED-9876',
  'hash-PLANTED-5432', 'rtc_pass_PLANTEDBEARER'];

function fixture({ journalExportFails = false } = {}) {
  const secrets = new Map(), changes = [], order = [], stored = [];
  const protectedRules = [{ kind: 'project', match: 'legacy-app',
    note: 'Legacy', source: 'setup_page' }];
  const replayRows = new Map();
  const db = createFakeDb({ accounts: [
    { id: 'team_FAKE', team_id: 'team_FAKE', team_slug: 'fixture', label: 'Fixture',
      scope: 'team', token_version: VERSION, token_last4: 'FAKE' },
    { id: 'team_OTHER', team_id: 'team_OTHER', team_slug: 'other', label: 'Other',
      scope: 'team', token_version: VERSION, token_last4: 'FAKE' }
  ] });
  Object.assign(db, {
    async insertOneTimeSecret(row) {
      secrets.set(row.id, { ...row, vercel_account: row.account,
        expires_at: row.expiresAt, viewed_at: null });
    },
    async consumeOneTimeSecret({ id, account }) {
      const row = secrets.get(id);
      if (!row || row.vercel_account !== account || row.viewed_at ||
        new Date(row.expires_at).getTime() <= Date.now()) return null;
      row.viewed_at = new Date(); return row;
    },
    async getAccountSettingRequest({ account, reference }) {
      const row = secrets.get(reference);
      return row && row.kind === 'owner_account_setting' &&
        row.vercel_account === account && !row.viewed_at &&
        new Date(row.expires_at).getTime() > Date.now() ? row : null;
    },
    async getOwnerApprovalRequest() { return null; },
    async getRtcPassRequest() { return null; },
    async getProductionEnableRequest() { return null; },
    async getPurchaseIntent() { return null; },
    async recordChange(entry) {
      if (journalExportFails && entry.tool === 'vercel_owner_export_data') {
        throw new Error('journal unavailable');
      }
      changes.push(entry); order.push('journal:' + entry.tool); return changes.length;
    },
    requestReplayStore: () => ({
      claim: async ({ key }) => {
        if (replayRows.has(key)) return replayRows.get(key);
        replayRows.set(key, { state: 'pending' }); return { state: 'claimed', claimId: 'FAKE' };
      },
      complete: async ({ key, result }) => replayRows.set(key, { state: 'completed', result }),
      release: async ({ key }) => replayRows.delete(key)
    }),
    async listProtectedResources() { return protectedRules.map(r => ({ ...r })); },
    async addProtectedResource({ account, kind, match, note }) {
      protectedRules.push({ account, kind, match, note, source: 'setup_page' });
    },
    async clearProtectedProjectRules(account) {
      for (let i = protectedRules.length - 1; i >= 0; i--) {
        if (protectedRules[i].account === account || protectedRules[i].account === undefined) {
          protectedRules.splice(i, 1);
        }
      }
      return true;
    },
    async putResult({ account, owner, summary, body }) {
      order.push('store');
      stored.push({ account, owner, summary, body });
      return { handle: 'res_' + 'f'.repeat(32), expiresAt: '2026-11-01T00:00:00.000Z' };
    },
    // The owner-export.test.js section stubs, planted secrets included.
    listAccountConnections: async () => [{
      id: 'conn_0123456789abcdef01', client_id: 'client_FAKE',
      vercel_account: 'team_FAKE', mode: 'production', profile: 'full',
      listing: 'front_door', kind: 'connector', created_at: '2026-10-01T00:00:00.000Z',
      last_used_at: null, expires_at: '2026-11-01T00:00:00.000Z', revoked_at: null,
      token_hash: PLANTED[2], access_token: PLANTED[0] }],
    listRtcPasses: async () => [{
      pass_id: 'pass_0123456789abcdef01', mode: 'preview', areas: ['server'],
      rate_limit_per_minute: 120, expires_at: '2026-10-31T00:00:00.000Z',
      revoked_at: null, created_at: '2026-10-30T00:00:00.000Z',
      token_hash: PLANTED[2], bearer: PLANTED[3] }],
    listKnownApps: async () => [{
      id: 'app_fixture', name: 'Fixture App', status: 'active', account: 'team_FAKE',
      source: 'owner', profile: { projects: ['fixture-app'] },
      updatedAt: '2026-10-30T00:00:00.000Z' }],
    exportChanges: async () => ({ total: 1, rows: [
      { id: 9, at: '2026-10-30T00:00:00.000Z', tool: 'vercel_env_set',
        project_id: 'prj_FAKE', mode: 'preview', summary: 'Set one variable',
        dry_run: false, production: false, spend_cents: null,
        before: { value: PLANTED[0] } }] })
  });
  return { db, secrets, changes, order, stored, protectedRules };
}
const ctx = (f, connection = connector) => ({ connection, db: f.db, env, registry });
async function propose(f, tool, args, connection = connector) {
  const out = parse(await H[tool]({ ...args, confirm: true }, ctx(f, connection)));
  expect(out.status).toBe('awaiting_owner_approval');
  return out.reference;
}
async function applyRef(f, reference, connection = connector) {
  return parse(await applyHandler({ reference, confirm: true }, ctx(f, connection)));
}

describe('AUD-AT vercel_export_owner_data', () => {
  it('stores an export shaped exactly like the page export, journaled before it is stored', async () => {
    const f = fixture();
    const out = parse(await H.vercel_export_owner_data({ confirm: true }, ctx(f)));
    expect(out).toMatchObject({ status: 'stored', confirmed: true,
      readBackWith: 'vercel_get_result' });
    expect(out.handle).toMatch(/^res_/);
    expect(f.stored).toHaveLength(1);
    // Journal-first (O-5b): the change_log row lands before the store.
    expect(f.order).toEqual(['journal:vercel_owner_export_data', 'store']);
    expect(f.changes[0]).toMatchObject({ account: 'team_FAKE',
      tool: 'vercel_owner_export_data', mode: 'production', dryRun: false,
      summary: 'Owner exported account data (metadata, connections, passes, settings, change log) — no token values' });
    // Byte-identical in shape to buildOwnerExport's page output for
    // the same store (the timestamp is the one the body reports).
    const body = f.stored[0].body;
    const expected = await buildOwnerExport({ db: f.db, account: 'team_FAKE',
      now: () => new Date(body.exportedAt) });
    expect(body).toEqual(expected);
    const serialized = JSON.stringify(body);
    for (const planted of PLANTED) expect(serialized).not.toContain(planted);
  });

  it('a failed journal write serves no export and stores nothing', async () => {
    const f = fixture({ journalExportFails: true });
    const out = parse(await H.vercel_export_owner_data({ confirm: true }, ctx(f)));
    expect(out).toMatchObject({ status: 'refused_by_guard', confirmed: false,
      reason: 'The export could not be completed. Nothing was stored.' });
    expect(f.stored).toHaveLength(0);
    expect(f.order).not.toContain('store');
  });

  it('previews and needs confirmation before anything is journaled or stored', async () => {
    const f = fixture();
    const dry = parse(await H.vercel_export_owner_data({ dryRun: true }, ctx(f)));
    expect(dry.status).toBe('preview');
    expect(dry.preview).toContain('most recent 500 entries');
    const bare = parse(await H.vercel_export_owner_data({}, ctx(f)));
    expect(bare.status).toBe('needs_confirmation');
    expect(f.stored).toHaveLength(0);
    expect(f.changes).toHaveLength(0);
  });

  it('refuses a delegated pass at the handler, through the real dispatch boundary', async () => {
    const f = fixture();
    const out = await dispatchReadOnlyTool({ registry, name: 'vercel_export_owner_data',
      args: { confirm: true }, connection: fullPass, db: f.db, env });
    expect(out.isError).toBe(true);
    expect(parse(out).reason).toContain('a delegated pass can never export owner data');
    expect(f.stored).toHaveLength(0);
    const everyday = await dispatchReadOnlyTool({ registry, name: 'vercel_export_owner_data',
      args: { confirm: true },
      connection: { kind: 'pass', account: 'team_FAKE', profile: 'everyday', mode: 'preview', listing: 'catalog' },
      db: f.db, env });
    expect(everyday.content[0].text).toContain('Tool unavailable');
  });

  it('refuses on the preview server and on unknown arguments', async () => {
    const f = fixture();
    const offProd = parse(await H.vercel_export_owner_data({ confirm: true },
      { connection: connector, db: f.db, env: { ...env, VERCEL_ENV: 'preview' }, registry }));
    expect(offProd.reason).toContain('only on the production server');
    const bad = parse(await H.vercel_export_owner_data({ confirm: true, path: '/tmp' }, ctx(f)));
    expect(bad.status).toBe('refused_by_guard');
  });
});

describe('AUD-AT vercel_set_purchase_policy', () => {
  it('proposes, inspects and applies exactly the page policy; a replay refuses', async () => {
    const f = fixture();
    const dry = parse(await H.vercel_set_purchase_policy(
      { budgetCents: 2500, grantRequired: true, dryRun: true }, ctx(f)));
    expect(dry).toMatchObject({ status: 'preview', dryRun: true });
    expect(dry.preview).toContain('agent budget $25.00; per-purchase grant required.');
    expect(f.secrets.size).toBe(0);
    const reference = await propose(f, 'vercel_set_purchase_policy',
      { budgetCents: 2500, grantRequired: true });
    expect(f.changes.some(c => c.tool === 'vercel_owner_account_setting_request' &&
      c.summary === 'Owner approval requested for purchase_policy (not applied)')).toBe(true);
    const seen = parse(await applyHandler({ reference, dryRun: true }, ctx(f)));
    expect(seen).toMatchObject({ status: 'preview', family: 'owner_account_setting' });
    expect(seen.summary).toContain('Set team_FAKE purchase policy');
    expect(await f.db.getPurchasePolicy('team_FAKE')).toEqual(
      { budgetCents: null, grantRequired: false });
    const applied = await applyRef(f, reference);
    expect(applied).toMatchObject({ status: 'applied', confirmed: true,
      family: 'owner_account_setting', action: 'purchase_policy' });
    expect(await f.db.getPurchasePolicy('team_FAKE')).toEqual(
      { budgetCents: 2500, grantRequired: true });
    const replay = await applyRef(f, reference);
    expect(replay.status).toBe('refused_by_guard');
  });

  it('a blank budget proposes no agent budget, like the form', async () => {
    const f = fixture();
    const reference = await propose(f, 'vercel_set_purchase_policy', {});
    const applied = await applyRef(f, reference);
    expect(applied.status).toBe('applied');
    expect(await f.db.getPurchasePolicy('team_FAKE')).toEqual(
      { budgetCents: null, grantRequired: false });
  });

  it('refuses budgets outside the stored shape (the form\'s invalid amounts)', async () => {
    const f = fixture();
    for (const budgetCents of [-1, 2147483648, 1.5, '2500']) {
      const out = parse(await H.vercel_set_purchase_policy(
        { budgetCents, confirm: true }, ctx(f)));
      expect(out.status).toBe('refused_by_guard');
    }
    expect(f.secrets.size).toBe(0);
  });

  it('refuses an apply from another account without consuming the envelope', async () => {
    const f = fixture();
    const reference = await propose(f, 'vercel_set_purchase_policy', { budgetCents: 100 });
    const other = { ...connector, account: 'team_OTHER' };
    const out = await applyRef(f, reference, other);
    expect(out.status).toBe('refused_by_guard');
    const applied = await applyRef(f, reference);
    expect(applied.status).toBe('applied');
  });
});

describe('AUD-AT vercel_set_token_no_expiry', () => {
  it('refuses a proposal naming a stale token version, with the page\'s remedy', async () => {
    const f = fixture();
    const out = parse(await H.vercel_set_token_no_expiry(
      { noExpiry: true, tokenVersion: STALE_VERSION, confirm: true }, ctx(f)));
    expect(out.status).toBe('refused_by_guard');
    expect(JSON.stringify(out)).toContain('could not be verified');
    expect(JSON.stringify(out)).toContain('reload and attest for the current token');
    expect(f.secrets.size).toBe(0);
  });

  it('binds the current version at proposal and applies the attestation', async () => {
    const f = fixture();
    const reference = await propose(f, 'vercel_set_token_no_expiry', { noExpiry: true });
    const applied = await applyRef(f, reference);
    expect(applied).toMatchObject({ status: 'applied', action: 'token_no_expiry' });
    expect(await f.db.getTokenNoExpiry('team_FAKE')).toBe(true);
  });

  it('a rotation between proposal and application refuses unverified, never attests', async () => {
    const f = fixture();
    const reference = await propose(f, 'vercel_set_token_no_expiry', { noExpiry: true });
    await f.db.upsertVercelAccount({ id: 'team_FAKE', teamId: 'team_FAKE',
      teamSlug: 'fixture', label: 'Fixture', scope: 'team',
      tokenEnc: 'FAKEENC', tokenLast4: 'FAKE', probe: {} });
    const out = await applyRef(f, reference);
    expect(out).toMatchObject({ status: 'unverified', confirmed: false,
      family: 'owner_account_setting' });
    expect(await f.db.getTokenNoExpiry('team_FAKE')).toBe(false);
  });

  it('an explicit current version proposes and applies', async () => {
    const f = fixture();
    const reference = await propose(f, 'vercel_set_token_no_expiry',
      { noExpiry: false, tokenVersion: VERSION });
    const applied = await applyRef(f, reference);
    expect(applied.status).toBe('applied');
    expect(await f.db.getTokenNoExpiry('team_FAKE')).toBe(false);
  });
});

describe('AUD-AT vercel_set_production_strictness', () => {
  it('proposes and applies the strictness; the summary disclaims enablement', async () => {
    const f = fixture();
    const reference = await propose(f, 'vercel_set_production_strictness',
      { strictness: 'passphrase' });
    const seen = parse(await applyHandler({ reference, dryRun: true }, ctx(f)));
    expect(seen.summary).toContain('No production access is enabled by this change.');
    const applied = await applyRef(f, reference);
    expect(applied).toMatchObject({ status: 'applied', action: 'production_strictness' });
    expect(await f.db.getProductionEnableStrictness('team_FAKE')).toBe('passphrase');
  });

  it('refuses a strictness outside the form\'s two words', async () => {
    const f = fixture();
    const out = parse(await H.vercel_set_production_strictness(
      { strictness: 'bogus', confirm: true }, ctx(f)));
    expect(out.status).toBe('refused_by_guard');
    expect(f.secrets.size).toBe(0);
  });
});

describe('AUD-AT protected resources (add direct, clear by envelope)', () => {
  it('adds a protection with the page\'s journal row and refuses a pass', async () => {
    const f = fixture();
    const passOut = await dispatchReadOnlyTool({ registry,
      name: 'vercel_add_protected_resource', args: { projectName: 'my-app', confirm: true },
      connection: fullPass, db: f.db, env });
    expect(parse(passOut).reason).toContain('a delegated pass can never add a project protection');
    const out = parse(await H.vercel_add_protected_resource(
      { projectName: 'my-app', confirm: true }, ctx(f)));
    expect(out).toMatchObject({ status: 'applied', confirmed: true, projectName: 'my-app' });
    expect(f.protectedRules).toContainEqual({ account: 'team_FAKE', kind: 'project',
      match: 'my-app', note: 'Owner protected via owner connection', source: 'setup_page' });
    expect(f.changes).toContainEqual(expect.objectContaining({
      account: 'team_FAKE', mode: 'preview', tool: 'vercel_add_protected_resource',
      summary: 'Owner added project protection: my-app', dryRun: false, production: false }));
  });

  it('refuses names the db setter would refuse, and previews without writing', async () => {
    const f = fixture();
    for (const projectName of ['Bad Name', '-lead', 'a', 'under_score']) {
      const out = parse(await H.vercel_add_protected_resource(
        { projectName, confirm: true }, ctx(f)));
      expect(out.status).toBe('refused_by_guard');
    }
    const dry = parse(await H.vercel_add_protected_resource(
      { projectName: 'my-app', dryRun: true }, ctx(f)));
    expect(dry.status).toBe('preview');
    expect(f.protectedRules.some(r => r.match === 'my-app')).toBe(false);
  });

  it('clears all project exclusions only through the owner-applied envelope', async () => {
    const f = fixture();
    const reference = await propose(f, 'vercel_clear_protected_resources', {});
    const seen = parse(await applyHandler({ reference, dryRun: true }, ctx(f)));
    expect(seen.summary).toContain('Remove old global defaults and all account project exclusions');
    expect(seen.summary).toContain('separate safety approvals still apply');
    const applied = await applyRef(f, reference);
    expect(applied).toMatchObject({ status: 'applied', action: 'clear_protected' });
    expect(f.protectedRules).toHaveLength(0);
  });
});

describe('AUD-AT vercel_disconnect_blob_store', () => {
  async function seeded(f) {
    await f.db.insertBlobStoreConnection({ account: 'team_FAKE', storeId: 'store_FAKE1',
      label: 'Uploads', access: 'public', ciphertext: 'FAKECIPHER', tokenLast4: 'FAKE' });
  }
  it('disconnects with the page\'s outcome text and deletes the stored token', async () => {
    const f = fixture(); await seeded(f);
    const out = parse(await H.vercel_disconnect_blob_store(
      { storeId: 'store_FAKE1', confirm: true }, ctx(f)));
    expect(out).toMatchObject({ status: 'disconnected', confirmed: true });
    expect(out.summary).toBe('Blob store store_FAKE1 disconnected; its stored token was deleted. ' +
      'Files in the store were not touched.');
    expect(await f.db.listBlobStoreConnections('team_FAKE')).toHaveLength(0);
  });

  it('reports the page\'s not-found outcome and refuses a pass', async () => {
    const f = fixture();
    const missing = parse(await H.vercel_disconnect_blob_store(
      { storeId: 'store_NOPE', confirm: true }, ctx(f)));
    expect(missing).toMatchObject({ status: 'not_found', confirmed: false,
      summary: 'That Blob store connection was not found.' });
    const passOut = await dispatchReadOnlyTool({ registry,
      name: 'vercel_disconnect_blob_store', args: { storeId: 'store_FAKE1', confirm: true },
      connection: fullPass, db: f.db, env });
    expect(parse(passOut).reason).toContain('a delegated pass can never disconnect a Blob store');
  });

  it('needs confirmation and validates the store ID shape', async () => {
    const f = fixture(); await seeded(f);
    const bare = parse(await H.vercel_disconnect_blob_store({ storeId: 'store_FAKE1' }, ctx(f)));
    expect(bare.status).toBe('needs_confirmation');
    const bad = parse(await H.vercel_disconnect_blob_store(
      { storeId: 'bad store!', confirm: true }, ctx(f)));
    expect(bad.status).toBe('refused_by_guard');
    expect(await f.db.listBlobStoreConnections('team_FAKE')).toHaveLength(1);
  });
});

describe('AUD-AT vercel_recheck_token', () => {
  it('rechecks the stored token like the setup action, full profile only', async () => {
    const token = 'vcp_FAKE_recheck_12345678';
    const f = fixture();
    f.db.getAccountCredential = vi.fn(async id => id === 'team_FAKE' ? {
      id: 'team_FAKE', team_id: 'team_FAKE', project_id: null, scope: 'team',
      token_expires_at: null,
      token_enc: encryptSecret(token, 'token:team_FAKE', env), token_probe: {}
    } : null);
    const api = makeFakeVercel();
    api.when('GET', '/v2/user').resolves({ user: { id: 'user_FAKE' } });
    api.when('GET', '/v2/teams').resolves({ teams: [{ id: 'team_FAKE', slug: 'fixture' }] });
    api.when('GET', '/v10/projects').resolves({
      projects: [{ id: 'prj_FAKE', name: 'fixture-app' }], pagination: { next: null } });
    const out = await dispatchReadOnlyTool({ registry, name: 'vercel_recheck_token',
      args: {}, connection: connector, db: f.db, env, fetchImpl: api.fetch });
    expect(out.isError).toBeFalsy();
    const report = JSON.parse(out.content[0].text);
    expect(report).toMatchObject({ storedScope: 'team', derivedScope: 'team',
      access: 'read_verified', persisted: false });
    expect(out.content[0].text).not.toContain(token);
    // The everyday profile never reaches the owner surface.
    const everyday = await dispatchReadOnlyTool({ registry, name: 'vercel_recheck_token',
      args: {}, connection: { kind: 'connector', account: 'team_FAKE', profile: 'everyday',
        mode: 'preview', listing: 'catalog' }, db: f.db, env, fetchImpl: api.fetch });
    expect(everyday.content[0].text).toContain('Tool unavailable');
    const bad = await H.vercel_recheck_token({ extra: 1 }, ctx(f));
    expect(bad.isError).toBe(true);
  });
});
