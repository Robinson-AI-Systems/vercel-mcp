// Vercel-specific account binding for the generic OAuth handlers.
import { SERVICE_DISPLAY_NAME } from '../service-identity.js';
import { encryptSecret } from '../core/secret-box.js';
import { BLOB_CONTEXT } from './blob.js';
import { boxReport } from './box.js';
import { loadToken, storeToken } from './tokens.js';
import { makeVercelClient } from './client.js';
import { SIGNIN_BINDING_COOKIE, buildSigninAuthorizeUrl, signinConfig } from './signin.js';

// AUD-AZ — what a new connection is issued with is DERIVED from the
// chosen account at consent, never picked on the authorize form
// (sign-in cleanup dossier §2.3). One derivation serves both the
// rendered page (caption + note) and code creation (mode + profile),
// so the two can never drift — the AUD-AE lesson, kept.
//   profile ← full, for every sign-in (AUD-BD, the login fix — the
//     owner's ruling that a normal end-user login lands with a full
//     profile; this supersedes the cleanup dossier's door-derived
//     D1). The doors still differ in the credential itself: an
//     install token's Vercel-side team/project reach vs a pasted
//     token's scope box, read back at enrollment, is the ceiling.
//     Restraint lives in that scope, the account's production
//     switch and the user's read-only switch, never in a consent
//     picker or a sign-in profile class.
//   mode ← the account's production switch: production when the
//     switch is on AND this server runs its production deployment,
//     else preview. The deployment conjunct is the pre-AUD-AZ
//     modesFor rule kept as the derivation's mode authority — a
//     non-production deployment of this server never mints a
//     production connection. The switch is the user's standing
//     choice (IN-09, decided default D7) and is born ON at
//     enrollment (AUD-BD), so the default landing is production;
//     vercel_set_working_box flips the mode freely inside the
//     ceiling afterwards.
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

// SR-2 — the Door 1 probe record persists the installer's
// Vercel user id (integration.js writes it as probe data); the
// stored probe may be an object or its JSON text.
function probeRecordOf(account) {
  const probe = account?.token_probe;
  if (!probe) return null;
  if (typeof probe === 'object') return probe;
  try {
    const parsed = JSON.parse(probe);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

// SR-2 — limb 1's attested owner: the account's own attested
// identity (SR-1's column; SR-3 populates it at enrollment)
// or, until then, the installer identity its Door 1 probe
// record already carries.
function attestedOwnerOf(account) {
  if (typeof account?.attested_user_id === 'string' && account.attested_user_id) {
    return account.attested_user_id;
  }
  const installer = probeRecordOf(account)?.installerUserId;
  return typeof installer === 'string' && installer ? installer : null;
}

// SR-2 — limb 2: the account's OWN stored credential reads
// its team's member list (teams_members_list — GET
// /v3/teams/{teamId}/members, verified against the pinned
// snapshot in this card; member items carry uid) and the
// list must name the signer. Fail closed on every error: an
// expired credential, a scope that cannot read members, or
// a malformed page simply does not grant.
async function rosterHasUser({ db, account, userId, env, fetchImpl }) {
  try {
    const { token, account: loaded } = await loadToken({ db, accountId: account.id, env });
    const client = makeVercelClient({ token, account: loaded, fetchImpl,
      replayStore: typeof db?.requestReplayStore === 'function' ?
        db.requestReplayStore() : undefined });
    const page = await client.request('teams_members_list',
      { path: { teamId: account.team_id } });
    const members = Array.isArray(page?.members) ? page.members :
      (Array.isArray(page) ? page : []);
    return members.some((member) => member?.uid === userId);
  } catch { return false; }
}

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
      // AUD-BD: full for every sign-in, both doors (see header).
      const profile = 'full';
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
    },
    // SR-2 (gate O-2.7, dossier section 5.1) — the Sign in
    // with Vercel adapter the generic OAuth handlers
    // orchestrate through, so src/core stays provider-free:
    // whether the leg is configured, where its authorize URL
    // points, and the flow's browser-binding cookie name
    // (SR-1's constant, carried here so the handlers never
    // import the provider module).
    signinConfigured(env = process.env) {
      return signinConfig(env) !== null;
    },
    signinAuthorizeUrl({ state, nonce, codeChallenge } = {}, env = process.env) {
      return buildSigninAuthorizeUrl({ config: signinConfig(env),
        state, nonce, codeChallenge });
    },
    signinBindingCookie() {
      return SIGNIN_BINDING_COOKIE;
    },
    // SR-2 — identity binding (dossier section 5.4): the
    // accounts a verified Vercel identity may pick at
    // consent — owner match or team-roster membership, each
    // limb failing closed (see the helpers above). The
    // generic handlers call this lazily, only on the
    // attested path.
    async bindableAccounts(attestedUserId, env = process.env) {
      if (typeof attestedUserId !== 'string' || !attestedUserId) return [];
      const accounts = await db.listVercelAccounts();
      const bindable = [];
      for (const account of accounts) {
        if (attestedOwnerOf(account) === attestedUserId) { bindable.push(account); continue; }
        if (account.team_id &&
          await rosterHasUser({ db, account, userId: attestedUserId, env, fetchImpl })) {
          bindable.push(account);
        }
      }
      return bindable;
    }
  };
}
