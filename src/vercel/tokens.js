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

// A Vercel API read can prove access to a team/project, not the token's
// *complete* permission footprint. Never treat a successful read as proof
// that writes are authorized. Batch B's independently enforced guards remain
// mandatory for every write.
export async function probeToken({ token, teamId, projectId = null, allowFull = false,
  fetchImpl, baseUrl }) {
  assertToken(token);
  if (!safeId(teamId) || (projectId !== null && !safeId(projectId))) {
    throw new TypeError('Select a valid target team and optional project');
  }
  const client = makeVercelClient({
    token, account: { id: 'probe_only', team_id: teamId },
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(baseUrl ? { baseUrl } : {})
  });
  const [identity, teamResponse, projectResponse] = await Promise.all([
    client.request('user_get'),
    client.request('teams_list'),
    client.request('projects_list', { query: { limit: 100 } })
  ]);
  const teams = teamResponse?.teams;
  const projects = projectResponse?.projects;
  // A single page cannot establish visibility. Never claim an exhaustive check
  // when Vercel reports more results beyond this bounded three-GET probe.
  if (teamResponse?.pagination?.next != null || projectResponse?.pagination?.next != null) {
    throw new Error('Token visibility is incomplete; review the connection in owner setup');
  }
  if (!identity?.user || !Array.isArray(teams) || !Array.isArray(projects)) {
    throw new Error('Could not confirm the token account and team access');
  }
  const team = teams.find(item => item?.id === teamId);
  if (!team || typeof team.slug !== 'string') {
    throw new Error('Token does not have verified access to the selected team');
  }
  const project = projectId && projects.find(item => item?.id === projectId);
  if (projectId && !project) throw new Error('Token cannot access the selected project');
  // Multiple visible teams/projects mean broader privileges might exist.
  // Even a single returned team does NOT establish exact token scope.
  const broad = teams.length > 1 || (projectId && projects.some(item => item.id !== projectId));
  if (broad && !allowFull) {
    throw new Error('Broader token visibility requires explicit owner allowance');
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

export async function storeToken({ db, token, teamId, projectId = null,
  allowFull = false, env = process.env, fetchImpl, baseUrl }) {
  if (!db?.upsertVercelAccount) throw new TypeError('Durable account storage is required');
  const result = await probeToken({ token, teamId, projectId, allowFull, fetchImpl, baseUrl });
  const id = result.projectId ? result.teamId + '/' + result.projectId : result.teamId;
  const tokenEnc = encryptSecret(token, 'token:' + id, env);
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
