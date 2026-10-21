// Vercel-specific account binding for the generic OAuth handlers.
import { SERVICE_DISPLAY_NAME } from '../service-identity.js';
export function createVercelLoginService(db) {
  return {
    name: SERVICE_DISPLAY_NAME,
    accountLabel: 'Vercel team',
    listAccounts: () => db.listVercelAccounts(),
    modesFor(account, env = process.env) {
      const modes = ['preview'];
      if (account?.production_enabled && env.VERCEL_ENV === 'production') modes.push('production');
      return modes;
    }
  };
}
