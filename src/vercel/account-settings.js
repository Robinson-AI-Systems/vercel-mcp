// AUD-AT: approval envelopes for the account settings that existed
// only as setup-page forms (sign-in cleanup dossier §2.5; the
// dossier's AUD-AS family, renumbered). An OAuth profile merely
// proposes; the owner applies on their own connection
// (vercel_apply_owner_approval) or, until AUD-AV deletes the route,
// the setup page's forms keep working directly. No Vercel or account
// mutation happens in this module — it issues, inspects and consumes
// envelopes, and applies an already owner-approved envelope through
// the same db setters the page calls.
//
// The four actions carried the page's fresh-passphrase proof tier;
// the envelope preserves that tier (dossier §2.4/§2.5): an agent's
// proposal is never the owner's act until the owner applies it. For
// token_no_expiry that is the AUD-E property itself — the envelope
// is bound to the token version current when it was proposed, so a
// rotation between proposal and application refuses, never attests
// the replacement token.
import { oneTimeSecrets } from '../core/one-time-secrets.js';
import { decryptSecret } from '../core/secret-box.js';

const KIND = 'owner_account_setting';
const ACTIONS = new Set(['purchase_policy', 'token_no_expiry',
  'production_strictness', 'clear_protected']);
const IDS = /^[a-zA-Z0-9_/-]{3,256}$/;
const REF = /^[0-9a-f-]{36}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed = new Set(['action', 'budgetCents', 'grantRequired',
  'noExpiry', 'tokenVersion', 'strictness', 'confirm', 'dryRun']);
const STALE_VERSION = 'Token expiry attestation change could not be verified. ' +
  'If the token was rotated since this page loaded, reload and attest for the current token.';
function denied(reason) {
  return { status: 'refused_by_guard', confirmed: false, reason };
}
function dollars(cents) {
  return '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
}
// One plain-words statement per action, used for the proposal
// preview, the apply tool's inspect summary and the journal — the
// setup page's own outcome wording, so all three surfaces agree.
export function accountSettingSummary(request) {
  const account = request.issuerAccount;
  if (request.action === 'purchase_policy') {
    return 'Set ' + account + ' purchase policy: ' +
      (request.budgetCents === null ? 'no agent budget set' :
        'agent budget ' + dollars(request.budgetCents)) +
      (request.grantRequired ? '; per-purchase grant required.' :
        '; per-purchase grant not required.') +
      ' No spending, purchase or production access is authorized.';
  }
  if (request.action === 'token_no_expiry') {
    return request.noExpiry ?
      'Attest that the enrolled token for ' + account +
        ' has no expiry — owner\'s choice, bound to the token enrolled now' :
      'Clear the no-expiry attestation for ' + account +
        ': the enrolled token expiry is not recorded';
  }
  if (request.action === 'production_strictness') {
    return 'Set production enable strictness to ' + request.strictness +
      ' for ' + account + '. No production access is enabled by this change.';
  }
  return 'Remove old global defaults and all account project exclusions for ' +
    account + '; separate safety approvals still apply. All projects are ' +
    'eligible within credential scope, but production, spending, ' +
    'destructive and self-credential safeguards remain.';
}
const validBudget = value => value === null ||
  (Number.isInteger(value) && value >= 0 && value <= 2147483647);

export async function requestAccountSetting({
  db, env = process.env, connection, args, now = () => Date.now()
}) {
  if (!connection || connection.profile !== 'full' || !IDS.test(connection.account || '') ||
      !['preview', 'production'].includes(connection.mode) || env.VERCEL_ENV !== 'production') {
    return denied('Full-profile connection to the production server is required to propose an account setting');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !allowed.has(k)) || !ACTIONS.has(args.action)) {
    return denied('Invalid account-setting request');
  }
  const { action } = args;
  if (args.confirm !== undefined && typeof args.confirm !== 'boolean' ||
      args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
    return denied('Invalid confirmation or preview flag');
  }
  const configured = await db.listVercelAccounts();
  const row = configured.find(r => r.id === connection.account);
  if (!row) {
    return denied('Current account is not configured');
  }
  // Each action carries exactly its own fields, validated with the
  // setup form's own rules (src/vercel/setup.js): the purchase
  // budget is blank-for-none or an exact amount inside the db's
  // integer-cents range; the attestation binds a UUID token version;
  // strictness is one of the two words; clearing carries nothing but
  // the remove-all acknowledgment, which lives in the plan text.
  // The bound token version travels as `boundVersion`, never
  // `tokenVersion`: the write path's audit screen refuses any
  // credential-shaped key in a journaled before-image, and the
  // envelope's own format field already owns the name `version`.
  const payload = { version: 1, issuerAccount: connection.account, action,
    budgetCents: null, grantRequired: null, noExpiry: null,
    boundVersion: null, strictness: null };
  if (action === 'purchase_policy') {
    if (args.noExpiry !== undefined || args.tokenVersion !== undefined ||
        args.strictness !== undefined ||
        !validBudget(args.budgetCents ?? null) ||
        (args.grantRequired !== undefined && typeof args.grantRequired !== 'boolean')) {
      return denied('A purchase policy is an exact budget in cents (or none) and a grant flag');
    }
    payload.budgetCents = args.budgetCents ?? null;
    payload.grantRequired = args.grantRequired === true;
  } else if (action === 'token_no_expiry') {
    if (args.budgetCents !== undefined || args.grantRequired !== undefined ||
        args.strictness !== undefined || typeof args.noExpiry !== 'boolean' ||
        (args.tokenVersion !== undefined &&
          (typeof args.tokenVersion !== 'string' || !UUID.test(args.tokenVersion)))) {
      return denied('Select an account, confirm the attestation change, and use the form as loaded for the current token');
    }
    // The version is bound at proposal: a caller-supplied version
    // must be the enrolled token's current one (the page's stale
    // form refusal); an omitted one binds the current version here,
    // since no tool surface displays it. Either way the envelope
    // names exactly one token, and the db setter re-checks it under
    // its own lock at apply time.
    const current = typeof row.token_version === 'string' ? row.token_version : null;
    if (!current) return denied('Token expiry attestation is unavailable for this account');
    if (args.tokenVersion !== undefined && args.tokenVersion !== current) {
      return denied(STALE_VERSION);
    }
    payload.noExpiry = args.noExpiry;
    payload.boundVersion = current;
  } else if (action === 'production_strictness') {
    if (args.budgetCents !== undefined || args.grantRequired !== undefined ||
        args.noExpiry !== undefined || args.tokenVersion !== undefined ||
        !['word', 'passphrase'].includes(args.strictness)) {
      return denied('Select an account, a strictness and confirm the change');
    }
    payload.strictness = args.strictness;
  } else {
    if (args.budgetCents !== undefined || args.grantRequired !== undefined ||
      args.noExpiry !== undefined || args.tokenVersion !== undefined ||
      args.strictness !== undefined) {
      return denied('Invalid account-setting request');
    }
  }
  const account = connection.account;
  const summary = accountSettingSummary(payload);
  if (args.dryRun === true) return { status: 'preview', dryRun: true, preview: summary,
    ownerApprovalRequired: true };
  if (args.confirm !== true) return { status: 'needs_confirmation', confirmed: false,
    preview: summary, ownerApprovalRequired: true };
  const receipt = await oneTimeSecrets({ db, env, now }).issue({
    account, kind: KIND, label: 'Owner account setting approval',
    value: JSON.stringify(payload), ttlMs: 600000
  });
  await db.recordChange({ account, mode: connection.mode,
    tool: 'vercel_owner_account_setting_request',
    summary: 'Owner approval requested for ' + action + ' (not applied)',
    dryRun: true, production: false, requestKey: receipt.id });
  return { status: 'awaiting_owner_approval', confirmed: false,
    reference: receipt.id, expiresAt: receipt.expiresAt,
    preview: summary, ownerApprovalRequired: true };
}

function validateAccountSettingEnvelope(payload, account) {
  if (!payload || payload.version !== 1 || payload.issuerAccount !== account ||
    !ACTIONS.has(payload.action)) return null;
  if (payload.action === 'purchase_policy') {
    return validBudget(payload.budgetCents) &&
      typeof payload.grantRequired === 'boolean' &&
      payload.noExpiry === null && payload.boundVersion === null &&
      payload.strictness === null ? payload : null;
  }
  if (payload.action === 'token_no_expiry') {
    return typeof payload.noExpiry === 'boolean' &&
      typeof payload.boundVersion === 'string' && UUID.test(payload.boundVersion) &&
      payload.budgetCents === null && payload.grantRequired === null &&
      payload.strictness === null ? payload : null;
  }
  if (payload.action === 'production_strictness') {
    return ['word', 'passphrase'].includes(payload.strictness) &&
      payload.budgetCents === null && payload.grantRequired === null &&
      payload.noExpiry === null && payload.boundVersion === null ? payload : null;
  }
  return payload.budgetCents === null && payload.grantRequired === null &&
    payload.noExpiry === null && payload.boundVersion === null &&
    payload.strictness === null ? payload : null;
}
function decode(value, account) {
  try { return validateAccountSettingEnvelope(JSON.parse(value), account); } catch { return null; }
}
/** Read-only preview; the owner's apply path (and owner setup) call this. */
export async function inspectAccountSetting({ db, env = process.env, account, reference }) {
  if (!IDS.test(account || '') || typeof reference !== 'string' || !REF.test(reference) ||
    typeof db.getAccountSettingRequest !== 'function') return null;
  const row = await db.getAccountSettingRequest({ account, reference });
  if (!row || row.kind !== KIND || row.vercel_account !== account) return null;
  let value;
  try {
    value = decryptSecret(row.ciphertext, 'once:' + account + ':' + KIND + ':' + reference, env);
  } catch { return null; }
  return decode(value, account);
}
/** Single-use consumption is distinct from inspection and never applies a mutation. */
export async function consumeAccountSetting({ db, env = process.env, account, reference, now = () => Date.now() }) {
  if (!IDS.test(account || '') || typeof reference !== 'string' || !REF.test(reference)) return null;
  const receipt = await oneTimeSecrets({ db, env, now }).reveal({ id: reference, account });
  if (receipt?.kind !== KIND) return null;
  return decode(receipt.value, account);
}

/**
 * Database-only application of an already owner-approved request.
 * This function is NOT an MCP handler or an owner authenticator. Its
 * caller completes the owner proof first: vercel_apply_owner_approval
 * (the owner's own connector-kind connection, confirm) — after
 * one-use reference consumption and an inspect/compare of the exact
 * envelope. Every DB method performs its own atomic audit and
 * independent read-back; never claim success on an ambiguous result.
 * For token_no_expiry the db setter's version predicate is the
 * apply-time truth: a token rotated since the proposal makes it
 * return false, which surfaces here as unverified, never applied.
 */
export async function applyApprovedAccountSetting({ db, request }) {
  if (!request || !validateAccountSettingEnvelope(request, request.issuerAccount)) {
    return { status: 'refused', confirmed: false };
  }
  if (!db || typeof db.listVercelAccounts !== 'function') {
    return { status: 'refused', confirmed: false };
  }
  const accounts = await db.listVercelAccounts();
  if (!accounts.some(row => row.id === request.issuerAccount)) {
    return { status: 'refused', confirmed: false };
  }
  let ok = false;
  if (request.action === 'purchase_policy') {
    if (typeof db.setPurchasePolicy !== 'function') {
      return { status: 'refused', confirmed: false };
    }
    ok = await db.setPurchasePolicy(request.issuerAccount,
      { budgetCents: request.budgetCents, grantRequired: request.grantRequired });
  } else if (request.action === 'token_no_expiry') {
    if (typeof db.setTokenNoExpiry !== 'function') {
      return { status: 'refused', confirmed: false };
    }
    ok = await db.setTokenNoExpiry(request.issuerAccount,
      request.noExpiry, request.boundVersion);
  } else if (request.action === 'production_strictness') {
    if (typeof db.setProductionEnableStrictness !== 'function') {
      return { status: 'refused', confirmed: false };
    }
    ok = await db.setProductionEnableStrictness(request.issuerAccount, request.strictness);
  } else {
    if (typeof db.clearProtectedProjectRules !== 'function') {
      return { status: 'refused', confirmed: false };
    }
    ok = await db.clearProtectedProjectRules(request.issuerAccount);
  }
  return { status: ok === true ? 'applied' : 'unverified', confirmed: ok === true,
    action: request.action };
}
