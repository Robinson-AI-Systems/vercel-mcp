// W-1 (BATCH-W): the read workflows — vercel_workflow_project_health,
// vercel_workflow_release_status, vercel_workflow_find. Each composes the
// area tools through the registry only (design W1; Batch P dossier R-1):
// no provider calls of its own. A section that cannot be read reports
// not_readable with the reason — a failed read is never dressed as ok
// (the O-5 composition-honesty pattern). The 45-second budget (design
// W2) is a small local helper (dossier verdict W-B2: no shared helper
// exists); when it trips, the workflow returns what is done plus the
// exact call to continue.
import { loadProfiles } from './app-guard.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const BUDGET_MS = 45000;
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

async function call(ctx, name, args) {
  const r = await ctx.dispatchTool(name, args);
  if (r?.isError) {
    throw new Error(r.content?.[0]?.text ?? `${name} failed`);
  }
  const raw = r?.content?.[0]?.text;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}
async function tryCall(ctx, name, args) {
  try { return await call(ctx, name, args); } catch { return null; }
}
function makeBudget() {
  const start = Date.now();
  return { exceeded: () => Date.now() - start > BUDGET_MS };
}
function assertProjectArg(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => k !== 'project') ||
    typeof args.project !== 'string' || !args.project ||
    args.project.length > 128) {
    throw new TypeError('Give exactly one project (ID or name)');
  }
  return args.project;
}
// The stored profile owning this project, or null. loadProfiles already
// returns active profile objects and [] on any failure (the projects.js
// appMarks pattern): profile data that cannot be loaded never blocks a
// read workflow — it judges nothing against an expectation it could
// not read.
async function profileForProject(ctx, projectId, projectName) {
  try {
    const profiles = await loadProfiles(ctx.db, ctx.connection?.account);
    const wanted = String(projectName ?? '').toLowerCase();
    return profiles.find((p) =>
      (Array.isArray(p?.projects) &&
        p.projects.some((n) => String(n).toLowerCase() === wanted)) ||
      (Array.isArray(p?.project_ids) && p.project_ids.includes(projectId))
    ) ?? null;
  } catch { return null; }
}
const briefDeployment = (d) => ({
  id: d?.id ?? null, url: d?.url ?? null, state: d?.state ?? null,
  target: d?.target ?? null, branch: d?.branch ?? null,
  commit: typeof d?.commit === 'string' ? d.commit.slice(0, 7) : null,
  createdAt: d?.createdAt ?? null
});

// ---------------------------------------------------------------- health
async function projectHealth(args, ctx) {
  const projectArg = assertProjectArg(args);
  const budget = makeBudget();
  const proj = await call(ctx, 'vercel_project_get', { project: projectArg });
  if (!proj?.id) throw new TypeError('Project could not be read');
  const projectId = proj.id;
  const projectName = proj.name ?? projectArg;
  const profile = await profileForProject(ctx, projectId, projectName);
  const sections = {};
  const section = (name, build) => {
    if (budget.exceeded() && Object.keys(sections).length) {
      sections[name] = { status: 'not_readable',
        reason: 'Time budget exceeded before this section ran' };
      return;
    }
    sections[name] = build;
  };

  const prod = await tryCall(ctx, 'vercel_deploy_list',
    { project: projectId, target: 'production', limit: 10 });
  if (!prod) {
    section('live', { status: 'not_readable',
      reason: 'Production deployments could not be listed' });
  } else {
    const deployments = Array.isArray(prod.deployments) ? prod.deployments : [];
    const live = deployments.find((d) => d.state === 'READY') ?? null;
    if (live) {
      section('live', { status: 'ok', deployment: briefDeployment(live) });
    } else if (deployments.length) {
      section('live', { status: 'needs_attention',
        detail: `No production deployment is READY; the newest is ${deployments[0].state ?? 'in an unknown state'}`,
        newest: briefDeployment(deployments[0]) });
    } else {
      section('live', { status: 'needs_attention',
        detail: 'This project has no production deployments yet' });
    }
  }

  const failed = await tryCall(ctx, 'vercel_deploy_list',
    { project: projectId, state: 'ERROR', limit: 10 });
  if (!failed) {
    section('failedBuilds', { status: 'not_readable',
      reason: 'Failed builds could not be listed' });
  } else {
    const list = Array.isArray(failed.deployments) ? failed.deployments : [];
    section('failedBuilds', list.length
      ? { status: 'needs_attention',
          count: list.length, complete: failed.complete !== false,
          recent: list.slice(0, 3).map(briefDeployment),
          detail: failed.complete === false
            ? `At least ${list.length} failed builds lately`
            : `${list.length} failed build(s) in the latest page` }
      : { status: 'ok', count: 0 });
  }

  const errors = await tryCall(ctx, 'vercel_logs_errors_summary',
    { project: projectId, limit: 5, windowMinutes: 1440 });
  if (!errors || (errors.providerRows === null && errors.shapeNote)) {
    section('topErrors', { status: 'not_readable',
      reason: errors?.shapeNote ?? 'Error summary could not be read' });
  } else {
    const rows = Array.isArray(errors.errors) ? errors.errors : [];
    section('topErrors', rows.length
      ? { status: 'needs_attention', windowMinutes: 1440,
          errors: rows.map((r) => ({
            error: r.errorCode ?? r.message ?? 'Unknown error',
            count: r.count ?? null, lastSeen: r.lastSeen ?? null })) }
      : { status: 'ok', windowMinutes: 1440, errors: [] });
  }

  const domainRows = await tryCall(ctx, 'vercel_domain_list_project_domains',
    { project: projectId });
  const certRows = await tryCall(ctx, 'vercel_cert_list', {});
  if (!domainRows || !certRows) {
    section('domains', { status: 'not_readable',
      reason: 'Project domains or certificates could not be listed' });
  } else {
    const certs = Array.isArray(certRows.certificates) ? certRows.certificates : [];
    const now = Date.now();
    const covers = (cert, name) => {
      const cns = Array.isArray(cert.cns) ? cert.cns
        : typeof cert.cn === 'string' ? [cert.cn] : [];
      return cns.some((cn) => cn === name ||
        (cn.startsWith('*.') && name.endsWith(cn.slice(1)) &&
          name.split('.').length === cn.split('.').length));
    };
    const domains = (Array.isArray(domainRows.domains) ? domainRows.domains : [])
      .map((d) => {
        const cert = certs.find((c) => covers(c, d.name)) ?? null;
        const expiresAt = cert?.expiresAt ?? cert?.validTo ?? null;
        const days = Number.isSafeInteger(expiresAt)
          ? Math.floor((expiresAt - now) / 86400000) : null;
        const issues = [];
        if (d.verified === false) issues.push('domain not verified');
        if (!cert) issues.push('no certificate covers this domain');
        if (days !== null && days < 0) issues.push('certificate has expired');
        else if (days !== null && days <= 30) {
          issues.push(`certificate expires in ${days} day(s)`);
        }
        return { name: d.name, verified: d.verified ?? null,
          certificate: cert ? { id: cert.id ?? null, expiresAt, daysLeft: days }
            : null, issues };
      });
    const bad = domains.filter((d) => d.issues.length);
    section('domains', { status: bad.length ? 'needs_attention' : 'ok',
      domains, complete: domainRows.complete !== false });
  }

  const env = await tryCall(ctx, 'vercel_env_list', { project: projectId });
  if (!env) {
    section('variables', { status: 'not_readable',
      reason: 'Environment variables could not be listed' });
  } else {
    const items = Array.isArray(env.items) ? env.items : [];
    const byTarget = { production: 0, preview: 0, development: 0 };
    const namesFor = { production: new Set(), preview: new Set(), development: new Set() };
    for (const item of items) {
      for (const t of Array.isArray(item.targets) ? item.targets : []) {
        if (namesFor[t]) { namesFor[t].add(item.key); byTarget[t]++; }
      }
    }
    const expected = profile?.expected_env;
    if (expected && typeof expected === 'object') {
      const missing = {};
      for (const t of Object.keys(byTarget)) {
        const want = Array.isArray(expected[t]) ? expected[t] : [];
        const miss = want.filter((k) => !namesFor[t].has(k));
        if (miss.length) missing[t] = miss;
      }
      section('variables', { status: Object.keys(missing).length
          ? 'needs_attention' : 'ok',
        judgedAgainst: `profile ${profile.id ?? 'app'} expectations`,
        byTarget, missing });
    } else {
      section('variables', { status: 'ok', byTarget,
        total: new Set(items.map((i) => i.key)).size,
        capped: env.capped === true,
        note: 'No profile expectation for this project — inventory only, nothing judged missing' });
    }
  }

  const crons = await tryCall(ctx, 'vercel_cron_list', { project: projectId });
  if (!crons) {
    section('crons', { status: 'not_readable',
      reason: 'Cron jobs could not be read' });
  } else if (crons.available === false) {
    section('crons', { status: 'not_readable',
      reason: crons.reason ?? 'Cron definitions are unavailable' });
  } else {
    const jobs = Array.isArray(crons.jobs) ? crons.jobs : [];
    section('crons', { status: 'ok', count: crons.count ?? jobs.length,
      jobs: jobs.slice(0, 20).map((j) => ({
        path: j.path ?? null, schedule: j.schedule ?? null })) });
  }

  const protection = await tryCall(ctx, 'vercel_protection_get',
    { project: projectId });
  if (!protection) {
    section('protection', { status: 'not_readable',
      reason: 'Deployment protection could not be read' });
  } else {
    const auth = protection.vercelAuthentication ?? {};
    section('protection', {
      status: auth.enabled ? 'ok' : 'needs_attention',
      vercelAuthentication: { enabled: auth.enabled ?? null,
        deploymentType: auth.deploymentType ?? null },
      passwordProtection: {
        enabled: protection.passwordProtection?.enabled ?? null },
      detail: auth.enabled ? undefined
        : 'Vercel Authentication is off: anyone with a deployment URL can open it' });
  }

  const counts = { ok: 0, needsAttention: 0, notReadable: 0 };
  for (const s of Object.values(sections)) {
    if (s.status === 'ok') counts.ok++;
    else if (s.status === 'needs_attention') counts.needsAttention++;
    else counts.notReadable++;
  }
  return text({
    project: { id: projectId, name: projectName,
      app: proj.app ?? profile?.id ?? null,
      framework: proj.framework ?? null },
    sections, summary: counts,
    note: 'Composed from the area read tools. A section marked not_readable could not be read and is never reported as ok.'
  });
}

// ---------------------------------------------------------- release status
async function releaseStatus(args, ctx) {
  const projectArg = assertProjectArg(args);
  const proj = await call(ctx, 'vercel_project_get', { project: projectArg });
  if (!proj?.id) throw new TypeError('Project could not be read');
  const projectId = proj.id;

  const prod = await tryCall(ctx, 'vercel_deploy_list',
    { project: projectId, target: 'production', limit: 20 });
  const live = prod?.deployments?.find((d) => d.state === 'READY') ?? null;
  const branch = proj.git?.productionBranch ?? proj.productionBranch ??
    live?.branch ?? null;

  let waiting = null;
  if (branch) {
    const rows = await tryCall(ctx, 'vercel_deploy_list',
      { project: projectId, branch, limit: 20 });
    if (rows) {
      waiting = (Array.isArray(rows.deployments) ? rows.deployments : [])
        .filter((d) => d.id !== live?.id &&
          (!live || (d.createdAt ?? 0) > (live.createdAt ?? 0)))
        .map((d) => ({ ...briefDeployment(d),
          readyToPromote: d.state === 'READY' }));
    }
  }
  const previews = await tryCall(ctx, 'vercel_deploy_list',
    { project: projectId, target: 'preview', state: 'READY', limit: 10 });
  const rolling = await tryCall(ctx, 'vercel_rolling_get',
    { project: projectId });

  return text({
    project: { id: projectId, name: proj.name ?? projectArg,
      app: proj.app ?? null },
    productionBranch: branch,
    live: live ? briefDeployment(live) : null,
    liveNote: live ? undefined
      : 'No READY production deployment was found in the latest page',
    waitingOnBranch: waiting,
    waitingNote: branch ? undefined
      : 'The production branch is unknown, so waiting builds cannot be listed',
    readyPreviews: previews
      ? (Array.isArray(previews.deployments) ? previews.deployments : [])
          .map(briefDeployment)
      : null,
    rollingRelease: rolling
      ? { active: rolling.active ?? null, config: rolling.config ?? null }
      : null,
    notReadable: [
      prod ? null : 'production deployments',
      previews ? null : 'ready previews',
      rolling ? null : 'rolling release'
    ].filter(Boolean),
    note: 'Live is the newest READY production deployment. Waiting builds are newer deployments of the production branch that are not live yet.'
  });
}

// ------------------------------------------------------------------- find
const HEX = /^[0-9a-fA-F]{7,40}$/;
const DOMAIN_SHAPED = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const ENV_KEY = /^[A-Z][A-Z0-9_]{2,127}$/;

async function* projectPages(ctx, budget, tracker) {
  let until;
  let pages = 0;
  do {
    const page = await tryCall(ctx, 'vercel_project_list',
      { limit: 100, ...(until ? { until } : {}) });
    if (!page) { tracker.complete = false; return; }
    for (const p of Array.isArray(page.projects) ? page.projects : []) yield p;
    until = page.next ?? null;
    pages++;
  } while (until && pages < 10 && !budget.exceeded());
  if (until) tracker.complete = false;
}

async function find(args, ctx) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => k !== 'query') ||
    typeof args.query !== 'string' || !args.query.trim() ||
    args.query.trim().length > 253) {
    throw new TypeError('Give one thing to find: a URL, deployment ID, domain, commit, branch, env key or project name');
  }
  const q = args.query.trim();
  const budget = makeBudget();
  const searched = { projects: 0, complete: true };

  const done = (kind, match, extra = {}) => text({
    query: q, kind, found: true, match, searched, ...extra });
  const miss = (kind, nextStep) => text({
    query: q, kind, found: false, match: null, searched, nextStep });

  // Direct, project-free resolutions first.
  if (/^https?:\/\//i.test(q)) {
    let host = null;
    try { host = new URL(q).hostname; } catch { /* fall through */ }
    if (host) {
      const domain = await tryCall(ctx, 'vercel_domain_get', { domain: host });
      if (domain) return done('domain', { domain });
      for await (const p of projectPages(ctx, budget, searched)) {
        searched.projects++;
        const dep = await tryCall(ctx, 'vercel_deploy_get',
          { project: p.id, deployment: host });
        if (dep) {
          return done('deployment', { project: { id: p.id, name: p.name },
            deployment: dep });
        }
        if (budget.exceeded()) { searched.complete = false; break; }
      }
      return miss('url', searched.complete
        ? 'No domain or deployment on this team answers to that address'
        : 'The search ran out of time; retry, or call vercel_deploy_get with the project and the hostname');
    }
  }
  if (q.startsWith('prj_') || !q.includes('.') && !q.includes('/') &&
    !HEX.test(q) && !ENV_KEY.test(q)) {
    const project = await tryCall(ctx, 'vercel_project_get', { project: q });
    if (project) {
      return done('project', { project: {
        id: project.id, name: project.name, framework: project.framework ?? null,
        productionUrl: project.productionUrl ?? null,
        productionBranch: project.git?.productionBranch ??
          project.productionBranch ?? null,
        app: project.app ?? null } });
    }
    if (q.startsWith('prj_')) {
      return miss('project', 'No project with that ID is readable on this team');
    }
  }
  if (DOMAIN_SHAPED.test(q) && /\.[a-z]{2,}$/i.test(q)) {
    const domain = await tryCall(ctx, 'vercel_domain_get', { domain: q });
    if (domain) return done('domain', { domain });
    return miss('domain', 'No team domain by that name is readable; check the spelling or the team on this connection');
  }
  if (q.startsWith('dpl_')) {
    for await (const p of projectPages(ctx, budget, searched)) {
      searched.projects++;
      const dep = await tryCall(ctx, 'vercel_deploy_get',
        { project: p.id, deployment: q });
      if (dep) {
        return done('deployment', { project: { id: p.id, name: p.name },
          deployment: dep });
      }
      if (budget.exceeded()) { searched.complete = false; break; }
    }
    return miss('deployment', searched.complete
      ? 'No project on this team holds that deployment'
      : 'The search ran out of time; call vercel_deploy_get with the project ID and this deployment ID');
  }
  if (HEX.test(q)) {
    for await (const p of projectPages(ctx, budget, searched)) {
      searched.projects++;
      const rows = await tryCall(ctx, 'vercel_deploy_list',
        { project: p.id, sha: q, limit: 5 });
      if (rows?.deployments?.length) {
        return done('commit', { project: { id: p.id, name: p.name },
          deployments: rows.deployments.map(briefDeployment) });
      }
      if (budget.exceeded()) { searched.complete = false; break; }
    }
    if (!searched.complete) {
      return miss('commit', 'The search ran out of time; call vercel_deploy_list with the project ID and this sha');
    }
    // An all-caps hex-looking string can still be an env key; fall through.
    if (!ENV_KEY.test(q)) {
      return miss('commit', 'No deployment on this team was built from that commit');
    }
  }
  if (ENV_KEY.test(q)) {
    const matches = [];
    for await (const p of projectPages(ctx, budget, searched)) {
      searched.projects++;
      const env = await tryCall(ctx, 'vercel_env_list', { project: p.id });
      const hit = (Array.isArray(env?.items) ? env.items : [])
        .filter((i) => i.key === q);
      for (const item of hit) {
        matches.push({ project: { id: p.id, name: p.name },
          key: item.key, targets: item.targets ?? [], kind: item.kind ?? null });
      }
      if (matches.length >= 10 || budget.exceeded()) {
        // Stopped early either way: more matches may exist unsearched.
        searched.complete = false;
        break;
      }
    }
    if (matches.length) return done('env_key', { variables: matches });
    return miss('env_key', searched.complete
      ? 'No project on this team has a variable with that name'
      : 'The search ran out of time; call vercel_env_list on the project you expect');
  }
  // Branch names and anything else: deployment search by branch, then a
  // last project-name attempt.
  for await (const p of projectPages(ctx, budget, searched)) {
    searched.projects++;
    const rows = await tryCall(ctx, 'vercel_deploy_list',
      { project: p.id, branch: q, limit: 5 });
    if (rows?.deployments?.length) {
      return done('branch', { project: { id: p.id, name: p.name },
        deployments: rows.deployments.map(briefDeployment) });
    }
    if (budget.exceeded()) { searched.complete = false; break; }
  }
  return miss('unknown', searched.complete
    ? ' Nothing on this team matched; try the exact project name, a dpl_ deployment ID, a domain, or a commit SHA'
    : 'The search ran out of time; narrow it with the exact project name or ID');
}

const projectArg = { type: 'object', additionalProperties: false,
  properties: { project: { type: 'string', minLength: 1, maxLength: 128 } },
  required: ['project'] };

export const workflowReadTools = {
  tools: [
    { name: 'vercel_workflow_project_health', writes: false, area: 'workflows',
      profiles: PROFILES,
      description: 'One project\'s health in one answer: live deployment, failed builds, top errors, domains and certificates, variables, crons, protection.',
      inputSchema: projectArg, annotations: { readOnlyHint: true } },
    { name: 'vercel_workflow_release_status', writes: false, area: 'workflows',
      profiles: PROFILES,
      description: 'What is live and what is waiting: the current production deployment, newer production-branch builds, ready previews, active rolling release.',
      inputSchema: projectArg, annotations: { readOnlyHint: true } },
    { name: 'vercel_workflow_find', writes: false, area: 'workflows',
      profiles: PROFILES,
      description: 'One search box for a URL, deployment ID, domain, commit, branch, env key or project name: says what it is and where it lives.',
      inputSchema: { type: 'object', additionalProperties: false,
        properties: { query: { type: 'string', minLength: 1, maxLength: 253 } },
        required: ['query'] },
      annotations: { readOnlyHint: true } }
  ],
  handlers: {
    vercel_workflow_project_health: projectHealth,
    vercel_workflow_release_status: releaseStatus,
    vercel_workflow_find: find
  }
};
