// Generic safe write executor. No Vercel-specific imports or provider I/O.
// The caller must supply a durable replay store, audit writer and safe shaper.
import { createHash } from 'node:crypto';
import { refusal, safeShape, writePreflight } from './write-preflight.js';

const PRESENTATION = new Set(['dryRun','confirm','fields','detail','requestKey']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([name,v]) => !PRESENTATION.has(name) && v !== undefined)
    .sort(([a],[b]) => a.localeCompare(b)).map(([name,v]) => [name,canonical(v)]));
}
export function writeRequestKey(name, args, connection, now = Date.now()) {
  if (args.requestKey !== undefined) {
    if (typeof args.requestKey !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)) throw new TypeError('Invalid requestKey');
    return args.requestKey;
  }
  const payload = JSON.stringify({
    account: connection.account, mode: connection.mode, tool: name, args: canonical(args)
  });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0,40);
  return 'rmcp_' + String(name).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,50) +
    '_' + hash + '_' + Math.floor(now/600000);
}
export function defineWrite(spec) {
  if (typeof spec?.name !== 'string' || !spec.name) throw new TypeError('Write name required');
  for (const key of ['before','preview','production','targets','apply','verify']) {
    if (typeof spec[key] !== 'function') throw new TypeError('Write must declare ' + key);
  }
  if (spec.risk?.spend && typeof spec.spend !== 'function') {
    throw new TypeError('Paid write requires spend declaration');
  }
  if (spec.risk?.access && typeof spec.access !== 'function') {
    throw new TypeError('Access-changing write requires access declaration');
  }
  const writeContract = Object.freeze({
    production: true, targets: true, spend: Boolean(spec.risk?.spend),
    access: Boolean(spec.risk?.access),
    secretOut: Boolean(spec.secretOut), secretIn: Boolean(spec.secretIn)
  });
  async function run(args = {}, ctx = {}) {
    const checked = await writePreflight(spec, args, ctx);
    if (checked.refused) return checked.refused;
    const { before, production, targets, summary, moneyLine, mode } = checked;
    const requestKey = writeRequestKey(spec.name, args, ctx.connection,
      typeof ctx.now === 'function' ? ctx.now() : Date.now());
    const auditBase = {
      tool: spec.name, account: ctx.connection.account, mode: ctx.connection.mode,
      requestKey, production: production.production,
      summary, targets: safeShape(ctx, targets), moneyLine
    };
    if (args.dryRun === true) {
      await ctx.audit({ ...auditBase, dryRun: true });
      return { status: 'preview', mode, dryRun: true, preview: summary,
        moneyLine, requestKey };
    }
    // Requiring confirmation for every write is conservative; later cards
    // may add stronger guards, never relax production or spend requirements.
    if (args.confirm !== true) return {
      status: 'needs_confirmation', mode, confirmed: false,
      preview: summary, moneyLine, requestKey
    };
    if (typeof ctx.replayStore?.claim !== 'function' ||
      typeof ctx.replayStore?.complete !== 'function') {
      return refusal('Durable replay protection is unavailable');
    }
    const claim = await ctx.replayStore.claim({
      key: requestKey, account: ctx.connection.account,
      mode: ctx.connection.mode, tool: spec.name, ttlMs: 600000
    });
    if (claim?.state === 'completed') return claim.result;
    if (claim?.state !== 'claimed') return {
      status: 'outcome_unknown', confirmed: null, requestKey,
      reason: 'A previous request is pending: verify the resource before retrying'
    };
    let providerResult;
    try {
      providerResult = await spec.apply(args, ctx, before, requestKey);
    } catch {
      // The request may have reached Vercel. Never auto-retry.
      return { status: 'outcome_unknown', mode, confirmed: null, requestKey,
        reason: 'Write result is unknown; run a read-back before retrying' };
    }
    let verification;
    try { verification = await spec.verify(args, ctx, before, providerResult); }
    catch { verification = { confirmed: null }; }
    const confirmed = typeof verification?.confirmed === 'boolean' ?
      verification.confirmed : null;
    const result = safeShape(ctx, { status: 'applied', mode, confirmed,
      preview: summary, moneyLine, requestKey });
    const inverse = typeof spec.inverse === 'function'
      ? safeShape(ctx, await spec.inverse(args, before, providerResult, ctx)) : null;
    await ctx.audit({ ...auditBase, dryRun: false,
      before: safeShape(ctx, before),
      after: safeShape(ctx, verification), inverse, result });
    await ctx.replayStore.complete({ key: requestKey,
      claimId: claim.claimId, result });
    return result;
  }
  return { run, writeContract };
}
