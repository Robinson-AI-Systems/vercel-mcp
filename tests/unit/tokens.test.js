import {describe, expect, it, vi} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {tokenTools} from '../../src/tools/tokens.js';
import {loadToken} from '../../src/vercel/tokens.js';

vi.mock('../../src/vercel/tokens.js', async importOriginal => {
  const original = await importOriginal();
  return {...original, loadToken: vi.fn()};
});

const account = {id: 'acct_1', team_id: 'team_ONE', scope: 'team'};
const conn = {account: account.id, profile: 'full', mode: 'production', listing: 'catalog', kind: 'connector'};
const ENV = {VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: '00'.repeat(32)};
const CREATED = 'vcp_FAKECREATEDTOKEN0001';
const tokenRow = (over = {}) => ({
  id: 'tok_1', name: 'ci-token', type: 'user', prefix: 'vcp_xxxx', suffix: 'WXYZ',
  scopes: [{type: 'team', teamId: 'team_ONE', createdAt: 1700000000000}],
  createdAt: 1700000000000, expiresAt: 1790000000000, activeAt: 1750000000000, ...over
});

function fixture() {
  loadToken.mockResolvedValue({token: 'vcp_FAKE', account});
  const api = makeFakeVercel();
  const audit = [], upserts = [], secrets = new Map();
  const db = {
    getAccountCredential: async () => ({}), listProtectedResources: async () => [],
    getPurchasePolicy: async () => ({grantRequired: false, budgetCents: null}),
    getTodaySpendCents: async () => 0,
    recordChange: async row => audit.push(row),
    listVercelAccounts: async () => [],
    upsertVercelAccount: async row => upserts.push(row),
    insertOneTimeSecret: async row => secrets.set(row.id, row),
    consumeOneTimeSecret: async () => null,
    requestReplayStore: () => {
      const rows = new Map();
      return {
        claim: async ({key}) => {
          if (rows.has(key)) return rows.get(key);
          rows.set(key, {state: 'pending'}); return {state: 'claimed', claimId: 'FAKE'};
        },
        complete: async ({key, result}) => rows.set(key, {state: 'completed', result}),
        release: async ({key}) => rows.delete(key)
      };
    }
  };
  return {api, db, audit, upserts, secrets,
    ctx: extra => ({db, connection: conn, fetchImpl: api.fetch, env: ENV, ...extra})};
}

describe('O-3 token tools', () => {
  it('lists tokens with scope, expiry and leak flags — never values', async () => {
    const f = fixture();
    f.api.when('GET', '/v6/user/tokens').resolves({
      tokens: [tokenRow(), tokenRow({id: 'tok_2', name: 'old', expiresAt: undefined,
        leakedAt: 1740000000000, scopes: [{type: 'project', teamId: 'team_ONE', projectId: 'prj_ABC123'}]})],
      pagination: {count: 2, next: null, prev: null}});
    const out = JSON.parse((await tokenTools.handlers.vercel_token_list({}, f.ctx())).content[0].text);
    expect(out.tokens).toHaveLength(2);
    expect(out.tokens[0]).toMatchObject({name: 'ci-token', suffix: 'WXYZ', leaked: false});
    expect(out.tokens[0].scopes).toEqual([{type: 'team', teamId: 'team_ONE'}]);
    expect(out.tokens[1].expiresAt).toBeNull();
    expect(out.tokens[1].leaked).toBe(true);
    expect(JSON.stringify(out)).not.toContain('bearerToken');
  });

  it('creates a team token delivered as a one-time owner reveal', async () => {
    const f = fixture();
    f.api.when('GET', '/v2/teams/{teamId}').resolves({id: 'team_ONE', slug: 'demo'});
    f.api.when('POST', '/v3/user/tokens')
      .resolves({bearerToken: CREATED, token: tokenRow({id: 'tok_NEW'})});
    f.api.when('GET', '/v5/user/tokens/{tokenId}').resolves(tokenRow({id: 'tok_NEW'}));
    const args = {name: 'ci-token', scope: 'team'};
    const plan = JSON.parse((await tokenTools.handlers.vercel_token_create(args, f.ctx())).content[0].text);
    expect(plan.status).toBe('needs_confirmation');
    expect(plan.preview).toContain('shown ONCE');
    expect(plan.preview).toContain('NO expiry');
    const done = JSON.parse((await tokenTools.handlers.vercel_token_create(
      {...args, confirm: true}, f.ctx())).content[0].text);
    // One-time delivery: the framework's own envelope carries the reveal ref.
    expect(done).toMatchObject({status: 'applied', confirmed: true,
      revealAt: '/api/vercel/setup'});
    expect(done.ownerRevealRef).toMatch(/^[0-9a-f-]{36}$/);
    // The value itself appears NOWHERE in any tool result — only encrypted at rest.
    expect(JSON.stringify(plan) + JSON.stringify(done)).not.toContain(CREATED);
    expect(f.secrets.size).toBe(1);
    const post = f.api.calls.find(c => c.method === 'POST');
    expect(post.path).toBe('/v3/user/tokens');
    expect(post.query).toEqual({teamId: 'team_ONE'});
    expect(post.body).toEqual({name: 'ci-token'});
  });

  it('creates a project token stored directly as a server account, recording its expiry', async () => {
    const f = fixture();
    f.api.when('GET', '/v2/teams/{teamId}').resolves({id: 'team_ONE', slug: 'demo'});
    f.api.when('GET', '/v9/projects/{idOrName}').resolves({id: 'prj_ABC123', name: 'shop'});
    f.api.when('POST', '/v3/user/tokens')
      .resolves({bearerToken: CREATED, token: tokenRow({id: 'tok_PRJ'})});
    f.api.when('GET', '/v5/user/tokens/{tokenId}').resolves(tokenRow({id: 'tok_PRJ', name: 'proj-token'}));
    // storeToken's probe of the NEW token, through the same fake transport.
    f.api.when('GET', '/v2/user').resolves({user: {id: 'usr_1'}});
    f.api.when('GET', '/v2/teams').resolves({teams: [{id: 'team_ONE', slug: 'demo', name: 'Demo'}]});
    f.api.when('GET', '/v10/projects').resolves({projects: [{id: 'prj_ABC123', name: 'shop'}]});
    const expiry = '2027-06-01T00:00:00.000Z';
    const done = JSON.parse((await tokenTools.handlers.vercel_token_create(
      {name: 'proj-token', scope: 'project', projectId: 'prj_ABC123',
       expiresAt: expiry, delivery: 'server', confirm: true}, f.ctx())).content[0].text);
    expect(done).toMatchObject({status: 'applied', confirmed: true});
    expect(done.receipt).toMatchObject({delivery: 'server',
      storedAsAccount: 'team_ONE/prj_ABC123', tokenExpiresAt: expiry});
    expect(f.upserts).toHaveLength(1);
    expect(f.upserts[0].expiresAt).toBe(Date.parse(expiry));
    expect(f.upserts[0].probe).toMatchObject({createdByTool: 'vercel_token_create',
      providerTokenId: 'tok_PRJ'});
    expect(JSON.stringify(done)).not.toContain(CREATED);
  });

  it('refuses malformed creation requests before any provider call', async () => {
    const f = fixture();
    const bad1 = JSON.parse((await tokenTools.handlers.vercel_token_create(
      {name: 'x', scope: 'project'}, f.ctx())).content[0].text);
    expect(bad1.reason).toMatch(/needs the projectId/);
    const bad2 = JSON.parse((await tokenTools.handlers.vercel_token_create(
      {name: 'x', scope: 'team', expiresAt: '2020-01-01'}, f.ctx())).content[0].text);
    expect(bad2.reason).toMatch(/date in the future/);
    expect(f.api.calls).toHaveLength(0);
  });

  it('deletes a token and verifies it is gone', async () => {
    const f = fixture();
    f.api.when('GET', '/v5/user/tokens/{tokenId}')
      .resolves(tokenRow())
      .rejects(Object.assign(new Error('gone'), {status: 404}));
    f.api.when('DELETE', '/v3/user/tokens/{tokenId}').resolves({});
    const done = JSON.parse((await tokenTools.handlers.vercel_token_delete(
      {tokenId: 'tok_1', confirm: true}, f.ctx())).content[0].text);
    expect(done).toMatchObject({status: 'applied', confirmed: true});
    expect(done.receipt).toMatchObject({tokenId: 'tok_1', revoked: true});
    expect(f.api.calls.some(c => c.method === 'DELETE')).toBe(true);
  });

  it('refuses to delete the token this server runs on (provider-id match)', async () => {
    const f = fixture();
    f.db.listVercelAccounts = async () => [
      {id: 'acct_1', token_last4: 'FAKE', token_probe: {providerTokenId: 'tok_1'}}];
    f.api.when('GET', '/v5/user/tokens/{tokenId}').resolves(tokenRow());
    const out = JSON.parse((await tokenTools.handlers.vercel_token_delete(
      {tokenId: 'tok_1', confirm: true}, f.ctx())).content[0].text);
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toMatch(/this server itself runs on/);
    expect(f.api.calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  it('refuses to delete a token sharing the running credential suffix', async () => {
    const f = fixture();
    f.db.listVercelAccounts = async () => [{id: 'acct_1', token_last4: 'WXYZ', token_probe: {}}];
    f.api.when('GET', '/v5/user/tokens/{tokenId}').resolves(tokenRow()); // suffix WXYZ
    const out = JSON.parse((await tokenTools.handlers.vercel_token_delete(
      {tokenId: 'tok_1', confirm: true}, f.ctx())).content[0].text);
    expect(out.status).toBe('refused_by_guard');
    expect(out.reason).toMatch(/same four characters/);
    expect(f.api.calls.some(c => c.method === 'DELETE')).toBe(false);
  });
});
