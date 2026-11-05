// RECENSUS-1: the OAuth client registration lifecycle tools.
// Unit level: the owner-door gate at the real dispatch boundary,
// the public shape (no secret material), update's mutable-fields
// boundary, and delete's confirmed-action binding (evaluate →
// disclose → confirm bound to the evaluation → execute → read-back).
// The lifecycle against real Postgres lives in
// tests/db/oauth-clients.test.js.
import { describe, it, expect, vi } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { oauthClientsTools } from '../../src/tools/oauth-clients.js';

const H = oauthClientsTools.handlers;
const parse = result => JSON.parse(result.content[0].text);
const owner = { kind: 'connector', account: 'team_FAKE', profile: 'full',
  mode: 'production', listing: 'catalog' };
const ID = 'FAKEclient-id_0123456789abcd';
const MISSING = 'FAKEmissing-id_0123456789abc';

function seedRow() {
  return { client_id: ID, client_name: 'Probe client',
    redirect_uris: ['https://example.test/callback'],
    token_endpoint_auth_method: 'client_secret_post',
    client_type: 'confidential', created_at: '2026-11-01T00:00:00.000Z',
    live_tokens: 2, tokens_total: 3, last_used_at: null,
    codes_outstanding: 1 };
}
function fixture() {
  const rows = new Map([[ID, seedRow()]]);
  const db = {
    listOAuthClients: vi.fn(async () => [...rows.values()]),
    getOAuthClientRegistration: vi.fn(async id => rows.get(id) ?? null),
    updateOAuthClient: vi.fn(async ({ clientId, clientName, redirectUris }) => {
      const row = rows.get(clientId);
      if (!row) return null;
      if (clientName !== undefined) row.client_name = clientName;
      if (redirectUris !== undefined) row.redirect_uris = redirectUris;
      return row;
    }),
    deleteOAuthClient: vi.fn(async ({ clientId }) => {
      if (!rows.delete(clientId)) return null;
      return { deleted: true, tokensRevoked: 2, codesRemoved: 1 };
    })
  };
  return { db, rows };
}

describe('RECENSUS-1 OAuth client registration tools', () => {
  it('lists and reads registrations in the public shape — no secret material', async () => {
    const f = fixture();
    const list = parse(await H.vercel_list_oauth_clients({}, { connection: owner, db: f.db }));
    expect(list.count).toBe(1);
    expect(list.clients[0]).toEqual(seedRow());
    expect(JSON.stringify(list)).not.toContain('secret_hash');
    const got = parse(await H.vercel_get_oauth_client(
      { clientId: ID }, { connection: owner, db: f.db }));
    expect(got.registration).toEqual(seedRow());
    const missing = await H.vercel_get_oauth_client(
      { clientId: MISSING }, { connection: owner, db: f.db });
    expect(missing.isError).toBe(true);
    expect(parse(missing).status).toBe('refused_by_guard');
  });

  it('updates only the mutable fields, with dry-run disclosure and read-back', async () => {
    const f = fixture();
    const plan = parse(await H.vercel_update_oauth_client(
      { clientId: ID, clientName: 'Renamed', dryRun: true },
      { connection: owner, db: f.db }));
    expect(plan.status).toBe('planned');
    expect(plan.changes).toEqual({ clientName: { from: 'Probe client', to: 'Renamed' } });
    expect(f.db.updateOAuthClient).not.toHaveBeenCalled();
    const noConfirm = await H.vercel_update_oauth_client(
      { clientId: ID, clientName: 'Renamed' }, { connection: owner, db: f.db });
    expect(parse(noConfirm).status).toBe('refused_by_guard');
    const done = parse(await H.vercel_update_oauth_client(
      { clientId: ID, clientName: 'Renamed',
        redirectUris: ['https://example.test/new'], confirm: true },
      { connection: owner, db: f.db }));
    expect(done).toMatchObject({ status: 'applied', confirmed: true });
    expect(done.registration.client_name).toBe('Renamed');
    expect(done.registration.redirect_uris).toEqual(['https://example.test/new']);
    const missing = await H.vercel_update_oauth_client(
      { clientId: MISSING, clientName: 'X', confirm: true },
      { connection: owner, db: f.db });
    expect(parse(missing).status).toBe('refused_by_guard');
  });

  it('deletes only on a confirmation bound to the fresh evaluation', async () => {
    const f = fixture();
    const plan = parse(await H.vercel_delete_oauth_client(
      { clientId: ID, dryRun: true }, { connection: owner, db: f.db }));
    expect(plan.status).toBe('planned');
    expect(plan.evaluation).toMatch(/^[a-f0-9]{32}$/);
    expect(plan.disclosure).toContain('revokes its 2 live token families');
    expect(f.db.deleteOAuthClient).not.toHaveBeenCalled();
    // No evaluation echoed: refused, nothing deleted.
    const unbound = await H.vercel_delete_oauth_client(
      { clientId: ID, confirm: true }, { connection: owner, db: f.db });
    expect(parse(unbound).status).toBe('refused_by_guard');
    expect(f.db.deleteOAuthClient).not.toHaveBeenCalled();
    // The row drifts after the dry run: the stale evaluation refuses.
    f.rows.get(ID).live_tokens = 5;
    const stale = await H.vercel_delete_oauth_client(
      { clientId: ID, confirm: true, evaluation: plan.evaluation },
      { connection: owner, db: f.db });
    expect(parse(stale).status).toBe('refused_by_guard');
    expect(f.db.deleteOAuthClient).not.toHaveBeenCalled();
    // A fresh evaluation confirms; read-back verifies the deletion.
    const fresh = parse(await H.vercel_delete_oauth_client(
      { clientId: ID, dryRun: true }, { connection: owner, db: f.db }));
    const done = parse(await H.vercel_delete_oauth_client(
      { clientId: ID, confirm: true, evaluation: fresh.evaluation },
      { connection: owner, db: f.db }));
    expect(done).toMatchObject({ status: 'applied', confirmed: true,
      deleted: ID, tokensRevoked: 2, codesRemoved: 1 });
    expect(f.db.deleteOAuthClient).toHaveBeenCalledTimes(1);
    // Deleting again is a clean refusal, never a partial mutation.
    const again = await H.vercel_delete_oauth_client(
      { clientId: ID, confirm: true, evaluation: fresh.evaluation },
      { connection: owner, db: f.db });
    expect(parse(again).status).toBe('refused_by_guard');
    expect(f.db.deleteOAuthClient).toHaveBeenCalledTimes(1);
  });

  it('refuses other principals at the handler and at dispatch', async () => {
    const f = fixture();
    const fullPass = { kind: 'pass', account: 'team_FAKE', profile: 'full',
      mode: 'production', listing: 'catalog' };
    for (const [name, args] of [
      ['vercel_list_oauth_clients', {}],
      ['vercel_get_oauth_client', { clientId: ID }],
      ['vercel_update_oauth_client', { clientId: ID, clientName: 'X', confirm: true }],
      ['vercel_delete_oauth_client', { clientId: ID, confirm: true }]
    ]) {
      const out = await dispatchReadOnlyTool({ registry, name, args,
        connection: fullPass, db: f.db, env: {} });
      expect(out.isError).toBe(true);
      expect(parse(out).status).toBe('refused_by_guard');
      expect(parse(out).reason).toContain('owner\'s own connector connection');
      const narrow = await dispatchReadOnlyTool({ registry, name, args,
        connection: { kind: 'connector', account: 'team_FAKE',
          profile: 'everyday', mode: 'preview', listing: 'catalog' },
        db: f.db, env: {} });
      expect(narrow.isError).toBe(true);
      expect(narrow.content[0].text).toContain('Tool unavailable');
    }
    expect(f.db.listOAuthClients).not.toHaveBeenCalled();
    expect(f.db.updateOAuthClient).not.toHaveBeenCalled();
    expect(f.db.deleteOAuthClient).not.toHaveBeenCalled();
  });
});
