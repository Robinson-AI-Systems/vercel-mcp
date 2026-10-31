// Vercel-specific account binding for the generic OAuth handlers.
import { SERVICE_DISPLAY_NAME } from '../service-identity.js';
import { encryptSecret } from '../core/secret-box.js';
import { BLOB_CONTEXT } from './blob.js';
import { boxReport } from './box.js';
import { storeToken } from './tokens.js';

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

// AUD-AR — probe-leg names for the enrollment branch, in the words
// the setup page's token form has always used (AUD-F's leg map,
// carried over verbatim): a probe failure names the leg it stopped
// at, and the leg's own message never carries token material or a
// provider body.
const ENROLL_LEG_WORDS = {
  input: 'input', identity: 'identity', teams: 'teams', projects: 'projects',
  project_team_match: 'project-team match', broad_visibility: 'broad-visibility',
  storage: 'storage'
};

// The optional fetchImpl seam exists for tests (the fake provider);
// production callers pass only the db and provider calls use the
// global fetch inside the token store, exactly as the setup page's
// enrollment does today.
export function createVercelLoginService(db, { fetchImpl } = {}) {
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
    },
    // AUD-AR — token enrollment for the sign-in flow's enrollment
    // branch (dossier §2.2). storeToken is unchanged underneath: it
    // probes the pasted token with Vercel and reads its reach back
    // BEFORE anything is stored, stores only ciphertext, and upserts
    // by team (+project), so re-enrolling the same team IS token
    // rotation. Nothing here binds or activates the account — a
    // connection binds it only when the owner finishes signing in.
    // The read-back is composed from the stored row (the box report),
    // so what the page states is what was actually recorded.
    async enrollToken({ token, teamId, projectId = null, allowFull = false } = {},
      env = process.env) {
      let result;
      try {
        result = await storeToken({ db, token, teamId, projectId, allowFull, env, fetchImpl });
      } catch (err) {
        const leg = ENROLL_LEG_WORDS[err?.probeLeg];
        if (leg) {
          return { ok: false, error: 'Enrollment failed at the ' + leg + ' check: ' + err.message };
        }
        return { ok: false, error: 'Enrollment could not be completed. ' +
          'Check the team ID and the token, then try again.' };
      }
      const row = (await db.listVercelAccounts()).find((account) => account.id === result.id) || null;
      const box = row ? boxReport(row) : null;
      return { ok: true, accountId: result.id, teamSlug: result.team, scope: result.scope,
        project: result.project, last4: result.last4,
        declaredBox: box ? box.declaredBox : null, probedBox: box ? box.probedBox : null };
    },
    // AUD-AR — Blob store enrollment, the setup form's second
    // enrollment kind, carried into the sign-in flow with its
    // validation wording unchanged: the account must already be
    // enrolled, the store ID and label are bounded, and the token
    // must look like a Blob read-write token. The token is encrypted
    // under the store's own context and stored as ciphertext only;
    // it is never shown again after this call.
    async enrollBlobStore({ account, storeId, label, access, token } = {},
      env = process.env) {
      const cleanAccount = String(account || '');
      const accounts = await db.listVercelAccounts();
      if (!cleanAccount || !accounts.some((row) => row.id === cleanAccount)) {
        return { ok: false, error: 'Choose a connected account.' };
      }
      const cleanStoreId = String(storeId || '');
      const cleanLabel = String(label || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(cleanStoreId) ||
        !cleanLabel || cleanLabel.length > 200) {
        return { ok: false, error: 'Give the store ID and a label.' };
      }
      const cleanToken = String(token || '');
      if (!cleanToken.startsWith('vercel_blob_rw_') || cleanToken.length < 24) {
        return { ok: false, error: 'That does not look like a Blob read-write token ' +
          '(it starts with vercel_blob_rw_).' };
      }
      try {
        const ciphertext = encryptSecret(cleanToken, BLOB_CONTEXT(cleanAccount, cleanStoreId), env);
        await db.insertBlobStoreConnection({ account: cleanAccount, storeId: cleanStoreId,
          label: cleanLabel, access: access === 'private' ? 'private' : 'public',
          ciphertext, tokenLast4: cleanToken.slice(-4) });
      } catch {
        return { ok: false, error: 'The store could not be saved on this server. Nothing was stored.' };
      }
      return { ok: true, storeId: cleanStoreId, label: cleanLabel };
    }
  };
}
