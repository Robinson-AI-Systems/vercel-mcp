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

export async function storeToken({ db, token, teamId, projectId = null,
  allowFull = false, env = process.env, fetchImpl, baseUrl }) {
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
        scopeVerified: false // REST reads cannot prove token's complete privilege set.
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
  return { token: decryptSecret(row.token_enc, 'token:' + row.id, env),
    account: { id: row.id, team_id: row.team_id, scope: row.scope, project_id: row.project_id } };
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
  const result = await probeToken({
    token, teamId: account.team_id, projectId: account.project_id || null,
    allowFull: account.scope === 'full', fetchImpl, baseUrl
  });
  return {
    checkedAt: result.checkedAt, teamId: result.teamId, teamSlug: result.teamSlug,
    projectId: result.projectId, storedScope: account.scope,
    visibleTeamCount: result.visibleTeamCount, visibleProjectCount: result.visibleProjectCount,
    access: 'read_verified', scopeVerified: false, writePermissions: 'unknown',
    expiryVerified: false, persisted: false
  };
}
