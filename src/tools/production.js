// Owner production permission tools only. These do not call Vercel's write APIs.
import { requestProductionEnable, disableProduction } from './production-guard.js';

const opts = { type: 'object', properties: {
  confirm: { type: 'boolean' }, dryRun: { type: 'boolean' }
}, additionalProperties: false };
function result(payload) {
  return { isError: payload.status === 'refused_by_guard',
    content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
// AUD-B: strictness is setup-only by design. A tool call carrying any
// argument beyond confirm/dryRun — above all one trying to set the
// strictness — is refused, never silently ignored.
function extraArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const extra = Object.keys(args).filter(k => !['confirm', 'dryRun'].includes(k));
  return extra.length ? extra : null;
}
function refusedExtra(extra) {
  return result({ status: 'refused_by_guard', confirmed: false,
    reason: extra.some(k => /strictness/i.test(k)) ?
      'Production enable strictness can only be changed by the owner on the setup page' :
      'This tool accepts only confirm and dryRun' });
}
export const productionTools = {
  tools: [
    { name: 'vercel_enable_production', writes: true, profiles: ['full'], localAdmin: true,
      description: 'Enable production mode for your team on your confirmed word, unless the team is set to passphrase strictness on setup.',
      inputSchema: opts,
      annotations: { readOnlyHint: false, destructiveHint: false },
      writeContract: { production: true, targets: true }
    },
    { name: 'vercel_disable_production', writes: true, profiles: ['full'], localAdmin: true,
      description: 'Disable a team’s production mode and revoke existing production connector tokens.',
      inputSchema: opts,
      annotations: { readOnlyHint: false, destructiveHint: true },
      writeContract: { production: true, targets: true }
    }
  ],
  handlers: {
    async vercel_enable_production(args, { connection, db, env }) {
      const extra = extraArgs(args);
      if (extra) return refusedExtra(extra);
      return result(await requestProductionEnable({
        db, connection, confirm: args?.confirm === true, dryRun: args?.dryRun === true,
        ...(env ? { env } : {})
      }));
    },
    async vercel_disable_production(args, { connection, db }) {
      const extra = extraArgs(args);
      if (extra) return refusedExtra(extra);
      return result(await disableProduction({
        db, connection, confirm: args?.confirm === true, dryRun: args?.dryRun === true
      }));
    }
  }
};
