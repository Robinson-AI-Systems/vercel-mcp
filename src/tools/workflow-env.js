// W-5 (BATCH-W §3 row W6, §4 row W-5): env_sync and rotate_secret.
// Both are guarded writes composing existing tools through the
// registry's dispatch seam (verdict C-1). Sync plans from
// vercel_env_list on both sides — variable VALUES are never read by
// this module; vercel_env_copy moves them server-side. Rotate
// dispatches vercel_env_set with a server-side generate block, so the
// fresh value exists only inside the step's own pipeline, then
// redeploys the live deployment so it picks the value up.
import { defineWrite, bindGuardedWrite, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { accountSpendGuard } from '../vercel/spend.js';
import { checkProtected } from './self-guard.js';
import { checkApp, loadProfiles } from './app-guard.js';

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TARGETS = ['production', 'preview', 'development'];
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

async function runSteps(args, ctx, before, requestKey) {
  const done = [];
  for (const step of before.steps) {
    const r = await tryStep(ctx, step.tool,
      { ...step.args, confirm: true, requestKey: stepKey(requestKey, step.n) });
    if (!r.ok || r.value?.status !== 'applied') {
      return { done, stoppedAt: { step: step.n, tool: step.tool,
        reason: r.ok
          ? reasonOf(r.value, `Step returned status ${r.value?.status ?? 'unknown'}`)
          : r.reason } };
    }
    done.push(step.n);
  }
  return { done, stoppedAt: null };
}

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

/* ---------------- env_sync ---------------- */

function assertSyncArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(schema.properties, k)) ||
    !args.description || typeof args.description !== 'object' ||
    Array.isArray(args.description) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new RefusalError('Invalid env sync request');
  }
  const a = args.description;
  if (typeof a.project !== 'string' || !a.project || a.project.length > 128 ||
    (a.destinationProject !== undefined &&
      (typeof a.destinationProject !== 'string' || !a.destinationProject ||
        a.destinationProject.length > 128)) ||
    !['preview', 'development'].includes(a.sourceTarget) ||
    !TARGETS.includes(a.destinationTarget) ||
    (a.keys !== undefined && (!Array.isArray(a.keys) || a.keys.length > 100 ||
      a.keys.some((k) => typeof k !== 'string' || !KEY.test(k)))) ||
    (a.outsideApp !== undefined && typeof a.outsideApp !== 'boolean')) {
    throw new RefusalError('Invalid env sync description: project, optional destinationProject, sourceTarget (preview or development), destinationTarget, optional keys and outsideApp');
  }
  return a;
}

const envSync = defineWrite({
  name: 'vercel_workflow_env_sync',
  async before(args, ctx) {
    const a = assertSyncArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    const src = await call(ctx, 'vercel_project_get', { project: a.project });
    const dstRef = a.destinationProject ?? a.project;
    const dst = dstRef === a.project ? src
      : await call(ctx, 'vercel_project_get', { project: dstRef });
    if (typeof src?.id !== 'string' || typeof dst?.id !== 'string') {
      throw new RefusalError('Projects could not be resolved to exact ids');
    }
    const srcList = await call(ctx, 'vercel_env_list',
      { project: src.id, target: a.sourceTarget });
    const dstList = await call(ctx, 'vercel_env_list',
      { project: dst.id, target: a.destinationTarget });
    const srcItems = srcList?.items ?? [];
    const dstItems = dstList?.items ?? [];
    // W5-C1: never plan from a capped inventory unless the caller
    // named the subset and every named key is visible at the source.
    const wanted = a.keys ? new Set(a.keys) : null;
    if (wanted) {
      for (const key of wanted) {
        if (!srcItems.some((i) => i.key === key)) {
          throw new RefusalError(`Named variable ${key} is not present at the source (${a.sourceTarget}) — check the name, or the source list was capped and the key is beyond it`);
        }
      }
    } else if (srcList?.capped || dstList?.capped) {
      throw new RefusalError('A variable list was capped at 100 rows; planning from a partial inventory could silently skip names. Re-run with keys naming the subset to sync');
    }
    const dstHas = (key, branch) => dstItems.some((i) => i.key === key &&
      (a.destinationTarget !== 'preview' ||
        (i.gitBranch ?? null) === (branch ?? null)));
    const steps = [], consistent = [], secretSources = [], notSyncable = [];
    let n = 0;
    for (const item of srcItems
      .filter((i) => !wanted || wanted.has(i.key))
      .sort((x, y) => x.key.localeCompare(y.key))) {
      if (item.kind === 'Secret') { secretSources.push(item.key); continue; }
      const branch = a.destinationTarget === 'preview'
        ? (item.gitBranch ?? null) : null;
      if (dstHas(item.key, branch)) { consistent.push(item.key); continue; }
      if ((item.targets ?? []).includes('production')) {
        notSyncable.push({ key: item.key,
          reason: 'the source row also targets production; vercel_env_copy only moves rows whose targets exclude production' });
        continue;
      }
      n += 1;
      const stepArgs = { project: src.id,
        ...(dst.id !== src.id ? { destinationProject: dst.id } : {}),
        sourceId: item.id, sourceKey: item.key,
        sourceUpdatedAt: item.updatedAt, sourceTarget: a.sourceTarget,
        ...(item.gitBranch && a.sourceTarget === 'preview'
          ? { sourceGitBranch: item.gitBranch } : {}),
        destinationKey: item.key, destinationTarget: a.destinationTarget,
        ...(branch ? { destinationGitBranch: branch } : {}),
        outsideApp: true };
      const dry = await tryStep(ctx, 'vercel_env_copy',
        { ...stepArgs, dryRun: true,
          requestKey: stepKey(args.requestKey ?? 'wfsync', n) });
      steps.push({ n, tool: 'vercel_env_copy', args: stepArgs,
        key: item.key,
        preview: dry.ok ? (dry.value?.preview ?? `Copy ${item.key}`)
          : `The copy step for ${item.key} cannot run on this connection yet: ${dry.reason}` });
    }
    return { srcId: src.id, srcName: src.name, dstId: dst.id,
      dstName: dst.name, sourceTarget: a.sourceTarget,
      destinationTarget: a.destinationTarget,
      outsideApp: a.outsideApp === true,
      steps, consistent, secretSources, notSyncable };
  },
  async preview(_args, _ctx, before) {
    const lines = [`Sync variables from ${before.srcName} (${before.sourceTarget}) to ${before.dstName} (${before.destinationTarget}):`];
    for (const s of before.steps) lines.push(`- ${s.preview}`);
    if (!before.steps.length) lines.push('- Nothing to copy.');
    if (before.consistent.length) {
      lines.push(`Already consistent (skipped): ${before.consistent.join(', ')}.`);
    }
    if (before.secretSources.length) {
      lines.push(`Secret-kind sources are never copied by this workflow (set them at the destination with vercel_env_set using a generated value, or in the Vercel dashboard): ${before.secretSources.join(', ')}.`);
    }
    for (const x of before.notSyncable) {
      lines.push(`Not syncable: ${x.key} — ${x.reason}.`);
    }
    return lines.join('\n');
  },
  async production(_args, _ctx, before) {
    const prod = before.destinationTarget === 'production' &&
      before.steps.length > 0;
    return { production: prod,
      why: prod ? 'Copies land on the production target'
        : 'No copies land on production' };
  },
  async targets(_args, before) {
    const out = [{ kind: 'project', id: before.srcId, name: before.srcName,
      outsideApp: before.outsideApp }];
    if (before.dstId !== before.srcId) {
      out.push({ kind: 'project', id: before.dstId, name: before.dstName,
        outsideApp: before.outsideApp });
    }
    for (const s of before.steps) {
      out.push({ kind: 'env', id: s.key, projectId: before.dstId,
        key: s.key, outsideApp: before.outsideApp });
    }
    return out;
  },
  async apply(args, ctx, before, requestKey) {
    const { done, stoppedAt } = await runSteps(args, ctx, before, requestKey);
    return { copied: before.steps.filter((s) => done.includes(s.n))
        .map((s) => s.key),
      consistent: before.consistent, secretSources: before.secretSources,
      notSyncable: before.notSyncable, stoppedAt };
  },
  async verify(_args, ctx, before, applied) {
    if (applied?.stoppedAt) return { confirmed: false,
      stoppedAt: applied.stoppedAt };
    const dstList = await tryCall(ctx, 'vercel_env_list',
      { project: before.dstId, target: before.destinationTarget });
    if (!dstList) return { confirmed: false };
    const items = dstList.items ?? [];
    const missing = before.steps.filter((s) => !items.some((i) =>
      i.key === s.key && (before.destinationTarget !== 'preview' ||
        (i.gitBranch ?? null) ===
          (s.args.destinationGitBranch ?? null)))).map((s) => s.key);
    return { confirmed: missing.length === 0, missing,
      copied: applied?.copied ?? [] };
  },
  async inverse(_args, before, applied) {
    return { copied: applied?.copied ?? [],
      note: 'Copies are create-only at the destination; remove a copied variable with vercel_env_delete naming its destination row.' };
  },
  async publicReceipt(_args, before, applied) {
    return { from: { project: before.srcName, target: before.sourceTarget },
      to: { project: before.dstName, target: before.destinationTarget },
      copied: applied?.copied ?? [], consistent: before.consistent,
      secretSources: before.secretSources,
      notSyncable: before.notSyncable,
      stoppedAt: applied?.stoppedAt ?? null };
  }
});

/* ---------------- rotate_secret ---------------- */

function assertRotateArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(schema.properties, k)) ||
    !args.description || typeof args.description !== 'object' ||
    Array.isArray(args.description) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new RefusalError('Invalid rotate request');
  }
  const a = args.description;
  if (typeof a.project !== 'string' || !a.project || a.project.length > 128 ||
    typeof a.key !== 'string' || !KEY.test(a.key) ||
    (a.targets !== undefined && (!Array.isArray(a.targets) ||
      a.targets.length < 1 || a.targets.length > 3 ||
      a.targets.some((t) => !TARGETS.includes(t)) ||
      new Set(a.targets).size !== a.targets.length)) ||
    (a.outsideApp !== undefined && typeof a.outsideApp !== 'boolean')) {
    throw new RefusalError('Invalid rotate description: project, key, optional targets and outsideApp');
  }
  return a;
}
const sameSet = (x, y) => x.length === y.length &&
  [...x].sort().every((v, i) => v === [...y].sort()[i]);

const rotateSecret = defineWrite({
  name: 'vercel_workflow_rotate_secret',
  async before(args, ctx) {
    const a = assertRotateArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    if (a.key.startsWith('VERCEL_')) {
      throw new RefusalError(`${a.key} is managed by Vercel itself and cannot be rotated through this tool`);
    }
    const proj = await call(ctx, 'vercel_project_get', { project: a.project });
    if (typeof proj?.id !== 'string' || typeof proj?.name !== 'string') {
      throw new RefusalError('Project could not be resolved to an exact id and name');
    }
    const list = await call(ctx, 'vercel_env_list', { project: proj.id });
    const rows = (list?.items ?? []).filter((i) => i.key === a.key);
    if (!rows.length) {
      throw new RefusalError(`No variable named ${a.key} exists on ${proj.name}`);
    }
    let row;
    if (a.targets) {
      row = rows.find((r) => sameSet(r.targets ?? [], a.targets));
      if (!row) {
        throw new RefusalError(`${a.key} has no row with targets ${a.targets.join(', ')}; rows on file target: ${rows.map((r) => (r.targets ?? []).join('+')).join('; ')}`);
      }
    } else if (rows.length === 1) {
      row = rows[0];
    } else {
      throw new RefusalError(`${a.key} has ${rows.length} rows (targets: ${rows.map((r) => (r.targets ?? []).join('+')).join('; ')}); name the targets to rotate`);
    }
    // W5-C3: the workflow's own refusals, before any step is planned.
    if (row.kind !== 'Secret') {
      throw new RefusalError(`${a.key} is a Config variable; rotation mints a fresh random value and applies only to Secret variables — change a Config value deliberately with vercel_env_set`);
    }
    const profile = await profileForProject(ctx, proj.id, proj.name);
    if (profile && Array.isArray(profile.managed_env) &&
      profile.managed_env.includes(a.key)) {
      throw new RefusalError(`${a.key} is managed by ${profile.name} (managed_env); rotate it through the owning system, not here`);
    }
    const steps = [];
    const setArgs = { project: proj.id, key: a.key, id: row.id,
      expectedUpdatedAt: row.updatedAt, kind: 'Secret', mode: 'update',
      targets: row.targets, generate: { bytes: 32, encoding: 'hex' },
      outsideApp: true };
    const drySet = await tryStep(ctx, 'vercel_env_set',
      { ...setArgs, dryRun: true,
        requestKey: stepKey(args.requestKey ?? 'wfrotate', 1) });
    steps.push({ n: 1, tool: 'vercel_env_set', args: setArgs,
      preview: drySet.ok ? (drySet.value?.preview ?? `Set a fresh generated value for ${a.key}`)
        : `The set step cannot run on this connection yet: ${drySet.reason}` });
    // Redeploy only when production consumes the variable and a live
    // deployment exists to pick the new value up.
    let live = null;
    if ((row.targets ?? []).includes('production')) {
      const aliases = await tryCall(ctx, 'vercel_alias_list',
        { project: proj.id });
      const mine = (aliases?.aliases ?? []).filter((x) => x.deployment);
      const distinct = [...new Set(mine.map((x) => x.deployment))];
      if (aliases?.complete === true && distinct.length === 1) {
        const dep = await tryCall(ctx, 'vercel_deploy_get',
          { deployment: distinct[0] });
        const target = dep?.target === 'staging' ? 'preview'
          : (dep?.target ?? null);
        if (dep && target === 'production' && dep.state) {
          live = { id: distinct[0], state: dep.state };
          const rdArgs = { project: proj.id, deployment: live.id,
            expectedState: live.state, expectedTarget: 'production',
            outsideApp: true };
          const dryRd = await tryStep(ctx, 'vercel_deploy_redeploy',
            { ...rdArgs, dryRun: true,
              requestKey: stepKey(args.requestKey ?? 'wfrotate', 2) });
          steps.push({ n: 2, tool: 'vercel_deploy_redeploy', args: rdArgs,
            preview: dryRd.ok ? (dryRd.value?.preview ?? `Redeploy ${live.id}`)
              : `The redeploy step cannot run on this connection yet: ${dryRd.reason}` });
        }
      }
    }
    return { projectId: proj.id, projectName: proj.name, key: a.key,
      rowId: row.id, targets: row.targets ?? [],
      updatedAt: row.updatedAt, outsideApp: a.outsideApp === true,
      live, steps };
  },
  async preview(_args, _ctx, before) {
    const lines = [`Rotate ${before.key} on ${before.projectName} (targets: ${before.targets.join(', ')}):`];
    for (const s of before.steps) lines.push(`- ${s.preview}`);
    lines.push('The new value is generated on the server inside the set step; it never appears in this preview, the result or the journal.');
    if (!before.live && before.targets.includes('production')) {
      lines.push('No single live production deployment was proven, so nothing is redeployed; the next deployment uses the new value.');
    }
    return lines.join('\n');
  },
  async production(_args, _ctx, before) {
    const prod = before.targets.includes('production');
    return { production: prod,
      why: prod ? 'The rotated variable targets production'
        : 'The rotated variable does not target production' };
  },
  async targets(_args, before) {
    return [{ kind: 'project', id: before.projectId, name: before.projectName,
        outsideApp: before.outsideApp },
      { kind: 'env', id: before.rowId, projectId: before.projectId,
        key: before.key, outsideApp: before.outsideApp }];
  },
  async apply(args, ctx, before, requestKey) {
    const { done, stoppedAt } = await runSteps(args, ctx, before, requestKey);
    return { rotated: done.includes(1),
      redeployed: done.includes(2) ? before.live?.id ?? null : null,
      stoppedAt };
  },
  async verify(_args, ctx, before, applied) {
    if (applied?.stoppedAt) return { confirmed: false,
      stoppedAt: applied.stoppedAt };
    const list = await tryCall(ctx, 'vercel_env_list',
      { project: before.projectId });
    const row = (list?.items ?? []).find((i) => i.id === before.rowId);
    return { confirmed: Boolean(row) && row.updatedAt !== before.updatedAt,
      key: before.key };
  },
  async inverse(_args, before) {
    return { note: `The previous value of ${before.key} is unrecoverable by design (it was never shown); to change it again, vercel_env_set with a fresh generated value or the Vercel dashboard.` };
  },
  async publicReceipt(_args, before, applied) {
    return { project: before.projectName, key: before.key,
      targets: before.targets, rotated: applied?.rotated ?? false,
      redeployed: applied?.redeployed ?? null,
      // W5-C4: no profile field names secret consumers today.
      alsoUsedBy: [
        'New deployments of this project use the new value automatically.',
        'Any system outside Vercel that shares this secret must be re-issued on that side — the generated value is never shown, by design.'],
      stoppedAt: applied?.stoppedAt ?? null };
  }
});

export const workflowEnvTools = {
  tools: [
    { name: 'vercel_workflow_env_sync', writes: true, guardedWrite: true,
      profiles: ['everyday', 'full'], area: 'workflows',
      description: 'Sync variable names/targets between targets or projects; values copied server-side.',
      inputSchema: schema, writeContract: envSync.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'vercel_workflow_rotate_secret', writes: true, guardedWrite: true,
      profiles: ['full'], area: 'workflows',
      description: 'Rotate a Secret variable with a server-generated value, then redeploy production.',
      inputSchema: schema, writeContract: rotateSecret.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } }],
  handlers: {
    vercel_workflow_env_sync: bindGuardedWrite(envSync, context, (result) => ({
      isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
      content: [{ type: 'text', text: JSON.stringify(result) }] })),
    vercel_workflow_rotate_secret: bindGuardedWrite(rotateSecret, context,
      (result) => ({
        isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
        content: [{ type: 'text', text: JSON.stringify(result) }] }))
  }
};
