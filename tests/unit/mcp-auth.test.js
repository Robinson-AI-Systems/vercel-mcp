import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { randomToken } from '../../src/core/oauth.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';

const env = { PUBLIC_BASE_URL: 'https://vercel-mcp.example.test', VERCEL_ENV: 'preview' };
function request(token) { return { headers: token ? { authorization: 'Bearer ' + token } : {} }; }
function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; }
  };
}
async function authenticate(db, token, runtimeEnv = env) {
  const res = response();
  const connection = await requireMcpToken(request(token), res, db, runtimeEnv);
  return { connection, res };
}
async function addToken(db, options = {}) {
  const accessToken = randomToken();
  await db.createAccessToken({
    accessToken, refreshToken: randomToken(), clientId: 'client_fixture',
    vercelAccount: 'team_fixture', mode: 'preview', profile: 'everyday', listing: 'catalog', ...options
  });
  return accessToken;
}

describe('MCP bearer authentication', () => {
  it('requires a bearer and advertises protected-resource metadata', async () => {
    const { connection, res } = await authenticate(createFakeDb(), null);
    expect(connection).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe(
      'Bearer resource_metadata="https://vercel-mcp.example.test/.well-known/oauth-protected-resource"'
    );
  });

  it('returns only generic connection context for a valid token', async () => {
    const db = createFakeDb();
    const accessToken = await addToken(db);
    const { connection, res } = await authenticate(db, accessToken);
    expect(res.statusCode).toBe(200);
    expect(connection.resultOwner).toMatch(/^resown_[a-f0-9]{64}$/);
    expect(JSON.stringify(connection)).not.toContain('resown_');
    expect(connection).toEqual({
      clientId: 'client_fixture', account: 'team_fixture',
      mode: 'preview', profile: 'everyday', listing: 'catalog',
      // AUD-A2: server-minted classification of the owner's own connection.
      kind: 'connector',
      // AUD-AQ: the connection's own read-only switch, born off.
      readOnly: false
    });
  });

  it('isolates two bearer identities sharing client and account',async()=>{
    const db=createFakeDb(),a=await addToken(db),b=await addToken(db);
    const x=(await authenticate(db,a)).connection,y=(await authenticate(db,b)).connection;
    expect(x.clientId).toBe(y.clientId);
    expect(x.resultOwner).not.toBe(y.resultOwner);
    expect(x.resultOwner).toBe((await authenticate(db,a)).connection.resultOwner);
    expect(Object.keys(x)).not.toContain('resultOwner');
  });
  it('rejects expired and revoked access tokens', async () => {
    const db = createFakeDb();
    const expired = await addToken(db, { ttlSeconds: -1 });
    expect((await authenticate(db, expired)).res.statusCode).toBe(401);
    const revoked = await addToken(db);
    await db.revokeAccessToken(revoked);
    const result = await authenticate(db, revoked);
    expect(result.connection).toBeNull();
    expect(result.res.statusCode).toBe(401);
    expect(result.res.headers['WWW-Authenticate']).toContain('error="invalid_token"');
  });

  it('refuses production tokens outside production and when the account is disabled', async () => {
    const enabledDb = createFakeDb({
      accounts: [{ id: 'team_fixture', label: 'Fixture', production_enabled: true }]
    });
    const productionToken = await addToken(enabledDb, { mode: 'production' });
    expect((await authenticate(enabledDb, productionToken, env)).connection).toBeNull();
    const liveEnv = { ...env, VERCEL_ENV: 'production' };
    expect((await authenticate(enabledDb, productionToken, liveEnv)).connection).toMatchObject({
      account: 'team_fixture', mode: 'production'
    });

    const disabledDb = createFakeDb({
      accounts: [{ id: 'team_fixture', label: 'Fixture', production_enabled: false }]
    });
    const disabledToken = await addToken(disabledDb, { mode: 'production' });
    expect((await authenticate(disabledDb, disabledToken, liveEnv)).connection).toBeNull();
  });
});
