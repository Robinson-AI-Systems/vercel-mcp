// X-1 (BATCH-X §X1): vercel_undo_change. A guarded write that loads
// one of the caller's own change-log rows and dispatches its stored
// inverse through the owning tool's own guarded pipeline (verdict
// C-1) — preview + confirm, the step's own guards, classification
// and purchase policy all apply inside that pipeline. The undo
// journals as its own change-log row; the original row is never
// rewritten. Dispatch form and refusal taxonomy: card verdicts
// X1-C1..C4.
import { defineWrite, bindGuardedWrite, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { accountSpendGuard } from '../vercel/spend.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';

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

function context({ db, connection, env, fetchImpl, dispatchTool }) {
  return { db, connection, env, fetchImpl, dispatchTool, shape: compact,
    audit: (entry) => db.recordChange(entry),
    replayStore: db.requestReplayStore(),
    checkSpend: accountSpendGuard({ db, account: connection.account }),
    guardProtected: (targets) => checkProtected(targets, { db, connection, env }),
    guardApp: (targets) => checkApp(targets, { db, connection, env }) };
}

// X1-C2: rows with no stored inverse refuse by naming the right
// opposite action for their family.
function noInverseRefusal(tool) {
  if (/_delete$|_remove$|_revoke/.test(tool)) {
    return `Change stored no inverse: deletions are not un-deleted. Re-create the resource with its area's create tool if it is still wanted`;
  }
  if (/registrar_(buy|renew|transfer_in)/.test(tool)) {
    return 'Change stored no inverse: purchases, renewals and transfers are not undoable through this server. Use the Vercel dashboard or Vercel support for billing remedies';
  }
  if (tool === 'vercel_member_invite') {
    return 'Change stored no inverse: an invitation is withdrawn with vercel_member_revoke_invite, or the member removed with vercel_member_remove after they join';
  }
  if (tool === 'vercel_token_create' || tool === 'vercel_token_delete') {
    return 'Change stored no inverse: tokens are managed with vercel_token_create and vercel_token_delete; a deleted token cannot be restored';
  }
  return `Change stored no inverse: ${tool} has no clean opposite recorded. Reverse it with the owning area tool directly`;
}

// X1-C1: the one adapter. Stored DNS images use recordValue (the
// storage shaper hides fields named `value` in stored copies) and
// nest the image under record/restore; expand them into the target
// tool's real arguments at dispatch time.
function dispatchArgs(inverse) {
  const { tool, undo: _sentence, ...fields } = inverse;
  const args = { ...fields };
  // Value-carrying dispatches (create/update/replace) expand the
  // stored images; any other dispatch (a delete) must not inherit
  // them — its own contract would refuse the extra fields.
  const carriesValue = /create|update|replace/.test(tool ?? '');
  if (args.record && typeof args.record === 'object') {
    if (carriesValue) {
      const { recordValue, ...rest } = args.record;
      Object.assign(args, rest, recordValue !== undefined
        ? { value: recordValue } : {});
    }
    delete args.record;
  }
  if (args.restore && typeof args.restore === 'object') {
    if (carriesValue) {
      const { recordValue, ...rest } = args.restore;
      Object.assign(args, rest, recordValue !== undefined
        ? { value: recordValue } : {});
    }
    delete args.restore;
  }
  if (args.recordValue !== undefined) {
    if (carriesValue) args.value = args.recordValue;
    delete args.recordValue;
  }
  if (Array.isArray(args.records)) {
    args.records = args.records.map((r) => {
      if (!r || typeof r !== 'object' || r.recordValue === undefined) return r;
      const { recordValue, ...rest } = r;
      return { ...rest, value: recordValue };
    });
  }
  return { tool, args };
}

function assertArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some((k) => !Object.hasOwn(schema.properties, k)) ||
    !args.description || typeof args.description !== 'object' ||
    Array.isArray(args.description) ||
    (args.confirm !== undefined && typeof args.confirm !== 'boolean') ||
    (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) {
    throw new RefusalError('Invalid undo request');
  }
  const a = args.description;
  if (!Number.isSafeInteger(a.change_id) || a.change_id < 1 ||
    (a.outsideApp !== undefined && typeof a.outsideApp !== 'boolean') ||
    Object.keys(a).some((k) => !['change_id', 'outsideApp'].includes(k))) {
    throw new RefusalError('Invalid undo description: change_id (a change-log row id from vercel_recent_changes) and optional outsideApp');
  }
  return a;
}

const undoChange = defineWrite({
  name: 'vercel_undo_change',
  async before(args, ctx) {
    const a = assertArgs(args);
    if (typeof ctx.dispatchTool !== 'function') {
      throw new RefusalError('Registry composition is unavailable');
    }
    if (typeof ctx.db?.getChangeForUndo !== 'function') {
      throw new RefusalError('Change-log read is unavailable');
    }
    const row = await ctx.db.getChangeForUndo(
      { account: ctx.connection.account, id: a.change_id });
    if (!row) {
      throw new RefusalError(`No change ${a.change_id} exists for this account`);
    }
    if (row.dry_run) {
      throw new RefusalError(`Change ${a.change_id} was a preview (dry run); nothing was changed, so there is nothing to undo`);
    }
    if (row.alreadyUndoneBy) {
      throw new RefusalError(`Change ${a.change_id} was already undone by change ${row.alreadyUndoneBy}`);
    }
    const inverse = row.inverse ?? null;
    if (!inverse || typeof inverse !== 'object' || Array.isArray(inverse)) {
      throw new RefusalError(noInverseRefusal(row.tool));
    }
    if (Array.isArray(inverse.steps)) {
      throw new RefusalError(`Change ${a.change_id} (${row.tool}) journaled per-step undo pointers, not one inverse. Undo each step's own change row — find them with vercel_recent_changes around the same time`);
    }
    if (typeof inverse.tool !== 'string' || !inverse.tool) {
      throw new RefusalError(typeof inverse.undo === 'string'
        ? `Change ${a.change_id} cannot be undone by dispatch: ${inverse.undo}`
        : noInverseRefusal(row.tool));
    }
    const { tool, args: stepArgs } = dispatchArgs(inverse);
    const dry = await tryStep(ctx, tool,
      { ...stepArgs, dryRun: true,
        requestKey: `${String(args.requestKey ?? 'wfundo').slice(0, 110)}-s1` });
    return { changeId: a.change_id, originalTool: row.tool,
      originalProduction: row.production === true,
      outsideApp: a.outsideApp === true, tool, stepArgs,
      stepPreview: dry.ok ? (dry.value?.preview ?? `Run ${tool}`)
        : `The undo step cannot run on this connection yet: ${dry.reason}`,
      startedAt: Date.now() };
  },
  async preview(_args, _ctx, before) {
    return `Undo change ${before.changeId} (${before.originalTool}):\n- ${before.stepPreview}`;
  },
  async production(_args, _ctx, before) {
    return { production: before.originalProduction,
      why: before.originalProduction
        ? 'The change being undone was a production change'
        : 'The change being undone was not a production change' };
  },
  async targets(_args, before) {
    // The dispatched step's own targets are judged inside its own
    // pipeline; the undo itself names only the change it reverses.
    return [{ kind: 'change', id: String(before.changeId),
      outsideApp: before.outsideApp }];
  },
  async apply(args, ctx, before, requestKey) {
    const step = await tryStep(ctx, before.tool,
      { ...before.stepArgs, confirm: true,
        requestKey: `${String(requestKey).slice(0, 110)}-s1` });
    if (!step.ok || step.value?.status !== 'applied') {
      return { undone: false, stoppedAt: { step: 1, tool: before.tool,
        reason: step.ok
          ? reasonOf(step.value, `Step returned status ${step.value?.status ?? 'unknown'}`)
          : step.reason } };
    }
    // X1-C3: find the step's own change row (journaled by the step's
    // own executor during the dispatch) so this undo's inverse can
    // point at it — undoing this undo re-dispatches that row's
    // inverse, which is the original change's opposite.
    let stepChangeId = null;
    try {
      const rows = await ctx.db.listRecentChanges(
        { account: ctx.connection.account, tool: before.tool, limit: 5 });
      const mine = (rows ?? []).find((r) =>
        r.dry_run === false &&
        new Date(r.at).getTime() >= before.startedAt - 5000);
      stepChangeId = mine?.id ?? null;
    } catch { stepChangeId = null; }
    return { undone: true, stoppedAt: null, stepChangeId };
  },
  async verify(_args, _ctx, before, applied) {
    if (!applied?.undone) return { confirmed: false,
      stoppedAt: applied?.stoppedAt ?? null, undoes: before.changeId };
    return { confirmed: true, undoes: before.changeId, via: before.tool,
      stepChangeId: applied.stepChangeId ?? null };
  },
  async inverse(_args, before, applied) {
    if (!applied?.undone) {
      return { undo: 'The undo did not land; nothing to reverse' };
    }
    return applied.stepChangeId
      ? { tool: 'vercel_undo_change', change_id: applied.stepChangeId }
      : { undo: 'The undo landed but its step change row could not be identified; reverse the step change directly with vercel_undo_change on its row' };
  },
  async publicReceipt(_args, before, applied) {
    return { undoes: before.changeId, originalTool: before.originalTool,
      via: before.tool, undone: applied?.undone ?? false,
      stepChangeId: applied?.stepChangeId ?? null,
      stoppedAt: applied?.stoppedAt ?? null };
  }
});

export const undoTools = {
  tools: [{ name: 'vercel_undo_change', writes: true, guardedWrite: true,
    profiles: ['everyday', 'full'], area: 'workflows',
    description: 'Undo one change-log entry by dispatching its stored inverse.',
    inputSchema: schema, writeContract: undoChange.writeContract,
    annotations: { readOnlyHint: false, destructiveHint: false } }],
  handlers: { vercel_undo_change: bindGuardedWrite(undoChange, context,
    (result) => ({
      isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
      content: [{ type: 'text', text: JSON.stringify(result) }]
    })) }
};
