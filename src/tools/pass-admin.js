// AUD-AU: pass issuance, revocation, and one-time reveal as tools
// (sign-in cleanup dossier §2.5) — the direct replacements for the
// owner setup page's issue_rtc_pass / issue_rtc_write_pass /
// revoke_rtc_pass forms and its reveal action, so AUD-AV can delete
// the setup route without stranding pass administration.
//
// Guardrails, stated plainly (dossier D8, SURFACE):
//   - Owner's connection only: every handler refuses unless
//     connection.kind === 'connector', BEFORE any argument or store
//     is touched (the vercel_apply_owner_approval gate). A delegated
//     RTC pass carries kind 'pass' and can never issue, revoke or
//     reveal — including a full-profile write pass, which passes
//     profile visibility and is stopped here at the handler.
//   - Issuance validations are the page forms' own, carried by the
//     shared passScope / writePassScope decoders; the bearer is
//     delivered only as a one-time secret reference (AUD-AS
//     precedent), never in the issue result.
//   - Reveal consumes the one_time_secrets row atomically
//     (single-view semantics unchanged) and returns the value once,
//     in that tool result only; the journal records the reveal
//     event and reference, never the value.
import {passScope, writePassScope} from '../vercel/pass-requests.js';
import {issueDirectPass, issuePlanText, inspectPassForRevoke, revokeDirectPass,
  inspectSecretForReveal, revealOneTimeSecretValue} from '../vercel/pass-admin.js';

const ACCOUNT = /^[a-zA-Z0-9_/-]{3,256}$/;
const REF = /^[0-9a-f-]{36}$/;
const PASS_ID = /^pass_[a-f0-9]{20}$/;
const MALFORMED = 'Malformed arguments: send only the documented arguments with the ' +
  'documented types; the administrator passphrase is never a tool argument';

function result(payload) {
  return { isError: ['refused_by_guard', 'unverified'].includes(payload?.status),
    content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
const refused = reason => result({ status: 'refused_by_guard', confirmed: false, reason });

// The setup forms validated areas against every area in the
// registry (setup.js validAreas) — both forms, read and write.
// That vocabulary, not the proposal flow's read-only subset, is
// what direct issuance carries.
const knownAllAreas = registry => [...new Set(['server',
  ...(registry?.tools ?? []).map(tool => tool.area).filter(Boolean)])];

const pick = (args, keys) => Object.fromEntries(
  keys.filter(key => args[key] !== undefined).map(key => [key, args[key]]));

const boolsOk = (args, keys) => keys.every(key =>
  args[key] === undefined || typeof args[key] === 'boolean');
const intsOk = (args, keys) => keys.every(key =>
  args[key] === undefined || Number.isInteger(args[key]));
const stringsOk = (args, keys) => keys.every(key =>
  args[key] === undefined || typeof args[key] === 'string');
const stringArraysOk = (args, keys) => keys.every(key =>
  args[key] === undefined ||
  (Array.isArray(args[key]) && args[key].every(item => typeof item === 'string')));

// The gates every handler shares, after the kind gate and argument
// discipline: full-profile owner connection, the production
// server, and a configured account (the forms' parity).
async function ownerGates({connection, db, env, verb}) {
  if (connection?.profile !== 'full' || typeof connection?.account !== 'string' ||
      !ACCOUNT.test(connection.account))
    return 'Pass administration needs the full-profile owner connection';
  if (env?.VERCEL_ENV !== 'production')
    return verb + ' is available only on the production server';
  const accounts = await db.listVercelAccounts();
  if (!(accounts ?? []).some(row => row.id === connection.account))
    return 'Choose a connected account';
  return null;
}

const ISSUE_KEYS = ['writes', 'profile', 'mode', 'hours', 'areas',
  'rateLimitPerMinute', 'spendLimitCents', 'projectIds', 'dryRun', 'confirm'];

async function issuePass(args, { connection, db, env = process.env, registry } = {}) {
  if (connection?.kind !== 'connector')
    return refused("Passes are issued only from the account owner's own connector connection; a delegated pass can never issue one");
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !ISSUE_KEYS.includes(key)) ||
      !boolsOk(args, ['writes', 'dryRun', 'confirm']) ||
      !intsOk(args, ['hours', 'rateLimitPerMinute', 'spendLimitCents']) ||
      !stringsOk(args, ['profile', 'mode']) ||
      !stringArraysOk(args, ['areas']) ||
      !(args.projectIds === undefined || args.projectIds === null ||
        stringArraysOk(args, ['projectIds'])))
    return refused(MALFORMED);
  const gate = await ownerGates({connection, db, env, verb: 'Pass issuance'});
  if (gate) return refused(gate);
  const writes = args.writes === true;
  // Write-only arguments on a read ask refuse rather than being
  // silently dropped (the vercel_create_pass precedent).
  if (!writes && (args.profile !== undefined || args.spendLimitCents !== undefined ||
      args.projectIds !== undefined))
    return refused('profile, spendLimitCents and projectIds belong to a write-capable pass; set writes: true or remove them');
  let scope;
  try {
    scope = writes
      ? writePassScope(pick(args, ['writes', 'profile', 'mode', 'hours', 'areas',
          'rateLimitPerMinute', 'spendLimitCents', 'projectIds']), knownAllAreas(registry))
      : passScope(pick(args, ['mode', 'hours', 'areas', 'rateLimitPerMinute']),
          knownAllAreas(registry));
  } catch {
    return refused(writes
      ? 'Choose known areas, a valid profile and mode, a short lifetime, a spend ceiling, and valid project IDs'
      : 'Choose known areas and a short lifetime');
  }
  if (args.confirm !== true) return result({
    status: args.dryRun === true ? 'preview' : 'needs_confirmation',
    confirmed: false, ownerApprovalRequired: true,
    summary: issuePlanText({account: connection.account, scope, writes}),
    note: 'No bearer is delivered until you confirm.' });
  return result(await issueDirectPass({db, env,
    account: connection.account, scope, writes}));
}

const REVOKE_KEYS = ['passId', 'dryRun', 'confirm'];

async function revokePass(args, { connection, db, env = process.env } = {}) {
  if (connection?.kind !== 'connector')
    return refused("Passes are revoked only from the account owner's own connector connection; a delegated pass can never revoke one");
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !REVOKE_KEYS.includes(key)) ||
      !boolsOk(args, ['dryRun', 'confirm']) ||
      typeof args.passId !== 'string')
    return refused(MALFORMED);
  // The form's one refusal covers a malformed, unknown, revoked or
  // foreign reference alike.
  if (!PASS_ID.test(args.passId))
    return refused('Pass missing, already revoked or belongs to another account');
  const gate = await ownerGates({connection, db, env, verb: 'Pass revocation'});
  if (gate) return refused(gate);
  const found = await inspectPassForRevoke({db,
    account: connection.account, passId: args.passId});
  if (!found) return refused('Pass missing, already revoked or belongs to another account');
  if (args.confirm !== true) return result({
    status: args.dryRun === true ? 'preview' : 'needs_confirmation',
    confirmed: false, ownerApprovalRequired: true, pass: found,
    summary: 'Revoke the ' + found.mode + ' RTC pass ' + found.passId + ' on ' +
      found.account + ' (areas: ' + found.areas.join(', ') + '; expires ' +
      found.expiresAt + '). Revocation is immediate: the pass refuses at the door from the next call.' });
  const done = await revokeDirectPass({db,
    account: connection.account, passId: args.passId});
  if (!done) return refused('Pass missing, already revoked or belongs to another account');
  return result({ status: 'revoked', confirmed: true, passId: args.passId,
    note: 'The selected RTC pass was revoked.' });
}

const REVEAL_KEYS = ['reference', 'account', 'dryRun', 'confirm'];

async function revealSecret(args, { connection, db, env = process.env } = {}) {
  if (connection?.kind !== 'connector')
    return refused("One-time secrets are revealed only from the account owner's own connector connection; a delegated pass can never reveal one");
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !REVEAL_KEYS.includes(key)) ||
      !boolsOk(args, ['dryRun', 'confirm']) ||
      typeof args.reference !== 'string' || !REF.test(args.reference) ||
      !(args.account === undefined || args.account === null ||
        (typeof args.account === 'string' && ACCOUNT.test(args.account))))
    return refused(MALFORMED);
  const gate = await ownerGates({connection, db, env, verb: 'Secret reveal'});
  if (gate) return refused(gate);
  // The reveal form's account select defaults to Server / global;
  // a named account must be a connected one (the form's refusal).
  const account = args.account ?? null;
  if (account !== null) {
    const accounts = await db.listVercelAccounts();
    if (!(accounts ?? []).some(row => row.id === account))
      return refused('Choose a connected account');
  }
  const meta = await inspectSecretForReveal({db, account, reference: args.reference});
  if (!meta) return refused('Expired, already viewed, or incorrect account');
  if (args.confirm !== true) return result({
    status: args.dryRun === true ? 'preview' : 'needs_confirmation',
    confirmed: false, ownerApprovalRequired: true,
    kind: meta.kind, label: meta.label, account: meta.account,
    expiresAt: meta.expiresAt,
    summary: 'Reveal the ' + (meta.label || meta.kind) + ' one-time secret once. ' +
      'Confirming consumes it: the value is returned in that result only and can never be viewed again.' });
  const revealed = await revealOneTimeSecretValue({db, env, account,
    reference: args.reference, journalAccount: connection.account,
    journalMode: connection.mode ?? 'production'});
  if (!revealed) return refused('Expired, already viewed, or incorrect account');
  return result({ status: 'revealed', confirmed: true, kind: revealed.kind,
    label: revealed.label, account, value: revealed.value,
    note: 'Copy this value now. It cannot be viewed again.' });
}

export const passAdminTools = {
  tools: [{
    name: 'vercel_issue_pass', writes: true, localAdmin: true, secretOut: true,
    profiles: ['full'],
    description: 'Issue an RTC pass on the owner connection: read-only, or write-capable with profile, spend ceiling and project restriction. Bearer goes to a one-time secret.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      writes: { type: 'boolean' },
      profile: { type: 'string', enum: ['everyday', 'full'] },
      mode: { type: 'string', enum: ['preview', 'test', 'production'] },
      hours: { type: 'integer', minimum: 1, maximum: 720 },
      areas: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true,
        items: { type: 'string', maxLength: 48 } },
      rateLimitPerMinute: { type: 'integer', minimum: 1, maximum: 600 },
      spendLimitCents: { type: 'integer', minimum: 0, maximum: 2147483647 },
      projectIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true,
        items: { type: 'string', maxLength: 128 } },
      dryRun: { type: 'boolean' }, confirm: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false },
    writeContract: { production: true, targets: true, access: true, secretOut: true }
  }, {
    name: 'vercel_revoke_pass', writes: true, localAdmin: true, profiles: ['full'],
    description: 'Revoke one RTC pass by its exact pass reference on the owner connection; revocation is immediate and journaled.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['passId'],
      properties: {
        passId: { type: 'string', pattern: '^pass_[a-f0-9]{20}$' },
        dryRun: { type: 'boolean' }, confirm: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: true },
    writeContract: { production: true, targets: true }
  }, {
    name: 'vercel_reveal_one_time_secret', writes: true, localAdmin: true,
    secretOut: true, profiles: ['full'],
    description: 'Reveal a one-time secret exactly once on the owner connection; the value returns in this result only and is never journaled or stored.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['reference'],
      properties: {
        reference: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
        account: { type: 'string', pattern: '^[a-zA-Z0-9_/-]{3,256}$' },
        dryRun: { type: 'boolean' }, confirm: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: true },
    writeContract: { production: true, targets: true, secretOut: true }
  }],
  handlers: { vercel_issue_pass: issuePass, vercel_revoke_pass: revokePass,
    vercel_reveal_one_time_secret: revealSecret }
};
