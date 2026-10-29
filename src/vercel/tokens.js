// Credential boundary: token is accepted only by an authenticated setup route.
// No result in this module echoes any token or upstream response body.
import { encryptSecret, decryptSecret } from '../core/secret-box.js';
import { makeVercelClient } from './client.js';

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{3,128}$/.test(value);
}
function assertToken(token) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 1024 ||
    /\s/.test(token)) throw new TypeError('A valid server-side token is required');
}

// AUD-F (VMCP-022): every probe failure carries a stable leg identifier so
// the setup page can name the leg that failed. Leg messages are written here
// and never include token material or a provider response body.
const PROBE_LEG_MESSAGES = Object.freeze({
  identity: 'Could not confirm the token identity with Vercel',
  teams: 'Could not confirm the token team visibility with Vercel',
  projects: 'Could not confirm the token project visibility with Vercel'
});
function probeFail(leg, message) {
  return Object.assign(new Error(message), { probeLeg: leg });
}
function transportFail(leg, err) {
  if (err?.probeLeg) return err;
  // AUD-I S5 (A-5): a dead integration credential names its cause
  // class in plain words wherever a probe surfaces it. Vercel
  // disables an installation's configuration when the person who
  // installed it leaves the team (403, code
  // integration_configuration_disabled — the client preserves the
  // provider code, never the body). The credential is dead at
  // Vercel; disconnecting here still completes on this server, and
  // reconnecting means a current team member installs again.
  if (err?.code === 'integration_configuration_disabled') {
    return probeFail('integration_disabled',
      'The Vercel integration behind this connection was disabled — this happens when the person who installed it leaves the team. The credential is dead at Vercel; disconnecting here still completes on this server, and reconnecting means a current team member installs again');
  }
  const status = Number.isInteger(err?.status) ? ' (HTTP ' + err.status + ')' : '';
  return probeFail(leg, (PROBE_LEG_MESSAGES[leg] || 'Could not confirm the token with Vercel') + status);
}

// Vercel may return a continuation even for a short final page. Follow it
// instead of treating a cursor as a failed credential; never assume exhaustion.
async function visibleRows(client, operation, field, leg = field) {
  const rows = [], ids = new Set();
  let until;
  for (let page = 0; page < 5; page++) {
    const result = await client.request(operation, {
      query: { limit: 100, ...(until === undefined ? {} : { until }) }
    }, { timeoutMs: 5000 }).catch(err => { throw transportFail(leg, err); });
    const items = result?.[field];
    if (!Array.isArray(items) || items.length > 100) {
      throw probeFail(leg, 'Could not confirm bounded token visibility');
    }
    for (const item of items) {
      if (!safeId(item?.id) || ids.has(item.id)) {
        throw probeFail(leg, 'Could not confirm unique token visibility');
      }
      ids.add(item.id);
      rows.push(item);
    }
    const next = result?.pagination?.next;
    if (next == null) return rows;
    if (!Number.isSafeInteger(next) || next < 0 || !items.length ||
        (until !== undefined && next >= until)) {
      throw probeFail(leg, 'Token visibility is incomplete; review the connection in owner setup');
    }
    until = next;
  }
  throw probeFail(leg, 'Token visibility is incomplete; review the connection in owner setup');
}

// A Vercel API read can prove access to a team/project, not the token's
// *complete* permission footprint. Never treat a successful read as proof
// that writes are authorized. Batch B's independently enforced guards remain
// mandatory for every write.
// The original probe: identity + team visibility + project visibility, all
// through the team-scoped client. This remains the behavior for team and
// full tokens, and for project enrollments whose token can satisfy it.
async function probeTeamVisible(client, { teamId, projectId, allowFull }) {
  const [identity, teams, projects] = await Promise.all([
    client.request('user_get').catch(err => { throw transportFail('identity', err); }),
    visibleRows(client, 'teams_list', 'teams'),
    visibleRows(client, 'projects_list', 'projects')
  ]);
  if (!identity?.user || !Array.isArray(teams) || !Array.isArray(projects)) {
    throw probeFail('identity', 'Could not confirm the token account and team access');
  }
  const team = teams.find(item => item?.id === teamId);
  if (!team || typeof team.slug !== 'string') {
    throw probeFail('teams', 'Token does not have verified access to the selected team');
  }
  const project = projectId && projects.find(item => item?.id === projectId);
  if (projectId && !project) throw probeFail('projects', 'Token cannot access the selected project');
  // Multiple visible teams/projects mean broader privileges might exist.
  // Even a single returned team does NOT establish exact token scope.
  const broad = teams.length > 1 || (projectId && projects.some(item => item.id !== projectId));
  if (broad && !allowFull) {
    throw probeFail('broad_visibility', 'Broader token visibility requires explicit owner allowance');
  }
  return {
    teamId, teamSlug: team.slug,
    teamName: typeof team.name === 'string' ? team.name : team.slug,
    scope: broad ? 'full' : projectId ? 'project' : 'team',
    projectId: projectId || null,
    projectName: project && typeof project.name === 'string' ? project.name : null,
    checkedAt: new Date().toISOString(),
    visibleTeamCount: teams.length,
    visibleProjectCount: projects.length
  };
}

// AUD-F project path: verification rests only on reads a genuinely
// project-scoped token can perform. The projects list is scope-inferred (no
// teamId attached); the project's owning team is derived from the project
// itself — its accountId, on the list row or on the direct project read —
// and checked against the requested team. user_get and teams_list are not
// load-bearing here: the teams read is attempted unscoped, best-effort, only
// to label the account row and to notice broader team visibility; a refused
// or empty answer cannot fail an otherwise-proven project enrollment, and
// the best verified label (the team ID) is stored when no label is readable.
async function probeProjectScoped(client, { teamId, projectId, allowFull }) {
  const projects = await visibleRows(client, 'projects_list_unscoped', 'projects');
  const project = projects.find(item => item?.id === projectId);
  if (!project) throw probeFail('projects', 'Token cannot access the selected project');
  let ownerId = typeof project.accountId === 'string' && project.accountId ? project.accountId : null;
  let detail = null;
  if (!ownerId) {
    detail = await client.request('projects_get_unscoped',
      { path: { idOrName: projectId } }, { timeoutMs: 5000 })
      .catch(err => { throw transportFail('projects', err); });
    if (detail?.id !== projectId) {
      throw probeFail('projects', 'Token cannot access the selected project');
    }
    ownerId = typeof detail?.accountId === 'string' && detail.accountId ? detail.accountId : null;
    if (!ownerId) {
      throw probeFail('project_team_match',
        'Could not confirm the selected project belongs to the selected team');
    }
  }
  if (ownerId !== teamId) {
    throw probeFail('project_team_match',
      'The selected project belongs to a different team than the selected team');
  }
  let teamRow = null, visibleTeamCount = 1;
  try {
    const result = await client.request('teams_list_unscoped',
      { query: { limit: 100 } }, { timeoutMs: 5000 });
    if (Array.isArray(result?.teams)) {
      visibleTeamCount = result.teams.length;
      teamRow = result.teams.find(item => item?.id === teamId) || null;
    }
  } catch { /* Label/broadness evidence only; never load-bearing. */ }
  const broad = visibleTeamCount > 1 || projects.length > 1;
  if (broad && !allowFull) {
    throw probeFail('broad_visibility', 'Broader token visibility requires explicit owner allowance');
  }
  return {
    teamId,
    teamSlug: typeof teamRow?.slug === 'string' ? teamRow.slug : teamId,
    teamName: typeof teamRow?.name === 'string' ? teamRow.name :
      typeof teamRow?.slug === 'string' ? teamRow.slug : teamId,
    scope: broad ? 'full' : 'project',
    projectId,
    projectName: typeof project.name === 'string' ? project.name :
      typeof detail?.name === 'string' ? detail.name : null,
    checkedAt: new Date().toISOString(),
    visibleTeamCount,
    visibleProjectCount: projects.length
  };
}

export async function probeToken({ token, teamId, projectId = null, allowFull = false,
  fetchImpl, baseUrl }) {
  try {
    assertToken(token);
  } catch {
    throw probeFail('input',
      'A valid server-side token is required; check the token for stray whitespace or copying errors');
  }
  if (!safeId(teamId) || (projectId !== null && !safeId(projectId))) {
    throw probeFail('input', 'Select a valid target team and optional project');
  }
  const client = makeVercelClient({
    token, account: { id: 'probe_only', team_id: teamId },
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(baseUrl ? { baseUrl } : {})
  });
  if (!projectId) return probeTeamVisible(client, { teamId, projectId, allowFull });
  try {
    return await probeTeamVisible(client, { teamId, projectId, allowFull });
  } catch (err) {
    // Only a failure of the identity, teams or projects legs can mean the
    // token's scope is narrower than the team-visible probe assumes; broad
    // visibility and every other refusal stand exactly as probed.
    if (!['identity', 'teams', 'projects'].includes(err?.probeLeg)) throw err;
    return probeProjectScoped(client, { teamId, projectId, allowFull });
  }
}

// AUD-I S1b: the user-keyed probe for a PERSONAL-account installation
// token (the Integrations exchange answered team_id: null). There is
// no team for the team probe to see, so the proof rests on reads a
// personal credential can actually perform, cross-checked against
// the exchange's own claim: the token's identity read must name the
// very user the exchange says installed it, and its unscoped project
// visibility is the personal account's granted set. A personal
// account id occupies the same account-id space as a team id in
// Vercel's model, so the record keys on the user id; the store's
// scope enum has no 'personal' value, so the row records scope
// 'team' (its account-shaped box) AND accountKind: 'personal' on the
// probe record — the honest label rides where whoami reads it, and
// DECISIONS 2026-10-29 (S1b) records the pairing. Team visibility
// beyond the personal account is broader than this box and refuses
// without the explicit allowance, exactly as the team probe treats
// broad visibility.
export async function probePersonalToken({ token, userId, allowFull = false,
  fetchImpl, baseUrl }) {
  try {
    assertToken(token);
  } catch {
    throw probeFail('input',
      'A valid server-side token is required; check the token for stray whitespace or copying errors');
  }
  if (!safeId(userId)) {
    throw probeFail('input', 'A valid installer identity is required');
  }
  // The client requires a team_id-shaped account; the user id fills
  // it (same account-id space), and every operation this probe calls
  // is declared unscoped, so the value never reaches a request.
  const client = makeVercelClient({
    token, account: { id: 'probe_only', team_id: userId },
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(baseUrl ? { baseUrl } : {})
  });
  const identity = await client.request('user_get_unscoped')
    .catch(err => { throw transportFail('identity', err); });
  if (!identity?.user || identity.user.id !== userId) {
    throw probeFail('identity',
      'The installed credential does not act for the user who installed it');
  }
  const projects = await visibleRows(client, 'projects_list_unscoped', 'projects');
  let visibleTeamCount = 0;
  try {
    const result = await client.request('teams_list_unscoped',
      { query: { limit: 100 } }, { timeoutMs: 5000 });
    if (Array.isArray(result?.teams)) visibleTeamCount = result.teams.length;
  } catch { /* Broadness evidence only; never load-bearing. */ }
  if (visibleTeamCount > 0 && !allowFull) {
    throw probeFail('broad_visibility',
      'Broader token visibility requires explicit owner allowance');
  }
  const username = typeof identity.user.username === 'string' && identity.user.username ?
    identity.user.username : userId;
  return {
    teamId: userId, teamSlug: username,
    teamName: typeof identity.user.name === 'string' && identity.user.name ?
      identity.user.name : username,
    scope: 'team', projectId: null, projectName: null,
    checkedAt: new Date().toISOString(),
    visibleTeamCount, visibleProjectCount: projects.length
  };
}

export async function storePersonalToken({ db, token, userId,
  allowFull = false, env = process.env, fetchImpl, baseUrl, probeExtra = {} }) {
  if (!db?.upsertVercelAccount) throw new TypeError('Durable account storage is required');
  const result = await probePersonalToken({ token, userId, allowFull, fetchImpl, baseUrl });
  const id = result.teamId;
  const tokenEnc = encryptSecret(token, 'token:' + id, env);
  try {
    await db.upsertVercelAccount({
      id, teamId: result.teamId, teamSlug: result.teamSlug, label: result.teamName,
      scope: result.scope, projectId: null, projectName: null,
      tokenEnc, tokenLast4: token.slice(-4), expiresAt: null,
      probe: {
        checkedAt: result.checkedAt,
        visibleTeamCount: result.visibleTeamCount,
        visibleProjectCount: result.visibleProjectCount,
        scopeVerified: false, // REST reads cannot prove token's complete privilege set.
        accountKind: 'personal',
        ...probeExtra
      }
    });
  } catch {
    throw probeFail('storage',
      'The verified token could not be saved; check the server storage configuration');
  }
  return { id, team: result.teamSlug, scope: result.scope, project: null,
    expiry: null, last4: token.slice(-4) };
}

export async function storeToken({ db, token, teamId, projectId = null,
  allowFull = false, env = process.env, fetchImpl, baseUrl, probeExtra = {} }) {
  if (!db?.upsertVercelAccount) throw new TypeError('Durable account storage is required');
  const result = await probeToken({ token, teamId, projectId, allowFull, fetchImpl, baseUrl });
  const id = result.projectId ? result.teamId + '/' + result.projectId : result.teamId;
  const tokenEnc = encryptSecret(token, 'token:' + id, env);
  try {
    await db.upsertVercelAccount({
      id, teamId: result.teamId, teamSlug: result.teamSlug, label: result.teamName,
      scope: result.scope, projectId: result.projectId, projectName: result.projectName,
      tokenEnc, tokenLast4: token.slice(-4), expiresAt: null,
      probe: {
        checkedAt: result.checkedAt,
        visibleTeamCount: result.visibleTeamCount,
        visibleProjectCount: result.visibleProjectCount,
        scopeVerified: false, // REST reads cannot prove token's complete privilege set.
        // Additive caller-supplied provenance (AUD-I: integration installs
        // record their installation identity + declared box). Default {}
        // keeps every existing enrollment's stored shape unchanged.
        ...probeExtra
      }
    });
  } catch {
    // The database error itself is never surfaced: it may carry server detail.
    throw probeFail('storage',
      'The verified token could not be saved; check the server storage configuration');
  }
  return { id, team: result.teamSlug, scope: result.scope, project: result.projectName,
    expiry: null, last4: token.slice(-4) };
}

export async function loadToken({ db, accountId, env = process.env }) {
  if (!db?.getAccountCredential) throw new TypeError('Durable account storage is required');
  const row = await db.getAccountCredential(accountId);
  if (!row || (row.token_expires_at && Date.parse(row.token_expires_at) <= Date.now())) {
    throw new Error('Vercel account is missing or the token is expired');
  }
  const probe = row.token_probe && typeof row.token_probe === 'object' ? row.token_probe :
    (typeof row.token_probe === 'string' ? (() => { try { return JSON.parse(row.token_probe); } catch { return null; } })() : null);
  return { token: decryptSecret(row.token_enc, 'token:' + row.id, env),
    account: { id: row.id, team_id: row.team_id, scope: row.scope, project_id: row.project_id,
      probe } };
}

/**
 * Recheck a credential already approved and encrypted by the owner.
 * This is deliberately READ-ONLY: GET access is not permission to write, nor
 * evidence of the complete privilege footprint or token expiry.
 * Only the authenticated connection's stored account ID is accepted by callers.
 */
export async function recheckStoredToken({ db, accountId, env = process.env, fetchImpl, baseUrl }) {
  if (typeof accountId !== 'string' || !accountId || accountId.length > 256) {
    throw new TypeError('A selected account is required');
  }
  const { token, account } = await loadToken({ db, accountId, env });
  if (account.id !== accountId || !['team', 'project', 'full'].includes(account.scope)) {
    throw new Error('Stored connection scope must be reviewed in owner setup');
  }
  // AUD-I S5: recheck routes by account kind — a personal seat is
  // re-proven by the user-keyed probe, never the team probe.
  const personal = account.probe?.accountKind === 'personal';
  const result = personal ?
    await probePersonalToken({ token, userId: account.id,
      allowFull: account.scope === 'full', fetchImpl, baseUrl }) :
    await probeToken({
      token, teamId: account.team_id, projectId: account.project_id || null,
      allowFull: account.scope === 'full', fetchImpl, baseUrl
    });
  return {
    checkedAt: result.checkedAt, teamId: result.teamId, teamSlug: result.teamSlug,
    projectId: result.projectId, storedScope: account.scope,
    ...(personal ? { accountKind: 'personal' } : {}),
    visibleTeamCount: result.visibleTeamCount, visibleProjectCount: result.visibleProjectCount,
    access: 'read_verified', scopeVerified: false, writePermissions: 'unknown',
    expiryVerified: false, persisted: false
  };
}
