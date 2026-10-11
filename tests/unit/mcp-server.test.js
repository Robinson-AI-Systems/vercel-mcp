import { describe, expect, it } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';

const env = { PUBLIC_BASE_URL: 'https://vercel-mcp.example.test', VERCEL_ENV: 'preview' };
const challenge = 'Bearer resource_metadata="https://vercel-mcp.example.test/.well-known/oauth-protected-resource"';

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; }
  };
}
function request(authorization) {
  return { method: 'POST', headers: authorization ? { authorization } : {}, body: {} };
}

describe('MCP bearer boundary', () => {
  it('requires a bearer token and returns a protected-resource challenge', async () => {
    const db = createFakeDb();
    const res = response();
    expect(await requireMcpToken(request(), res, db, env)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe(challenge);
    expect(JSON.parse(res.body).error).toBe('unauthorized');
  });

  it('accepts a valid preview token and returns only the connection settings', async () => {
    const db = createFakeDb();
    await db.createAccessToken({
      accessToken: 'A'.repeat(43), refreshToken: 'R'.repeat(43), clientId: 'client-fixture',
      vercelAccount: 'team_fixture', mode: 'preview', profile: 'everyday', listing: 'catalog'
    });
    const res = response();
    const connection = await requireMcpToken(request('Bearer ' + 'A'.repeat(43)), res, db, env);
    expect(connection).toEqual({
      clientId: 'client-fixture', account: 'team_fixture', mode: 'preview',
      profile: 'everyday', listing: 'catalog'
    });
    expect(Object.isFrozen(connection)).toBe(true);
  });

  it('rejects production tokens on preview deployments even when the account is enabled', async () => {
    const db = createFakeDb({ accounts: [{
      id: 'team_fixture', team_id: 'team_fixture', team_slug: 'fixture', label: 'Fixture',
      scope: 'team', production_enabled: true
    }] });
    await db.createAccessToken({
      accessToken: 'P'.repeat(43), clientId: 'client-fixture',
      vercelAccount: 'team_fixture', mode: 'production', profile: 'full', listing: 'catalog'
    });
    const res = response();
    expect(await requireMcpToken(request('Bearer ' + 'P'.repeat(43)), res, db, env)).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('denies tools unless they are explicitly read-only and profile-compatible', async () => {
    let calls = 0;
    const registry = {
      tools: [
        { name: 'vercel_read', writes: false, profiles: ['everyday', 'full'] },
        { name: 'vercel_write', writes: true, profiles: ['everyday', 'full'] },
        { name: 'vercel_hidden', profiles: ['everyday', 'full'] }
      ],
      handlers: {
        vercel_read: async (args, context) => { calls++; return { content: [{ type: 'text', text: context.connection.account }] }; },
        vercel_write: async () => { calls++; return { ok: true }; },
        vercel_hidden: async () => { calls++; return { ok: true }; }
      }
    };
    const connection = { account: 'team_fixture', profile: 'everyday' };
    const allowed = await dispatchReadOnlyTool({
      registry, name: 'vercel_read', args: {}, connection, db: createFakeDb()
    });
    expect(allowed.content[0].text).toBe('team_fixture');
    for (const name of ['vercel_write', 'vercel_hidden', 'vercel_missing']) {
      const denied = await dispatchReadOnlyTool({ registry, name, args: {}, connection, db: createFakeDb() });
      expect(denied.isError).toBe(true);
    }
    expect(calls).toBe(1);
    const wrongProfile = await dispatchReadOnlyTool({
      registry, name: 'vercel_read', args: {}, connection: { ...connection, profile: 'read_only_not_allowed' }, db: createFakeDb()
    });
    expect(wrongProfile.isError).toBe(true);
    expect(calls).toBe(1);
  });
});
