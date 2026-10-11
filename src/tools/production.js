// Owner production permission tools only. These do not call Vercel's write APIs.
import { requestProductionEnable, disableProduction } from './production-guard.js';

const opts = { type: 'object', properties: {
  confirm: { type: 'boolean' }, dryRun: { type: 'boolean' }
}, additionalProperties: false };
function result(payload) {
  return { isError: payload.status === 'refused_by_guard',
    content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
export const productionTools = {
  tools: [
    { name: 'vercel_enable_production', writes: true, profiles: ['full'], localAdmin: true,
      description: 'Request production mode for your team; owner passphrase approval on setup is still required.',
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
    async vercel_enable_production(args, { connection, db }) {
      return result(await requestProductionEnable({
        db, connection, confirm: args.confirm === true, dryRun: args.dryRun === true
      }));
    },
    async vercel_disable_production(args, { connection, db }) {
      return result(await disableProduction({
        db, connection, confirm: args.confirm === true, dryRun: args.dryRun === true
      }));
    }
  }
};
