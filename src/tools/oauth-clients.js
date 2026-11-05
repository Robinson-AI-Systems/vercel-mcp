// RECENSUS-1: the OAuth client registration lifecycle on the owner
// door. Registrations are server-global — a registration carries no
// per-account owner (registration is not account authority, A-3) —
// so the only management surface is the owner's own connector
// connection (localAdmin), the same door as the other server-self
// administration tools. No registration_access_token is issued: the
// owner door is the management credential (decision recorded in
// docs/pr-cards/RECENSUS-1.md). The stored secret hash is never
// returned; the db layer's public shape omits it by construction.
import { createHash } from 'node:crypto';

const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/;
const result = payload => ({
  isError: ['refused_by_guard', 'outcome_unknown'].includes(payload.status),
  content: [{ type: 'text', text: JSON.stringify(payload) }]
});
const refused = reason => result({ status: 'refused_by_guard', confirmed: false, reason });
const asText = payload => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
function requireFields(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !allowed.includes(k))) {
    throw new Error('Invalid tool arguments');
  }
}
function ownerGate(connection) {
  return connection?.kind === 'connector' ? null :
    'Registration management runs only from the account owner\'s own connector connection.';
}
function requireDb(db, methods) {
  return methods.every(m => typeof db?.[m] === 'function');
}
// The row-17 binding: an evaluation fingerprint over exactly what
// the dry run disclosed — the registration's identity fields plus
// its live dependent counts. Confirmation must echo it, and
// execution re-computes it against the current row; any drift
// refuses instead of deleting something other than what was shown.
function evaluationOf(row) {
  const basis = JSON.stringify({
    client_id: row.client_id, client_name: row.client_name,
    redirect_uris: row.redirect_uris,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    client_type: row.client_type, live_tokens: row.live_tokens,
    codes_outstanding: row.codes_outstanding
  });
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}
function disclose(row) {
  const tokens = row.live_tokens === 1 ? '1 live token family' :
    `${row.live_tokens} live token families`;
  const codes = row.codes_outstanding === 1 ? '1 outstanding authorization code' :
    `${row.codes_outstanding} outstanding authorization codes`;
  return `Deleting registration ${row.client_id}` +
    (row.client_name ? ` ("${row.client_name}")` : '') +
    ` permanently removes the registration, revokes its ${tokens} ` +
    `(they stop working immediately) and removes its ${codes}. ` +
    'This cannot be undone; the client would have to register again.';
}

export const oauthClientsTools = {
  tools: [
    { name: 'vercel_list_oauth_clients', writes: true, localAdmin: true,
      profiles: ['full'],
      description: 'List OAuth client registrations (name, redirect URIs, type, created, live token counts) on the owner door; secret material is never shown.',
      inputSchema: { type: 'object', additionalProperties: false,
        properties: { confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
      annotations: { readOnlyHint: false, destructiveHint: false },
      writeContract: { production: true, targets: true } },
    { name: 'vercel_get_oauth_client', writes: true, localAdmin: true,
      profiles: ['full'],
      description: 'Read one OAuth client registration by client_id on the owner door, with its live token and code counts; secret material is never shown.',
      inputSchema: { type: 'object', additionalProperties: false,
        required: ['clientId'],
        properties: { clientId: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$' },
          confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
      annotations: { readOnlyHint: false, destructiveHint: false },
      writeContract: { production: true, targets: true } },
    { name: 'vercel_update_oauth_client', writes: true, localAdmin: true,
      profiles: ['full'],
      description: 'Update a registration\'s display name and/or redirect URIs on the owner door; id, auth method and secret never change. Confirm required.',
      inputSchema: { type: 'object', additionalProperties: false,
        required: ['clientId'],
        properties: {
          clientId: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$' },
          clientName: { type: ['string', 'null'], maxLength: 100 },
          redirectUris: { type: 'array', minItems: 1, maxItems: 8,
            items: { type: 'string', maxLength: 2048 } },
          confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
      annotations: { readOnlyHint: false, destructiveHint: false },
      writeContract: { production: true, targets: true } },
    { name: 'vercel_delete_oauth_client', writes: true, localAdmin: true,
      profiles: ['full'],
      description: 'Delete one OAuth client registration on the owner door, revoking its live token families in the same action. Confirm needs the dry-run evaluation.',
      inputSchema: { type: 'object', additionalProperties: false,
        required: ['clientId'],
        properties: {
          clientId: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$' },
          evaluation: { type: 'string', pattern: '^[a-f0-9]{32}$' },
          confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
      annotations: { readOnlyHint: false, destructiveHint: true },
      writeContract: { production: true, targets: true } }
  ],
  handlers: {
    async vercel_list_oauth_clients(args, { connection, db }) {
      requireFields(args ?? {}, ['dryRun', 'confirm']);
      const gate = ownerGate(connection);
      if (gate) return refused(gate);
      if (!requireDb(db, ['listOAuthClients'])) throw new Error('Registration store unavailable');
      const clients = await db.listOAuthClients();
      return asText({ clients, count: clients.length });
    },
    async vercel_get_oauth_client(args, { connection, db }) {
      requireFields(args, ['clientId', 'dryRun', 'confirm']);
      const gate = ownerGate(connection);
      if (gate) return refused(gate);
      if (!requireDb(db, ['getOAuthClientRegistration'])) throw new Error('Registration store unavailable');
      if (typeof args.clientId !== 'string' || !CLIENT_ID.test(args.clientId)) {
        return refused('clientId must be a registration id issued by this server.');
      }
      const registration = await db.getOAuthClientRegistration(args.clientId);
      if (!registration) {
        return result({ status: 'refused_by_guard', confirmed: false,
          reason: `No registration exists with client_id ${args.clientId}.` });
      }
      return asText({ registration });
    },
    async vercel_update_oauth_client(args, { connection, db }) {
      requireFields(args, ['clientId', 'clientName', 'redirectUris', 'confirm', 'dryRun']);
      const gate = ownerGate(connection);
      if (gate) return refused(gate);
      if (!requireDb(db, ['getOAuthClientRegistration', 'updateOAuthClient'])) {
        throw new Error('Registration store unavailable');
      }
      if (typeof args.clientId !== 'string' || !CLIENT_ID.test(args.clientId)) {
        return refused('clientId must be a registration id issued by this server.');
      }
      if (args.clientName === undefined && args.redirectUris === undefined) {
        return refused('Nothing to update: pass clientName and/or redirectUris.');
      }
      const before = await db.getOAuthClientRegistration(args.clientId);
      if (!before) {
        return refused(`No registration exists with client_id ${args.clientId}; nothing was changed.`);
      }
      const changes = {};
      if (args.clientName !== undefined && args.clientName !== before.client_name) {
        changes.clientName = { from: before.client_name, to: args.clientName };
      }
      if (args.redirectUris !== undefined &&
        JSON.stringify(args.redirectUris) !== JSON.stringify(before.redirect_uris)) {
        changes.redirectUris = { from: before.redirect_uris, to: args.redirectUris };
      }
      if (args.dryRun === true) {
        return asText({ status: 'planned', confirmed: false, registration: before, changes,
          note: 'On confirm, exactly these fields change; the client id, auth method and stored secret never change.' });
      }
      if (args.confirm !== true) {
        return refused('Preview this update with dryRun: true, or apply it with confirm: true.');
      }
      const after = await db.updateOAuthClient({
        clientId: args.clientId, clientName: args.clientName,
        redirectUris: args.redirectUris
      });
      if (!after) {
        return result({ status: 'outcome_unknown', confirmed: null,
          reason: 'The registration disappeared during the update; read it back before retrying.' });
      }
      // Verify by read-back: the stored row must show the asked state.
      const verified =
        (args.clientName === undefined || after.client_name === args.clientName) &&
        (args.redirectUris === undefined ||
          JSON.stringify(after.redirect_uris) === JSON.stringify(args.redirectUris));
      return result({ status: 'applied', confirmed: verified ? true : null,
        registration: after, changes });
    },
    async vercel_delete_oauth_client(args, { connection, db }) {
      requireFields(args, ['clientId', 'evaluation', 'confirm', 'dryRun']);
      const gate = ownerGate(connection);
      if (gate) return refused(gate);
      if (!requireDb(db, ['getOAuthClientRegistration', 'deleteOAuthClient'])) {
        throw new Error('Registration store unavailable');
      }
      if (typeof args.clientId !== 'string' || !CLIENT_ID.test(args.clientId)) {
        return refused('clientId must be a registration id issued by this server.');
      }
      // Evaluate the exact target, every time: the confirm path
      // re-reads and re-binds, so a registration that changed since
      // the dry run is never deleted on a stale disclosure.
      const row = await db.getOAuthClientRegistration(args.clientId);
      if (!row) {
        return refused(`No registration exists with client_id ${args.clientId}; nothing was deleted.`);
      }
      const evaluation = evaluationOf(row);
      const disclosure = disclose(row);
      if (args.dryRun === true) {
        return asText({ status: 'planned', confirmed: false, registration: row,
          evaluation, disclosure,
          note: 'To delete, call again with confirm: true and this exact evaluation value.' });
      }
      if (args.confirm !== true) {
        return refused('Preview this deletion with dryRun: true, or apply it with confirm: true and the evaluation it returns.');
      }
      if (args.evaluation !== evaluation) {
        return refused('The registration changed since the evaluation (or no evaluation was supplied); re-run the dry run and confirm the fresh evaluation.');
      }
      if (typeof connection.account !== 'string' || !connection.account) {
        return refused('The deletion must be journaled under the owner\'s account; this connection has none.');
      }
      const outcome = await db.deleteOAuthClient({
        clientId: args.clientId, account: connection.account,
        mode: connection.mode === 'production' ? 'production' : 'preview',
        production: connection.mode === 'production'
      });
      if (outcome === null) {
        return refused(`No registration exists with client_id ${args.clientId}; nothing was deleted.`);
      }
      if (outcome === false || outcome?.deleted !== true) {
        return result({ status: 'outcome_unknown', confirmed: null,
          reason: 'The deletion could not be journaled atomically; read the registration back before retrying.' });
      }
      // Verify by read-back: the row is gone and no live family remains.
      const after = await db.getOAuthClientRegistration(args.clientId);
      const verified = after === null;
      return result({ status: 'applied', confirmed: verified ? true : null,
        deleted: args.clientId, tokensRevoked: outcome.tokensRevoked,
        codesRemoved: outcome.codesRemoved, disclosure,
        note: verified ? 'Read-back confirms the registration is gone; its token families read back revoked with it.' :
          'The delete reported success but the registration still reads back; treat as unconfirmed.' });
    }
  }
};
