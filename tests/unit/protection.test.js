import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { loadToken } from '../../src/vercel/tokens.js';
import { pendingInputs } from '../../src/core/pending-inputs.js';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
vi.mock('../../src/vercel/tokens.js', async fn => ({ ...await fn(), loadToken: vi.fn() }));

const account = 'acct_FAKE', team = 'team_FAKE';
const env = { TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32) };
const production = { account, mode: 'production', profile: 'full', listing: 'catalog' };
const parse = out => JSON.parse(out.content?.[0]?.text ?? '{}');
const baseProject = { id: 'prj_FAKE', name: 'demo', accountId: team };
const T1 = 1761000000000, T2 = 1761100000000;
const bypassRow = {
  ...baseProject,
  protectionBypass: {
    FAKEsecretCI: { createdAt: T1, createdBy: 'usr_FAKE', isEnvVar: true, note: 'ci pipeline', scope: 'automation-bypass' },
    FAKEsecretOLD: { createdAt: T2, createdBy: 'usr_FAKE', isEnvVar: false, note: 'old laptop', scope: 'automation-bypass' },
    FAKEsecretINT: { createdAt: T1, createdBy: 'usr_FAKE', configurationId: 'icfg_FAKE', scope: 'integration-automation-bypass' }
  }
};

function harness() {
  const fake = makeFakeVercel(), audit = [], pending = new Map(), once = new Map();
  const db = {
    getAccountCredential: async () => ({}),
    listProtectedResources: async () => [],
    recordChange: async e => audit.push(e),
    requestReplayStore: () => ({
      claim: async ({ key }) => ({ state: 'claimed', claimId: key }),
      complete: async () => true, release: async () => true
    }),
    insertPendingInput: async row => { pending.set(row.id, row); },
    consumePendingInput: async ({ id, account: a, kind }) => {
      const r = pending.get(id);
      if (!r || r.account !== a || r.kind !== kind) return null;
      pending.delete(id); return { ...r, vercel_account: r.account };
    },
    insertOneTimeSecret: async row => { once.set(row.id, row); },
    consumeOneTimeSecret: async ({ id, account: a }) => {
      const r = once.get(id);
      if (!r || (r.account !== a && r.vercel_account !== a)) return null;
      once.delete(id); return { ...r, vercel_account: r.account };
    }
  };
  const call = (name, args = {}, conn = production, fetchImpl = fake.fetch) =>
    dispatchReadOnlyTool({ registry, name, args, connection: conn, db, fetchImpl, env });
  return { fake, db, audit, pending, once, call };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadToken.mockResolvedValue({ token: ['vcp', 'FAKE', 'token'].join('_'), account: { id: account, team_id: team, scope: 'team' } });
});

describe('F-1 registration', () => {
  it('registers eight protection tools with contract-accurate classifications', () => {
    const byName = n => registry.tools.find(t => t.name === n);
    for (const n of ['vercel_protection_get', 'vercel_protection_list_bypass'])
      expect(byName(n)).toMatchObject({ writes: false });
    expect(byName('vercel_protection_set_vercel_auth').writeContract)
      .toMatchObject({ access: true, spend: false });
    expect(byName('vercel_protection_set_password').writeContract)
      .toMatchObject({ secretIn: true });
    expect(byName('vercel_protection_set_trusted_ips').writeContract)
      .toMatchObject({ access: true });
    expect(byName('vercel_protection_create_bypass').writeContract)
      .toMatchObject({ access: true, secretOut: true });
    expect(byName('vercel_alias_set_shareable_link').writeContract)
      .toMatchObject({ access: true, secretOut: true });
    expect(byName('vercel_alias_set_shareable_link').profiles).toEqual(['everyday', 'full']);
    expect(byName('vercel_protection_set_password').profiles).toEqual(['full']);
  });
});

describe('F-1 reads', () => {
  it('reports protection state and never a bypass secret value', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}').resolves({
      ...bypassRow,
      ssoProtection: { deploymentType: 'all' },
      passwordProtection: { deploymentType: 'preview', internalMarker: 'do-not-leak' },
      trustedIps: { deploymentType: 'preview', protectionMode: 'additional',
        addresses: [{ value: '203.0.113.0/24', note: 'office' }] },
      optionsAllowlist: { paths: [{ value: '/.well-known/*' }] }
    });
    const out = await h.call('vercel_protection_get', { project: 'prj_FAKE' });
    const text = out.content[0].text, view = parse(out);
    expect(view.vercelAuthentication).toEqual({ enabled: true, deploymentType: 'all' });
    expect(view.passwordProtection).toEqual({ enabled: true, deploymentType: 'preview' });
    expect(view.trustedIps.addresses).toEqual([{ value: '203.0.113.0/24', note: 'office' }]);
    expect(view.optionsAllowlist.paths).toEqual(['/.well-known/*']);
    expect(view.bypassSecrets).toHaveLength(3);
    expect(view.bypassSecrets.find(x => x.note === 'ci pipeline').isEnvVar).toBe(true);
    expect(view.bypassSecrets.find(x => x.scope === 'integration-automation-bypass').managedByIntegration).toBe(true);
    for (const secret of ['FAKEsecretCI', 'FAKEsecretOLD', 'FAKEsecretINT', 'do-not-leak'])
      expect(text).not.toContain(secret);
    h.fake.verify();
  });

  it('reports an unprotected project plainly', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}').resolves({ ...baseProject });
    const view = parse(await h.call('vercel_protection_get', { project: 'prj_FAKE' }));
    expect(view.vercelAuthentication.enabled).toBe(false);
    expect(view.passwordProtection.enabled).toBe(false);
    expect(view.trustedIps).toEqual({ enabled: false });
    expect(view.bypassSecrets).toEqual([]);
  });

  it('lists bypass secrets by note and date only', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}').resolves(bypassRow);
    const out = await h.call('vercel_protection_list_bypass', { project: 'prj_FAKE' });
    const view = parse(out);
    expect(view.count).toBe(3);
    expect(view.bypassSecrets.map(x => x.note)).toContain('old laptop');
    expect(out.content[0].text).not.toContain('FAKEsecret');
  });
});

describe('F-1 Vercel Authentication', () => {
  it('previews, applies and read-back-verifies turning auth on', async () => {
    const h = harness();
    const on = { ...baseProject, ssoProtection: { deploymentType: 'preview' } };
    h.fake.when('GET', '/v9/projects/{idOrName}')
      .resolves(baseProject).resolves(baseProject).resolves(baseProject).resolves(on);
    h.fake.when('PATCH', '/v9/projects/{idOrName}').resolves(on);
    const preview = parse(await h.call('vercel_protection_set_vercel_auth',
      { project: 'prj_FAKE', enabled: true, deploymentType: 'preview', dryRun: true }));
    expect(preview).toMatchObject({ status: 'preview', mode: 'PRODUCTION' });
    expect(preview.preview).toContain('sign in');
    expect(h.fake.calls.filter(x => x.method === 'PATCH')).toHaveLength(0);
    const applied = parse(await h.call('vercel_protection_set_vercel_auth',
      { project: 'prj_FAKE', enabled: true, deploymentType: 'preview', confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body)
      .toEqual({ ssoProtection: { deploymentType: 'preview' } });
    h.fake.verify();
  });

  it('turning auth off is disclosed as a loosening in the preview', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}')
      .resolves({ ...baseProject, ssoProtection: { deploymentType: 'all' } });
    const preview = parse(await h.call('vercel_protection_set_vercel_auth',
      { project: 'prj_FAKE', enabled: false, dryRun: true }));
    expect(preview.preview).toContain('LOOSENS');
  });

  it('refuses a no-op and a preview-mode connection', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}')
      .resolves({ ...baseProject, ssoProtection: { deploymentType: 'all' } });
    const noop = parse(await h.call('vercel_protection_set_vercel_auth',
      { project: 'prj_FAKE', enabled: true, deploymentType: 'all', dryRun: true }));
    expect(noop.status).toBe('refused_by_guard');
    expect(noop.reason).toContain('already covers');
    const previewConn = parse(await h.call('vercel_protection_set_vercel_auth',
      { project: 'prj_FAKE', enabled: false, confirm: true },
      { account, mode: 'preview', profile: 'full', listing: 'catalog' }));
    expect(previewConn.status).toBe('refused_by_guard');
  });
});

describe('F-1 password protection', () => {
  it('refuses to turn it on without a setup-page password', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}').resolves(baseProject);
    const out = parse(await h.call('vercel_protection_set_password',
      { project: 'prj_FAKE', enabled: true, deploymentType: 'preview', dryRun: true }));
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toContain('setup page');
  });

  it('applies with the pending-input password and never echoes it', async () => {
    const h = harness();
    const submitted = await pendingInputs({ db: h.db, env }).submit({
      account, kind: 'deploy_password', label: 'Deployment password', value: 'FAKE-horse-battery' });
    const on = { ...baseProject, passwordProtection: { deploymentType: 'preview' } };
    h.fake.when('GET', '/v9/projects/{idOrName}')
      .resolves(baseProject).resolves(baseProject).resolves(on);
    h.fake.when('PATCH', '/v9/projects/{idOrName}').resolves(on);
    const applied = parse(await h.call('vercel_protection_set_password', {
      project: 'prj_FAKE', enabled: true, deploymentType: 'preview',
      pendingInputId: submitted.id, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    const patch = h.fake.calls.find(x => x.method === 'PATCH');
    expect(patch.body).toEqual({ passwordProtection:
      { deploymentType: 'preview', password: 'FAKE-horse-battery' } });
    expect(JSON.stringify(applied)).not.toContain('FAKE-horse-battery');
    expect(JSON.stringify(h.audit)).not.toContain('FAKE-horse-battery');
    h.fake.verify();
  });

  it('turns password protection off with a null field', async () => {
    const h = harness();
    const row = { ...baseProject, passwordProtection: { deploymentType: 'all' } };
    h.fake.when('GET', '/v9/projects/{idOrName}')
      .resolves(row).resolves(row).resolves(baseProject);
    h.fake.when('PATCH', '/v9/projects/{idOrName}').resolves(baseProject);
    const applied = parse(await h.call('vercel_protection_set_password',
      { project: 'prj_FAKE', enabled: false, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body)
      .toEqual({ passwordProtection: null });
  });
});

describe('F-1 trusted IPs', () => {
  const args = { project: 'prj_FAKE', enabled: true, deploymentType: 'preview',
    protectionMode: 'exclusive', addresses: [{ value: '203.0.113.7', note: 'hq' },
      { value: '198.51.100.0/24' }] };
  const row = { ...baseProject, trustedIps: { deploymentType: 'preview',
    protectionMode: 'exclusive', addresses: [{ value: '203.0.113.7', note: 'hq' },
      { value: '198.51.100.0/24' }] } };

  it('sets trusted IPs with the exact documented body and read-back', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}')
      .resolves(baseProject).resolves(baseProject).resolves(row);
    h.fake.when('PATCH', '/v9/projects/{idOrName}').resolves(row);
    const applied = parse(await h.call('vercel_protection_set_trusted_ips',
      { ...args, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body).toEqual({ trustedIps: {
      deploymentType: 'preview', protectionMode: 'exclusive', addresses: args.addresses } });
    h.fake.verify();
  });

  it('refuses invalid addresses and IPv6 (the contract does not support it)', async () => {
    const h = harness();
    h.fake.when('GET', '/v9/projects/{idOrName}').resolves(baseProject);
    for (const value of ['999.1.1.1', '::1', '10.0.0.0/33', 'not-an-ip']) {
      const out = parse(await h.call('vercel_protection_set_trusted_ips',
        { ...args, addresses: [{ value }], dryRun: true }));
      expect(out.status).toBe('refused_by_guard');
    }
    const longNote = parse(await h.call('vercel_protection_set_trusted_ips',
      { ...args, addresses: [{ value: '203.0.113.7', note: 'x'.repeat(21) }], dryRun: true }));
    expect(longNote.status).toBe('refused_by_guard');
  });
});

describe('F-1 bypass secrets', () => {
  it('creates a bypass delivered only through the one-time-secret page', async () => {
    const h = harness();
    let state = { ...baseProject };
    h.fake.when('GET', '/v9/projects/{idOrName}').resolves(state);
    const fetchImpl = async (input, init) => {
      const req = input instanceof Request ? input : null;
      const url = new URL(req ? req.url : String(input));
      const method = (init?.method || req?.method || 'GET').toUpperCase();
      if (method === 'PATCH' && url.pathname.endsWith('/protection-bypass')) {
        const body = JSON.parse(init?.body ?? await req.clone().text());
        const entry = { createdAt: T1, createdBy: 'usr_FAKE', isEnvVar: false,
          note: body.generate.note ?? null, scope: 'automation-bypass' };
        // The provider mints the secret (the contract makes a supplied value
        // optional and pattern-bound); the fake models that mint.
        state = { ...state, protectionBypass: { FAKEproviderMinted: entry } };
        h.fake.when('PATCH', '/v1/projects/{idOrName}/protection-bypass')
          .resolves({ protectionBypass: state.protectionBypass });
        h.fake.when('GET', '/v9/projects/{idOrName}').resolves(state);
      }
      return h.fake.fetch(input, init);
    };
    const applied = parse(await h.call('vercel_protection_create_bypass',
      { project: 'prj_FAKE', note: 'ci pipeline', confirm: true }, production, fetchImpl));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(applied.ownerRevealRef).toMatch(/^[0-9a-f-]{36}$/);
    const patch = h.fake.calls.find(x => x.method === 'PATCH');
    expect(patch.body).toEqual({ generate: { note: 'ci pipeline' } });
    const revealed = await oneTimeSecrets({ db: h.db, env })
      .reveal({ id: applied.ownerRevealRef, account });
    expect(revealed.value).toBe('FAKEproviderMinted');
    expect(JSON.stringify(applied)).not.toContain(revealed.value);
    expect(JSON.stringify(h.audit)).not.toContain(revealed.value);
    h.fake.verify();
  });

  it('revokes by note, warns on the env-var secret, refuses unknown notes', async () => {
    const h = harness();
    const after = { ...bypassRow, protectionBypass: {
      FAKEsecretCI: bypassRow.protectionBypass.FAKEsecretCI,
      FAKEsecretINT: bypassRow.protectionBypass.FAKEsecretINT } };
    h.fake.when('GET', '/v9/projects/{idOrName}')
      .resolves(bypassRow).resolves(bypassRow).resolves(bypassRow).resolves(bypassRow)
      .resolves(after);
    h.fake.when('PATCH', '/v1/projects/{idOrName}/protection-bypass')
      .resolves({ protectionBypass: after.protectionBypass });
    const warn = parse(await h.call('vercel_protection_revoke_bypass',
      { project: 'prj_FAKE', note: 'ci pipeline', dryRun: true }));
    expect(warn.preview).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    const unknown = parse(await h.call('vercel_protection_revoke_bypass',
      { project: 'prj_FAKE', note: 'no such note', dryRun: true }));
    expect(unknown.status).toBe('refused_by_guard');
    const applied = parse(await h.call('vercel_protection_revoke_bypass',
      { project: 'prj_FAKE', note: 'old laptop', confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body)
      .toEqual({ revoke: { secret: 'FAKEsecretOLD', regenerate: false } });
    expect(JSON.stringify(applied)).not.toContain('FAKEsecretOLD');
    h.fake.verify();
  });
});

describe('F-1 shareable links', () => {
  const aliasRow = { uid: 'alias_FAKE', alias: 'demo.vercel.app', projectId: 'prj_FAKE', protectionBypass: {} };
  const linkedRow = { ...aliasRow, protectionBypass: {
    FAKEshareableSecret: { createdAt: T1, createdBy: 'usr_FAKE', scope: 'shareable-link' } } };

  it('creates a link recovered by read-back and delivered once', async () => {
    const h = harness();
    h.fake.when('GET', '/v4/aliases/{idOrAlias}').resolves(aliasRow).resolves(linkedRow);
    h.fake.when('PATCH', '/aliases/{id}/protection-bypass').resolves({});
    const applied = parse(await h.call('vercel_alias_set_shareable_link',
      { alias: 'demo.vercel.app', action: 'create', confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(applied.ownerRevealRef).toMatch(/^[0-9a-f-]{36}$/);
    const revealed = await oneTimeSecrets({ db: h.db, env })
      .reveal({ id: applied.ownerRevealRef, account });
    expect(revealed.value).toBe('FAKEshareableSecret');
    expect(JSON.stringify(applied)).not.toContain('FAKEshareableSecret');
    h.fake.verify();
  });

  it('refuses a second link and revokes by creation time', async () => {
    const h = harness();
    h.fake.when('GET', '/v4/aliases/{idOrAlias}')
      .resolves(linkedRow).resolves(linkedRow).resolves(linkedRow).resolves(aliasRow);
    h.fake.when('PATCH', '/aliases/{id}/protection-bypass').resolves({});
    const dup = parse(await h.call('vercel_alias_set_shareable_link',
      { alias: 'demo.vercel.app', action: 'create', dryRun: true }));
    expect(dup.status).toBe('refused_by_guard');
    expect(dup.reason).toContain('already has a shareable link');
    const applied = parse(await h.call('vercel_alias_set_shareable_link',
      { alias: 'demo.vercel.app', action: 'revoke', createdAt: T1, confirm: true }));
    expect(applied).toMatchObject({ status: 'applied', confirmed: true });
    expect(h.fake.calls.find(x => x.method === 'PATCH').body)
      .toEqual({ revoke: { secret: 'FAKEshareableSecret', regenerate: false } });
    h.fake.verify();
  });
});
