// W-2 (BATCH-W §3): the build-diagnosis read and the deploy-and-wait
// write workflow. Both compose the area tools through the registry's
// dispatch seam (ctx.dispatchTool) — the seam vercel_call uses — per
// Batch P verdict C-1: the write workflow is itself a defineWrite whose
// single step dispatches vercel_deploy_create_from_git through that
// tool's own guarded pipeline (its profile gate, purchase policy and
// production class apply there, never re-implemented here), and the
// polling composes vercel_deploy_wait the same way.
import { defineWrite, bindGuardedWrite, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { accountSpendGuard } from '../vercel/spend.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const schema = (properties, required = []) => ({ type: 'object', properties,
  required, additionalProperties: false });
const asText = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const DPL = /^dpl_[A-Za-z0-9_-]{3,120}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/;
// W-B2: no shared time-budget helper exists; each workflow module
// carries its own small budget, checked between dispatches.
const BUDGET_MS = 45000;
function makeBudget() {
  const start = Date.now();
  return { exceeded: () => Date.now() - start > BUDGET_MS };
}

async function call(ctx, name, args) {
  const r = await ctx.dispatchTool(name, args);
  if (r?.isError) throw new Error(r.content?.[0]?.text ?? `${name} failed`);
  const raw = r?.content?.[0]?.text;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}
async function tryCall(ctx, name, args) {
  try { return await call(ctx, name, args); } catch { return null; }
}
// A dispatched write's refusal envelope carries its named reason at the
// top level (AUD-AH); surface it, never a paraphrase.
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

/* ---------------- vercel_workflow_why_did_build_fail ---------------- */

function assertDiagnosisArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !['project', 'deployment'].includes(k)) ||
    typeof args.deployment !== 'string' || !DPL.test(args.deployment) ||
    (args.project !== undefined &&
      (typeof args.project !== 'string' || !args.project)))
    throw new TypeError('Give a deployment ID (dpl_…) and optionally its project');
  return args;
}

async function resolveDeployment(ctx, args, budget) {
  if (args.project !== undefined) {
    // Deployment reads are keyed by the exact project ID; resolve a
    // name first (project_get accepts either).
    const proj = await call(ctx, 'vercel_project_get', { project: args.project });
    const dep = await call(ctx, 'vercel_deploy_get',
      { project: proj.id, deployment: args.deployment });
    return { project: proj.id, deployment: dep };
  }
  let until;
  let pages = 0;
  do {
    const page = await call(ctx, 'vercel_project_list',
      { limit: 100, ...(until ? { until } : {}) });
    pages += 1;
    for (const p of page.projects ?? []) {
      const dep = await tryCall(ctx, 'vercel_deploy_get',
        { project: p.id, deployment: args.deployment });
      if (dep) return { project: p.id, deployment: dep };
      if (budget.exceeded()) break;
    }
    until = page.next ?? null;
  } while (until && pages < 10 && !budget.exceeded());
  throw new TypeError('Deployment not found in any project on this connection; pass its project to narrow the search');
}

// W2-C3: cause and fix are keyed to the failing build step and the
// error tally only — the area tool never returns raw log text (the
// no-secrets rule), so none is invented here.
function diagnose(logs, checks) {
  const tally = logs?.tally ?? { error: 0, warning: 0, command: 0, other: 0 };
  const first = logs?.firstError ?? null;
  const failedChecks = (checks?.items ?? [])
    .filter((c) => c.conclusion === 'failure')
    .map((c) => c.name);
  if (!first && tally.error === 0) {
    return { firstError: null, failedChecks,
      likelyCause: 'The build log carries no error events: the failure left no code-level trace (an infrastructure, timeout or cancellation-class failure).',
      exactFix: 'Redeploy the same commit; if it fails again with no error events, the cause is on Vercel\'s side — check the deployment in Vercel for platform notices.',
      redeployWouldHelp: true };
  }
  const step = first?.step ?? null;
  const base = { firstError: first
      ? { step, eventIndex: first.eventIndex ?? null,
          note: 'Raw log text never leaves Vercel through this server; the unredacted error line is in the deployment\'s build log in Vercel.' }
      : null, failedChecks, redeployWouldHelp: false };
  if (step && /install/i.test(step)) {
    return { ...base,
      likelyCause: `The dependency install step ("${step}") failed — a package, lockfile or registry problem, not application code.`,
      exactFix: 'Reproduce the install locally (npm ci), fix the dependency or lockfile error it shows, push, then redeploy. A redeploy of the same commit will fail at the same step.' };
  }
  if (step && /(build|compile|command|bundle|lint|type)/i.test(step)) {
    return { ...base,
      likelyCause: `The build step ("${step}") reported the first error — the code or build configuration at this commit does not build.`,
      exactFix: 'Open the deployment in Vercel, read the first error in that step, fix it, push, then redeploy. A redeploy of the same commit will fail the same way.' };
  }
  return { ...base,
    likelyCause: step
      ? `The first build error is in step "${step}".`
      : 'The build log reports errors but names no step for the first one.',
    exactFix: 'Open the deployment in Vercel, read the first error line (raw log text is never returned through this server), fix it, push, then redeploy. A redeploy of the same commit will fail the same way.' };
}

async function whyDidBuildFail(args, ctx) {
  const a = assertDiagnosisArgs(args);
  if (typeof ctx.dispatchTool !== 'function') {
    throw new TypeError('Registry composition is unavailable');
  }
  const budget = makeBudget();
  const { project, deployment: dep } = await resolveDeployment(ctx, a, budget);
  const out = { project, deployment: { id: dep.id, url: dep.url ?? null,
    state: dep.state,
    target: dep.target === 'production' ? 'production' : 'preview',
    branch: dep.branch ?? null,
    commit: dep.commit ?? null, createdAt: dep.createdAt ?? null } };
  if (dep.state === 'READY') {
    return asText({ ...out, verdict: 'not_failed',
      summary: 'This deployment built and is READY — it did not fail.',
      redeployWouldHelp: false });
  }
  if (dep.state === 'CANCELED') {
    return asText({ ...out, verdict: 'canceled',
      summary: 'This deployment was canceled before it finished; a cancellation is not a build error.',
      redeployWouldHelp: false,
      nextStep: 'Deploy again with vercel_workflow_deploy_and_wait if the build is still wanted.' });
  }
  if (dep.state !== 'ERROR') {
    return asText({ ...out, verdict: 'not_finished',
      summary: `This deployment is ${dep.state} — it has not failed (yet).`,
      redeployWouldHelp: false,
      nextStep: 'Call vercel_deploy_wait with the same project and deployment to keep waiting.' });
  }
  const logs = await tryCall(ctx, 'vercel_deploy_get_build_logs',
    { project, deployment: dep.id });
  const checks = await tryCall(ctx, 'vercel_check_list_runs',
    { project, deployment: dep.id });
  const d = diagnose(logs, checks);
  return asText({ ...out, verdict: 'build_failed',
    buildLog: logs ? { scanned: logs.scanned, tally: logs.tally,
        complete: false,
        note: 'The build-log summary is one bounded scan; it cannot prove it saw every event.' }
      : null,
    buildLogReadable: Boolean(logs),
    checksReadable: Boolean(checks),
    ...d });
}

/* ---------------- vercel_workflow_deploy_and_wait ---------------- */

// C-9 compact advertised schema: one description object, hand-validated.
// description: {project*, branch*, sha?, target?, outsideApp?}
const deploySchema = { type: 'object', properties: {
  description: { type: 'object' },
  dryRun: { type: 'boolean' }, confirm: { type: 'boolean' },
  requestKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' }
}, required: ['description'], additionalProperties: false };

function assertDeployArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(deploySchema.properties, k)) ||
    !args.description || typeof args.description !== 'object' ||
    Array.isArray(args.description) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new RefusalError('Invalid deploy-and-wait request');
  }
  const a = args.description;
  if (typeof a.project !== 'string' || !a.project || a.project.length > 128 ||
    typeof a.branch !== 'string' || !REF.test(a.branch) ||
    a.branch.includes('..') ||
    a.branch.split('/').some((x) => x === '' || x === '.') ||
    (a.sha !== undefined && (typeof a.sha !== 'string' || !SHA40.test(a.sha))) ||
    (a.target !== undefined && !['preview', 'production'].includes(a.target)) ||
    (a.outsideApp !== undefined && typeof a.outsideApp !== 'boolean')) {
    throw new RefusalError('Invalid deploy-and-wait description: project, branch, an optional full 40-character sha, target and outsideApp');
  }
  return a;
}

function context({ db, connection, env, fetchImpl, dispatchTool }) {
  return { db, connection, env, fetchImpl, dispatchTool, shape: compact,
    audit: (entry) => db.recordChange(entry),
    replayStore: db.requestReplayStore(),
    checkSpend: accountSpendGuard({ db, account: connection.account }),
    guardProtected: (targets) => checkProtected(targets, { db, connection, env }),
    guardApp: (targets) => checkApp(targets, { db, connection, env }) };
}

const deployAndWait = defineWrite({
  // W2-C1: no spend() of its own — the catalog row's Safety mark is Cp
  // with no $ (check-writes enforces the match). The metered build
  // spend is the create step's; its purchase policy runs inside its own
  // dispatched pipeline.
  name: 'vercel_workflow_deploy_and_wait',
  async before(args, ctx) {
    const a = assertDeployArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    const proj = await call(ctx, 'vercel_project_get', { project: a.project });
    if (typeof proj?.id !== 'string' || typeof proj?.name !== 'string') {
      throw new RefusalError('Project could not be resolved to an exact id and name');
    }
    const target = a.target ?? 'preview';
    let sha = a.sha ?? null;
    let shaSource = sha ? 'given' : null;
    if (!sha) {
      const list = await call(ctx, 'vercel_deploy_list',
        { project: proj.id, branch: a.branch, limit: 5 });
      const rows = (list?.deployments ?? [])
        .filter((d) => typeof d.commit === 'string' && SHA40.test(d.commit));
      if (!rows.length) {
        throw new RefusalError(`No deployment on branch ${a.branch} to take the exact commit from; pass sha (the full 40-character commit) in the description`);
      }
      sha = rows[0].commit;
      shaSource = 'branch_latest';
    }
    const stepArgs = { project: proj.id, expectedName: proj.name,
      gitRef: a.branch, gitSha: sha, target, outsideApp: true };
    const dry = await tryStep(ctx, 'vercel_deploy_create_from_git',
      { ...stepArgs, dryRun: true,
        requestKey: stepKey(args.requestKey ?? 'wfdeploy', 1) });
    return { projectId: proj.id, projectName: proj.name, branch: a.branch,
      sha, shaSource, target, outsideApp: a.outsideApp === true,
      step: { tool: 'vercel_deploy_create_from_git', args: stepArgs,
        preview: dry.ok ? (dry.value?.preview ?? 'Create the deployment')
          : `The create step cannot run on this connection yet: ${dry.reason}` },
      stepRunnable: dry.ok };
  },
  async preview(_args, _ctx, before) {
    return [`Deploy ${before.target} from branch ${before.branch} at commit ${before.sha} (${before.shaSource === 'given' ? 'as given' : 'the newest deployment on the branch'}) and wait for it:`,
      `- ${before.step.preview}`,
      '- Then poll the new deployment until it is READY, ERROR or CANCELED, and report its URL and check runs.'].join('\n');
  },
  async production(_args, _ctx, before) {
    return { production: before.target === 'production',
      why: before.target === 'production'
        ? 'The caller explicitly asked for a production deployment'
        : 'Preview deployment unless production is explicitly asked' };
  },
  async targets(_args, before) {
    return [{ kind: 'project', id: before.projectId, name: before.projectName,
      deployTarget: before.target, outsideApp: before.outsideApp }];
  },
  async apply(args, ctx, before, requestKey) {
    const budget = makeBudget();
    const step = await tryStep(ctx, 'vercel_deploy_create_from_git',
      { ...before.step.args, confirm: true,
        requestKey: stepKey(requestKey, 1) });
    if (!step.ok || step.value?.status !== 'applied') {
      return { projectId: before.projectId, deployment: null, polls: 0,
        done: false, stoppedAt: { step: 1,
          tool: 'vercel_deploy_create_from_git',
          reason: step.ok
            ? reasonOf(step.value, `Step returned status ${step.value?.status ?? 'unknown'}`)
            : step.reason } };
    }
    // Read the created deployment back from the branch list (the P-3
    // create-then-read-back pattern): newest row at the exact commit.
    let deployment = null;
    for (let attempt = 0; attempt < 3 && !deployment && !budget.exceeded();
      attempt += 1) {
      const list = await tryCall(ctx, 'vercel_deploy_list',
        { project: before.projectId, branch: before.branch, limit: 5 });
      const rows = (list?.deployments ?? [])
        .filter((d) => d.commit === before.sha);
      if (rows.length) deployment = rows[0];
      else if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!deployment) {
      return { projectId: before.projectId, deployment: null, polls: 0,
        done: false, stoppedAt: null,
        note: 'The deployment was created but is not visible in the deployment list yet; find it with vercel_deploy_list and wait on it with vercel_deploy_wait.' };
    }
    let state = deployment.state;
    let polls = 0;
    let done = ['READY', 'ERROR', 'CANCELED'].includes(state);
    // Real deploy_wait dispatches pace themselves (each waits up to 8s
    // server-side), so the 45s budget normally binds first; the poll
    // cap is a safety valve so the loop can never spin unbounded.
    const MAX_POLLS = 12;
    while (!done && polls < MAX_POLLS && !budget.exceeded()) {
      const wait = await tryCall(ctx, 'vercel_deploy_wait',
        { project: before.projectId, deployment: deployment.id, waitSeconds: 8 });
      if (!wait) break;
      polls += 1;
      state = wait.state ?? state;
      done = wait.done === true;
    }
    let checks = null;
    if (done && state === 'READY') {
      const runs = await tryCall(ctx, 'vercel_check_list_runs',
        { project: before.projectId, deployment: deployment.id });
      if (runs) {
        const items = runs.items ?? [];
        checks = { total: items.length,
          failed: items.filter((c) => c.conclusion === 'failure').map((c) => c.name),
          allConcluded: items.every((c) => c.status === 'completed'),
          allPassed: items.every((c) => c.conclusion === 'success') };
      }
    }
    const full = await tryCall(ctx, 'vercel_deploy_get',
      { project: before.projectId, deployment: deployment.id });
    return { projectId: before.projectId,
      deployment: { id: deployment.id,
        url: full?.url ?? deployment.url ?? null,
        state, target: before.target, branch: before.branch,
        commit: before.sha },
      polls, done, checks, stoppedAt: null };
  },
  async verify(_args, ctx, before, applied) {
    if (!applied?.deployment) return { confirmed: false,
      stoppedAt: applied?.stoppedAt ?? null };
    const dep = await tryCall(ctx, 'vercel_deploy_get',
      { project: before.projectId, deployment: applied.deployment.id });
    return { confirmed: Boolean(dep) && dep.id === applied.deployment.id,
      deployment: applied.deployment.id, state: dep?.state ?? null };
  },
  async inverse(_args, before, applied) {
    return { steps: [{ tool: 'vercel_deploy_create_from_git',
        requestKey: 'derived <workflowKey>-s1',
        undo: "vercel_undo_change over that step's own change-log row" }],
      deployment: applied?.deployment?.id ?? null,
      note: 'Or remove the deployment with vercel_deployment_delete.' };
  },
  async publicReceipt(_args, before, applied) {
    const d = applied?.deployment ?? null;
    return { project: before.projectName, projectId: before.projectId,
      branch: before.branch, target: before.target,
      deployment: d, done: applied?.done === true,
      successful: d?.state === 'READY',
      polls: applied?.polls ?? 0, checks: applied?.checks ?? null,
      stoppedAt: applied?.stoppedAt ?? null,
      note: applied?.note ?? null,
      nextStep: applied?.stoppedAt || !d ? null
        : applied?.done ? null
        : `Still ${d.state}: call vercel_deploy_wait with project ${before.projectId} and deployment ${d.id} to keep waiting — do not re-run this workflow; it would create another deployment.` };
  }
});

export const workflowDeployTools = {
  tools: [
    { name: 'vercel_workflow_why_did_build_fail', writes: false,
      profiles: PROFILES, area: 'workflows',
      description: 'Diagnose a failed build: first error, likely cause, exact fix, and whether a redeploy would help.',
      inputSchema: schema({ project: { type: 'string', maxLength: 128 },
        deployment: { type: 'string', minLength: 7, maxLength: 128 } },
        ['deployment']),
      annotations: { readOnlyHint: true } },
    { name: 'vercel_workflow_deploy_and_wait', writes: true,
      guardedWrite: true, profiles: ['everyday', 'full'], area: 'workflows',
      description: 'Deploy a branch (preview unless production asked) and report when ready, with URL and checks.',
      inputSchema: deploySchema, writeContract: deployAndWait.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } }
  ],
  handlers: {
    vercel_workflow_why_did_build_fail: whyDidBuildFail,
    vercel_workflow_deploy_and_wait: bindGuardedWrite(deployAndWait, context,
      (result) => ({
        isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
        content: [{ type: 'text', text: JSON.stringify(result) }]
      }))
  }
};
