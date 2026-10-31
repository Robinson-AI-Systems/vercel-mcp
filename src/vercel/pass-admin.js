// AUD-AU: direct RTC pass administration and one-time-secret
// reveal on the owner's own connector connection (sign-in cleanup
// dossier §2.5). This engine performs exactly what the owner setup
// page's direct forms performed, through the same db methods, so
// issuance and revocation journal identically by construction:
//   - issue: db.issueReadOnlyRtcPass / db.issueWriteRtcPass (their
//     own change_log rows), an independent scope read-back through
//     db.inspectRtcPass — the setup request→approve flow's own
//     verification, ported from src/vercel/owner-apply.js — and the
//     bearer delivered ONLY as a one-time secret (the page's
//     labels, the page's 10-minute TTL). Any failure after issuance
//     revokes the pass before refusing.
//   - revoke: db.revokeRtcPass, the page's single any-row revoke.
//   - reveal (dossier D8): oneTimeSecrets().reveal consumes the row
//     atomically; the value returns in the reveal tool result only,
//     no stored result is created, and the change_log records the
//     reveal EVENT and reference — never the value.
import {oneTimeSecrets} from '../core/one-time-secrets.js';

const cents = value => '$' + (value / 100).toFixed(2);
const iso = value => value instanceof Date ? value.toISOString() : value ?? null;

// The plain-words plan the preview returns, in the vocabulary of
// vercel_create_pass's preview and the setup review page.
export function issuePlanText({account, scope, writes}) {
  if (!writes) return 'Issue a ' + scope.hours + '-hour read-only ' + scope.mode +
    ' pass on ' + account + '; areas: ' + scope.areas.join(', ') +
    '; max ' + scope.rateLimitPerMinute + ' calls/minute; zero spending and no writes' +
    (scope.mode === 'test' ? '; TEST is service identity only' : '') +
    '. The bearer is delivered as a one-time secret and is never shown in a tool result.';
  return 'Issue a ' + scope.hours + '-hour write-capable ' + scope.mode + ' pass (' +
    scope.profile + ' profile) on ' + account + '; areas: ' + scope.areas.join(', ') +
    '; max ' + scope.rateLimitPerMinute + ' calls/minute; spend ceiling ' +
    cents(scope.spendLimitCents) + '; projects: ' +
    (scope.projectIds ? scope.projectIds.join(', ') : 'any in the account') +
    '. Production changes still need per-change confirmation. The bearer is delivered ' +
    'as a one-time secret and is never shown in a tool result.';
}

// The independent scope read-back, ported from owner-apply's
// applyPassRequest: the stored pass must BE the approved scope.
function scopeVerified({scope, writes, checked, account, issuedId}) {
  return checked?.status === 'ok' && checked.id === issuedId &&
    checked.account === account &&
    checked.profile === (writes ? scope.profile : 'read_only') &&
    checked.mode === scope.mode &&
    JSON.stringify(checked.areas) === JSON.stringify(scope.areas) &&
    checked.rateLimitPerMinute === scope.rateLimitPerMinute &&
    (!writes || (checked.allowWrites === true &&
      checked.spendLimitCents === scope.spendLimitCents &&
      JSON.stringify(checked.projectIds ?? null) ===
        JSON.stringify(scope.projectIds ?? null)));
}

export async function issueDirectPass({db, env, account, scope, writes, now = () => Date.now()}) {
  const issued = writes
    ? await db.issueWriteRtcPass({account, profile: scope.profile, hours: scope.hours,
        areas: scope.areas, mode: scope.mode, spendLimitCents: scope.spendLimitCents,
        projectIds: scope.projectIds, rateLimitPerMinute: scope.rateLimitPerMinute})
    : await db.issueReadOnlyRtcPass({account, hours: scope.hours, areas: scope.areas,
        mode: scope.mode, rateLimitPerMinute: scope.rateLimitPerMinute});
  if (!issued) return {status: 'refused_by_guard', confirmed: false,
    reason: 'Pass was not issued. Check the selected account and try again.'};
  let once = null;
  try {
    const checked = await db.inspectRtcPass(issued.token);
    if (!scopeVerified({scope, writes, checked, account, issuedId: issued.id}))
      throw new Error('scope verification failed');
    once = await oneTimeSecrets({db, env, now}).issue({account, kind: 'rtc_pass',
      label: writes ? 'Write-capable RTC pass' : 'Read-only RTC pass',
      value: issued.token, ttlMs: 600000});
  } catch {
    await db.revokeRtcPass({account, id: issued.id}).catch(() => {});
    return {status: 'refused_by_guard', confirmed: false,
      reason: 'Pass verification or one-time delivery failed; the pass was revoked — inspect before retrying'};
  }
  return {status: 'issued', confirmed: true, writes: writes === true,
    passId: issued.id, account, mode: scope.mode,
    profile: writes ? scope.profile : 'read_only',
    areas: scope.areas, hours: scope.hours,
    rateLimitPerMinute: scope.rateLimitPerMinute,
    ...(writes ? {spendLimitCents: scope.spendLimitCents,
      projectIds: scope.projectIds} : {}),
    passExpiresAt: iso(issued.expiresAt),
    secretReference: once.id, secretExpiresAt: once.expiresAt,
    note: 'Reveal the secret once using reference ' + once.id + ' with account ' +
      account + ' via vercel_reveal_one_time_secret; the bearer is not shown in any tool result.'};
}

// Non-consuming metadata for the revoke preview, from the same
// listing the setup page renders. A revoked or unknown pass reads
// as absent — the page's one refusal covers all three cases.
export async function inspectPassForRevoke({db, account, passId}) {
  const rows = await db.listRtcPasses(account);
  const row = (rows ?? []).find(entry => entry.pass_id === passId) ?? null;
  if (!row || row.revoked_at) return null;
  return {passId: row.pass_id, account, mode: row.mode ?? null,
    areas: row.areas ?? [], rateLimitPerMinute: row.rate_limit_per_minute ?? null,
    expiresAt: iso(row.expires_at), createdAt: iso(row.created_at)};
}

export async function revokeDirectPass({db, account, passId}) {
  return (await db.revokeRtcPass({account, id: passId})) === true;
}

// Non-consuming metadata for the reveal preview (db.getOneTimeSecret
// never selects the ciphertext).
export async function inspectSecretForReveal({db, account, reference}) {
  const row = await db.getOneTimeSecret({id: reference, account});
  if (!row) return null;
  return {reference: row.id, account: row.vercel_account ?? null,
    kind: row.kind, label: row.label ?? null, expiresAt: iso(row.expires_at)};
}

// Consume-then-journal: the reveal event is recorded only after the
// atomic consume succeeds, and the journal entry carries the kind
// and reference — recordChange's own credential screen would refuse
// the value, and it is never offered.
export async function revealOneTimeSecretValue({db, env, account, reference,
  journalAccount, journalMode, now = () => Date.now()}) {
  const revealed = await oneTimeSecrets({db, env, now}).reveal({id: reference, account});
  if (!revealed) return null;
  await db.recordChange({account: journalAccount, tool: 'vercel_reveal_one_time_secret',
    mode: journalMode, dryRun: false, production: false,
    summary: 'Owner revealed one-time secret (kind: ' + revealed.kind +
      ', reference: ' + reference + ') — shown once; the value is never recorded'});
  return {kind: revealed.kind, label: revealed.label ?? null, value: revealed.value};
}
