import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { listMcpTools, dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { registry } from '../../src/tools/index.js';
import { FRONT_DOOR } from '../../src/data/front-door.js';
import { checkBudgets, measureBudgets, FRONT_DOOR_TOKENS_MAX } from '../../scripts/check-budgets.mjs';
import { createDb } from '../../src/db.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';
import { randomToken } from '../../src/core/oauth.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createVercelLoginService } from '../../src/vercel/login.js';

const names = (profile, listing) => listMcpTools(registry, { profile, listing }).map((t) => t.name);
const META_FIVE = ['vercel_search_tools', 'vercel_describe_tool', 'vercel_call', 'vercel_recent_changes', 'vercel_get_result'];

describe('AUD-C front-door membership artifact (OP-1 / D-C)', () => {
  it('is a versioned, labelled SEED whose tools are all registered', () => {
    expect(FRONT_DOOR.version).toBe(1);
    expect(FRONT_DOOR.basis).toBe('seed-2026-10-27');
    expect(new Set(FRONT_DOOR.tools).size).toBe(FRONT_DOOR.tools.length);
    const registered = new Set(registry.tools.map((t) => t.name));
    for (const name of FRONT_DOOR.tools) expect(registered.has(name)).toBe(true);
    for (const name of [...META_FIVE, 'vercel_batch']) expect(FRONT_DOOR.tools).toContain(name);
  });

  it('front_door returns the membership intersected with the connection profile', () => {
    for (const profile of ['read_only', 'everyday', 'full']) {
      const door = names(profile, 'front_door');
      for (const name of door) expect(FRONT_DOOR.tools).toContain(name);
      for (const name of META_FIVE) expect(door).toContain(name);
      expect(door).toContain('vercel_batch');
      expect(door.length).toBeLessThan(names(profile, 'catalog').length);
    }
    const readOnly = names('read_only', 'front_door');
    expect(readOnly).not.toContain('vercel_project_create');
    expect(readOnly).not.toContain('vercel_deploy_redeploy');
    expect(names('everyday', 'front_door')).toContain('vercel_project_create');
  });

  it('leaves compact and catalog membership byte-identical to baseline', () => {
    expect(names('everyday', 'compact').sort()).toEqual([
      'vercel_api_search', 'vercel_batch', 'vercel_call', 'vercel_describe_tool',
      'vercel_get_result', 'vercel_search_tools', 'vercel_whoami'
    ]);
    expect(names('read_only', 'catalog')).toHaveLength(78); // AUD-AB: +vercel_account_teams (read, all profiles); M-1: +3 reads (all profiles); M-2: +2 reads (all profiles); M-3: +3 reads (all profiles); M-4: +2 reads (all profiles); F-1: +2 protection reads (all profiles); F-2: +3 firewall reads (all profiles); F-3: +vercel_route_list, +vercel_redirect_list (reads, all profiles); N-2: +vercel_dns_list, +vercel_dns_get_record, +vercel_cert_list (reads, all profiles)
    expect(names('everyday', 'catalog')).toHaveLength(114); // AUD-AB: +vercel_account_teams; M-1: +3 reads (all profiles); M-2: +2 reads, +vercel_drain_test; M-3: +3 reads (all profiles); M-4: +2 reads, +vercel_blob_put; F-1: +2 protection reads, +vercel_alias_set_shareable_link; F-2: +3 firewall reads, +vercel_firewall_block_ip, +vercel_firewall_unblock_ip, +vercel_firewall_set_attack_mode; F-3: +2 routing reads, +6 route/redirect/cache writes; N-2: +3 DNS/cert reads, +vercel_dns_create_record, +vercel_dns_update_record, +vercel_cert_issue
    expect(names('full', 'catalog')).toHaveLength(192); // AUD-Z: +vercel_set_working_box, reachable again for the owner profile; AUD-AA: +vercel_remove_account (owner catalog only); AUD-AB: +vercel_account_teams, +vercel_team_create, +vercel_team_delete; M-1: +5 logs/analytics tools; M-2: +vercel_drain_list, +vercel_drain_create, +vercel_drain_delete, +vercel_drain_update, +vercel_drain_test, +vercel_webhook_list, +vercel_webhook_create, +vercel_webhook_delete; M-3: +vercel_integration_list, +vercel_integration_get, +vercel_integration_remove, +vercel_integration_connect_resource, +vercel_integration_create_store, +vercel_storage_get_store, +vercel_storage_create_blob_store, +vercel_storage_delete_blob_store; M-4: +vercel_blob_list, +vercel_blob_head, +vercel_blob_put, +vercel_blob_delete; O-1R: +2 team retention/directory tools; F-1: +8 protection tools; U-1m: +vercel_api_write (full profile only); F-2: +11 firewall tools; F-3: +8 routing tools; N-2: +9 DNS/cert tools
    expect(names('everyday', 'catalog')).toContain('vercel_env_set');
    expect(names('everyday', 'front_door')).not.toContain('vercel_env_set');  });

  it('keeps the unknown-listing fall-through on the catalog shape', () => {
    expect(names('everyday', 'some_future_listing')).toEqual(names('everyday', 'catalog'));
  });

  it('keeps the search/describe escape hatch over the full registry under front_door', async () => {
    const connection = { account: 'team_ALPHA', mode: 'preview', profile: 'read_only', listing: 'front_door' };
    const parse = (r) => JSON.parse(r.content[0].text);
    const found = parse(await dispatchReadOnlyTool({
      registry, name: 'vercel_search_tools', args: { query: 'connections' }, connection, db: {}
    }));
    expect(found.tools.some((x) => x.name === 'vercel_list_connections')).toBe(true);
    expect(FRONT_DOOR.tools).not.toContain('vercel_list_connections');
    const described = parse(await dispatchReadOnlyTool({
      registry, name: 'vercel_describe_tool', args: { name: 'vercel_list_connections' }, connection, db: {}
    }));
    expect(described.name).toBe('vercel_list_connections');
  });
});

describe('AUD-C front-door budgets (owner policy OP-1)', () => {
  it('measures the front door under 5,000 tokens at every profile and names its source', () => {
    const m = measureBudgets(registry.tools);
    expect(m.frontDoorReadOnly).toBeLessThan(FRONT_DOOR_TOKENS_MAX);
    expect(m.frontDoor).toBeLessThan(FRONT_DOOR_TOKENS_MAX);
    expect(m.frontDoorFull).toBeLessThan(FRONT_DOOR_TOKENS_MAX);
    expect(m.frontDoorMembership).toEqual({
      source: 'src/data/front-door.json', version: 1, basis: 'seed-2026-10-27', tools: FRONT_DOOR.tools.length
    });
    expect(checkBudgets(registry.tools)).toEqual([]);
  });

  it('fails when the membership is planted over budget', () => {
    const profiles = ['read_only', 'everyday', 'full'];
    const tools = FRONT_DOOR.tools.map((name) => ({
      name, description: 'Read fixture resource', writes: false, profiles,
      inputSchema: { type: 'object', properties: { blob: { type: 'string', description: 'y'.repeat(4500) } }, additionalProperties: false }
    }));
    const failures = checkBudgets(tools);
    expect(failures.some((x) => x.startsWith('front-door listing'))).toBe(true);
  });
});

function captureDb() {
  const calls = [];
  const query = (strings, ...values) => { calls.push({ sql: strings.join('?'), values }); return Promise.resolve([]); };
  return { db: createDb(query), calls };
}

describe('AUD-C issuance defaults', () => {
  it('defaults new auth codes and access tokens to front_door; explicit catalog is honored', async () => {
    const first = captureDb();
    await first.db.createAuthCode({ code: 'code_fixture', clientId: 'client_fixture', redirectUri: 'https://client.example.test/cb', codeChallenge: 'x'.repeat(43) });
    expect(first.calls[0].values).toContain('front_door');
    const second = captureDb();
    await second.db.createAccessToken({ accessToken: '<redacted>', refreshToken: '<redacted>', clientId: 'client_fixture' });
    expect(second.calls[0].values).toContain('front_door');
    const third = captureDb();
    await third.db.createAccessToken({ accessToken: '<redacted>', refreshToken: '<redacted>', clientId: 'client_fixture', listing: 'catalog' });
    expect(third.calls[0].values).toContain('catalog');
    expect(third.calls[0].values).not.toContain('front_door');
  });

  it('authenticates a front_door token and leaves a stored catalog token untouched', async () => {
    const env = { PUBLIC_BASE_URL: 'https://vercel-mcp.example.test', VERCEL_ENV: 'preview' };
    const db = createFakeDb();
    const doorToken = randomToken();
    await db.createAccessToken({ accessToken: doorToken, refreshToken: randomToken(), clientId: 'client_fixture', vercelAccount: 'team_fixture', mode: 'preview', profile: 'everyday', listing: 'front_door' });
    const catalogToken = randomToken();
    await db.createAccessToken({ accessToken: catalogToken, refreshToken: randomToken(), clientId: 'client_fixture', vercelAccount: 'team_fixture', mode: 'preview', profile: 'everyday', listing: 'catalog' });
    const attempt = async (token) => {
      const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, send(value) { this.body = value; return this; } };
      return requireMcpToken({ headers: { authorization: 'Bearer ' + token } }, res, db, env);
    };
    expect((await attempt(doorToken)).listing).toBe('front_door');
    expect((await attempt(catalogToken)).listing).toBe('catalog');
  });
});

describe('AUD-C OAuth authorize door', () => {
  const baseEnv = { PUBLIC_BASE_URL: 'https://vercel-mcp.example.test', ADMIN_PASSPHRASE: 'test-passphrase-fixture', VERCEL_ENV: 'preview' };
  const resource = baseEnv.PUBLIC_BASE_URL + '/api/mcp';
  const callback = 'https://client.example.test/callback';
  const challenge = createHash('sha256').update('a'.repeat(43)).digest('base64url');
  function request(method, data) {
    return { method, headers: {}, body: method === 'GET' ? undefined : data, query: method === 'GET' ? data : undefined, socket: { remoteAddress: '198.51.100.1' } };
  }
  function response() {
    return { statusCode: 200, headers: {}, body: null, ended: false,
      setHeader(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      send(value) { this.body = value; return this; },
      json(value) { this.body = JSON.stringify(value); return this; },
      end() { this.ended = true; return this; } };
  }
  async function fixture() {
    const db = createFakeDb({ accounts: [{ id: 'team_fixture', label: 'Fixture team', scope: 'team', production_enabled: false, team_id: 'team_fixture', team_slug: 'fixture' }] });
    const handlers = createOAuthHandlers({ db, env: baseEnv, service: createVercelLoginService(db) });
    const res = response();
    await handlers.register(request('POST', { redirect_uris: [callback], client_name: 'Test client' }), res);
    return { db, handlers, client: JSON.parse(res.body) };
  }
  const args = (client, extra = {}) => ({
    client_id: client.client_id, redirect_uri: callback, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'state-fixture',
    resource, account: 'team_fixture', mode: 'preview', profile: 'full', ...extra
  });

  it('preselects front_door when no listing is chosen and honors an explicit catalog choice', async () => {
    const { handlers, client } = await fixture();
    const noChoice = response();
    await handlers.authorize(request('GET', args(client)), noChoice);
    expect(noChoice.body).toContain('<option value="front_door" selected>');
    const explicit = response();
    await handlers.authorize(request('GET', args(client, { listing: 'catalog' })), explicit);
    expect(explicit.body).toContain('<option value="catalog" selected>');
    expect(explicit.body).not.toContain('<option value="front_door" selected>');
  });

  it('binds front_door to the issued code when that listing is submitted', async () => {
    const { db, handlers, client } = await fixture();
    const res = response();
    await handlers.authorize(request('POST', args(client, { listing: 'front_door', passphrase: 'test-passphrase-fixture' })), res);
    expect(res.statusCode).toBe(302);
    const code = new URL(res.headers.Location).searchParams.get('code');
    const record = await db.consumeAuthCode(code);
    expect(record.listing).toBe('front_door');
  });
});
