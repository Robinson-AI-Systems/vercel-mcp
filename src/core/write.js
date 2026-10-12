// Generic safe write executor. No Vercel-specific imports or provider I/O.
// The caller must supply a durable replay store, audit writer and safe shaper.
import { createHash } from 'node:crypto';
import { refusal, safeShape, writePreflight } from './write-preflight.js';

// A definite pre-dispatch safety refusal is never a provider-write failure.
export class PreDispatchRefusal extends Error {}
export async function requirePreDispatch(check){
  try { return await check(); }
  catch { throw new PreDispatchRefusal('Execution-time authorization recheck refused'); }
}

// Private provenance: forged tool metadata cannot authorize a guarded mutation.
const contracts = new WeakMap();
const handlers = new WeakMap();

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
    // The public idempotency label alone cannot replay a result for different
    // meaningful arguments. Bind the durable claim to the canonical payload;
    // the owner-approved purchase fingerprint independently binds its quote.
    const scope = JSON.stringify([connection.account, connection.mode, name,
      args.requestKey, canonical(args)]);
    return 'rmcp_scoped_' + createHash('sha256').update(scope).digest('hex');
  }
  const payload = JSON.stringify({
    account: connection.account, mode: connection.mode, tool: name, args: canonical(args)
  });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0,40);
  return 'rmcp_' + String(name).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,50) +
    '_' + hash + '_' + Math.floor(now/600000);
}
// Stable owner charge identity. Presentation and caller requestKey are not part
// of the resource mutation digest, but all meaningful arguments and price are.
export function purchaseFingerprint(name,args,connection,spend) {
  return createHash('sha256').update(JSON.stringify({
    name,account:connection.account,mode:connection.mode,profile:connection.profile,
    args:canonical(args),priceCents:spend.cents,recurring:spend.recurring,
    description:spend.description
  })).digest('hex');
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
  if (spec.approvalOnly && (spec.risk?.spend || spec.risk?.access)) {
    throw new TypeError('Approval proposal cannot itself spend or widen access');
  }
  const writeContract = Object.freeze({
    production: true, targets: true, spend: Boolean(spec.risk?.spend),
    access: Boolean(spec.risk?.access),
    secretOut: Boolean(spec.secretOut), secretIn: Boolean(spec.secretIn)
  });
  async function run(args = {}, ctx = {}) {
    const checked = await writePreflight(spec, args, ctx);
    if (checked.refused) return checked.refused;
    const { before, production, targets, summary, moneyLine, spendCents, mode, purchase, spendDeclaration } = checked;
    const requestKey = writeRequestKey(spec.name, args, ctx.connection,
      typeof ctx.now === 'function' ? ctx.now() : Date.now());
    const auditBase = {
      tool: spec.name, account: ctx.connection.account, mode: ctx.connection.mode,
      requestKey, production: production.production,
      summary, targets: safeShape(ctx, targets), moneyLine, spendCents: spendCents??null
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
    // Agents may only PROPOSE a purchase. The single-use purchase grant comes
    // exclusively from separately authenticated owner setup (not MCP confirm).
    let charge=null;
    if(purchase){
      // A recurring fixed per-period fee can also exceed a one-time grant.
      // A numeric ceiling is meaningless unless the provider guarantees
      // lifetime charges cannot exceed it. Vercel build/compute usage
      // currently supplies no enforceable per-request maximum here.
      if(purchase.cents===null || purchase.recurring) return refusal(
        'Unbounded metered usage is disabled until a provider-enforceable owner ceiling can be verified');
      if(typeof args.requestKey!=='string')
        return refusal('A stable explicit requestKey is mandatory for paid operations');
      if(typeof ctx.db?.requestPurchaseIntent!=='function' ||
        typeof ctx.db?.getPurchaseIntent!=='function' ||
        typeof ctx.db?.consumePurchaseIntent!=='function')
        return refusal('Independent owner purchase approval is unavailable');
      const pricingSource=purchase.cents===null?'metered':'provider_quote';
      const fingerprint=purchaseFingerprint(spec.name,args,ctx.connection,purchase);
      const binding={account:ctx.connection.account,operation:spec.name,
        requestKey,fingerprint,priceCents:purchase.cents,pricingSource};
      let issued;
      try {issued=await ctx.db.requestPurchaseIntent(binding);}catch{return refusal('Purchase intent could not be safely recorded');}
      if(!issued||typeof issued.reference!=='string')
        return refusal('Transaction price or request identity was changed or unavailable');
      if(issued.status==='pending'){
        await ctx.audit({...auditBase,dryRun:true,
          summary:'Awaiting independently authenticated owner purchase approval (no provider write)'});
        return {status:'awaiting_owner_approval',confirmed:false,ownerApprovalRequired:true,
          reference:issued.reference,expiresAt:issued.expiresAt,
          requestKey,reviewAt:'/api/vercel/setup',moneyLine,
          reason:'Owner must review and approve this exact transaction separately'};
      }
      if(issued.status!=='approved')
        return refusal('Owner has not approved this exact transaction');
      let verified;
      try{verified=await ctx.db.getPurchaseIntent({account:binding.account,reference:issued.reference});}
      catch{return refusal('Owner purchase approval read-back failed');}
      const ceiling=Number(verified?.ceiling_cents);
      if(verified?.status!=='approved'||!Number.isSafeInteger(ceiling)||
        ceiling<1||(purchase.cents!==null&&purchase.cents>ceiling)||
        !verified.approved_at||new Date(verified.expires_at).getTime()<=Date.now())
        return refusal('Owner purchase approval is stale or cannot cover the quoted price');
      charge={...binding,reference:issued.reference};
    }
    if (typeof ctx.replayStore?.claim !== 'function' ||
      typeof ctx.replayStore?.complete !== 'function') {
      return refusal('Durable replay protection is unavailable');
    }
    let claim;
    try {
      claim = await ctx.replayStore.claim({
        key: requestKey, account: ctx.connection.account,
        mode: ctx.connection.mode, tool: spec.name, ttlMs: 600000
      });
    } catch {
      // An uncertain database claim must never initiate a provider mutation.
      return refusal('Durable replay service unavailable; no provider write dispatched');
    }
    if (claim?.state === 'completed') return claim.result;
    if (claim?.state !== 'claimed') return {
      status: 'outcome_unknown', confirmed: null, requestKey,
      reason: 'A previous request is pending: verify the resource before retrying'
    };
    let providerResult;
    try {
      let executionContext=ctx;
      if(spendDeclaration){
        // A fresh declaration is required immediately before dispatch,
        // including for originally $0 writes. If pricing, recurrence or the
        // provider quote description drifted, no provider mutation is safe.
        // For chargeable writes this occurs BEFORE consuming the owner grant.
        await requirePreDispatch(async()=>{
          // Cached preflight state cannot validate a provider-sourced quote.
          // Re-read charged operations before consuming a one-use owner grant.
          const freshBefore=spendDeclaration.cents===0&&!spendDeclaration.recurring?
            before:await spec.before(args,ctx);
          const fresh=await spec.spend(args,ctx,freshBefore);
          if(!fresh||fresh.cents!==spendDeclaration.cents||
            fresh.recurring!==spendDeclaration.recurring||
            typeof fresh.description!=='string'||
            fresh.description.trim()!==spendDeclaration.description)
            throw new Error('Price changed after independent confirmation');
        });
      }
      if(charge){
        // Atomic consume + audit is mandatory BEFORE any chargeable apply.
        // The transaction can never be spent again, regardless of transport.
        const consumed=await ctx.db.consumePurchaseIntent(charge);
        if(consumed!==true) throw new PreDispatchRefusal('Owner purchase grant was unavailable');
        executionContext={...ctx,purchaseApproval:Object.freeze({
          reference:charge.reference,requestKey,operation:spec.name})};
      }
      providerResult = await spec.apply(args, executionContext, before, requestKey);
    } catch (error) {
      if (error instanceof PreDispatchRefusal && typeof ctx.replayStore.release === 'function') {
        try {
          // CAS delete the definite non-dispatched claim, never a pending write.
          await ctx.replayStore.release({key:requestKey,claimId:claim.claimId});
          return refusal('Execution-time authorization or resource checks refused the change');
        } catch { /* changed claim ownership: fail closed as unknown */ }
      }
      return { status: 'outcome_unknown', mode, confirmed: null, requestKey,
        reason: 'Write result is unknown; run a read-back before retrying' };
    }
    let verification;
    try { verification = await spec.verify(args, ctx, before, providerResult); }
    catch { verification = { confirmed: null }; }
    const confirmed = typeof verification?.confirmed === 'boolean' ?
      verification.confirmed : null;
    // An owner-request write issues an approval reference; it never applies an
    // account mutation. Do not call an issued reference a confirmed account change.
    if (spec.approvalOnly && (confirmed !== true ||
      providerResult?.status !== 'awaiting_owner_approval' ||
      providerResult?.ownerApprovalRequired !== true ||
      typeof providerResult?.reference !== 'string' ||
      typeof providerResult?.expiresAt !== 'string')) {
      return { status: 'outcome_unknown', mode, confirmed: null, requestKey,
        reason: 'The owner approval request could not be verified; do not retry blindly' };
    }
    const result = safeShape(ctx, spec.approvalOnly ?
      { status: 'awaiting_owner_approval', mode, confirmed: false,
        ownerApprovalRequired: true, reference: providerResult.reference,
        expiresAt: providerResult.expiresAt, preview: summary, requestKey,
        reviewAt: '/api/vercel/setup' } :
      { status: 'applied', mode, confirmed, preview: summary, moneyLine, requestKey });
    const inverse = typeof spec.inverse === 'function'
      ? safeShape(ctx, await spec.inverse(args, before, providerResult, ctx)) : null;
    await ctx.audit({ ...auditBase, dryRun: false,
      before: safeShape(ctx, before),
      after: safeShape(ctx, verification), inverse, result });
    await ctx.replayStore.complete({ key: requestKey,
      claimId: claim.claimId, result });
    return result;
  }
  const identity = Object.freeze({ name: spec.name, run, writeContract });
  contracts.set(writeContract, identity);
  return { run, writeContract };
}

// Only this factory produces registry-authenticated guarded handlers. The
// adapter translates provider context/output; it never replaces defineWrite.run.
export function bindGuardedWrite(write, context, output) {
  const identity = contracts.get(write?.writeContract);
  if (!identity || identity.run !== write?.run ||
    typeof context !== 'function' || typeof output !== 'function') {
    throw new TypeError('Only defineWrite can bind guarded provider handlers');
  }
  const handler = async (args, ctx) => output(await identity.run(args, context(ctx)));
  handlers.set(handler, identity);
  return handler;
}

export function isGuardedWrite(tool, handler) {
  const identity = contracts.get(tool?.writeContract);
  return Boolean(tool?.guardedWrite === true && tool?.writes === true &&
    identity?.name === tool?.name &&
    (handler === undefined || handlers.get(handler) === identity));
}
