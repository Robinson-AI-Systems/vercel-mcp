// AUD-AT: account tools for the owner actions that existed only as
// setup-page forms (sign-in cleanup dossier §2.5; the dossier's
// AUD-AS family, renumbered). Four settings that carried the page's
// fresh-passphrase proof tier become owner-approval proposals
// (proposal here, application by the owner's own connection through
// vercel_apply_owner_approval — the AUD-AS proof shape); the four
// actions whose page tier was passphrase-plus-confirm run directly
// from the owner's own connector connection here, hard-gated to it
// like vercel_apply_owner_approval: a delegated pass can never
// perform them. Each tool carries its form's validations verbatim
// (src/vercel/setup.js); handleSetup itself is untouched — AUD-AV
// deletes the route later and the forms stay until then.
import { defineWrite, RefusalError } from '../core/write.js';
import { buildOwnerExport } from '../vercel/owner-export.js';
import { recheckStoredToken } from '../vercel/tokens.js';
import {
  requestAccountSetting, inspectAccountSetting, accountSettingSummary
} from '../vercel/account-settings.js';
import { ownerWriteContext } from './owner-proposals.js';

const ACCOUNT = /^[a-zA-Z0-9_/-]{3,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The db setter's operative project-name bound (the form's pattern
// is the looser [a-z0-9-]+; the form trims before the same setter).
const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{1,100}$/;
// AUD-AR's enrollment-time store ID bound, carried from the setup
// form unchanged.
const STORE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const result = payload => ({
  isError: ['refused_by_guard', 'outcome_unknown'].includes(payload.status),
  content: [{ type: 'text', text: JSON.stringify(payload) }]
});
const refused = reason => result({ status: 'refused_by_guard', confirmed: false, reason });
function requireFields(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !allowed.includes(k))) {
    throw new RefusalError('Invalid tool arguments');
  }
}
function ownerGate(connection, tail) {
  return connection?.kind === 'connector' ? null :
    'This owner action runs only from the account owner\'s own connector connection; ' + tail;
}
async function configuredAccount(db, connection) {
  const accounts = await db.listVercelAccounts();
  return accounts.some(row => row.id === connection.account);
}

// --- The four envelope proposals ------------------------------------
// One factory over src/vercel/account-settings.js, mirroring
// ownerProposal (src/tools/owner-proposals.js): defineWrite with
// approvalOnly, so confirm issues the encrypted envelope and nothing
// changes until the owner applies it.
const PROPOSAL_FIELDS = {
  purchase_policy: ['budgetCents', 'grantRequired', 'confirm', 'dryRun'],
  token_no_expiry: ['noExpiry', 'tokenVersion', 'confirm', 'dryRun'],
  production_strictness: ['strictness', 'confirm', 'dryRun'],
  clear_protected: ['confirm', 'dryRun']
};
function settingProposal(name, action) {
  return defineWrite({
      name, approvalOnly: true,
      async before(args, { connection, db, env }) {
        requireFields(args, PROPOSAL_FIELDS[action]);
        if (env?.VERCEL_ENV !== 'production' || connection?.profile !== 'full' ||
          !ACCOUNT.test(connection?.account || '')) {
          throw new RefusalError('Owner request unavailable');
        }
        const accounts = await db.listVercelAccounts();
        const row = accounts.find(r => r.id === connection.account);
        if (!row) throw new RefusalError('Unconfigured account');
        if (action === 'purchase_policy') {
          const budgetCents = args.budgetCents === undefined ? null : args.budgetCents;
          if (!(budgetCents === null ||
            (Number.isInteger(budgetCents) && budgetCents >= 0 && budgetCents <= 2147483647)) ||
            (args.grantRequired !== undefined && typeof args.grantRequired !== 'boolean')) {
            throw new RefusalError('A purchase policy is an exact budget in cents (or none) and a grant flag');
          }
          return { account: connection.account, action, budgetCents,
            grantRequired: args.grantRequired === true,
            noExpiry: null, boundVersion: null, strictness: null };
        }
        if (action === 'token_no_expiry') {
          if (typeof args.noExpiry !== 'boolean' ||
            (args.tokenVersion !== undefined &&
              (typeof args.tokenVersion !== 'string' || !UUID.test(args.tokenVersion)))) {
            throw new RefusalError('Select an account, confirm the attestation change, and use the form as loaded for the current token');
          }
          const current = typeof row.token_version === 'string' ? row.token_version : null;
          if (!current) throw new RefusalError('Token expiry attestation is unavailable for this account');
          if (args.tokenVersion !== undefined && args.tokenVersion !== current) {
            throw new RefusalError('Token expiry attestation change could not be verified. ' +
              'If the token was rotated since this page loaded, reload and attest for the current token.');
          }
          return { account: connection.account, action, noExpiry: args.noExpiry,
            boundVersion: current, budgetCents: null, grantRequired: null, strictness: null };
        }
        if (action === 'production_strictness') {
          if (!['word', 'passphrase'].includes(args.strictness)) {
            throw new RefusalError('Select an account, a strictness and confirm the change');
          }
          return { account: connection.account, action, strictness: args.strictness,
            budgetCents: null, grantRequired: null, noExpiry: null, boundVersion: null };
        }
        return { account: connection.account, action, budgetCents: null,
          grantRequired: null, noExpiry: null, boundVersion: null, strictness: null };
      },
      async preview(_args, _ctx, before) {
        return accountSettingSummary({ ...before, issuerAccount: before.account });
      },
      async production() {
        return { production: true, why: 'Owner-account administration is live' };
      },
      async targets(_args, before) {
        return [{ kind: 'account', id: before.account }];
      },
      async apply(args, { db, env, connection }, before) {
        const payload = { action: before.action, confirm: args.confirm === true,
          ...(before.action === 'purchase_policy' ?
            { budgetCents: before.budgetCents, grantRequired: before.grantRequired } : {}),
          ...(before.action === 'token_no_expiry' ?
            { noExpiry: before.noExpiry, tokenVersion: before.boundVersion } : {}),
          ...(before.action === 'production_strictness' ?
            { strictness: before.strictness } : {}) };
        return requestAccountSetting({ db, env, connection, args: payload });
      },
      async verify(_args, { db, env }, before, issued) {
        if (issued?.status !== 'awaiting_owner_approval' || typeof issued.reference !== 'string') {
          return { confirmed: null };
        }
        const found = await inspectAccountSetting({ db, env,
          account: before.account, reference: issued.reference });
        const confirmed = Boolean(found) && found.issuerAccount === before.account &&
          found.action === before.action &&
          (before.action === 'purchase_policy' ?
            found.budgetCents === before.budgetCents && found.grantRequired === before.grantRequired :
            before.action === 'token_no_expiry' ?
              found.noExpiry === before.noExpiry && found.boundVersion === before.boundVersion :
              before.action === 'production_strictness' ?
                found.strictness === before.strictness : true);
        return { confirmed: confirmed === true };
      }
  });
}
const purchasePolicyRequest = settingProposal('vercel_set_purchase_policy', 'purchase_policy');
const tokenNoExpiryRequest = settingProposal('vercel_set_token_no_expiry', 'token_no_expiry');
const productionStrictnessRequest = settingProposal('vercel_set_production_strictness', 'production_strictness');
const clearProtectedRequest = settingProposal('vercel_clear_protected_resources', 'clear_protected');
const text = payload => ({
  isError: ['refused_by_guard', 'outcome_unknown'].includes(payload.status),
  content: [{ type: 'text', text: JSON.stringify(payload) }]
});

// --- The four direct owner actions ----------------------------------
async function exportOwnerData(args, { connection, db, env = process.env }) {
  const gate = ownerGate(connection, 'a delegated pass can never export owner data');
  if (gate) return refused(gate);
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !['confirm', 'dryRun'].includes(k)) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    return refused('Invalid owner export arguments');
  }
  if (connection.profile !== 'full' || !ACCOUNT.test(connection.account || '')) {
    return refused('A full-profile owner connection is required to export owner data');
  }
  // The page's own posture, kept: the export exists only on the
  // production server and only for a configured account.
  if (env.VERCEL_ENV !== 'production') {
    return refused('Owner data export is available only on the production server');
  }
  if (typeof connection.resultOwner !== 'string' || typeof db?.putResult !== 'function') {
    return refused('Stored-result delivery is unavailable on this connection');
  }
  if (!await configuredAccount(db, connection)) {
    return refused('Current account is not configured');
  }
  const plan = 'Export everything this server holds for ' + connection.account +
    ': account metadata (never token values), connections, passes, protected resources, ' +
    'settings, project profiles, Blob store connections and the change log ' +
    '(most recent 500 entries). The export is recorded in the change log before it ' +
    'is stored for retrieval with vercel_get_result.';
  if (args.dryRun === true) {
    return result({ status: 'preview', dryRun: true, confirmed: false, preview: plan });
  }
  if (args.confirm !== true) {
    return result({ status: 'needs_confirmation', confirmed: false, preview: plan });
  }
  let data;
  try {
    data = await buildOwnerExport({ db, account: connection.account });
    // O-5b invariant (the page's rule, verbatim): the journal row
    // lands BEFORE the export is stored — an unjournaled export
    // never leaves. A journal failure stores nothing.
    await db.recordChange({ account: connection.account,
      tool: 'vercel_owner_export_data', mode: 'production', dryRun: false, production: false,
      summary: 'Owner exported account data (metadata, connections, passes, settings, change log) — no token values' });
  } catch {
    return refused('The export could not be completed. Nothing was stored.');
  }
  const issued = await db.putResult({ account: connection.account,
    owner: connection.resultOwner,
    summary: 'Owner data export for ' + connection.account, body: data });
  return result({ status: 'stored', confirmed: true, handle: issued.handle,
    expiresAt: issued.expiresAt, readBackWith: 'vercel_get_result',
    summary: 'Owner data export stored for retrieval; it was recorded in the change log before it was stored.' });
}

async function addProtectedResource(args, { connection, db }) {
  const gate = ownerGate(connection, 'a delegated pass can never add a project protection');
  if (gate) return refused(gate);
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !['projectName', 'confirm', 'dryRun'].includes(k)) ||
    typeof args.projectName !== 'string' || !PROJECT_NAME.test(args.projectName.trim()) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    return refused('Use a lowercase project name with letters, numbers and hyphens');
  }
  if (connection.profile !== 'full' || !ACCOUNT.test(connection.account || '')) {
    return refused('A full-profile owner connection is required to protect a project');
  }
  if (!await configuredAccount(db, connection)) {
    return refused('Current account is not configured');
  }
  const projectName = args.projectName.trim();
  const plan = 'Protect project ' + projectName + ' on ' + connection.account +
    ': writes targeting it refuse until the owner clears the exclusion.';
  if (args.dryRun === true) {
    return result({ status: 'preview', dryRun: true, confirmed: false, preview: plan });
  }
  if (args.confirm !== true) {
    return result({ status: 'needs_confirmation', confirmed: false, preview: plan });
  }
  // The page's call and journal, verbatim except the note, which
  // names this surface truthfully (the db records source
  // 'setup_page' for both paths; AUD-AV's card owns that label).
  await db.addProtectedResource({ account: connection.account, kind: 'project',
    match: projectName, note: 'Owner protected via owner connection' });
  await db.recordChange({ account: connection.account, mode: 'preview',
    tool: 'vercel_add_protected_resource',
    summary: 'Owner added project protection: ' + projectName,
    dryRun: false, production: false });
  return result({ status: 'applied', confirmed: true, projectName,
    summary: 'Project ' + projectName + ' is protected on ' + connection.account +
      '; writes targeting it now refuse.' });
}

async function disconnectBlobStore(args, { connection, db }) {
  const gate = ownerGate(connection, 'a delegated pass can never disconnect a Blob store');
  if (gate) return refused(gate);
  const storeId = typeof args?.storeId === 'string' ? args.storeId.trim() : '';
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !['storeId', 'confirm', 'dryRun'].includes(k)) ||
    !STORE_ID.test(storeId) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    return refused('Give the store ID of a connected Blob store');
  }
  if (connection.profile !== 'full' || !ACCOUNT.test(connection.account || '')) {
    return refused('A full-profile owner connection is required to disconnect a Blob store');
  }
  if (!await configuredAccount(db, connection)) {
    return refused('Current account is not configured');
  }
  const plan = 'Disconnect Blob store ' + storeId + ' from ' + connection.account +
    '; its stored token is deleted. Files in the store are not touched.';
  if (args.dryRun === true) {
    return result({ status: 'preview', dryRun: true, confirmed: false, preview: plan });
  }
  if (args.confirm !== true) {
    return result({ status: 'needs_confirmation', confirmed: false, preview: plan });
  }
  // The page journals nothing for this action; parity is kept.
  const removed = typeof db.deleteBlobStoreConnection === 'function' &&
    await db.deleteBlobStoreConnection({ account: connection.account, storeId });
  if (!removed) {
    return result({ status: 'not_found', confirmed: false, storeId,
      summary: 'That Blob store connection was not found.' });
  }
  return result({ status: 'disconnected', confirmed: true, storeId,
    summary: 'Blob store ' + storeId + ' disconnected; its stored token was deleted. ' +
      'Files in the store were not touched.' });
}

async function recheckToken(args, { connection, db, env = process.env, fetchImpl }) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 0) {
    return { isError: true, content: [{ type: 'text', text: 'This tool takes no arguments' }] };
  }
  if (typeof connection?.account !== 'string') {
    throw new Error('Connection account unavailable');
  }
  const report = await recheckStoredToken({ db, accountId: connection.account, env, fetchImpl });
  return { content: [{ type: 'text', text: JSON.stringify(report) }] };
}

const accountSettingsToolList = [
  { name: 'vercel_export_owner_data', writes: true, localAdmin: true,
    profiles: ['full'],
    description: 'Export everything this server holds for your account — metadata only, ' +
      'never token values — to a stored result; journaled before it is stored.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: { production: true, targets: true } },
  { name: 'vercel_set_purchase_policy', writes: true, localAdmin: true,
    profiles: ['full'],
    description: 'Propose an account purchase policy (optional agent budget in cents, per-purchase ' +
      'grant flag); the owner applies it with vercel_apply_owner_approval.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: {
        budgetCents: { type: ['integer', 'null'], minimum: 0, maximum: 2147483647 },
        grantRequired: { type: 'boolean' },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: purchasePolicyRequest.writeContract },
  { name: 'vercel_set_token_no_expiry', writes: true, localAdmin: true,
    profiles: ['full'],
    description: 'Propose the owner\'s no-expiry attestation for the enrolled Vercel token, bound to ' +
      'the token version it is made for; the owner applies it.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['noExpiry'],
      properties: {
        noExpiry: { type: 'boolean' },
        tokenVersion: { type: 'string',
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: tokenNoExpiryRequest.writeContract },
  { name: 'vercel_set_production_strictness', writes: true, localAdmin: true,
    profiles: ['full'],
    description: 'Propose the production-enable strictness (word or passphrase) for this account; ' +
      'the owner applies it with vercel_apply_owner_approval.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['strictness'],
      properties: {
        strictness: { type: 'string', enum: ['word', 'passphrase'] },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: productionStrictnessRequest.writeContract },
  { name: 'vercel_add_protected_resource', writes: true, localAdmin: true,
    profiles: ['full'],
    description: 'Protect one project on this account so writes targeting it refuse ' +
      'until the owner clears the exclusion. Direct write, confirm required.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['projectName'],
      properties: {
        projectName: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,100}$',
          minLength: 2, maxLength: 101 },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: { production: true, targets: true } },
  { name: 'vercel_clear_protected_resources', writes: true, localAdmin: true,
    profiles: ['full'],
    description: 'Propose removing the old global defaults and all project exclusions for this ' +
      'account; the owner applies it with vercel_apply_owner_approval.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: clearProtectedRequest.writeContract },
  { name: 'vercel_recheck_token', writes: false, profiles: ['full'],
    description: 'Recheck the stored Vercel token\'s read access for this account ' +
      '(owner-surface twin of the setup page action); writes and expiry stay unverified.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true } },
  { name: 'vercel_disconnect_blob_store', writes: true, localAdmin: true,
    profiles: ['full'],
    description: 'Disconnect one Blob store from this account and delete its stored ' +
      'token; files in the store are not touched. Direct write, confirm required.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['storeId'],
      properties: {
        storeId: { type: 'string', minLength: 1, maxLength: 200 },
        confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: { production: true, targets: true } }
];

export const accountSettingsTools = {
  tools: accountSettingsToolList,
  handlers: {
    vercel_export_owner_data: exportOwnerData,
    async vercel_set_purchase_policy(args, { connection, db, env }) {
      return text(await purchasePolicyRequest.run(args, ownerWriteContext({ connection, db, env })));
    },
    async vercel_set_token_no_expiry(args, { connection, db, env }) {
      return text(await tokenNoExpiryRequest.run(args, ownerWriteContext({ connection, db, env })));
    },
    async vercel_set_production_strictness(args, { connection, db, env }) {
      return text(await productionStrictnessRequest.run(args, ownerWriteContext({ connection, db, env })));
    },
    vercel_add_protected_resource: addProtectedResource,
    async vercel_clear_protected_resources(args, { connection, db, env }) {
      return text(await clearProtectedRequest.run(args, ownerWriteContext({ connection, db, env })));
    },
    vercel_recheck_token: recheckToken,
    vercel_disconnect_blob_store: disconnectBlobStore
  }
};
