import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { loadToken } from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js', async fn => ({ ...await fn(), loadToken: vi.fn() }));

const account = 'acct_FAKE', team = 'team_FAKE';
const production = { account, mode: 'production', profile: 'full', listing: 'catalog' };
const previewConn = { account, mode: 'preview', profile: 'full', listing: 'catalog' };
const parse = out => JSON.parse(out.content?.[0]?.text ?? '{}');
const projectRow = { id: 'prj_FAKE', name: 'demo', accountId: team };
const routeItem = { id: 'route_FAKE1', name: 'Legacy blog', description: 'old blog',
  enabled: true, rawSrc: '/blog/:path*', rawDest: '/posts/:path*',
  route: { src: '/blog/:path*', dest: '/posts/:path*' } };
const routeVersions = [
  { id: 'rver_LIVE', alias: 'live-a', createdBy: 'user_FAKE', isLive: true, isStaging: false,
    lastModified: '2026-10-29T00:00:00.000Z', ruleCount: 1, s3Key: 'k1' },
  { id: 'rver_OLD', alias: 'old-a', createdBy: 'user_FAKE', isLive: false, isStaging: false,
    lastModified: '2026-10-20T00:00:00.000Z', ruleCount: 1, s3Key: 'k0' },
  { id: 'rver_STAGE', alias: 'stage-a', createdBy: 'user_FAKE', isLive: false, isStaging: true,
    lastModified: '2026-10-30T00:00:00.000Z', ruleCount: 2, s3Key: 'k2' }];
const redirectItem = { source: '/old-page', destination: '/new-page', statusCode: 301,
  permanent: true, caseSensitive: false, query: false, preserveQueryParams: false };
const redirectVersions = [
  { id: 'dver_LIVE', alias: 'live-b', createdBy: 'user_FAKE', isLive: true, isStaging: false,
    key: 'k1', lastModified: '2026-10-29T00:00:00.000Z', name: 'Live', redirectCount: 1 },
  { id: 'dver_OLD', alias: 'old-b', createdBy: 'user_FAKE', isLive: false, isStaging: false,
    key: 'k0', lastModified: '2026-10-20T00:00:00.000Z', name: 'Old', redirectCount: 1 },
  { id: 'dver_STAGE', alias: 'stage-b', createdBy: 'user_FAKE', isLive: false, isStaging: true,
    key: 'k2', lastModified: '2026-10-30T00:00:00.000Z', name: 'Next', redirectCount: 2 }];

function harness() {
  const fake = makeFakeVercel(), audit = [];
  const db = {
    getAccountCredential: async () => ({}),
    listProtectedResources: async () => [],
    recordChange: async e => audit.push(e),
    requestReplayStore: () => ({
      claim: async ({ key }) => ({ state: 'claimed', claimId: key }),
      complete: async () => true, release: async () => true
    })
  };
  fake.when('GET', '/v9/projects/{idOrName}').resolves(projectRow);
  const call = (name, args = {}, conn = production) =>
    dispatchReadOnlyTool({ registry, name, args, connection: conn, db, fetchImpl: fake.fetch, env: {} });
  return { fake, db, audit, call };
}
const routeReads = (h, versions = routeVersions) => {
  h.fake.when('GET', '/v1/projects/{projectId}/routes').resolves({ routes: [routeItem] });
  h.fake.when('GET', '/v1/projects/{projectId}/routes/versions').resolves({ versions });
};
const redirectReads = (h, versions = redirectVersions) => {
  h.fake.when('GET', '/v1/bulk-redirects')
    .resolves({ redirects: [redirectItem], pagination: { numPages: 1, page: 1, per_page: 100 } });
  h.fake.when('GET', '/v1/bulk-redirects/versions').resolves({ versions });
};

beforeEach(() => {
  vi.clearAllMocks();
  loadToken.mockResolvedValue({ token: ['vcp', 'FAKE', 'token'].join('_'),
    account: { id: account, team_id: team, scope: 'team' } });
});

describe('F-3 registration and the dangerously-delete ban', () => {
  it('registers eight routing tools with guarded-write contracts and catalog profiles', () => {
    const byName = n => registry.tools.find(t => t.name === n);
    for (const n of ['vercel_route_stage', 'vercel_redirect_stage', 'vercel_route_publish',
      'vercel_redirect_publish', 'vercel_redirect_restore', 'vercel_cache_invalidate'])
      expect(byName(n)).toMatchObject({ writes: true, guardedWrite: true,
        profiles: ['everyday', 'full'] });
    expect(byName('vercel_route_list')).toMatchObject({ writes: false });
    // The P/PR split itself is proven behaviorally below: staging applies
    // on a preview connection; publishing from one is refused.
  });
  it('no operation or F-3 source reaches a dangerously-delete endpoint', () => {
    const ops = readFileSync('src/vercel/operations.js', 'utf8');
    const mod = readFileSync('src/tools/routes.js', 'utf8');
    expect(ops).not.toContain('/v1/edge-cache/dangerously-delete');
    expect(mod).not.toContain('dangerously-delete-by');
  });
});

describe('F-3 reads', () => {
  it('lists routes and versions; the opaque branch reports unverifiable, not empty', async () => {
    const h = harness();
    routeReads(h);
    const view = parse(await h.call('vercel_route_list', { project: 'prj_FAKE' }));
    expect(view.routes[0]).toMatchObject({ id: 'route_FAKE1', src: '/blog/:path*', dest: '/posts/:path*' });
    expect(view.versions.map(v => v.id)).toEqual(['rver_LIVE', 'rver_OLD', 'rver_STAGE']);
    const h2 = harness();
    h2.fake.when('GET', '/v1/projects/{projectId}/routes').resolves({});
    h2.fake.when('GET', '/v1/projects/{projectId}/routes/versions').resolves({ versions: routeVersions });
    const opaque = parse(await h2.call('vercel_route_list', { project: 'prj_FAKE' }));
    expect(opaque.routes).toBe(null);
    expect(opaque.note).toContain('did not return a readable route list');
    h.fake.verify(); h2.fake.verify();
  });
  it('lists redirects and versions', async () => {
    const h = harness();
    redirectReads(h);
    const view = parse(await h.call('vercel_redirect_list', { project: 'prj_FAKE' }));
    expect(view.redirects[0]).toMatchObject({ source: '/old-page', destination: '/new-page', statusCode: 301 });
    expect(view.versions[0].isLive).toBe(true);
    h.fake.verify();
  });
});

describe('F-3 route staging and publishing', () => {
  const newRoute = { name: 'API rewrite', enabled: true, srcSyntax: 'path-to-regexp',
    route: { src: '/api/:path*', dest: 'https://api.example.com/:path*' } };
  it('stages an add on a preview connection, publishes from production', async () => {
    const h = harness();
    routeReads(h);
    h.fake.when('POST', '/v1/projects/{projectId}/routes')
      .resolves({ route: { id: 'route_FAKE2', ...newRoute }, version: { id: 'rver_STAGE' } });
    const staged = parse(await h.call('vercel_route_stage',
      { project: 'prj_FAKE', action: 'add', route: newRoute, confirm: true }, previewConn));
    expect(staged).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'POST' && x.path.includes('/routes')).body)
      .toEqual({ route: newRoute });
    expect(JSON.stringify(h.audit)).toContain('vercel_route_publish');
    // publish: staged version goes live
    const afterPublish = routeVersions.map(v => ({ ...v,
      isLive: v.id === 'rver_STAGE', isStaging: v.id === 'rver_STAGE' ? false : v.isStaging }));
    h.fake.when('GET', '/v1/projects/{projectId}/routes/versions')
      .resolves({ versions: routeVersions }).resolves({ versions: routeVersions })
      .resolves({ versions: afterPublish });
    h.fake.when('POST', '/v1/projects/{projectId}/routes/versions').resolves({ version: { id: 'rver_STAGE' } });
    const published = parse(await h.call('vercel_route_publish',
      { project: 'prj_FAKE', versionId: 'rver_STAGE', action: 'promote', confirm: true }));
    expect(published).toMatchObject({ status: 'applied', confirmed: true });
    const post = h.fake.calls.find(x => x.method === 'POST' && x.path.includes('/versions'));
    expect(post.body).toEqual({ id: 'rver_STAGE', action: 'promote' });
    h.fake.verify();
  });
  it('refuses publishing the live version and staging an update to a missing route', async () => {
    const h = harness();
    routeReads(h);
    const live = parse(await h.call('vercel_route_publish',
      { project: 'prj_FAKE', versionId: 'rver_LIVE', action: 'promote', dryRun: true }));
    expect(live.status).toBe('refused_by_guard');
    expect(live.reason).toContain('already the live one');
    const missing = parse(await h.call('vercel_route_stage',
      { project: 'prj_FAKE', action: 'update', routeId: 'route_NOPE', route: newRoute, dryRun: true }));
    expect(missing.status).toBe('refused_by_guard');
    const previewPublish = parse(await h.call('vercel_route_publish',
      { project: 'prj_FAKE', versionId: 'rver_STAGE', action: 'promote', confirm: true }, previewConn));
    expect(previewPublish.status).toBe('refused_by_guard');
    h.fake.verify();
  });
});

describe('F-3 redirect staging, publish and restore', () => {
  it('stages a replacement set with the team id injected into the PUT body', async () => {
    const h = harness();
    redirectReads(h);
    h.fake.when('PUT', '/v1/bulk-redirects')
      .resolves({ alias: 'stage-b', version: { id: 'dver_STAGE' } });
    const staged = parse(await h.call('vercel_redirect_stage', {
      project: 'prj_FAKE', action: 'replace',
      redirects: [redirectItem, { source: '/a', destination: '/b', permanent: true }],
      confirm: true }));
    expect(staged).toMatchObject({ status: 'applied', confirmed: true });
    const put = h.fake.calls.find(x => x.method === 'PUT');
    expect(put.body.projectId).toBe('prj_FAKE');
    expect(put.body.teamId).toBe(team);
    expect(put.body.redirects).toHaveLength(2);
    expect(JSON.stringify(h.audit)).toContain('vercel_redirect_publish');
    h.fake.verify();
  });
  it('removes by source strings and restores a named version', async () => {
    const h = harness();
    redirectReads(h);
    h.fake.when('DELETE', '/v1/bulk-redirects')
      .resolves({ alias: 'stage-b', version: { id: 'dver_STAGE' } });
    const removed = parse(await h.call('vercel_redirect_stage',
      { project: 'prj_FAKE', action: 'remove', sources: ['/old-page'], confirm: true }));
    expect(removed).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'DELETE').body)
      .toEqual({ redirects: ['/old-page'] });
    const afterRestore = redirectVersions.map(v => ({ ...v, isLive: v.id === 'dver_OLD' }));
    h.fake.when('GET', '/v1/bulk-redirects/versions')
      .resolves({ versions: redirectVersions }).resolves({ versions: redirectVersions })
      .resolves({ versions: afterRestore });
    h.fake.when('POST', '/v1/bulk-redirects/versions').resolves({ version: { id: 'dver_OLD' } });
    const restored = parse(await h.call('vercel_redirect_restore',
      { project: 'prj_FAKE', versionId: 'dver_OLD', confirm: true }));
    expect(restored).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'POST').body)
      .toEqual({ id: 'dver_OLD', action: 'restore' });
    h.fake.verify();
  });
});

describe('F-3 cache invalidation', () => {
  it('invalidates by tags and by source images, honestly unverified', async () => {
    const h = harness();
    h.fake.when('POST', '/v1/edge-cache/invalidate-by-tags').resolves({});
    h.fake.when('POST', '/v1/edge-cache/invalidate-by-src-images').resolves({});
    const byTags = parse(await h.call('vercel_cache_invalidate',
      { project: 'prj_FAKE', tags: ['product:1', 'product:2'], target: 'production', confirm: true }));
    expect(byTags).toMatchObject({ status: 'applied', confirmed: null });
    const tagCall = h.fake.calls.find(x => x.path.includes('invalidate-by-tags'));
    expect(tagCall.body).toEqual({ tags: ['product:1', 'product:2'], target: 'production' });
    expect(tagCall.query.projectIdOrName).toBe('prj_FAKE');
    const byImages = parse(await h.call('vercel_cache_invalidate',
      { project: 'prj_FAKE', srcImages: ['https://example.com/a.png'], confirm: true }));
    expect(byImages).toMatchObject({ status: 'applied', confirmed: null });
    const both = parse(await h.call('vercel_cache_invalidate',
      { project: 'prj_FAKE', tags: ['x'], srcImages: ['https://example.com/a.png'], dryRun: true }));
    expect(both.status).toBe('refused_by_guard');
    h.fake.verify();
  });
});
