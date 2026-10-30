import {describe, it, expect, vi, beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {universalTools} from '../../src/tools/universal.js';
import {spendOperation} from '../../src/vercel/spend-operations.js';
import {secretWriteOperation} from '../../src/vercel/secret-operations.js';
import {handBuiltWrites} from '../../src/vercel/hand-built-map.js';
import {apiOperation} from '../../src/vercel/openapi-index.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js', async m => ({...await m(), loadToken: vi.fn()}));
const account = {id: 'acct_1', team_id: 'team_FAKE', scope: 'team'};
const previewConn = {account: 'acct_1', profile: 'full', mode: 'preview', kind: 'connector'};
const prodConn = {account: 'acct_1', profile: 'full', mode: 'production', kind: 'connector'};
const delegatedProd = {account: 'acct_1', profile: 'full', mode: 'production'};
const nonLiveProject = {id: 'prj_FAKE', accountId: 'team_FAKE',
  latestDeployments: [{target: 'preview'}]};
const liveProject = {id: 'prj_FAKE', accountId: 'team_FAKE',
  targets: {production: {id: 'dpl_FAKE'}}};
// Body remodelled from the pinned createFlag schema: each environment
// entry requires active, pausedOutcome, rules and fallthrough.
const flagBody = {slug: 'checkout-v2', kind: 'boolean',
  environments: {production: {active: true,
    pausedOutcome: {type: 'variant', variantId: 'v_off'}, rules: [],
    fallthrough: {type: 'variant', variantId: 'v_off'}}}};
function fixture({protectedRules = [], policy} = {}) {
  const api = makeFakeVercel(), rows = new Map(), audit = [];
  const db = {
    getAccountCredential: async () => ({}),
    listProtectedResources: async () => protectedRules,
    recordChange: async row => audit.push(row),
    requestReplayStore: () => ({
      claim: async ({key}) => {
        if (rows.has(key)) return rows.get(key);
        rows.set(key, {state: 'pending'});
        return {state: 'claimed', claimId: 'FAKE'};
      },
      complete: async ({key, result}) => rows.set(key, {state: 'completed', result}),
      release: async ({key}) => rows.delete(key)
    }),
    getVercelAccountSafe: async () => ({id: 'acct_1', spend_limit_cents: 0}),
    getTodaySpendCents: async () => 0,
    ...(policy ? {getPurchasePolicy: async () => policy} : {})
  };
  const ctx = connection => ({db, connection, fetchImpl: api.fetch,
    env: {VERCEL_ENV: connection.mode}});
  return {api, audit, rows,
    call: (args, connection = previewConn) =>
      universalTools.handlers.vercel_api_write(args, ctx(connection))};
}
const read = r => JSON.parse(r.content[0].text);
const flagCreate = {op: 'createFlag',
  params: {path: {projectIdOrName: 'prj_FAKE'}, body: flagBody}};
function stubFlagProject(f, project = nonLiveProject) {
  f.api.when('GET', '/v9/projects/{idOrName}').resolves(project);
}
describe('U-1 universal write classification (pure)', () => {
  it('spend table and safe default classify as designed', () => {
    expect(spendOperation(apiOperation('buyDomains')))
      .toMatchObject({spend: true, recurring: false});
    expect(spendOperation(apiOperation('updateDomainAutoRenew')))
      .toMatchObject({spend: true, recurring: true});
    expect(spendOperation(apiOperation('createStorageStoresBlob')))
      .toMatchObject({spend: true});
    expect(spendOperation(apiOperation('finalize-installation')))
      .toMatchObject({spend: true, reason: 'Possible charge (unlisted operation)'});
    expect(spendOperation(apiOperation('createFlag'))).toBeNull();
    expect(spendOperation(apiOperation('getFlag'))).toBeNull();
  });
  it('secret write classifier catches the classes the read arms miss', () => {
    expect(secretWriteOperation(apiOperation('createWebhook'))).toBe(true);
    expect(secretWriteOperation(apiOperation('signKmsMessage'))).toBe(true);
    expect(secretWriteOperation(apiOperation('signKmsToken'))).toBe(true);
    expect(secretWriteOperation(apiOperation('getProjectToken'))).toBe(true);
    expect(secretWriteOperation(apiOperation('createFlag'))).toBe(false);
  });
  it('hand-built write map covers every OPS write operation', () => {
    expect(Object.keys(handBuiltWrites)).toHaveLength(65);
    expect(handBuiltWrites.createProjectEnv).toBe('vercel_env_set');
    expect(handBuiltWrites.createDeployment).toBe('vercel_deploy_create_from_git');
  });
  it('registry entry carries the full-profile guarded write contract', () => {
    const tool = universalTools.tools.find(t => t.name === 'vercel_api_write');
    expect(tool.profiles).toEqual(['full']);
    expect(tool.writes).toBe(true);
    expect(tool.writeContract).toMatchObject({production: true, targets: true,
      spend: true, access: true});
    expect(tool.inputSchema.properties).toHaveProperty('dryRun');
    expect(tool.inputSchema.properties).toHaveProperty('confirm');
  });
});
describe('U-1 universal write refusals happen before provider I/O', () => {
  beforeEach(() => { vi.clearAllMocks();
    loadToken.mockResolvedValue({token: 'vcp_FAKE', account}); });
  it('refuses unknown operations, read operations and caller team aiming', async () => {
    const f = fixture();
    const unknown = read(await f.call({op: 'notARealOperation', params: {path: {}}}));
    expect(unknown).toMatchObject({status: 'refused_by_guard'});
    expect(unknown.reason).toMatch(/Unknown documented API operation/);
    const readOp = read(await f.call({op: 'getFlag',
      params: {path: {projectIdOrName: 'prj_FAKE', flagIdOrSlug: 'flag_FAKE'}}}));
    expect(readOp.reason).toMatch(/cannot run a read operation/);
    const aimed = read(await f.call({...flagCreate,
      params: {...flagCreate.params, query: {teamId: 'team_FAKE'}}}));
    expect(aimed.reason).toMatch(/Team authority/);
    const bogus = read(await f.call({...flagCreate,
      params: {...flagCreate.params, query: {bogus: 1}}}));
    expect(bogus.status).toBe('refused_by_guard');
    expect(f.api.calls).toHaveLength(0);
  });
  it('refuses hand-built operations naming the owning tool', async () => {
    const f = fixture();
    const env = read(await f.call({op: 'createProjectEnv',
      params: {path: {idOrName: 'prj_FAKE'}, body: {key: 'X', value: 'y',
        type: 'plain', target: ['preview']}}}));
    expect(env).toMatchObject({status: 'refused_by_guard'});
    expect(env.reason).toContain('vercel_env_set');
    const settings = read(await f.call({op: 'updateProject',
      params: {path: {idOrName: 'prj_FAKE'}, body: {name: 'renamed'}}}));
    expect(settings.reason).toContain('vercel_project_update_settings');
    expect(f.api.calls).toHaveLength(0);
  });
  it('refuses credential-returning operations by class', async () => {
    const f = fixture();
    for (const args of [
      {op: 'createWebhook', params: {path: {}, body: {url: 'https://example.com/hook', events: ['deployment.created']}}},
      {op: 'signKmsMessage', params: {path: {issuerId: 'issuer_FAKE'}, body: {message: 'hello'}}},
      {op: 'getProjectToken', params: {path: {idOrName: 'prj_FAKE'}, body: {}}}
    ]) {
      const r = read(await f.call(args));
      expect(r).toMatchObject({status: 'refused_by_guard'});
      expect(r.reason).toMatch(/returns a credential/);
    }
    expect(f.api.calls).toHaveLength(0);
  });
  it('refuses credential-shaped body values and credential-named fields', async () => {
    const f = fixture();
    const shaped = read(await f.call({op: 'createFlag', params: {
      path: {projectIdOrName: 'prj_FAKE'},
      body: {...flagBody, description: 'sk_live_' + 'x'.repeat(24)}}}));
    expect(shaped.reason).toMatch(/credential-shaped value/);
    const named = read(await f.call({op: 'createFlag', params: {
      path: {projectIdOrName: 'prj_FAKE'},
      body: {...flagBody, webhookSecret: 'hunter2'}}}));
    expect(named.reason).toMatch(/cannot carry a credential value/);
    expect(f.api.calls).toHaveLength(0);
  });
  it('refuses non-full profiles and protected targets', async () => {
    const f = fixture();
    const everyday = read(await f.call(flagCreate,
      {account: 'acct_1', profile: 'everyday', mode: 'preview', kind: 'connector'}));
    expect(everyday).toMatchObject({status: 'refused_by_guard'});
    expect(everyday.reason).toMatch(/full profile/);
    const p = fixture({protectedRules: [{match: 'prj_FAKE', note: 'fixture project'}]});
    stubFlagProject(p);
    const blocked = read(await p.call({...flagCreate, confirm: true}));
    expect(blocked).toMatchObject({status: 'refused_by_guard'});
    expect(blocked.reason).toMatch(/Protected resource/);
    expect(p.api.calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });
});
describe('U-1 universal write execution (fake provider)', () => {
  beforeEach(() => { vi.clearAllMocks();
    loadToken.mockResolvedValue({token: 'vcp_FAKE', account}); });
  it('changes nothing without confirm; dryRun previews and audits', async () => {
    const f = fixture(); stubFlagProject(f);
    const ask = read(await f.call(flagCreate));
    expect(ask).toMatchObject({status: 'needs_confirmation', mode: 'PREVIEW',
      confirmed: false});
    expect(ask.preview).toContain('createFlag');
    const dry = read(await f.call({...flagCreate, dryRun: true}));
    expect(dry).toMatchObject({status: 'preview', dryRun: true});
    expect(f.audit.some(row => row.dryRun === true && row.tool === 'vercel_api_write'))
      .toBe(true);
    expect(f.api.calls.every(c => c.method === 'GET')).toBe(true);
    f.api.verify();
  });
  it('completes a feature-flag write with read-back and replay safety', async () => {
    const f = fixture(); stubFlagProject(f);
    f.api.when('PUT', '/v1/projects/{projectIdOrName}/feature-flags/flags')
      .resolves({id: 'flag_FAKE', slug: 'checkout-v2', projectId: 'prj_FAKE',
        variants: [{value: 'private'}]});
    f.api.when('GET', '/v1/projects/{projectIdOrName}/feature-flags/flags/{flagIdOrSlug}')
      .resolves({id: 'flag_FAKE', projectId: 'prj_FAKE'});
    const args = {...flagCreate, confirm: true, requestKey: 'u1-flag-create-0001'};
    const r = read(await f.call(args));
    expect(r).toMatchObject({status: 'applied', confirmed: true, mode: 'PREVIEW',
      receipt: {op: 'createFlag', id: 'flag_FAKE', projectId: 'prj_FAKE'}});
    expect(JSON.stringify(r)).not.toContain('private');
    const puts = f.api.calls.filter(c => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].query.teamId).toBe('team_FAKE');
    const replay = read(await f.call(args));
    expect(replay).toMatchObject({status: 'applied', confirmed: true});
    expect(f.api.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    f.api.verify();
  });
  it('deletes with confirmed null when no read-back identity exists', async () => {
    const f = fixture(); stubFlagProject(f);
    f.api.when('GET', '/v1/projects/{projectIdOrName}/feature-flags/segments/{segmentIdOrSlug}')
      .resolves({id: 'seg_FAKE', projectId: 'prj_FAKE'});
    f.api.when('DELETE', '/v1/projects/{projectIdOrName}/feature-flags/segments/{segmentIdOrSlug}')
      .resolves({});
    const r = read(await f.call({op: 'deleteFlagSegment', confirm: true,
      params: {path: {projectIdOrName: 'prj_FAKE', segmentIdOrSlug: 'seg_FAKE'}}}));
    expect(r).toMatchObject({status: 'applied', confirmed: null});
    expect(f.api.calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
    f.api.verify();
  });
  it('refuses a production-classified write from a preview connection', async () => {
    const f = fixture(); stubFlagProject(f, liveProject);
    f.api.when('GET', '/v1/projects/{projectIdOrName}/feature-flags/flags/{flagIdOrSlug}')
      .resolves({id: 'flag_FAKE', projectId: 'prj_FAKE'});
    const args = {op: 'updateFlag', confirm: true,
      params: {path: {projectIdOrName: 'prj_FAKE', flagIdOrSlug: 'flag_FAKE'},
        body: {description: 'toggle'}}};
    const r = read(await f.call(args));
    expect(r).toMatchObject({status: 'refused_by_guard'});
    expect(r.reason).toMatch(/Live resources cannot be changed from a preview connection/);
    expect(f.api.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
    const ask = read(await f.call({...args, confirm: false}, prodConn));
    expect(ask.preview).toMatch(/Current object/);
    expect(ask.preview).toContain('flag_FAKE');
    f.api.verify();
  });
  it('runs a spend-table write on the owner word and journals the money line', async () => {
    const policy = {budgetCents: null, grantRequired: false};
    const f = fixture({policy});
    f.api.when('POST', '/storage/stores/blob')
      .resolves({id: 'store_FAKE', name: 'blob-fixture'});
    const args = {op: 'createStorageStoresBlob',
      params: {path: {}, body: {name: 'blob-fixture'}}};
    const ask = read(await f.call(args, prodConn));
    expect(ask).toMatchObject({status: 'needs_confirmation', mode: 'PRODUCTION'});
    expect(ask.moneyLine).toMatch(/cost depends on usage/);
    const r = read(await f.call({...args, confirm: true,
      requestKey: 'u1-blob-create-0001'}, prodConn));
    expect(r).toMatchObject({status: 'applied', mode: 'PRODUCTION'});
    const row = f.audit.find(x => x.dryRun === false && x.tool === 'vercel_api_write');
    expect(row.moneyLine).toMatch(/Blob store creation/);
    expect(f.api.calls.filter(c => c.method === 'POST')).toHaveLength(1);
    f.api.verify();
  });
  it('refuses the same spend on a delegated connection (grant path)', async () => {
    const f = fixture();
    const r = read(await f.call({op: 'createStorageStoresBlob', confirm: true,
      requestKey: 'u1-blob-create-0002',
      params: {path: {}, body: {name: 'blob-fixture'}}}, delegatedProd));
    expect(r).toMatchObject({status: 'refused_by_guard'});
    expect(r.reason).toMatch(/provider-enforceable ceiling/);
    expect(f.api.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  it('treats an unlisted billing operation as spend by the safe default', async () => {
    const f = fixture({policy: {budgetCents: null, grantRequired: false}});
    const ask = read(await f.call({op: 'finalize-installation',
      params: {path: {integrationConfigurationId: 'icfg_FAKE'}}}, prodConn));
    expect(ask).toMatchObject({status: 'needs_confirmation'});
    expect(ask.moneyLine).toMatch(/cost depends on usage/);
    expect(f.api.calls).toHaveLength(0);
  });
  it('declares access changes in the preview for member operations', async () => {
    const f = fixture({policy: {budgetCents: null, grantRequired: false}});
    const ask = read(await f.call({op: 'updateTeamMember',
      params: {path: {uid: 'user_FAKE'}, body: {role: 'ADMIN'}}}, prodConn));
    expect(ask).toMatchObject({status: 'needs_confirmation'});
    expect(ask.preview).toMatch(/changes access for/);
    expect(ask.preview).toMatch(/role ADMIN/);
    expect(f.api.calls).toHaveLength(0);
  });
  it('surfaces provider failure as outcome_unknown with detail and a journal fingerprint', async () => {
    const f = fixture(); stubFlagProject(f);
    f.api.when('PUT', '/v1/projects/{projectIdOrName}/feature-flags/flags').rejects(503);
    const r = read(await f.call({...flagCreate, confirm: true,
      requestKey: 'u1-flag-create-0503'}));
    expect(r).toMatchObject({status: 'outcome_unknown', confirmed: null});
    // The executor's failure detail keeps only pattern-safe legs, so the
    // op identity rides in the SHAPE-FP journal row below instead.
    expect(r.failure).toMatchObject({failureClass: 'http_status', status: 503});
    const fp = f.audit.find(x => typeof x.summary === 'string' &&
      x.summary.startsWith('SHAPE-FP api_write'));
    expect(fp).toBeTruthy();
    expect(fp.summary).toMatch(/failed=\[503:outcome_unknown\]/);
    expect(fp.summary).not.toContain('checkout-v2');
    f.api.verify();
  });
});
