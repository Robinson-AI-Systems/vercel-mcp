// AUD-AS: vercel_apply_owner_approval — the owner's apply surface
// for approval envelopes, on the owner's own connection (sign-in
// cleanup dossier §2.4). Proposal tools issue an envelope; this tool
// inspects it (dryRun, never consuming) or applies it (confirm),
// through the same family functions the setup page calls.
//
// HARD GATE: the handler refuses unless the connection's kind is
// 'connector' (src/core/mcp-auth.js mints that only for the account
// owner's own OAuth connection). RTC pass connections carry kind
// 'pass' — a delegated pass can never apply an owner approval,
// including a write-capable one. Profile visibility alone is not
// the gate: a write pass may carry the full profile.
import { inspectOwnerApproval, applyOwnerApproval } from '../vercel/owner-apply.js';

const REF = /^[0-9a-f-]{36}$/;
const ACCOUNT = /^[a-zA-Z0-9_/-]{3,256}$/;
function result(payload) {
  return { isError: ['refused_by_guard', 'unverified'].includes(payload.status),
    content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
function refused(reason) {
  return result({ status: 'refused_by_guard', confirmed: false, reason });
}
// The pass family's scope decode validates areas against the live
// registry — the same derivation the setup page uses.
function passAreas(registry) {
  const tools = Array.isArray(registry?.tools) ? registry.tools : [];
  return {
    knownAreas: ['server', ...new Set(tools.filter(t => t.writes === false).map(t => t.area).filter(Boolean))],
    knownWriteAreas: ['server', ...new Set(tools.map(t => t.area).filter(Boolean))]
  };
}

export const ownerApplyTools = {
  tools: [{
    name: 'vercel_apply_owner_approval', writes: true, localAdmin: true, profiles: ['full'],
    description: 'Inspect (dryRun) or apply (confirm) one pending owner approval by its single-use reference: account change, purchase, pass request or production enable.',
    inputSchema: { type: 'object', properties: {
      reference: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
      dryRun: { type: 'boolean' }, confirm: { type: 'boolean' }
    }, required: ['reference'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
    writeContract: { production: true, targets: true }
  }],
  handlers: {
    async vercel_apply_owner_approval(args, { connection, db, env = process.env, registry }) {
      // The hard gate comes first, before any argument or store is
      // touched: only the owner's own connector credential applies.
      if (connection?.kind !== 'connector') {
        return refused('Owner approvals apply only from the account owner\'s own connector connection; a delegated pass can never apply one');
      }
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(k => !['reference', 'dryRun', 'confirm'].includes(k)) ||
        typeof args.reference !== 'string' || !REF.test(args.reference) ||
        (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
        (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
        return refused('Invalid owner approval arguments');
      }
      if (connection.profile !== 'full' || !ACCOUNT.test(connection.account || '')) {
        return refused('A full-profile owner connection is required to apply an owner approval');
      }
      if (env.VERCEL_ENV !== 'production') {
        return refused('Owner approvals apply only on the production server');
      }
      const accounts = await db.listVercelAccounts();
      if (!accounts.some(row => row.id === connection.account)) {
        return refused('Current account is not configured');
      }
      const base = { db, env, account: connection.account, reference: args.reference, ...passAreas(registry) };
      if (args.confirm !== true) {
        const inspected = await inspectOwnerApproval(base);
        if (!inspected) {
          return refused('Approval reference is expired, already used, belongs to another account, or is invalid');
        }
        return result({ status: args.dryRun === true ? 'preview' : 'needs_confirmation',
          dryRun: args.dryRun === true, confirmed: false, ownerApprovalRequired: true,
          family: inspected.family, reference: args.reference, summary: inspected.summary });
      }
      return result(await applyOwnerApproval(base));
    }
  }
};
