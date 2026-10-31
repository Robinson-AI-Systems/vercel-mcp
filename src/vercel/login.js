// Vercel-specific account binding for the generic OAuth handlers.
import { SERVICE_DISPLAY_NAME } from '../service-identity.js';
import { boxReport } from './box.js';

// AUD-AZ — what a new connection is issued with is DERIVED from the
// chosen account at consent, never picked on the authorize form
// (sign-in cleanup dossier §2.3). One derivation serves both the
// rendered page (caption + note) and code creation (mode + profile),
// so the two can never drift — the AUD-AE lesson, kept.
//   profile ← the account's door. Door 1 (an Integrations install;
//     the probe record's source is 'integration') is the standard
//     tier: everyday. Door 2 (a pasted token) is the full tier —
//     god mode = everything ON (IN-16/IN-17). Restraint lives in
//     the credential's own Vercel-side scope, the account's
//     production switch and the user's read-only switch, never in
//     a consent picker (decided default D1).
//   mode ← the account's production switch: production when the
//     switch is on AND this server runs its production deployment,
//     else preview. The deployment conjunct is the pre-AUD-AZ
//     modesFor rule kept as the derivation's mode authority — a
//     non-production deployment of this server never mints a
//     production connection. The switch is the user's standing
//     choice (IN-09, decided default D7); vercel_set_working_box
//     flips the mode freely inside the ceiling afterwards.
const BOX_WORDS = {
  account: 'Account-wide',
  team: 'Team',
  personal: 'Personal account',
  'team-projects': 'Chosen projects on the team',
  project: 'One project'
};

export function createVercelLoginService(db) {
  return {
    name: SERVICE_DISPLAY_NAME,
    accountLabel: 'Vercel team',
    listAccounts: () => db.listVercelAccounts(),
    issuanceFor(account, env = process.env) {
      const report = boxReport(account);
      const mode = account?.production_enabled && env.VERCEL_ENV === 'production' ?
        'production' : 'preview';
      const profile = report.source === 'integration' ? 'everyday' : 'full';
      // The option caption: the declared box in plain words plus the
      // posture a connection on this account starts in. Fixed words
      // and the account's own switch state only — labels never enter
      // it, and every account carries its own, so no script is
      // needed to keep the page truthful when the choice changes.
      const caption = (BOX_WORDS[report.declaredBox] || 'Team') +
        (mode === 'production' ? ' · starts in production' : ' · starts in preview');
      // The AUD-W/AUD-AE production note survives as information
      // (dossier §2.3): a preview-starting account states why, and
      // the flip path, in plain words. It is rendered for the
      // selected account; it is not a disabled option and gates
      // nothing — derivation is the only authority at issuance.
      const note = mode === 'production' ? '' :
        (account?.production_enabled ?
          '<p>Production mode is offered by this server\'s production deployment. ' +
          'This connection starts in preview; it can be flipped to production ' +
          'with vercel_set_working_box.</p>' :
          '<p>Production mode is switched off for this account. The account owner can switch ' +
          'it on with vercel_enable_production; a connection made in preview can ' +
          'be flipped to production afterwards with vercel_set_working_box.</p>');
      return { mode, profile, caption, note };
    }
  };
}
