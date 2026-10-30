import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { loadToken } from '../../src/vercel/tokens.js';
import { APPLIANCE_DESK_PROFILE, KNOWN_APP_SEED } from '../../src/db.js';
import { validateProfile } from '../../src/tools/app-guard.js';
vi.mock('../../src/vercel/tokens.js', async mod => ({ ...await mod(),
  loadToken: vi.fn() }));

// P-1 (BATCH-P): the seeded Appliance Desk profile, its traceability to
// docs/APP-NEEDS-APPLIANCE-DESK.md, the profile read tools, and the app
// mark on project reads.
const row = { id: 'appliance-desk', name: 'Appliance Desk', status: 'active',
  account: null, source: 'default', profile: APPLIANCE_DESK_PROFILE,
  updatedAt: null };
const conn = { account: 'acct_FAKE', mode: 'preview', profile: 'read_only',
  listing: 'catalog' };
const parse = r => JSON.parse(r.content[0].text);
const dbWith = rows => ({ listKnownApps: async () => rows,
  getAccountCredential: async () => ({}) });
const call = (name, args, db) => dispatchReadOnlyTool({ registry, name,
  args, connection: conn, db, fetchImpl: makeFakeVercel().fetch });

describe('P-1 the Appliance Desk seed', () => {
  it('is the one shipped default and validates', () => {
    expect(KNOWN_APP_SEED).toEqual([APPLIANCE_DESK_PROFILE]);
    expect(validateProfile(APPLIANCE_DESK_PROFILE)).toEqual([]);
    const p = APPLIANCE_DESK_PROFILE;
    expect(p.projects).toEqual(['appliance-desk']);
    expect(p.production_branch).toBe('live');
    expect(p.release_rule).toBe('branch');
    expect(p.node_version).toBe('24');
    expect(p.framework).toBe('nextjs');
    expect(p.cost_target_cents).toBe(2000);
    expect(p.owned_domains).toEqual(['robinsonappliancerentals.com']);
    expect(p.owned_stores).toEqual(['appliance-desk-photos']);
    expect(p.rollback_caution).toContain('migration');
  });
  it('carries all nineteen crons from the app vercel.json, uniquely', () => {
    const paths = APPLIANCE_DESK_PROFILE.expected_crons.map(c => c.path);
    expect(paths).toHaveLength(19);
    expect(new Set(paths).size).toBe(19);
    for (const c of APPLIANCE_DESK_PROFILE.expected_crons) {
      expect(c.schedule.split(' ')).toHaveLength(5);
    }
  });
  it('expected and managed names trace to APP-NEEDS-APPLIANCE-DESK.md', () => {
    const doc = readFileSync('docs/APP-NEEDS-APPLIANCE-DESK.md', 'utf8');
    const names = [...APPLIANCE_DESK_PROFILE.expected_env.production,
      ...APPLIANCE_DESK_PROFILE.expected_env.preview,
      ...APPLIANCE_DESK_PROFILE.managed_env];
    for (const name of names) expect(doc).toContain(name);
    expect(doc).toContain('robinsonappliancerentals.com');
    expect(doc).toContain('appliance-desk-photos');
    // Deliberately-unset and planned names are NOT expectations.
    expect(APPLIANCE_DESK_PROFILE.expected_env.production)
      .not.toContain('TWILIO_PHONE_NUMBER');
    expect(APPLIANCE_DESK_PROFILE.expected_env.production)
      .not.toContain('COLORADO_GIS_API_KEY');
  });
});

describe('P-1 profile read tools', () => {
  it('lists profiles with ownership summaries', async () => {
    const out = parse(await call('vercel_profile_list', {}, dbWith([row])));
    expect(out.count).toBe(1);
    expect(out.profiles[0]).toMatchObject({ id: 'appliance-desk',
      releaseRule: 'branch', productionBranch: 'live',
      ownedStores: ['appliance-desk-photos'], expectedCronsCount: 19 });
  });
  it('gets one profile in full and refuses an unknown one', async () => {
    const out = parse(await call('vercel_profile_get',
      { app: 'appliance-desk' }, dbWith([row])));
    expect(out.profile.managed_env).toContain('BLOB_READ_WRITE_TOKEN');
    expect(out.accountScope).toBe('every account');
    const missing = await call('vercel_profile_get', { app: 'nope-app' },
      dbWith([row]));
    expect(missing.isError).toBe(true);
  });
});

describe('P-1 project reads mark profile-owned projects', () => {
  beforeEach(() => loadToken.mockReset());
  function fixture() {
    const fake = makeFakeVercel();
    loadToken.mockResolvedValue({ token: 'vcp_FAKE_TEST',
      account: { id: 'acct_FAKE', team_id: 'team_FAKE', scope: 'full' } });
    fake.when('GET', '/v10/projects').resolves({ projects: [
      { id: 'prj_AD', name: 'appliance-desk', framework: 'nextjs',
        link: { repo: 'appliance-desk', productionBranch: 'live' } },
      { id: 'prj_X', name: 'scratch', framework: null, link: null }],
      pagination: { next: null } });
    return { fake, db: dbWith([row]) };
  }
  it('vercel_project_list adds app only to the owned project', async () => {
    const { fake, db } = fixture();
    const out = parse(await dispatchReadOnlyTool({ registry,
      name: 'vercel_project_list', args: {}, connection: conn, db,
      fetchImpl: fake.fetch }));
    expect(out.projects[0]).toMatchObject({ name: 'appliance-desk',
      app: 'appliance-desk' });
    expect(out.projects[1].app).toBe(undefined);
  });
});
