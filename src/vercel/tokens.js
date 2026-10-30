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
function probeFail(leg, message, extras = {}) {
  return Object.assign(new Error(message), { probeLeg: leg }, extras);
}

// AUD-AI: the client's integer status survives the probe re-wrap as a
// property (the message already names it in text). The tool surface
// classifies a probe refusal from its leg + this status; before
// AUD-AI the re-wrap dropped the status and the code, so every
// recheck refusal collapsed into unknown_error at the MCP surface.
function probeStatusExtras(err) {
  const status = Number(err?.status);
  return Number.isInteger(status) && status >= 100 && status <= 599 ?
    { status } : {};
}

// AUD-M2 (goal-workspace AUD-M): shape fingerprints. When a shape
// gate refuses a provider body, the refusal records WHICH predicates
// failed and the received object's field-name → JSON-type map —
// type words only (string/number/boolean/array/object/null/absent),
// never values; id-shaped fields appear only as predicate outcomes.
// The install callback journals the summary line (fingerprintSummary)
// into the change_log, where the operator reads it back through the
// existing vercel_recent_changes tool; failed predicate names come
// first so the read's 160-char summary bound can never truncate the
// conviction away. One live attempt after this ships names the exact
// field instead of repeating the AUD-K2 expedition.
function jsonTypeOf(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function shapeFingerprint(gate, checks, integrationMatch, failedOverride = null) {
  const failed = failedOverride ??
    checks.filter(check => !check.ok).map(check => check.name);
  // Summary layout under the journal read's 160-char bound: failed
  // predicate names first (the conviction — truncation can never
  // reach them), then the type map with the failed fields' types
  // ahead of the rest, so even a many-failure refusal loses only
  // trailing type words of fields that passed.
  const ordered = [...checks.filter(check => failed.includes(check.name)),
    ...checks.filter(check => !failed.includes(check.name))];
  const types = ordered.map(check => check.name + ':' + check.type).join(' ');
  return {
    gate, failed,
    types: Object.fromEntries(checks.map(check => [check.name, check.type])),
    integrationMatch,
    // The comparison outcome rides the fingerprint object; in the
    // summary it is carried by the failed-predicate name itself
    // ('integrationIdMatch'), keeping the line inside the bound.
    summary: 'SHAPE-FP ' + gate + ' failed=[' + failed.join(',') + '] types: ' + types
  };
}
function probeShapeFail(leg, message, fingerprint) {
  return Object.assign(new Error(message),
    { probeLeg: leg, fingerprint, fingerprintSummary: fingerprint.summary });
}
// The scopes entry's type word: a clean string array is 'array'; an
// array carrying another element type names it ('array<number>') so
// the fingerprint still convicts the element predicate.
function scopesTypeOf(scopes) {
  if (!Array.isArray(scopes)) return jsonTypeOf(scopes);
  const elements = [...new Set(scopes.map(scope => jsonTypeOf(scope)))];
  return elements.length === 0 || elements.every(type => type === 'string') ?
    'array' : 'array<' + elements.join('+') + '>';
}
// AUD-I S5 (A-5): a dead integration credential names its cause
// class in plain words wherever a probe surfaces it. Vercel
// disables an installation's configuration when the person who
// installed it leaves the team (403, code
// integration_configuration_disabled — the client preserves the
// provider code, never the body). The credential is dead at
// Vercel; disconnecting here still completes on this server, and
// reconnecting means a current team member installs again.
const INTEGRATION_DISABLED_MESSAGE =
  'The Vercel integration behind this connection was disabled — this happens when the person who installed it leaves the team. The credential is dead at Vercel; disconnecting here still completes on this server, and reconnecting means a current team member installs again';
function transportFail(leg, err) {
  if (err?.probeLeg) return err;
  if (err?.code === 'integration_configuration_disabled') {
    return probeFail('integration_disabled', INTEGRATION_DISABLED_MESSAGE,
      probeStatusExtras(err));
  }
  const status = Number.isInteger(err?.status) ? ' (HTTP ' + err.status + ')' : '';
  return probeFail(leg, (PROBE_LEG_MESSAGES[leg] || 'Could not confirm the token with Vercel') + status,
    probeStatusExtras(err));
}

// AUD-K: the installation probe's configuration read classifies its
// refusals per IN-18 — plain-words cause plus the remedy — keyed on
// the HTTP status and the one documented provider code
// (integration_configuration_disabled, handled by transportFail).
// No other provider code is published for this endpoint, so no finer
// branch is keyed on one.
function installationReadFail(err) {
  if (err?.probeLeg) return err;
  if (err?.code === 'integration_configuration_disabled') {
    return transportFail('configuration', err);
  }
  const status = err?.status;
  const shown = Number.isInteger(status) ? ' (HTTP ' + status + ')' : '';
  if (status === 401) {
    return probeFail('configuration',
      'Vercel does not accept the installed credential; install again from the connection page' + shown,
      probeStatusExtras(err));
  }
  if (status === 403) {
    return probeFail('configuration',
      "Vercel refused to let this connection read its own installation — the integration is missing the permission to read its installations (integration-configuration); in Vercel's Integration Console, grant the integration-configuration scope, confirm the scope change, then install again" + shown,
      probeStatusExtras(err));
  }
  if (status === 404 || status === 410) {
    return probeFail('configuration',
      'The installation no longer exists at Vercel (it may have been removed before setup finished); install again from the connection page' + shown,
      probeStatusExtras(err));
  }
  return probeFail('configuration', 'Could not confirm the installation with Vercel' + shown,
    probeStatusExtras(err));
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

// AUD-K (VMCP-026 / A-1): the credential-class-aware probe for a
// Door-1 TEAM installation token. The standard probe's load-bearing
// legs are calls this credential class cannot make: the documented
// per-scope endpoint map grants an installation token the
// configuration read (integration-configuration scope), the
// single-team read (team scope) and the team-scoped projects list
// (project scope) — the teams LIST appears under no scope, and the
// user read identifies the installing user, not the installation
// (contract dossier 2026-10-30, shape map rows 1–6). So the proof
// rests on the installation's own configuration record: it exists,
// it belongs to this integration, it sits on the exchanged team, it
// is alive, and it states what it was granted; the projects list
// then proves the credential functionally reads what the record
// grants. A configuration-bounded token can never see a second team
// and is never account-wide, so there is no broad-visibility gate
// and the recorded scope is 'team' or 'project', never 'full'.
export async function probeInstallationToken({ token, teamId, installationId,
  integrationId, userId = null, fetchImpl, baseUrl }) {
  try {
    assertToken(token);
  } catch {
    throw probeFail('input',
      'A valid server-side token is required; check the token for stray whitespace or copying errors');
  }
  if (!safeId(teamId) || !safeId(installationId) ||
    typeof integrationId !== 'string' || !integrationId) {
    throw probeFail('input',
      'A valid installation identity is required; review the connection in owner setup');
  }
  const client = makeVercelClient({
    token, account: { id: 'probe_only', team_id: teamId },
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(baseUrl ? { baseUrl } : {})
  });
  const config = await client.request('integrations_configuration_get',
    { path: { id: installationId } }, { timeoutMs: 5000 })
    .catch(err => { throw installationReadFail(err); });
  // Shape gate (AUD-M2 necessity audit — every hard predicate cites
  // the proof step that consumes its field):
  //   id            — the identity step: the record must be the very
  //                   installation the exchange named (and the id
  //                   stored for recheck's rebuild).
  //   type          — NOT gated outright (AUD-M3): AUD-M2 kept it
  //                   hard as the resource-kind discriminator, but
  //                   the live record OMITS it — the journaled
  //                   fingerprint of the 2026-10-30 closure re-run
  //                   reads failed=[type], type:absent, with every
  //                   other field present and correctly typed — and
  //                   the identity it was meant to vouch for already
  //                   rests on the by-id read, the id match above and
  //                   the integrationId check below. A discriminator
  //                   the provider does not send cannot vouch for
  //                   anything, so the predicate is conditional:
  //                   absent proceeds (the evidence records
  //                   'absent'); present must equal the documented
  //                   kind — a present-but-wrong value means the
  //                   record is a different resource kind than the
  //                   endpoint promised, refused here as shape.
  //   integrationId — consumed by the next check (this integration).
  //   teamId        — consumed by the team check below; null is its
  //                   documented personal shape, refused there as a
  //                   team mismatch, not as a shape failure.
  //   ownerId       — consumed by the team check (ownerId === team).
  //   scopes        — consumed by scope derivation (grantedScopes).
  // userId is NOT gated: its only consumer is the informational
  // installerMatchesConfiguration evidence, which records null when
  // either side is not a string (AUD-M2 — it was hard-required while
  // feeding evidence only, the over-strictness the live A-1 re-run
  // could not rule in or out because no fingerprint existed).
  const configChecks = [
    { name: 'id', type: jsonTypeOf(config?.id),
      ok: config?.id === installationId },
    { name: 'type', type: jsonTypeOf(config?.type),
      ok: config?.type === undefined ||
        config?.type === 'integration-configuration' },
    { name: 'integrationId', type: jsonTypeOf(config?.integrationId),
      ok: typeof config?.integrationId === 'string' && !!config.integrationId },
    { name: 'teamId', type: jsonTypeOf(config?.teamId),
      ok: typeof config?.teamId === 'string' || config?.teamId === null },
    { name: 'ownerId', type: jsonTypeOf(config?.ownerId),
      ok: typeof config?.ownerId === 'string' && !!config.ownerId },
    { name: 'userId', type: jsonTypeOf(config?.userId), ok: true },
    { name: 'scopes', type: scopesTypeOf(config?.scopes),
      ok: Array.isArray(config?.scopes) &&
        config.scopes.every(scope => typeof scope === 'string') }
  ];
  if (configChecks.some(check => !check.ok)) {
    throw probeShapeFail('configuration',
      'Vercel answered the installation check in an unexpected shape; try again — if it persists, it is a provider contract change, not a user error',
      shapeFingerprint('configuration', configChecks, 'not-reached'));
  }
  if (config.integrationId !== integrationId) {
    throw probeShapeFail('configuration_integration',
      "The installation Vercel reported belongs to a different integration; install again from this product's connection page",
      shapeFingerprint('configuration', configChecks, 'mismatch',
        ['integrationIdMatch']));
  }
  if (config.teamId !== teamId || config.ownerId !== teamId) {
    throw probeFail('configuration_team',
      'The installation Vercel reported belongs to a different team than the install named; install again and choose the intended team');
  }
  if (config.deletedAt != null) {
    throw probeFail('configuration_removed',
      'This installation was removed at Vercel; install again from the connection page');
  }
  if (config.disabledAt != null) {
    throw probeFail('integration_disabled', INTEGRATION_DISABLED_MESSAGE);
  }
  const configurationStatus = typeof config.status === 'string' ? config.status : 'ready';
  if (configurationStatus === 'uninstalled') {
    throw probeFail('configuration_removed',
      'This installation was removed at Vercel; install again from the connection page');
  }
  if (configurationStatus === 'suspended') {
    throw probeFail('configuration_suspended',
      'This installation is suspended at Vercel; resolve the suspension in Vercel, then install again from the connection page');
  }
  // Scope derivation from the configuration alone. An absent projects
  // array under an all-projects selection is the documented
  // full-project-access form; a present non-empty array limits the
  // grant whether or not the selection says so.
  const grantedScopes = [...config.scopes];
  const projectSelection = config.projectSelection === 'selected' ? 'selected' : 'all';
  const grantedProjects = Array.isArray(config.projects) ?
    config.projects.filter(item => typeof item === 'string' && item) : null;
  const projectLimited = projectSelection === 'selected' ||
    (grantedProjects !== null && grantedProjects.length > 0);
  let scope = 'team', projectId = null;
  if (projectLimited) {
    const granted = grantedProjects ?? [];
    if (!granted.length) {
      throw probeFail('configuration_grant',
        'This install was not granted access to any project; install again and grant at least one project');
    }
    if (granted.length > 1) {
      throw probeFail('configuration_grant',
        'This install was limited to more than one project; a connection here covers one team or one project. Install again with All Projects, or limit it to the single project to connect');
    }
    scope = 'project';
    projectId = granted[0];
  }
  // Functional proof: the credential reads the team's projects under
  // its project scope. A 403 here (past the disabled class, which
  // transportFail classifies first) names the missing project read.
  let projects;
  try {
    projects = await visibleRows(client, 'projects_list', 'projects');
  } catch (err) {
    if (err?.probeLeg === 'projects' && /\(HTTP 403\)/.test(err.message || '')) {
      throw probeFail('projects',
        "The installed credential cannot read the team's projects — the integration is missing project read permission; in Vercel's Integration Console, grant the project scope (read), confirm the scope change, then install again (HTTP 403)");
    }
    throw err;
  }
  // The configuration record and the credential's reach must agree:
  // nothing visible outside the granted set, and a single granted
  // project actually visible.
  let projectName = null;
  if (projectLimited) {
    const granted = new Set(grantedProjects ?? []);
    const projectRow = projects.find(item => item?.id === projectId);
    if (projects.some(item => !granted.has(item?.id)) || !projectRow) {
      throw probeFail('configuration_grant',
        "Vercel's installation record and the credential's reach disagree; install again — if the disagreement persists, it is a provider issue");
    }
    projectName = typeof projectRow.name === 'string' ? projectRow.name : null;
  }
  const label = await installationLabel(client, teamId);
  return {
    teamId, teamSlug: label.slug, teamName: label.name,
    scope, projectId, projectName,
    checkedAt: new Date().toISOString(),
    visibleTeamCount: 1, visibleProjectCount: projects.length,
    installation: { grantedScopes, projectSelection, configurationStatus,
      // AUD-M3: evidence only — the configuration's type posture as
      // the provider actually sends it: the documented kind when the
      // field is present, 'absent' when the live record omits it (the
      // shape the 2026-10-30 fingerprint captured), so the posture
      // stays observable on the stored row.
      configurationType: config.type === undefined ? 'absent' : config.type,
      // AUD-M2: evidence only — null unless BOTH sides are strings,
      // so an absent or mistyped config.userId (no longer gated)
      // records an honest unknown, never a false mismatch.
      installerMatchesConfiguration:
        typeof userId === 'string' && typeof config.userId === 'string' ?
          config.userId === userId : null }
  };
}

// The single-team read supplies the account label only (team scope,
// Read). It is never load-bearing: any failure falls back to the
// team ID as its own label — the probeProjectScoped precedent. The
// configuration's own slug is the INTEGRATION's slug, never the
// team's, and is not consulted here.
async function installationLabel(client, teamId) {
  try {
    const team = await client.request('teams_get',
      { path: { teamId } }, { timeoutMs: 5000 });
    if (typeof team?.slug === 'string' && team.slug) {
      return { slug: team.slug,
        name: typeof team.name === 'string' && team.name ? team.name : team.slug };
    }
  } catch { /* Label evidence only; never load-bearing. */ }
  return { slug: teamId, name: teamId };
}

// Sibling of storePersonalToken (the S1b precedent): run the
// installation-aware probe and upsert through the same row shape as
// storeToken, with the configuration-derived evidence recorded on
// the probe record beside the caller's provenance.
export async function storeInstallationToken({ db, token, teamId, installationId,
  integrationId, userId = null, env = process.env, fetchImpl, baseUrl, probeExtra = {} }) {
  if (!db?.upsertVercelAccount) throw new TypeError('Durable account storage is required');
  const result = await probeInstallationToken({ token, teamId, installationId,
    integrationId, userId, fetchImpl, baseUrl });
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
        grantedScopes: result.installation.grantedScopes,
        projectSelection: result.installation.projectSelection,
        configurationStatus: result.installation.configurationStatus,
        configurationType: result.installation.configurationType,
        installerMatchesConfiguration: result.installation.installerMatchesConfiguration,
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

export async function storeToken({ db, token, teamId, projectId = null,
  allowFull = false, env = process.env, fetchImpl, baseUrl, probeExtra = {},
  expiresAt = null }) {
  if (!db?.upsertVercelAccount) throw new TypeError('Durable account storage is required');
  const result = await probeToken({ token, teamId, projectId, allowFull, fetchImpl, baseUrl });
  const id = result.projectId ? result.teamId + '/' + result.projectId : result.teamId;
  const tokenEnc = encryptSecret(token, 'token:' + id, env);
  try {
    await db.upsertVercelAccount({
      id, teamId: result.teamId, teamSlug: result.teamSlug, label: result.teamName,
      scope: result.scope, projectId: result.projectId, projectName: result.projectName,
      tokenEnc, tokenLast4: token.slice(-4), expiresAt,
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
    expiry: expiresAt, last4: token.slice(-4) };
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
// AUD-AI (recheck conviction): when a recheck refuses, one
// best-effort change_log row journals a redacted fingerprint — the
// AUD-M2 grammar applied to the recheck. Verdict fields first (leg,
// provider status, provider code class) so the recent-changes
// read's 160-char bound can never truncate the conviction away;
// route and stored scope are in-repo enums. Never values: no token
// material, no team/project IDs, no provider message. The journal
// is best-effort by construction — a failing journal write never
// changes the recheck's outcome; the original error propagates.
const RECHECK_LEG_SHAPE = /^[a-z][a-z_]{0,29}$/;
const RECHECK_CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
export function recheckRefusalSummary({ err, phase = 'probe', route = 'user',
  storedScope = null } = {}) {
  const leg = typeof err?.probeLeg === 'string' && RECHECK_LEG_SHAPE.test(err.probeLeg) ?
    err.probeLeg : phase;
  const status = Number.isInteger(err?.status) && err.status >= 100 && err.status <= 599 ?
    String(err.status) : 'absent';
  const code = typeof err?.code === 'string' && RECHECK_CODE_SHAPE.test(err.code) ?
    err.code : 'absent';
  const stored = ['team', 'project', 'full'].includes(storedScope) ? storedScope : 'absent';
  return 'SHAPE-FP recheck failed=[' + leg + ':' + status + ':' + code +
    '] route:' + route + ' stored:' + stored;
}
async function journalRecheckRefusal({ db, accountId, err, phase, route, storedScope }) {
  if (typeof db?.recordChange !== 'function') return;
  try {
    await db.recordChange({
      account: accountId, mode: 'preview', tool: 'vercel_check_token',
      summary: recheckRefusalSummary({ err, phase, route, storedScope }),
      dryRun: false, production: false
    });
  } catch { /* Journaling never changes the recheck's outcome. */ }
}

export async function recheckStoredToken({ db, accountId, env = process.env, fetchImpl, baseUrl }) {
  if (typeof accountId !== 'string' || !accountId || accountId.length > 256) {
    throw new TypeError('A selected account is required');
  }
  let phase = 'load', route = 'user', storedScope = null;
  try {
    const { token, account } = await loadToken({ db, accountId, env });
    storedScope = ['team', 'project', 'full'].includes(account?.scope) ?
      account.scope : null;
    if (account.id !== accountId || !storedScope) {
      throw new Error('Stored connection scope must be reviewed in owner setup');
    }
    phase = 'probe';
    // AUD-I S5: recheck routes by account kind — a personal seat is
    // re-proven by the user-keyed probe, never the team probe.
    const personal = account.probe?.accountKind === 'personal';
    // AUD-K: a Door-1 TEAM seat (an integration-sourced row with no
    // personal kind) is re-proven by the installation-aware probe —
    // the standard probe's teams-list leg is a call this credential
    // class cannot make, so routing it there would fail every recheck
    // with the A-1 error. The probe's identity inputs are rebuilt from
    // the stored installation id and the server's configured
    // integration client id (the operator env contract).
    const integrationTeam = !personal && account.probe?.source === 'integration';
    route = personal ? 'personal' : integrationTeam ? 'installation' : 'user';
    // AUD-AI: the recheck derives WITHOUT the enrollment consent
    // gate (allowFull: true). The credential was already
    // owner-approved for this row and the recheck persists nothing;
    // gating the derivation on the stored scope made any row whose
    // reach had grown since enrollment refuse with broad_visibility
    // instead of reporting the drift. The derived scope is returned
    // beside the stored one; enrollment paths keep their gate.
    const result = personal ?
      await probePersonalToken({ token, userId: account.id,
        allowFull: true, fetchImpl, baseUrl }) :
      integrationTeam ?
        await probeInstallationToken({ token, teamId: account.team_id,
          installationId: account.probe?.installationId,
          integrationId: typeof env?.VERCEL_INTEGRATION_CLIENT_ID === 'string' ?
            env.VERCEL_INTEGRATION_CLIENT_ID : null,
          userId: account.probe?.installerUserId ?? null, fetchImpl, baseUrl }) :
        await probeToken({
          token, teamId: account.team_id, projectId: account.project_id || null,
          allowFull: true, fetchImpl, baseUrl
        });
    return {
      checkedAt: result.checkedAt, teamId: result.teamId, teamSlug: result.teamSlug,
      projectId: result.projectId, storedScope: account.scope,
      ...(typeof result.scope === 'string' ? { derivedScope: result.scope } : {}),
      ...(personal ? { accountKind: 'personal' } : {}),
      visibleTeamCount: result.visibleTeamCount, visibleProjectCount: result.visibleProjectCount,
      access: 'read_verified', scopeVerified: false, writePermissions: 'unknown',
      expiryVerified: false, persisted: false
    };
  } catch (err) {
    await journalRecheckRefusal({ db, accountId, err, phase, route, storedScope });
    throw err;
  }
}
