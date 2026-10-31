// W-3 (BATCH-W §3 row W4): ship-to-production and emergency rollback.
// Both are guarded writes composing the release tools through the
// registry's dispatch seam (verdict C-1): each workflow plans and gates
// in before(), then dispatches exactly one step — vercel_deploy_promote
// or vercel_deploy_rollback — through that tool's own pipeline, where
// its full-profile gate, expectedCurrent proof and served-history
// rules apply. Ship's gates (READY + checks + smoke) are the design's
// W4 gates, proven from read-backs before the step is planned.
import { defineWrite, bindGuardedWrite, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { accountSpendGuard } from '../vercel/spend.js';
import { checkProtected } from './self-guard.js';
import { checkApp, loadProfiles } from './app-guard.js';

const DPL = /^dpl_[A-Za-z0-9_-]{3,120}$/;
const schema = { type: 'object', properties: {
  description: { type: 'object' },
  dryRun: { type: 'boolean' }, confirm: { type: 'boolean' },
  requestKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' }
}, required: ['description'], additionalProperties: false };

async function call(ctx, name, args) {
  const r = await ctx.dispatchTool(name, args);
  if (r?.isError) throw new Error(r.content?.[0]?.text ?? `${name} failed`);
  const raw = r?.content?.[0]?.text;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}
async function tryCall(ctx, name, args) {
  try { return await call(ctx, name, args); } catch { return null; }
}
function reasonOf(envelope, fallback) {
  if (envelope && typeof envelope === 'object' &&
    typeof envelope.reason === 'string') return envelope.reason;
  return fallback;
}
async function tryStep(ctx, name, args) {
  try { return { ok: true, value: await call(ctx, name, args) }; }
  catch (err) {
    let parsed = null;
    try { parsed = JSON.parse(String(err?.message ?? '')); } catch { /* keep null */ }
    return { ok: false, value: parsed,
      reason: reasonOf(parsed, String(err?.message ?? err).slice(0, 300)) };
  }
}
function stepKey(base, n) { return `${String(base).slice(0, 110)}-s${n}`; }

function context({ db, connection, env, fetchImpl, dispatchTool }) {
  return { db, connection, env, fetchImpl, dispatchTool, shape: compact,
    audit: (entry) => db.recordChange(entry),
    replayStore: db.requestReplayStore(),
    checkSpend: accountSpendGuard({ db, account: connection.account }),
    guardProtected: (targets) => checkProtected(targets, { db, connection, env }),
    guardApp: (targets) => checkApp(targets, { db, connection, env }) };
}

// The live deployment, proven from the alias list: complete and
// pointing at exactly one deployment (the release-common rule).
async function currentFromAliases(ctx, projectId) {
  const reply = await call(ctx, 'vercel_alias_list', { project: projectId });
  const aliases = reply?.aliases ?? [];
  if (reply?.complete !== true) {
    throw new RefusalError('The production alias list is capped or incomplete; the current deployment cannot be proven');
  }
  if (!aliases.length) {
    throw new RefusalError('The project has no production aliases; there is no live deployment to replace');
  }
  const ids = new Set(aliases.map((x) => x.deployment));
  if (ids.size !== 1) {
    throw new RefusalError('Production aliases point at more than one deployment; resolve the routing before using a release workflow');
  }
  return { current: aliases[0].deployment, aliases };
}

async function profileFor(ctx, projectId, projectName) {
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

function assertCommon(args, tool) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(schema.properties, k)) ||
    !args.description || typeof args.description !== 'object' ||
    Array.isArray(args.description) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new RefusalError(`Invalid ${tool} request`);
  }
  const a = args.description;
  if (typeof a.project !== 'string' || !a.project || a.project.length > 128 ||
    (a.outsideApp !== undefined && typeof a.outsideApp !== 'boolean') ||
    (a.reason !== undefined &&
      (typeof a.reason !== 'string' || a.reason.length > 160))) {
    throw new RefusalError(`Invalid ${tool} description`);
  }
  return a;
}

/* ---------------- vercel_workflow_ship_to_production ---------------- */

const SAFE_PATH = /^\/[a-zA-Z0-9_./~-]*$/;
function assertShipArgs(args) {
  const a = assertCommon(args, 'ship-to-production');
  if (typeof a.deployment !== 'string' || !DPL.test(a.deployment) ||
    (a.paths !== undefined && (!Array.isArray(a.paths) ||
      a.paths.length < 1 || a.paths.length > 10 ||
      a.paths.some((p) => typeof p !== 'string' || p.length > 180 ||
        !SAFE_PATH.test(p) || p.startsWith('//') ||
        p.split('/').includes('..'))))) {
    throw new RefusalError('Invalid ship description: project, deployment and optional smoke paths');
  }
  return a;
}

// W3-C1: the smoke host is the candidate's own URL from provider
// read-back; caller input supplies paths only. Status only — no body
// is read or returned; redirects are not followed (3xx passes, per
// the design's 2xx/3xx rule).
async function smoke(ctx, host, paths) {
  if (typeof ctx.fetchImpl !== 'function') {
    throw new RefusalError('Smoke fetch is unavailable on this connection; the ship gate cannot run');
  }
  const results = [];
  for (const path of paths) {
    let status = null;
    try {
      const res = await ctx.fetchImpl(`https://${host}${path}`,
        { method: 'GET', redirect: 'manual',
          signal: AbortSignal.timeout(6000) });
      status = Number.isSafeInteger(res?.status) ? res.status : null;
    } catch { status = null; }
    results.push({ path, status,
      ok: status !== null && status >= 200 && status < 400 });
  }
  return results;
}

const ship = defineWrite({
  name: 'vercel_workflow_ship_to_production',
  async before(args, ctx) {
    const a = assertShipArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    const proj = await call(ctx, 'vercel_project_get', { project: a.project });
    if (typeof proj?.id !== 'string' || typeof proj?.name !== 'string') {
      throw new RefusalError('Project could not be resolved to an exact id and name');
    }
    const { current, aliases } = await currentFromAliases(ctx, proj.id);
    if (a.deployment === current) {
      throw new RefusalError('That deployment is already live; there is nothing to ship');
    }
    const dep = await call(ctx, 'vercel_deploy_get',
      { project: proj.id, deployment: a.deployment });
    if (dep.state !== 'READY') {
      throw new RefusalError(`Deployment is ${dep.state}, not READY — only a ready deployment can ship`);
    }
    // W4 gate 2 (W3-C4, literal): every reported check concluded
    // success. Zero reported checks is allowed and disclosed.
    const runs = await call(ctx, 'vercel_check_list_runs',
      { project: proj.id, deployment: a.deployment });
    const items = runs?.items ?? [];
    const incomplete = items.filter((c) => c.status !== 'completed');
    if (incomplete.length) {
      throw new RefusalError(`Checks have not all concluded: ${incomplete.map((c) => c.name).join(', ')}`);
    }
    const notSuccess = items.filter((c) => c.conclusion !== 'success');
    if (notSuccess.length) {
      throw new RefusalError(`Checks did not all conclude success: ${notSuccess.map((c) => `${c.name} (${c.conclusion ?? 'no conclusion'})`).join(', ')} — vercel_deploy_promote remains available directly if you judge them fine`);
    }
    // W4 gate 3: smoke the candidate's own URL.
    if (typeof dep.url !== 'string' || !dep.url) {
      throw new RefusalError('The candidate deployment has no URL to smoke test');
    }
    const paths = a.paths ?? ['/'];
    const smokeResults = await smoke(ctx, dep.url, paths);
    const failed = smokeResults.filter((r) => !r.ok);
    if (failed.length) {
      throw new RefusalError(`Smoke test failed: ${failed.map((r) => `${r.path} returned ${r.status ?? 'no response'}`).join(', ')}`);
    }
    const stepArgs = { project: proj.id, deployment: a.deployment,
      expectedCurrent: current, outsideApp: true,
      ...(a.reason ? { reason: a.reason } : {}) };
    const dry = await tryStep(ctx, 'vercel_deploy_promote',
      { ...stepArgs, dryRun: true, requestKey: stepKey(args.requestKey ?? 'wfship', 1) });
    return { projectId: proj.id, projectName: proj.name,
      current, target: a.deployment, aliases: aliases.map((x) => x.domain),
      outsideApp: a.outsideApp === true,
      checks: { total: items.length, allPassed: items.length > 0 },
      smoke: smokeResults,
      step: { tool: 'vercel_deploy_promote', args: stepArgs,
        preview: dry.ok ? (dry.value?.preview ?? 'Promote the deployment')
          : `The promote step cannot run on this connection yet: ${dry.reason}` } };
  },
  async preview(_args, _ctx, before) {
    return [`Ship ${before.target} to production for ${before.projectName}, replacing live ${before.current}:`,
      `- Checks: ${before.checks.total === 0 ? 'none reported (not a pass — no checks ran)' : `all ${before.checks.total} concluded success`}.`,
      `- Smoke: ${before.smoke.map((r) => `${r.path} → ${r.status}`).join(', ')}.`,
      `- ${before.step.preview}`,
      `- The previous live deployment (${before.current}) is recorded; roll back to it with vercel_workflow_emergency_rollback.`].join('\n');
  },
  async production() {
    return { production: true, why: 'Explicit live production traffic change' };
  },
  async targets(_args, before) {
    return [{ kind: 'project', id: before.projectId, name: before.projectName,
        release: 'promote', outsideApp: before.outsideApp },
      { kind: 'deployment', id: before.current, projectId: before.projectId },
      { kind: 'deployment', id: before.target, projectId: before.projectId }];
  },
  async apply(args, ctx, before, requestKey) {
    const step = await tryStep(ctx, 'vercel_deploy_promote',
      { ...before.step.args, confirm: true, requestKey: stepKey(requestKey, 1) });
    if (!step.ok || step.value?.status !== 'applied') {
      return { projectId: before.projectId, shipped: null,
        previous: before.current,
        stoppedAt: { step: 1, tool: 'vercel_deploy_promote',
          reason: step.ok
            ? reasonOf(step.value, `Step returned status ${step.value?.status ?? 'unknown'}`)
            : step.reason } };
    }
    return { projectId: before.projectId, shipped: before.target,
      previous: before.current, stoppedAt: null };
  },
  async verify(_args, ctx, before, applied) {
    if (!applied?.shipped) return { confirmed: false,
      stoppedAt: applied?.stoppedAt ?? null };
    const reply = await tryCall(ctx, 'vercel_alias_list',
      { project: before.projectId });
    if (!reply) return { confirmed: null };
    const ids = new Set((reply.aliases ?? []).map((x) => x.deployment));
    return { confirmed: ids.size === 1 && ids.has(before.target),
      deployment: before.target };
  },
  async inverse(_args, before) {
    return { steps: [{ tool: 'vercel_deploy_promote',
        requestKey: 'derived <workflowKey>-s1',
        undo: "vercel_undo_change over that step's own change-log row" }],
      rollbackTo: before.current,
      note: `Or roll back directly: vercel_workflow_emergency_rollback to ${before.current}.` };
  },
  async publicReceipt(_args, before, applied) {
    return { project: before.projectName, projectId: before.projectId,
      shipped: applied?.shipped ?? null, previousLive: before.current,
      checks: before.checks, smoke: before.smoke,
      stoppedAt: applied?.stoppedAt ?? null };
  }
});

/* ---------------- vercel_workflow_emergency_rollback ---------------- */

function assertRollbackArgs(args) {
  const a = assertCommon(args, 'emergency rollback');
  if (a.deployment !== undefined &&
    (typeof a.deployment !== 'string' || !DPL.test(a.deployment))) {
    throw new RefusalError('Invalid rollback description: project and an optional deployment');
  }
  return a;
}

const rollback = defineWrite({
  name: 'vercel_workflow_emergency_rollback',
  async before(args, ctx) {
    const a = assertRollbackArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    const proj = await call(ctx, 'vercel_project_get', { project: a.project });
    if (typeof proj?.id !== 'string' || typeof proj?.name !== 'string') {
      throw new RefusalError('Project could not be resolved to an exact id and name');
    }
    const { current } = await currentFromAliases(ctx, proj.id);
    const profile = await profileFor(ctx, proj.id, proj.name);
    const caution = typeof profile?.rollback_caution === 'string' &&
      profile.rollback_caution ? profile.rollback_caution : null;
    // W3-C3: eligibility is proven by the rollback tool's own dry-run.
    let candidates;
    if (a.deployment) {
      if (a.deployment === current) {
        throw new RefusalError('That deployment is the live one; rolling back to it changes nothing');
      }
      candidates = [a.deployment];
    } else {
      const list = await call(ctx, 'vercel_deploy_list',
        { project: proj.id, target: 'production', state: 'READY', limit: 20 });
      candidates = (list?.deployments ?? [])
        .filter((d) => d.id !== current)
        .sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
        .map((d) => d.id).slice(0, 3);
      if (!candidates.length) {
        throw new RefusalError('No earlier READY production deployment exists to roll back to');
      }
    }
    const tried = [];
    for (const candidate of candidates) {
      const stepArgs = { project: proj.id, deployment: candidate,
        expectedCurrent: current, outsideApp: true,
        ...(a.reason ? { reason: a.reason } : {}) };
      const dry = await tryStep(ctx, 'vercel_deploy_rollback',
        { ...stepArgs, dryRun: true, requestKey: stepKey(args.requestKey ?? 'wfroll', 1) });
      if (dry.ok) {
        return { projectId: proj.id, projectName: proj.name,
          current, target: candidate, caution,
          outsideApp: a.outsideApp === true,
          step: { tool: 'vercel_deploy_rollback', args: stepArgs,
            preview: dry.value?.preview ?? 'Roll production back' },
          tried };
      }
      tried.push({ deployment: candidate, reason: dry.reason });
    }
    throw new RefusalError(`No eligible rollback target: ${tried.map((t) => `${t.deployment} — ${t.reason}`).join('; ')}`);
  },
  async preview(_args, _ctx, before) {
    const lines = [`Emergency rollback for ${before.projectName}: production moves from ${before.current} to ${before.target}.`,
      `- ${before.step.preview}`];
    if (before.caution) lines.push(`- App caution: ${before.caution}`);
    if (before.tried.length) {
      lines.push(`- Newer candidates were not eligible: ${before.tried.map((t) => t.deployment).join(', ')}.`);
    }
    lines.push('- After the rollback the workflow reads production routing and recent errors back and reports whether errors are still occurring.');
    return lines.join('\n');
  },
  async production() {
    return { production: true, why: 'Explicit live production traffic change' };
  },
  async targets(_args, before) {
    return [{ kind: 'project', id: before.projectId, name: before.projectName,
        release: 'rollback', outsideApp: before.outsideApp },
      { kind: 'deployment', id: before.current, projectId: before.projectId },
      { kind: 'deployment', id: before.target, projectId: before.projectId }];
  },
  async apply(args, ctx, before, requestKey) {
    const step = await tryStep(ctx, 'vercel_deploy_rollback',
      { ...before.step.args, confirm: true, requestKey: stepKey(requestKey, 1) });
    if (!step.ok || step.value?.status !== 'applied') {
      return { projectId: before.projectId, rolledBackTo: null,
        from: before.current, aliasesVerified: null, errorsContinue: null,
        stoppedAt: { step: 1, tool: 'vercel_deploy_rollback',
          reason: step.ok
            ? reasonOf(step.value, `Step returned status ${step.value?.status ?? 'unknown'}`)
            : step.reason } };
    }
    const appliedAt = Date.now();
    const reply = await tryCall(ctx, 'vercel_alias_list',
      { project: before.projectId });
    const aliasesVerified = reply
      ? new Set((reply.aliases ?? []).map((x) => x.deployment)).has(before.target) &&
        (reply.aliases ?? []).every((x) => x.deployment === before.target)
      : null;
    // Honest error read-back: rows still being seen after the rollback
    // moment mean errors continue; a shapeless or unreadable summary
    // reports null, never a guess.
    const summary = await tryCall(ctx, 'vercel_logs_errors_summary',
      { project: before.projectId });
    let errorsContinue = null;
    let recentErrorCodes = [];
    if (summary && Array.isArray(summary.errors) &&
      summary.providerRows !== null) {
      const recent = summary.errors.filter((e) =>
        typeof e.lastSeen === 'number' && e.lastSeen >= appliedAt);
      errorsContinue = recent.length > 0;
      recentErrorCodes = recent.map((e) => e.errorCode).filter(Boolean);
    }
    return { projectId: before.projectId, rolledBackTo: before.target,
      from: before.current, aliasesVerified, errorsContinue,
      recentErrorCodes, stoppedAt: null };
  },
  async verify(_args, ctx, before, applied) {
    if (!applied?.rolledBackTo) return { confirmed: false,
      stoppedAt: applied?.stoppedAt ?? null };
    const reply = await tryCall(ctx, 'vercel_alias_list',
      { project: before.projectId });
    if (!reply) return { confirmed: null };
    const ids = new Set((reply.aliases ?? []).map((x) => x.deployment));
    return { confirmed: ids.size === 1 && ids.has(before.target),
      deployment: before.target };
  },
  async inverse(_args, before) {
    return { steps: [{ tool: 'vercel_deploy_rollback',
        requestKey: 'derived <workflowKey>-s1',
        undo: "vercel_undo_change over that step's own change-log row" }],
      rollForwardTo: before.current,
      note: `Rolling forward again to ${before.current} uses vercel_deploy_rollback (it previously served).` };
  },
  async publicReceipt(_args, before, applied) {
    return { project: before.projectName, projectId: before.projectId,
      from: before.current, rolledBackTo: applied?.rolledBackTo ?? null,
      aliasesVerified: applied?.aliasesVerified ?? null,
      errorsContinue: applied?.errorsContinue ?? null,
      recentErrorCodes: applied?.recentErrorCodes ?? [],
      caution: before.caution,
      stoppedAt: applied?.stoppedAt ?? null,
      note: applied?.errorsContinue === true
        ? 'Errors are still occurring after the rollback — the cause may not be the deployment that was rolled back.'
        : applied?.errorsContinue === false
          ? 'No errors seen since the rollback.'
          : null };
  }
});

const bind = (spec) => bindGuardedWrite(spec, context, (result) => ({
  isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
  content: [{ type: 'text', text: JSON.stringify(result) }]
}));

export const workflowReleaseTools = {
  tools: [
    { name: 'vercel_workflow_ship_to_production', writes: true,
      guardedWrite: true, profiles: ['everyday', 'full'], area: 'workflows',
      description: 'Promote a ready preview after checks (build ok, checks passed, smoke test); records the previous live deployment for rollback.',
      inputSchema: schema, writeContract: ship.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'vercel_workflow_emergency_rollback', writes: true,
      guardedWrite: true, profiles: ['everyday', 'full'], area: 'workflows',
      description: '"The site is broken": roll production back to the last good deployment, then report what changed.',
      inputSchema: schema, writeContract: rollback.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } }
  ],
  handlers: {
    vercel_workflow_ship_to_production: bind(ship),
    vercel_workflow_emergency_rollback: bind(rollback)
  }
};
