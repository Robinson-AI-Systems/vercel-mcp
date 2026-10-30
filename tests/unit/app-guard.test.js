import { describe, it, expect } from 'vitest';
import { checkApp, checkAppTargets, globMatch, previewBranchRefusal,
  validateProfile } from '../../src/tools/app-guard.js';
import { APPLIANCE_DESK_PROFILE } from '../../src/db.js';

// P-1 (BATCH-P): the profile guard defers to what an app owns. Rows are
// shaped like db.listKnownApps results.
const row = (profile, extra = {}) => ({ id: profile.id, name: profile.name,
  status: 'active', account: null, source: 'setup_page', profile, ...extra });
const AD = APPLIANCE_DESK_PROFILE;
const OTHER = { id: 'other-app', name: 'Other App', projects: ['other-project'],
  release_rule: 'promote', managed_env: ['OTHER_MANAGED'],
  owned_domains: ['other.example.com'],
  owned_dns_records: [{ type: 'MX', name: '@' }],
  owned_stores: ['other-store'], owned_store_ids: [],
  no_preview_branches: ['frozen/**'], protected_sandboxes: ['other-sandbox'] };
const ROWS = [row(AD), row(OTHER)];
const AD_PROJECT = { kind: 'project', id: 'prj_AD', name: 'appliance-desk' };

describe('P-1 profile guard: ownership matching', () => {
  it('allows everything when the account has no profiles', () => {
    expect(checkAppTargets([AD_PROJECT], []).blocked).toBe(false);
    expect(checkAppTargets([{ kind: 'env', id: 'x', key: 'BLOB_READ_WRITE_TOKEN',
      projectName: 'appliance-desk' }], []).blocked).toBe(false);
  });
  it('allows targets no profile owns', () => {
    expect(checkAppTargets([{ kind: 'project', id: 'prj_X', name: 'scratch' }],
      ROWS).blocked).toBe(false);
    expect(checkAppTargets([{ kind: 'env', id: 'e1', key: 'DATABASE_URL',
      projectName: 'appliance-desk' }], ROWS).blocked).toBe(false);
  });
  it('reports the owning app per target (two profiles, one account)', () => {
    const a = checkAppTargets([{ kind: 'env', id: 'e1', key: 'OTHER_MANAGED',
      projectName: 'other-project' }], ROWS);
    expect(a.blocked).toBe(true);
    expect(a.reason).toContain('Other App');
    const b = checkAppTargets([{ kind: 'env', id: 'e2',
      key: 'BLOB_READ_WRITE_TOKEN', projectName: 'appliance-desk' }], ROWS);
    expect(b.blocked).toBe(true);
    expect(b.reason).toContain('Appliance Desk');
  });
  it('matches projects by setup-page id as well as by name', () => {
    const withIds = { ...AD, project_ids: ['prj_BOUND'] };
    const r = checkAppTargets([{ kind: 'env', id: 'e1',
      key: 'BLOB_READ_WRITE_TOKEN', projectId: 'prj_BOUND' }], [row(withIds)]);
    expect(r.blocked).toBe(true);
  });
  it('draft profiles never guard', () => {
    const draft = row(OTHER, { status: 'draft' });
    expect(checkAppTargets([{ kind: 'env', id: 'e1', key: 'OTHER_MANAGED',
      projectName: 'other-project' }], [draft]).blocked).toBe(false);
  });
});

describe('P-1 profile guard: managed variables', () => {
  const env = extra => ({ kind: 'env', id: 'env_ROWID', key: 'CRON_SECRET',
    projectId: 'prj_AD', projectName: 'appliance-desk', ...extra });
  it('refuses a managed variable write without outsideApp', () => {
    const r = checkAppTargets([env({ key: 'BLOB_READ_WRITE_TOKEN' })], ROWS);
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('outsideApp');
  });
  it('allows a managed variable write with the outsideApp marker', () => {
    expect(checkAppTargets([env({ key: 'BLOB_READ_WRITE_TOKEN',
      outsideApp: true })], ROWS).blocked).toBe(false);
  });
  it('recognizes the key when the target id is the key (batch-set shape)', () => {
    const r = checkAppTargets([{ kind: 'env', id: 'PRIVATE_PHOTO_BLOB_STORE_ID',
      projectName: 'appliance-desk' }], ROWS);
    expect(r.blocked).toBe(true);
  });
});

describe('P-1 profile guard: owned DNS records', () => {
  const rec = extra => ({ kind: 'dns_record', id: 'rec_1',
    domain: 'robinsonappliancerentals.com', ...extra });
  it('refuses the owned MX record', () => {
    const r = checkAppTargets([rec({ type: 'MX', name: '@',
      value: 'aspmx.l.google.com' })], ROWS);
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('Appliance Desk');
  });
  it('refuses SPF and DKIM by rule, allows unrelated records', () => {
    expect(checkAppTargets([rec({ type: 'TXT', name: '@',
      value: 'v=spf1 include:_spf.google.com ~all' })], ROWS).blocked).toBe(true);
    expect(checkAppTargets([rec({ type: 'TXT', name: 'google._domainkey',
      value: 'v=DKIM1; k=rsa; p=FAKE' })], ROWS).blocked).toBe(true);
    expect(checkAppTargets([rec({ type: 'A', name: '@',
      value: '76.76.21.21' })], ROWS).blocked).toBe(false);
    expect(checkAppTargets([rec({ type: 'TXT', name: '@',
      value: 'google-site-verification=FAKE' })], ROWS).blocked).toBe(false);
  });
  it('allows an owned record with the outsideApp marker', () => {
    expect(checkAppTargets([rec({ type: 'MX', name: '@',
      value: 'aspmx.l.google.com', outsideApp: true })], ROWS).blocked).toBe(false);
  });
});

describe('P-1 profile guard: owned stores', () => {
  it('refuses an owned store delete by connection label', () => {
    const r = checkAppTargets([{ kind: 'store', id: 'store_1',
      storeName: 'appliance-desk-photos', storeAction: 'delete' }], ROWS);
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('Appliance Desk');
  });
  it('refuses an overwriting put, allows a fresh put', () => {
    expect(checkAppTargets([{ kind: 'store', id: 'store_1',
      storeName: 'appliance-desk-photos', storeAction: 'put',
      overwrite: true }], ROWS).blocked).toBe(true);
    expect(checkAppTargets([{ kind: 'store', id: 'store_1',
      storeName: 'appliance-desk-photos', storeAction: 'put',
      overwrite: false }], ROWS).blocked).toBe(false);
  });
  it('matches by setup-page store id and by blob connection label fallback', () => {
    const withIds = { ...AD, owned_store_ids: ['store_9'] };
    expect(checkAppTargets([{ kind: 'store', id: 'store_9',
      storeAction: 'delete' }], [row(withIds)]).blocked).toBe(true);
    const labels = new Map([['store_7', 'appliance-desk-photos']]);
    expect(checkAppTargets([{ kind: 'store', id: 'store_7',
      storeAction: 'delete' }], ROWS, { storeLabels: labels }).blocked).toBe(true);
  });
  it('allows an owned store delete with the outsideApp marker', () => {
    expect(checkAppTargets([{ kind: 'store', id: 'store_1',
      storeName: 'appliance-desk-photos', storeAction: 'delete',
      outsideApp: true }], ROWS).blocked).toBe(false);
  });
});

describe('P-1 profile guard: release rule and sandboxes', () => {
  it('refuses branch-rule promote and rolling start without outsideApp', () => {
    for (const release of ['promote', 'rolling_start']) {
      const r = checkAppTargets([{ ...AD_PROJECT, release }], ROWS);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain('live');
    }
    expect(checkAppTargets([{ ...AD_PROJECT, release: 'promote',
      outsideApp: true }], ROWS).blocked).toBe(false);
  });
  it('never blocks rollback, and refuses direct production deploys', () => {
    expect(checkAppTargets([{ ...AD_PROJECT, release: 'rollback' }],
      ROWS).blocked).toBe(false);
    expect(checkAppTargets([{ ...AD_PROJECT, deployTarget: 'production' }],
      ROWS).blocked).toBe(true);
    expect(checkAppTargets([{ ...AD_PROJECT, deployTarget: 'preview' }],
      ROWS).blocked).toBe(false);
  });
  it('protects named sandboxes', () => {
    const r = checkAppTargets([{ kind: 'sandbox', name: 'other-sandbox' }], ROWS);
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('Other App');
  });
});

describe('P-1 checkApp loading behavior', () => {
  const target = [{ kind: 'project', id: 'prj_X', name: 'scratch' }];
  it('fails closed when profile data is unavailable or broken', async () => {
    expect((await checkApp(target, {})).blocked).toBe(true);
    expect((await checkApp(target, { db: { listKnownApps: async () => {
      throw new Error('offline'); } }, connection: { account: 'a' } }))
      .blocked).toBe(true);
  });
  it('allows on a db build that predates profiles (no accessor at all)', async () => {
    expect((await checkApp(target, { db: {}, connection: { account: 'a' } }))
      .blocked).toBe(false);
  });
  it('allows with an empty profile list', async () => {
    const ctx = { db: { listKnownApps: async () => [] },
      connection: { account: 'a' } };
    expect((await checkApp(target, ctx)).blocked).toBe(false);
  });
  it('resolves store labels through blob connections when targets lack them', async () => {
    const ctx = { db: {
      listKnownApps: async () => ROWS,
      listBlobStoreConnections: async () => [{ storeId: 'store_7',
        label: 'appliance-desk-photos' }] },
      connection: { account: 'a' } };
    const r = await checkApp([{ kind: 'store', id: 'store_7',
      storeAction: 'delete' }], ctx);
    expect(r.blocked).toBe(true);
  });
});

describe('P-1 no-preview branches from profiles', () => {
  it('glob matcher handles **, *, literals and case', () => {
    expect(globMatch('ai/**', 'ai/feature-x')).toBe(true);
    expect(globMatch('ai/**', 'aix/feature')).toBe(false);
    expect(globMatch('*._domainkey', 'google._domainkey')).toBe(true);
    expect(globMatch('AI/**', 'ai/x')).toBe(true);
    expect(globMatch('transfer/**', 'transfer')).toBe(false);
  });
  it('falls back to the built-in default with no profile data', async () => {
    const ask = branch => previewBranchRefusal({ db: {}, account: 'a',
      branch, outsideApp: undefined });
    expect(await ask('ai/x')).toBe('No-preview branch refused');
    expect(await ask('feature/x')).toBe(null);
  });
  it('profile globs replace the default when profiles exist', async () => {
    const db = { listKnownApps: async () => [row(OTHER)] };
    const ask = (branch, outsideApp) => previewBranchRefusal({ db,
      account: 'a', branch, outsideApp });
    expect(await ask('frozen/x')).toBe('No-preview branch refused');
    expect(await ask('ai/x')).toBe(null);
    expect(await ask('frozen/x', true)).toBe(null);
  });
});

describe('P-1 profile validation', () => {
  it('accepts the shipped seed', () => {
    expect(validateProfile(APPLIANCE_DESK_PROFILE)).toEqual([]);
  });
  it('names malformed fields', () => {
    expect(validateProfile({ id: 'x', name: 'X',
      release_rule: 'sideways' })).toContain('release_rule');
    expect(validateProfile({ name: 'X' })).toContain('id');
    expect(validateProfile(null)).toHaveLength(1);
  });
});
