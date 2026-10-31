// P-3 (BATCH-P §P5): vercel_workflow_project_setup — set up Vercel for a
// NEW project from a short description, composing the area tools through
// the registry (card verdicts C-1..C-7). The workflow is itself a guarded
// write; every step executes only by dispatching the owning tool, so each
// step's own guards, classification and purchase policy apply inside its
// own pipeline. before() reads live state through the registry and plans
// only what is missing, which is what makes the setup idempotent: a
// second run plans zero steps and creates nothing. It ends by storing a
// draft profile row (its own local write) and returning the APP-NEEDS
// text — returned, never committed anywhere else.
import { defineWrite, bindGuardedWrite, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { accountSpendGuard } from '../vercel/spend.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';
import { profileFromFindings, appNeedsText } from './profile-draft.js';

const NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const TARGETS = ['production', 'preview', 'development'];
const CONFIG_FIELDS = ['framework', 'buildCommand', 'installCommand',
  'devCommand', 'outputDirectory', 'rootDirectory',
  'commandForIgnoringBuildStep'];
// The advertised schema is deliberately compact: the workflow takes one
// description object (the readiness tool's inline-spec precedent), whose
// fields are validated by hand in assertArgs below. A 25-field inline
// schema would by itself break the OP-1 front-door budget — compound
// workflow tools join the front door by rule, so their advertised shape
// stays small and the contract lives in the validator + the card.
const schema = { type: 'object', properties: {
  description: { type: 'object' },
  dryRun: { type: 'boolean' }, confirm: { type: 'boolean' },
  requestKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' }
}, required: ['description'], additionalProperties: false };
// The description object's own fields (validated in assertArgs):
// name*, appId?, framework? + build/install/dev/output/root commands,
// commandForIgnoringBuildStep?, gitRepository? {type, repo, namespaceId},
// nodeVersion?, productionBranch?, releaseRule?, rollbackCaution?,
// customEnvironments? [{name, branch, description?, copyFrom?}],
// env? [{key, targets, kind?, generate?}], domains?, protection?
// {vercelAuth, deploymentType?}, noPreviewBranches?, crons?
// [{path, schedule}], costTargetCents?.

function assertArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(schema.properties, k)) ||
    !args.description || typeof args.description !== 'object' ||
    Array.isArray(args.description) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new RefusalError('Invalid project setup request');
  }
  const a = args.description;
  if (typeof a.name !== 'string' || !NAME.test(a.name) ||
    (a.appId !== undefined && !ID.test(a.appId)) ||
    (a.releaseRule !== undefined &&
      !['promote', 'branch'].includes(a.releaseRule)) ||
    (a.costTargetCents !== undefined &&
      (!Number.isSafeInteger(a.costTargetCents) || a.costTargetCents < 0)) ||
    (a.env !== undefined && (!Array.isArray(a.env) || a.env.some((e) =>
      !e || typeof e !== 'object' || !KEY.test(e.key ?? '') ||
      !Array.isArray(e.targets) || !e.targets.length ||
      e.targets.some((t) => !TARGETS.includes(t)) ||
      (e.kind !== undefined && !['Secret', 'Config'].includes(e.kind)) ||
      (e.generate !== undefined && typeof e.generate !== 'boolean')))) ||
    (a.domains !== undefined && (!Array.isArray(a.domains) ||
      a.domains.some((d) => typeof d !== 'string' || !DOMAIN.test(d)))) ||
    (a.customEnvironments !== undefined &&
      (!Array.isArray(a.customEnvironments) || a.customEnvironments.some((e) =>
        !e || typeof e.name !== 'string' || !e.name ||
        typeof e.branch !== 'string' || !e.branch))) ||
    (a.protection !== undefined &&
      (!a.protection || typeof a.protection !== 'object' ||
        typeof a.protection.vercelAuth !== 'boolean'))) {
    throw new RefusalError('Invalid project setup description');
  }
  for (const f of CONFIG_FIELDS) {
    if (a[f] !== undefined &&
      (typeof a[f] !== 'string' || !a[f] || a[f].length > 256)) {
      throw new RefusalError(`Invalid project setup field: ${f}`);
    }
  }
  if (a.gitRepository !== undefined) {
    const g = a.gitRepository;
    if (!g || typeof g !== 'object' || Array.isArray(g) ||
      !['github', 'gitlab', 'bitbucket'].includes(g.type) ||
      typeof g.repo !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/.test(g.repo) ||
      typeof g.namespaceId !== 'string' || !g.namespaceId) {
      throw new RefusalError('Invalid git repository in the setup description');
    }
  }
  return a;
}

// Registry dispatch, the readiness pattern: JSON out, error text up.
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
function stepKey(base, n) {
  return `${String(base).slice(0, 110)}-s${n}`;
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function context({ db, connection, env, fetchImpl, dispatchTool }) {
  return { db, connection, env, fetchImpl, dispatchTool, shape: compact,
    audit: (entry) => db.recordChange(entry),
    replayStore: db.requestReplayStore(),
    checkSpend: accountSpendGuard({ db, account: connection.account }),
    guardProtected: (targets) => checkProtected(targets, { db, connection, env }),
    guardApp: (targets) => checkApp(targets, { db, connection, env }) };
}

const setup = defineWrite({
  // No spend declaration of its own: the catalog row carries no $, and
  // the workflow never touches the provider — the metered step
  // (vercel_project_create) declares its spend and runs its own purchase
  // policy inside its own dispatched pipeline (amended C-4).
  name: 'vercel_workflow_project_setup',
  async before(args, ctx) {
    const a = assertArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    const appId = a.appId ?? a.name;
    if (!ID.test(appId)) {
      throw new RefusalError('The app id derived from the project name is not a valid profile id; pass appId');
    }
    const steps = [];
    const valuesNeeded = [];
    const guided = [];
    const proj = await tryCall(ctx, 'vercel_project_get', { project: a.name });
    const projectId = typeof proj?.id === 'string' ? proj.id : null;
    let envItems = null, domainRows = null, envRows = null, protection = null;
    if (projectId) {
      // The project exists: plan strictly from read-back state. A state
      // read that fails refuses the setup — planning blind would create
      // duplicates and stop mid-flight on a step's own refusal anyway.
      envItems = await call(ctx, 'vercel_env_list', { project: a.name });
      domainRows = await call(ctx, 'vercel_domain_list_project_domains',
        { project: projectId });
      envRows = await call(ctx, 'vercel_environment_list', { project: a.name });
      protection = await call(ctx, 'vercel_protection_get', { project: a.name });
    }
    const plan = (step) => { steps.push({ n: steps.length + 1, ...step }); };
    if (!projectId) {
      const createArgs = { name: a.name };
      for (const f of CONFIG_FIELDS) {
        if (a[f] !== undefined) createArgs[f] = a[f];
      }
      if (a.gitRepository) createArgs.gitRepository = a.gitRepository;
      plan({ kind: 'create-project', label: `Create project ${a.name}`,
        tool: 'vercel_project_create', args: createArgs });
    }
    for (const ce of a.customEnvironments ?? []) {
      const slug = slugify(ce.name);
      const exists = (envRows?.items ?? []).some((r) =>
        r.slug === slug || r.name === ce.name);
      if (exists) continue;
      plan({ kind: 'custom-environment',
        label: `Create custom environment ${ce.name}`,
        tool: 'vercel_environment_create',
        args: { project: projectId ?? '$PROJECT_ID', expectedName: a.name,
          slug, branch: ce.branch,
          ...(ce.description ? { description: ce.description } : {}),
          ...(ce.copyFrom ? { copyFrom: ce.copyFrom } : {}),
          outsideApp: true },
        pendingProject: !projectId });
    }
    for (const entry of a.env ?? []) {
      const existing = (envItems?.items ?? []).filter((i) => i.key === entry.key);
      if (projectId && existing.length) {
        const covered = new Set(existing.flatMap((i) => i.targets ?? []));
        const missing = entry.targets.filter((t) => !covered.has(t));
        if (missing.length) {
          valuesNeeded.push({ key: entry.key, targets: missing,
            note: `${entry.key} already exists for ${[...covered].join(', ')}; ` +
              `add ${missing.join(', ')} with vercel_env_set (mode update) — setup never rewrites an existing variable.` });
        }
        continue;
      }
      if (entry.generate === true) {
        plan({ kind: 'env-generate',
          label: `Create variable ${entry.key} with a generated value for ${entry.targets.join(', ')}`,
          tool: 'vercel_env_set',
          args: { project: projectId ?? '$PROJECT_ID', key: entry.key,
            mode: 'create', targets: entry.targets,
            kind: entry.kind ?? 'Secret',
            generate: { bytes: 32, encoding: 'hex' }, outsideApp: true },
          pendingProject: !projectId });
      } else {
        // C-2: value-less names are reported, never dispatched — the
        // workflow never invents or carries a value. AUD-AV: the
        // pending-input follow-up is gone with the setup page; the
        // owner sets the value in the dashboard or generates one.
        valuesNeeded.push({ key: entry.key, targets: entry.targets,
          followUp: { tool: 'vercel_env_set',
            args: { project: a.name, key: entry.key, mode: 'create',
              targets: entry.targets, kind: entry.kind ?? 'Secret' },
            note: 'Set the value in the Vercel dashboard (Project Settings → Environment Variables), or run vercel_env_set with generate for a generated secret.' } });
      }
    }
    const attached = new Set((domainRows?.domains ?? []).map((d) => d.name));
    for (const domain of a.domains ?? []) {
      if (attached.has(domain)) continue;
      plan({ kind: 'domain-attach', label: `Attach domain ${domain}`,
        tool: 'vercel_domain_attach_to_project',
        args: { project: projectId ?? '$PROJECT_ID', domain, outsideApp: true },
        pendingProject: !projectId });
    }
    if (a.protection) {
      const current = protection?.vercelAuthentication;
      const differs = !projectId || !current ||
        current.enabled !== a.protection.vercelAuth ||
        (a.protection.deploymentType !== undefined &&
          current.deploymentType !== a.protection.deploymentType);
      if (differs) {
        plan({ kind: 'protection',
          label: `${a.protection.vercelAuth ? 'Enable' : 'Disable'} Vercel Authentication`,
          tool: 'vercel_protection_set_vercel_auth',
          args: { project: a.name, enabled: a.protection.vercelAuth,
            ...(a.protection.deploymentType
              ? { deploymentType: a.protection.deploymentType } : {}) } });
      }
    }
    // Step previews: real dry-runs through each step's own pipeline when
    // the step can run now; steps waiting on the new project's id carry
    // the workflow's own line (W3 — one combined preview either way).
    for (const step of steps) {
      if (step.pendingProject) {
        step.preview = `${step.label} (after the project exists)`;
        continue;
      }
      const dry = await tryCall(ctx, step.tool,
        { ...step.args, dryRun: true, requestKey: stepKey(args.requestKey ?? 'wfsetup', step.n) });
      step.preview = dry?.preview ?? dry?.text ?? step.label;
    }
    if (a.nodeVersion) {
      guided.push(`Node version ${a.nodeVersion}: set "engines": { "node": "${a.nodeVersion}.x" } in the app's package.json, or the project's Node.js Version in the dashboard — no tool changes it (dossier R-2).`);
    }
    if (a.productionBranch) {
      guided.push(`Production branch ${a.productionBranch}: branch tracking is a guided dashboard setting (Project → Settings → Git); it is recorded in the draft profile now.`);
    }
    const { profile } = profileFromFindings({
      app: appId, name: a.name,
      ...(a.framework ? { framework: a.framework } : {}),
      ...(a.nodeVersion ? { nodeVersion: a.nodeVersion } : {}),
      ...(a.productionBranch ? { productionBranch: a.productionBranch } : {}),
      ...(a.releaseRule ? { releaseRule: a.releaseRule } : {}),
      ...(a.rollbackCaution ? { rollbackCaution: a.rollbackCaution } : {}),
      projects: [a.name],
      ...(a.crons ? { crons: a.crons } : {}),
      ...(a.env?.length ? { expectedEnv: Object.fromEntries(
        TARGETS.map((t) => [t, (a.env ?? [])
          .filter((e) => e.targets.includes(t)).map((e) => e.key)])
          .filter(([, names]) => names.length)) } : {}),
      ...(a.domains?.length ? { domains: a.domains } : {}),
      ...(a.noPreviewBranches?.length
        ? { noPreviewBranches: a.noPreviewBranches } : {}),
      ...(a.costTargetCents !== undefined
        ? { costTargetCents: a.costTargetCents } : {})
    });
    const productionParts = (a.domains?.length ?? 0) > 0 ||
      (a.env ?? []).some((e) => e.targets.includes('production')) ||
      ['all', 'prod_deployment_urls_and_all_previews']
        .includes(a.protection?.deploymentType ?? '');
    return { name: a.name, appId, projectId, projectExists: Boolean(projectId),
      productionParts,
      targetEnv: (a.env ?? []).map((e) => e.key),
      targetDomains: a.domains ?? [],
      steps: steps.map(({ n, kind, label, tool, args: a, preview }) =>
        ({ n, kind, label, tool, args: a, preview })),
      pendingProjectSteps: steps.filter((s) => s.pendingProject).map((s) => s.n),
      valuesNeeded, guided, profile };
  },
  async preview(_args, _ctx, before) {
    const lines = [`Set up project ${before.name}:`];
    if (!before.steps.length) {
      lines.push('Nothing to do: everything in the description already exists.');
    }
    for (const step of before.steps) lines.push(`- ${step.preview}`);
    for (const v of before.valuesNeeded) {
      lines.push(`- Variable ${v.key} for ${v.targets.join(', ')}: value needed from you (pending input); the name is recorded in the draft profile.`);
    }
    for (const g of before.guided) lines.push(`- Guided: ${g}`);
    lines.push(`- Save a draft profile for ${before.appId} and return its APP-NEEDS text.`);
    return lines.join('\n');
  },
  async production(_args, _ctx, before) {
    const live = before.productionParts ||
      before.steps.some((s) => s.kind === 'domain-attach');
    return { production: live,
      why: live ? 'The description includes production parts (domains, production variables or production protection)'
        : 'Preview-side setup only' };
  },
  async targets(_args, before) {
    const out = [{ kind: 'project', id: before.projectId ?? before.name,
      projectName: before.name }];
    for (const key of before.targetEnv) {
      out.push({ kind: 'env', id: key, key,
        projectId: before.projectId ?? before.name, projectName: before.name });
    }
    for (const d of before.targetDomains) {
      out.push({ kind: 'domain', id: d,
        projectId: before.projectId ?? before.name, projectName: before.name });
    }
    return out;
  },
  async apply(args, ctx, before, requestKey) {
    const appliedSteps = [];
    let projectId = before.projectId;
    for (const step of before.steps) {
      const stepArgs = { ...step.args };
      if (stepArgs.project === '$PROJECT_ID') stepArgs.project = projectId;
      let result;
      try {
        result = await call(ctx, step.tool,
          { ...stepArgs, confirm: true, requestKey: stepKey(requestKey, step.n) });
      } catch (err) {
        return { projectId, appliedSteps,
          stoppedAt: { step: step.n, tool: step.tool,
            reason: String(err?.message ?? err).slice(0, 300) },
          valuesNeeded: before.valuesNeeded, guided: before.guided };
      }
      if (result?.status !== 'applied') {
        return { projectId, appliedSteps,
          stoppedAt: { step: step.n, tool: step.tool,
            reason: result?.preview ?? result?.text ??
              `Step returned status ${result?.status ?? 'unknown'}` },
          valuesNeeded: before.valuesNeeded, guided: before.guided };
      }
      appliedSteps.push({ n: step.n, tool: step.tool, label: step.label,
        requestKey: stepKey(requestKey, step.n) });
      if (step.kind === 'create-project') {
        const proj = await tryCall(ctx, 'vercel_project_get',
          { project: before.name });
        projectId = typeof proj?.id === 'string' ? proj.id : null;
        if (!projectId) {
          return { projectId, appliedSteps,
            stoppedAt: { step: step.n, tool: step.tool,
              reason: 'Project was created but its id could not be read back; remaining steps were not attempted.' },
            valuesNeeded: before.valuesNeeded, guided: before.guided };
        }
      }
    }
    // C-6: the draft profile row is the workflow's own local write.
    await ctx.db.upsertKnownApp({ account: ctx.connection.account,
      id: before.appId, name: before.profile.name, status: 'draft',
      source: 'draft', profile: before.profile });
    return { projectId, appliedSteps, stoppedAt: null,
      draftProfile: before.appId,
      valuesNeeded: before.valuesNeeded, guided: before.guided };
  },
  async verify(_args, ctx, before, applied) {
    if (applied?.stoppedAt) return { confirmed: false,
      appliedSteps: applied.appliedSteps.length,
      stoppedAt: applied.stoppedAt };
    const proj = await tryCall(ctx, 'vercel_project_get', { project: before.name });
    const row = typeof ctx.db?.getKnownApp === 'function'
      ? await ctx.db.getKnownApp(ctx.connection.account, before.appId)
      : null;
    return { confirmed: Boolean(proj?.id) && row?.status === 'draft',
      project: proj?.id ?? null, draftProfile: row?.status ?? null };
  },
  async inverse(_args, before, applied) {
    return { steps: (applied?.appliedSteps ?? []).map((s) => ({
        tool: s.tool, requestKey: s.requestKey,
        undo: "vercel_undo_change over that step's own change-log row" })),
      draftProfile: before.appId,
      note: 'The stored profile row stays as an inert draft (status draft activates nothing) if the setup is abandoned.' };
  },
  async publicReceipt(_args, before, applied) {
    return { project: before.name, projectId: applied?.projectId ?? null,
      appliedSteps: (applied?.appliedSteps ?? []).map((s) => s.label),
      stoppedAt: applied?.stoppedAt ?? null,
      valuesNeeded: applied?.valuesNeeded ?? before.valuesNeeded,
      guided: applied?.guided ?? before.guided,
      draftProfile: applied?.draftProfile
        ? { id: applied.draftProfile, status: 'draft' } : null,
      appNeeds: applied?.stoppedAt ? null
        : appNeedsText(before.profile, { notes: before.guided }) };
  }
});

export const workflowProjectSetupTools = {
  tools: [{ name: 'vercel_workflow_project_setup', writes: true,
    guardedWrite: true, profiles: ['full'], area: 'profiles',
    description: 'Set up a new Vercel project from a short description: project, framework, environments, variables, domains, protection. Idempotent; ends with a draft profile.',
    inputSchema: schema, writeContract: setup.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } }],
  handlers: { vercel_workflow_project_setup: bindGuardedWrite(setup, context,
    (result) => ({
      isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
      content: [{ type: 'text', text: JSON.stringify(result) }]
    })) }
};
