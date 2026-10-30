// Generic safe write executor. No Vercel-specific imports or provider I/O.
// The caller must supply a durable replay store, audit writer and safe shaper.
import { createHash } from 'node:crypto';
import { refusal, safeShapeForReturn, safeShapeStored, storedReference, writePreflight } from './write-preflight.js';
export { RefusalError } from './write-preflight.js';

// AUD-Y (VMCP-011, second layer): the audit writer caps the whole
// record at 8 KB in aggregate — before + after + result + inverse +
// summary, serialized as the writer will serialize them. Fields
// that each fit the per-field bound can still sum past it (the live
// shape: a batch whose before, targets, preview, and result are
// each ~3 KB), and the writer's throw lands after the write has
// succeeded. Fit the entry before auditing: measure exactly as the
// writer measures, and replace the largest remaining field with
// its stored reference until the entry fits. The summary — the
// human headline — is never replaced, and the writer's cap itself
// stays: an entry that still cannot fit keeps the writer's refusal.
const AUDIT_MEASURED = ['before', 'after', 'result', 'inverse'];
function auditEntrySize(entry) {
  const before = JSON.stringify({ snapshot: entry.before ?? null, targets: entry.targets ?? [] });
  const after = JSON.stringify(entry.after ?? null);
  const result = JSON.stringify(entry.delegation ?
    { ...(entry.result && typeof entry.result === 'object' && !Array.isArray(entry.result) ?
        entry.result : {}), delegation: entry.delegation } :
    (entry.result ?? null));
  const inverse = JSON.stringify(entry.inverse ?? null);
  const summary = String(entry.summary) + (entry.moneyLine ? ' | ' + String(entry.moneyLine) : '');
  return Buffer.byteLength(before + after + result + inverse + summary);
}
async function fitAuditEntry(ctx, entry, label) {
  const fitted = { ...entry };
  while (auditEntrySize(fitted) > 8192) {
    let largest = null, largestSize = -1;
    for (const field of AUDIT_MEASURED) {
      const value = fitted[field];
      if (value === undefined || value === null) continue;
      if (value?.status === 'stored' && typeof value?.handle === 'string') continue;
      const size = Buffer.byteLength(JSON.stringify(value) ?? '');
      if (size > largestSize) { largest = field; largestSize = size; }
    }
    if (largest === null) break;
    fitted[largest] = await storedReference(ctx, fitted[largest], label);
  }
  return fitted;
}

// A definite pre-dispatch safety refusal is never a provider-write failure.
export class PreDispatchRefusal extends Error {}
export async function requirePreDispatch(check){
  try { return await check(); }
  catch { throw new PreDispatchRefusal('Execution-time authorization recheck refused'); }
}

// AUD-H (VMCP-023): an outcome_unknown that names nothing teaches the caller
// nothing. When the thrown error carries a safe failure detail — a
// pattern-validated code, the operation leg that failed, a coarse failure
// class, an HTTP status — the executor surfaces exactly those fields and
// nothing else: never a message, never a provider body.
const FAILURE_CLASSES = new Set(['timeout', 'network', 'http_status', 'shape']);
function failureDetail(error) {
  if (!error || typeof error !== 'object') return null;
  const detail = {};
  if (typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(error.code)) {
    detail.code = error.code;
  }
  if (typeof error.leg === 'string' && /^[a-z][a-z0-9_]{0,60}$/.test(error.leg)) {
    detail.leg = error.leg;
  }
  if (FAILURE_CLASSES.has(error.failureClass)) detail.failureClass = error.failureClass;
  if (Number.isSafeInteger(error.status) && error.status >= 100 && error.status <= 599) {
    detail.status = error.status;
  }
  return Object.keys(detail).length ? detail : null;
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
// AUD-A2: the delegation the executor itself minted for an owner-word
// purchase (design D-A). Metered tools that re-check purchase authority
// inside apply accept this in place of a consumed grant; it is bound to the
// exact operation and request key, and it exists only when preflight
// evaluated the account policy on an owner connection. A caller can never
// inject it: execution contexts are built here, never from tool arguments.
export function purchaseDelegationFor(ctx, operation, requestKey) {
  const delegation = ctx?.purchaseDelegation;
  return delegation && delegation.basis === 'owner_word' &&
    delegation.operation === operation && delegation.requestKey === requestKey ?
    delegation : null;
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
    // AUD-A2: the delegation block preflight evaluated for an owner-word
    // purchase (null on every other path). It is journaled on the change-log
    // row and returned in the applied result under the same name.
    const delegation = purchase?.delegation ?? null;
    // AUD-D (D-D, VMCP-008): an oversized target list is stored and
    // referenced by handle in the audit/change-log row, like the preview —
    // the 8 KB bound displays, it does not block the write. Unshapable
    // targets still throw here, before any dispatch.
    const auditBase = {
      tool: spec.name, account: ctx.connection.account, mode: ctx.connection.mode,
      requestKey, production: production.production,
      summary, targets: await safeShapeStored(ctx, targets, spec.name), moneyLine, spendCents: spendCents??null,
      ...(delegation ? { delegation } : {})
    };
    if (args.dryRun === true) {
      await ctx.audit(await fitAuditEntry(ctx, { ...auditBase, dryRun: true }, spec.name));
      return { status: 'preview', mode, dryRun: true, preview: summary,
        moneyLine, requestKey };
    }
    // Requiring confirmation for every write is conservative. Stronger
    // guards may be added, but production and spend strictness are the
    // account owner's own policy choices, not a builder doctrine: the
    // purchase branch below applies the owner's standing policy
    // (docs/END-USER-AUTHORITY.md). The builder-activity constraint —
    // implementation agents spend $0 and never approve grants — binds
    // builders' own activity, never an end user's connection.
    if (args.confirm !== true) return {
      status: 'needs_confirmation', mode, confirmed: false,
      preview: summary, moneyLine, requestKey
    };
    // Purchase authority (AUD-A2, design D-A, OP-2). On the account owner's
    // own connection with purchase_grant_required = false, preflight has
    // already evaluated the standing policy: the owner's confirmed word is
    // the authority, no purchase intent is created or consumed, and the
    // delegation block is journaled. On delegated/builder connections — and
    // for owners who opted into purchase_grant_required — an agent may only
    // PROPOSE a purchase: the single-use purchase grant comes exclusively
    // from separately authenticated owner setup (not MCP confirm).
    let charge=null;
    if(purchase&&!delegation){
      // A recurring fixed per-period fee can also exceed a one-time grant.
      // A numeric ceiling is meaningless unless the provider guarantees
      // lifetime charges cannot exceed it. Vercel build/compute usage
      // currently supplies no enforceable per-request maximum here.
      if(purchase.cents===null || purchase.recurring){
        // On this grant path the only authorized exception is a finite,
        // isolated Sandbox session: owner must explicitly accept
        // non-guaranteed variable usage AFTER reviewing the real scope in
        // authenticated setup. No generic metered purchase inherits this
        // permission, and this agent cannot approve it. (Owner connections
        // whose policy does not require a grant never reach this block:
        // metered spend executes on their word with the usage disclosure.)
        if(!(spec.name==='vercel_dev_sandbox_create'&&spec.risk?.ownerApprovedMetered===true&&
          purchase.cents===null&&purchase.recurring===true))
          return refusal('Unbounded metered usage requires a provider-enforceable ceiling or a separately authenticated owner-approved supported policy');
      }
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
        (purchase.cents===null&&verified?.allow_unbounded_metered!==true)||
        (purchase.cents!==null&&verified?.allow_unbounded_metered===true)||
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
        // For grant-path writes this occurs BEFORE consuming the owner grant;
        // owner-word writes re-check the same way, consuming nothing.
        await requirePreDispatch(async()=>{
          // Cached preflight state cannot validate a provider-sourced quote.
          // Re-read charged operations before any grant is consumed.
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
      if(delegation){
        // Owner-word path: nothing is consumed. Apply-side authority checks
        // receive the delegation the executor minted, bound to this exact
        // operation and request key (purchaseDelegationFor).
        executionContext={...ctx,purchaseDelegation:Object.freeze({
          basis:'owner_word',operation:spec.name,requestKey,
          budgetCents:delegation.budgetCents,quotedCents:delegation.quotedCents,
          overBudget:delegation.overBudget})};
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
      const failure = failureDetail(error);
      return { status: 'outcome_unknown', mode, confirmed: null, requestKey,
        ...(failure ? { failure } : {}),
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
    // One-time provider secrets are never returned through MCP. Only a UUID
    // for the independently authenticated owner reveal form may be included.
    const oneTimeRequired=spec.oneTimeDelivery===true&&
      (typeof spec.oneTimeWhen!=='function'||spec.oneTimeWhen(args)===true);
    const delivered=oneTimeRequired?{
      ownerRevealRef:providerResult?.ownerRevealRef,
      expiresAt:providerResult?.expiresAt,
      revealAt:'/api/vercel/setup'
    }:null;
    if(delivered&&(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(delivered.ownerRevealRef??'')||
      typeof delivered.expiresAt!=='string'||
      !Number.isFinite(new Date(delivered.expiresAt).getTime())||
      new Date(delivered.expiresAt).getTime()<=Date.now()||
      new Date(delivered.expiresAt).getTime()>Date.now()+600000))
      return {status:'outcome_unknown',mode,confirmed:null,requestKey,
        reason:'Provider token outcome or encrypted one-time delivery is unverified'};
    // Optional Vercel-agnostic verified receipt. Default writes preserve the
    // original response, while multi-step workflows can expose exact owner-
    // scoped IDs and private result handles WITHOUT exposing provider bodies.
    // AUD-X (VMCP-011): everything shaped AFTER the write has landed
    // uses the stored treatment, never the throwing one — the 8 KB
    // bound displays, it does not convert a landed, verified write
    // into an error envelope. The receipt and the inverse become
    // stored references when oversized; the audit's before/after/
    // result copies do the same; the replay copy does the same and
    // keeps the receipt scalars beside the reference so a replayed
    // answer stays a truthful receipt; and the returned result is
    // shaped for return (screened at the storage cap), leaving the
    // display bound to the delivery layer's stored-result path.
    const publicReceipt=confirmed===true&&typeof spec.publicReceipt==='function'?
      await safeShapeStored(ctx,await spec.publicReceipt(args,before,providerResult,verification),spec.name):null;
    const result = safeShapeForReturn(ctx, spec.approvalOnly ?
      { status: 'awaiting_owner_approval', mode, confirmed: false,
        ownerApprovalRequired: true, reference: providerResult.reference,
        expiresAt: providerResult.expiresAt, preview: summary, requestKey,
        reviewAt: '/api/vercel/setup' } :
      { status: 'applied', mode, confirmed, preview: summary, moneyLine, requestKey,
        ...(delegation?{delegation}:{}),
        ...(delivered||{}),...(publicReceipt?{receipt:publicReceipt}:{}) });
    const inverse = typeof spec.inverse === 'function'
      ? await safeShapeStored(ctx, await spec.inverse(args, before, providerResult, ctx), spec.name) : null;
    await ctx.audit(await fitAuditEntry(ctx, { ...auditBase, dryRun: false,
      before: await safeShapeStored(ctx, before, spec.name),
      after: await safeShapeStored(ctx, verification, spec.name), inverse,
      result: await safeShapeStored(ctx, result, spec.name) }, spec.name));
    const replayResult = await safeShapeStored(ctx, result, spec.name);
    await ctx.replayStore.complete({ key: requestKey,
      claimId: claim.claimId, result: replayResult?.status === 'stored' ?
        { ...replayResult, writeStatus: result.status,
          writeConfirmed: result.confirmed ?? null, requestKey } : replayResult });
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
