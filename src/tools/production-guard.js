// Production enable (AUD-B, design D-B, ruling IN-09): on the owner's word
// by default. A team whose owner chose 'passphrase' strictness on the setup
// page keeps the two-step flow (tool request + owner passphrase reentry);
// 'word' teams complete in the tool call itself on confirm. The passphrase
// machinery is unchanged — it is the 'passphrase' mode, not a gate on all
// teams. Disable is unchanged: confirm completes it and revokes tokens.
import { oneTimeSecrets } from '../core/one-time-secrets.js';

const MODE = 'production';
const MAX_MS = 600000;
function denied(message) { return { status: 'refused_by_guard', confirmed: false, reason: message }; }
function authorized(connection) {
  return connection?.account && connection.profile === 'full' && connection.mode === 'preview';
}
export function productionStrictness(account) {
  return account?.production_enable_strictness === 'passphrase' ? 'passphrase' : 'word';
}
// The one enable effect, shared by the word path and the passphrase
// approval path (packet AUD-B stop point: the state write and its audit
// row must never fork). Sets production_enabled, then records the change.
async function performProductionEnable({ db, account, summary, requestKey }) {
  const enabled = await db.setProductionEnabled(account, true);
  if (!enabled) return false;
  await db.recordChange({ account, mode: 'preview',
    tool: 'vercel_enable_production', summary,
    dryRun: false, production: true, ...(requestKey ? { requestKey } : {}) });
  return true;
}
export function checkProductionWrite({ connection, production, confirm }) {
  if (!production || typeof production.production !== 'boolean') {
    return denied('Production impact is unknown');
  }
  if (!production.production) return { status: 'allowed', mode: 'PREVIEW' };
  if (connection?.mode !== MODE) return denied('Reconnect in production mode to change live resources');
  if (!confirm) return { status: 'needs_confirmation', mode: 'PRODUCTION' };
  return { status: 'allowed', mode: 'PRODUCTION' };
}
export async function requestProductionEnable({
  db, env = process.env, connection, confirm = false, dryRun = false,
  now = () => Date.now()
}) {
  if (!authorized(connection)) return denied('Only a full-profile preview connection may request access');
  if (env.VERCEL_ENV !== 'production') return denied('Preview deployments cannot enable production');
  const accounts = await db.listVercelAccounts();
  const account = accounts.find(item => item.id === connection.account);
  if (!account) return denied('The selected team is not connected');
  const strictness = productionStrictness(account);
  if (account.production_enabled) return { status: 'already_enabled', account: account.id, strictness };
  if (dryRun) return { status: 'preview', dryRun: true, account: account.id, strictness,
    message: strictness === 'passphrase' ?
      'Requires confirmation here AND owner approval with vercel_apply_owner_approval within 10 minutes' :
      'Requires confirmation here; this team is set to word strictness, so confirmation enables production immediately on your word' };
  if (confirm !== true) return { status: 'needs_confirmation', account: account.id, strictness,
    message: strictness === 'passphrase' ?
      'After confirmation, approve the request with vercel_apply_owner_approval to enable this team' :
      'Confirm here to enable production for this team on your word (this team is set to word strictness)' };
  if (strictness === 'word') {
    const enabled = await performProductionEnable({ db, account: account.id,
      summary: 'Owner word confirmed; team production access enabled' });
    if (!enabled) return denied('The account no longer exists');
    const after = (await db.listVercelAccounts()).find(item => item.id === account.id);
    if (!after?.production_enabled) return denied('Production enable could not be verified');
    return { status: 'enabled', account: account.id, productionEnabled: true, strictness: 'word' };
  }
  const receipt = await oneTimeSecrets({ db, env, now }).issue({
    account: account.id, kind: 'production_enable', label: 'Owner production approval',
    value: JSON.stringify({ account: account.id }), ttlMs: MAX_MS
  });
  await db.recordChange({ account: account.id, mode: 'preview',
    tool: 'vercel_enable_production', summary: 'Owner production approval requested (not enabled)',
    dryRun: true, production: false, requestKey: receipt.id });
  return { status: 'awaiting_owner_passphrase', account: account.id, reference: receipt.id,
    expiresAt: receipt.expiresAt, productionEnabled: false, strictness: 'passphrase' };
}
export async function approveProductionEnable({
  db, env = process.env, account, reference, now = () => Date.now()
}) {
  if (env.VERCEL_ENV !== 'production') return denied('Preview deployments cannot enable production');
  if (typeof account !== 'string' || typeof reference !== 'string') return denied('Missing approval details');
  const vault = oneTimeSecrets({ db, env, now });
  const receipt = await vault.reveal({ id: reference, account });
  if (!receipt || receipt.kind !== 'production_enable') return denied('Approval is expired, already used or invalid');
  let parsed;
  try { parsed = JSON.parse(receipt.value); } catch { return denied('Approval is invalid'); }
  if (parsed.account !== account) return denied('Approval account mismatch');
  const enabled = await performProductionEnable({ db, account,
    summary: 'Owner passphrase verified; team production access enabled', requestKey: reference });
  if (!enabled) return denied('The account no longer exists');
  return { status: 'enabled', account, productionEnabled: true, strictness: 'passphrase' };
}
export async function disableProduction({ db, connection, confirm = false, dryRun = false }) {
  if (!connection?.account || connection.profile !== 'full') return denied('Full-profile connection required');
  const accounts = await db.listVercelAccounts();
  if (!accounts.some(row => row.id === connection.account)) return denied('Account not found');
  if (dryRun) return { status: 'preview', dryRun: true, account: connection.account };
  if (confirm !== true) return { status: 'needs_confirmation', account: connection.account };
  const updated = await db.setProductionEnabled(connection.account, false);
  if (!updated) return denied('Account was not updated');
  await db.revokeProductionTokens(connection.account);
  await db.recordChange({ account: connection.account, mode: connection.mode,
    tool: 'vercel_disable_production', summary: 'Production access disabled by confirmed owner operation',
    dryRun: false, production: true });
  return { status: 'disabled', account: connection.account, productionEnabled: false };
}
