// AUD-AS: envelope application on the owner's own connection — the
// apply half of the approval-envelope pattern, moved off the setup
// page (sign-in cleanup dossier §2.4; the page keeps working until
// AUD-AV deletes the route, and both paths call these same family
// functions, so the semantics can never fork).
//
// THE PROOF CHANGE (dossier D2, stated plainly): the page applied an
// envelope after the owner re-entered the administrator passphrase.
// Here the proof is possession of the owner's own connector
// credential (the tool refuses any connection whose kind is not
// 'connector' — a delegated RTC pass can never apply an approval),
// the unguessable single-use reference with its ~10-minute TTL, and
// each family's existing change_log journaling, unchanged. The
// passphrase is never a tool argument (gate 2.6).
//
// Inspect never consumes (the page's review semantics). Apply
// re-inspects, consumes single-use, compares the consumed envelope
// with the inspected one, and only then mutates — the page's exact
// order, family by family.
import { oneTimeSecrets } from '../core/one-time-secrets.js';
import { decryptSecret } from '../core/secret-box.js';
import {
  inspectOwnerAccountChange, consumeOwnerAccountChange,
  applyApprovedOwnerAccountChange
} from './owner-approvals.js';
import { inspectPassRequest, consumePassRequest } from './pass-requests.js';
import { approveProductionEnable } from '../tools/production-guard.js';

const REF = /^[0-9a-f-]{36}$/;
const PRODUCTION_KIND = 'production_enable';
// The metered Sandbox approval stores allow_unbounded_metered=true;
// beside that flag the ceiling column is inert (both consumers —
// db.consumePurchaseIntent and the write path's approval read-back —
// ignore it when the flag is set), so the widest value the column
// accepts records "no ceiling" for that one approval shape. A fixed-
// price intent always stores its exact quoted price as the ceiling.
const UNBOUNDED_CEILING_CENTS = 2147483647;

function refused(reason) {
  return { status: 'refused_by_guard', confirmed: false, reason };
}
function dollars(cents) {
  return '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
}

// The page's ownerRequestSummary wording (src/vercel/setup.js),
// carried so the tool states the change in the same plain words.
function ownerChangeSummary(request) {
  if (request.action === 'default') return 'Select ' + request.targetAccount + ' as the new default Vercel account';
  if (request.action === 'spend') return 'Set ' + request.issuerAccount + ' daily spend limit to ' + dollars(request.limitCents);
  if (request.action === 'remove') return 'Remove the enrolled account ' + request.targetAccount +
    ' — its stored credential, connections, passes and account-scoped settings are removed with it';
  return 'Revoke connector ' + request.connectionRef + ' from ' + request.issuerAccount +
    ' (subject to last-active protection)';
}
// The page's pass review wording, in one summary sentence set.
function passSummary(request) {
  if (request.writes === true) {
    return 'Write-capable ' + request.mode + ' pass (' + request.profile + ' profile); ' +
      request.hours + ' hours; areas: ' + request.areas.join(', ') + '; ' +
      request.rateLimitPerMinute + ' calls/minute. Spend ceiling ' +
      (request.spendLimitCents === 0 ? '$0.00 — spending refused' : dollars(request.spendLimitCents)) +
      '; projects: ' + (request.projectIds ? request.projectIds.join(', ') : 'no restriction') +
      '. Production changes still need per-change confirmation.';
  }
  return 'Read-only ' + request.mode + ' pass; ' + request.hours + ' hours; areas: ' +
    request.areas.join(', ') + '; ' + request.rateLimitPerMinute +
    ' calls/minute. No spending or writes. TEST is service identity only.';
}
// The page's purchase review wording.
function purchaseSummary(intent) {
  const cents = intent.price_cents === null ? null : Number(intent.price_cents);
  let summary = 'Operation: ' + intent.operation + '. Pricing evidence: ' + intent.pricing_source + '. ' +
    (cents === null ? 'Metered usage: no fixed provider total available' :
      'Quoted total: ' + dollars(cents)) +
    '. Expires: ' + new Date(intent.expires_at).toISOString() + '.';
  if (cents === null && intent.operation === 'vercel_dev_sandbox_create' &&
    intent.pricing_source === 'metered') {
    summary += ' Variable Sandbox billing: runtime is finite but the provider does not ' +
      'guarantee a total-dollar ceiling. Charges may exceed your planned amount. ' +
      'Applying this approval explicitly accepts non-guaranteed variable charges ' +
      'for this one Sandbox operation.';
  }
  if (intent.status !== 'pending') summary += ' This intent is already ' + intent.status + '.';
  return summary;
}

/** Non-consuming inspection of one production-enable receipt. */
export async function inspectProductionEnableRequest({ db, env = process.env, account, reference }) {
  if (typeof account !== 'string' || !/^[a-zA-Z0-9_/-]{3,256}$/.test(account) ||
    typeof reference !== 'string' || !REF.test(reference) ||
    typeof db.getProductionEnableRequest !== 'function') return null;
  const row = await db.getProductionEnableRequest({ account, reference });
  if (!row || row.kind !== PRODUCTION_KIND || row.vercel_account !== account) return null;
  let parsed;
  try {
    parsed = JSON.parse(decryptSecret(row.ciphertext,
      'once:' + account + ':' + PRODUCTION_KIND + ':' + reference, env));
  } catch { return null; }
  if (!parsed || parsed.account !== account) return null;
  return { account };
}

/**
 * Resolve a reference against the four envelope stores without
 * consuming anything. Returns {family, summary, request|intent} or
 * null when the reference is unknown, expired, already used or
 * belongs to another account.
 */
export async function inspectOwnerApproval({
  db, env = process.env, account, reference, knownAreas, knownWriteAreas, now = () => Date.now()
}) {
  if (typeof account !== 'string' || typeof reference !== 'string' || !REF.test(reference)) return null;
  const change = await inspectOwnerAccountChange({ db, env, account, reference });
  if (change) return { family: 'owner_account_change', request: change, summary: ownerChangeSummary(change) };
  const pass = await inspectPassRequest({ db, env, account, reference, knownAreas, knownWriteAreas, now });
  if (pass) return { family: 'rtc_pass_request', request: pass, summary: passSummary(pass) };
  const production = await inspectProductionEnableRequest({ db, env, account, reference });
  if (production) {
    return { family: 'production_enable', request: production,
      summary: 'Enable production access for ' + account +
        ' (requested from a preview connection; this team is set to passphrase strictness, ' +
        'so the enable waits for this owner approval)' };
  }
  if (typeof db.getPurchaseIntent === 'function') {
    const intent = await db.getPurchaseIntent({ account, reference });
    if (intent) return { family: 'purchase_intent', intent, summary: purchaseSummary(intent) };
  }
  return null;
}

async function applyPassRequest({ db, env, account, reference, inspected, knownAreas, knownWriteAreas, now }) {
  const approved = await consumePassRequest({ db, env, account, reference, knownAreas, knownWriteAreas, now });
  if (!approved || JSON.stringify(approved) !== JSON.stringify(inspected.request)) {
    return refused('Pass request was used, changed, or expired');
  }
  const writeApproved = approved.writes === true;
  const issued = writeApproved
    ? await db.issueWriteRtcPass({ account: approved.account, profile: approved.profile,
      mode: approved.mode, hours: approved.hours, areas: approved.areas,
      spendLimitCents: approved.spendLimitCents, projectIds: approved.projectIds,
      rateLimitPerMinute: approved.rateLimitPerMinute })
    : await db.issueReadOnlyRtcPass({ account: approved.account,
      mode: approved.mode, hours: approved.hours, areas: approved.areas,
      rateLimitPerMinute: approved.rateLimitPerMinute });
  if (!issued) return refused('Pass was not issued; the request is consumed');
  let once;
  try {
    // The page's independent scope read-back, verbatim: no bearer is
    // delivered when the stored scope differs from the approved one.
    const verifiedPass = await db.inspectRtcPass(issued.token);
    if (verifiedPass?.status !== 'ok' || verifiedPass.id !== issued.id ||
      verifiedPass.account !== approved.account ||
      verifiedPass.profile !== (writeApproved ? approved.profile : 'read_only') ||
      verifiedPass.mode !== approved.mode ||
      JSON.stringify(verifiedPass.areas) !== JSON.stringify(approved.areas) ||
      verifiedPass.rateLimitPerMinute !== approved.rateLimitPerMinute ||
      (writeApproved && (verifiedPass.allowWrites !== true ||
        verifiedPass.spendLimitCents !== approved.spendLimitCents ||
        JSON.stringify(verifiedPass.projectIds ?? null) !== JSON.stringify(approved.projectIds)))) {
      throw new TypeError('Pass scope was not independently verified');
    }
    once = await oneTimeSecrets({ db, env, now }).issue({ account: approved.account,
      kind: 'rtc_pass', label: writeApproved ? 'Owner-approved write-capable pass' : 'Owner-approved read-only pass',
      value: issued.token, ttlMs: 600000 });
  } catch {
    await db.revokeRtcPass({ account: approved.account, id: issued.id });
    return refused('Pass verification or one-time delivery failed; the pass was revoked — inspect before retrying');
  }
  return { status: 'applied', confirmed: true, family: 'rtc_pass_request',
    summary: inspected.summary, passId: issued.id, passExpiresAt: issued.expiresAt,
    secretReference: once.id,
    note: 'The pass bearer was stored as a one-time secret; reveal it once with secret reference ' +
      once.id + '. This request cannot be reused.' };
}

async function applyPurchaseIntent({ db, account, reference, inspected, now }) {
  const pending = inspected.intent;
  const quoted = pending?.price_cents === null ? null : Number(pending?.price_cents);
  if (!pending || pending.status !== 'pending' ||
    new Date(pending.expires_at).getTime() <= now() ||
    (quoted !== null && (!Number.isSafeInteger(quoted) || quoted <= 0))) {
    return refused('Purchase intent is missing, expired, or already processed');
  }
  // The page's approval rule, unchanged: a fixed price is approved at
  // exactly its quoted total; the one metered shape is approved only
  // as an explicit unbounded acknowledgment.
  let ceilingCents, acknowledgeUnbounded;
  if (quoted !== null) { ceilingCents = quoted; acknowledgeUnbounded = false; }
  else if (pending.operation === 'vercel_dev_sandbox_create' && pending.pricing_source === 'metered') {
    ceilingCents = UNBOUNDED_CEILING_CENTS; acknowledgeUnbounded = true;
  } else {
    return refused('This purchase intent has no approvable price shape');
  }
  const ok = await db.approvePurchaseIntent({ account, reference, ceilingCents, acknowledgeUnbounded });
  if (ok !== true) return refused('Could not commit the one-use owner approval');
  const verified = await db.getPurchaseIntent({ account, reference });
  if (verified?.status !== 'approved' || Number(verified.ceiling_cents) !== ceilingCents ||
    verified.allow_unbounded_metered !== acknowledgeUnbounded) {
    return { status: 'unverified', confirmed: false, family: 'purchase_intent',
      reason: 'Approval and distinct metered-risk acknowledgment were not proven' };
  }
  return { status: 'applied', confirmed: true, family: 'purchase_intent',
    summary: inspected.summary, operation: pending.operation,
    ceilingCents, acknowledgeUnbounded,
    note: acknowledgeUnbounded
      ? 'Approved with a non-guaranteed planning threshold: variable charges accepted, no enforceable ceiling. No charge was performed by this approval.'
      : 'Approved one transaction at its quoted total of ' + dollars(ceilingCents) + '. No charge was performed by this approval.' };
}

/**
 * Apply the envelope a reference names: re-inspect, consume
 * single-use, compare, then run the family's own apply function with
 * its journaling unchanged. A replayed reference refuses — every
 * family's consume is atomic and single-use.
 */
export async function applyOwnerApproval({
  db, env = process.env, account, reference, knownAreas, knownWriteAreas, now = () => Date.now()
}) {
  const inspected = await inspectOwnerApproval({ db, env, account, reference, knownAreas, knownWriteAreas, now });
  if (!inspected) return refused('Approval reference is expired, already used, belongs to another account, or is invalid');
  if (inspected.family === 'owner_account_change') {
    const approved = await consumeOwnerAccountChange({ db, env, account, reference, now });
    if (!approved || JSON.stringify(approved) !== JSON.stringify(inspected.request)) {
      return refused('Owner request was used, changed, or expired');
    }
    const outcome = await applyApprovedOwnerAccountChange({ db, request: approved });
    if (outcome?.status !== 'applied' || outcome.confirmed !== true) {
      return { status: 'unverified', confirmed: false, family: inspected.family,
        reason: 'The change was not verified. Inspect current account state before making another request.' };
    }
    return { status: 'applied', confirmed: true, family: inspected.family,
      action: approved.action, summary: inspected.summary,
      note: 'The approval reference cannot be reused.' };
  }
  if (inspected.family === 'rtc_pass_request') {
    return applyPassRequest({ db, env, account, reference, inspected, knownAreas, knownWriteAreas, now });
  }
  if (inspected.family === 'production_enable') {
    const result = await approveProductionEnable({ db, env, account, reference, now });
    if (result?.status !== 'enabled') {
      return refused(result?.reason || 'Production approval is invalid or expired');
    }
    return { status: 'applied', confirmed: true, family: inspected.family,
      summary: inspected.summary, account, productionEnabled: true,
      note: 'The approval reference cannot be reused.' };
  }
  return applyPurchaseIntent({ db, account, reference, inspected, now });
}
