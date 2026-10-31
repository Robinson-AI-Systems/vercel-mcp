// Provider-neutral write policy. Unknown targets and missing guards always deny.
import { compact, credentialLike } from './util.js';
export function refusal(reason, status = 'refused_by_guard') {
  return { status, confirmed: false, reason };
}
// AUD-AH: a tool's own classification refusal, constructed value-free by
// the tool itself (a static plain-words sentence naming the failed
// predicate). The preflight passes a RefusalError's reason to the caller
// verbatim after the boundary screen in refusalReason; every other throw
// keeps the generic sentence, because arbitrary error text is unvetted —
// provider errors can echo messages, identifiers and values. Extends
// TypeError so the class change is invisible everywhere else: the
// read/plain handler error path screens TypeError messages the same way,
// the executor's failure detail reads fields rather than classes, and
// pre-dispatch re-checks re-wrap every error alike.
export class RefusalError extends TypeError {
  constructor(reason) {
    super(reason);
    this.name = 'RefusalError';
  }
}
const ID_SHAPED = /\b(?:team|prj|dpl|ecfg|store|conn)_[A-Za-z0-9_-]{12,}\b/;
export function refusalReason(error, generic) {
  if (!(error instanceof RefusalError)) return generic;
  const reason = error.message;
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 300 ||
    /[\x00-\x1f\x7f]/.test(reason) || credentialLike(reason) ||
    ID_SHAPED.test(reason)) return generic;
  return reason;
}
// AUD-A2 (design D-A, owner ruling OP-2): connection classification for the
// purchase branch. Only a server-minted classification counts — the MCP auth
// layer sets kind 'connector' from the oauth_tokens row it verified (the
// account owner's own connector/OAuth connection); the RTC door sets kind
// 'pass' for delegated passes. Anything else (builder/TEST fixtures, unknown
// doors) is NOT an owner connection and keeps the grant path. Caller-supplied
// tool arguments can never set this: the connection object is created by the
// auth layer and frozen before dispatch. See docs/END-USER-AUTHORITY.md.
export function isOwnerConnection(conn) {
  return conn?.kind === 'connector';
}
// R-1W (BATCH-R amendment, 2026-10-30): a write-capable RTC pass connection.
// The door mints these fields from the authorized pass row onto the frozen
// connection; caller arguments can never set them. A read-only pass has
// profile 'read_only' and is refused before the purchase branch is reached.
export function isWritePassConnection(conn) {
  return conn?.kind === 'pass' && conn?.passAllowWrites === true &&
    Number.isSafeInteger(conn?.passSpendLimitCents) &&
    conn.passSpendLimitCents >= 0 && conn.passSpendLimitCents <= 2147483647;
}
// The budget-framed dollar line for an owner connection whose policy does
// not require a per-purchase grant. The budget frames disclosure only: it
// never refuses the owner. quotedCents is the provider-quoted price, or null
// when the cost is unquantified (metered, or a $0-upfront recurring charge
// whose later charges are not knowable).
export function purchaseDisclosure({ description, cents, recurring, budgetCents, spentTodayCents }) {
  const quotedCents = (cents === null || (recurring && cents === 0)) ? null : cents;
  const price = quotedCents === null ?
    'cost depends on usage; Vercel bills it monthly' :
    '$' + (quotedCents / 100).toFixed(2) + ' USD' + (recurring ? ' per billing period' : '');
  let line = description + ': ' + price + '.';
  let overBudget = false;
  if (budgetCents === null) {
    line += ' No agent budget set.';
  } else {
    line += ' Your agent budget is $' + (budgetCents / 100).toFixed(2) +
      ' (today so far: $' + (spentTodayCents / 100).toFixed(2) + ').';
    if (quotedCents !== null) {
      overBudget = quotedCents > budgetCents;
      line += overBudget ?
        ' This purchase is over your budget — proceeding on your instruction.' :
        ' This purchase is within your budget.';
    }
  }
  return { moneyLine: line,
    delegation: { basis: 'owner_word', budgetCents, quotedCents, overBudget } };
}
export function safeShape(ctx, value) {
  if (typeof ctx.shape !== 'function') throw new Error('Output shaper is unavailable');
  // Even an identity shaper supplied by a caller cannot allow secrets into audit/replay.
  const output = compact(ctx.shape(value));
  const encoded = JSON.stringify(output);
  if (output === undefined || !encoded || Buffer.byteLength(encoded) > 8192) {
    throw new Error('Output cannot be safely shaped within 8 KB');
  }
  return output;
}
// AUD-D (design D-D, VMCP-008): the 8 KB bound is a display bound, not an
// existence bound. A value that shapes safely but exceeds the inline bound
// is stored through the result store — under the same connection-scoped
// rules as stored reads — and replaced by its stored reference, so the
// write proceeds to confirmation instead of refusing. The reference mirrors
// the read path's stored receipt (handle, expiry, count, preview, next
// step). Two cases keep today's behavior exactly: a value that cannot shape
// safely at all (the shaper throws for a non-size reason — cycles, depth,
// secret-screening failures) still throws here and still refuses in
// preflight; and with no usable result store on the context, an oversized
// value throws the same error safeShape throws, so nothing is silently
// truncated and the cap is never raised. Shaping runs at the result store's
// own 1 MB cap: a shaper that refuses on size alone (the real write
// contexts use compact itself as the shaper) is re-run at that cap so the
// safely shaped value can be stored.
export async function safeShapeStored(ctx, value, label = 'vercel_write') {
  if (typeof ctx.shape !== 'function') throw new Error('Output shaper is unavailable');
  let output;
  try {
    output = compact(ctx.shape(value), 1048576);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    output = compact(value, 1048576);
  }
  const encoded = JSON.stringify(output);
  if (output === undefined || !encoded) {
    throw new Error('Output cannot be safely shaped within 8 KB');
  }
  if (Buffer.byteLength(encoded) <= 8192) return output;
  const db = ctx.db, conn = ctx.connection;
  if (typeof db?.putResult !== 'function' || !conn?.resultOwner || !conn?.account) {
    throw new Error('Output cannot be safely shaped within 8 KB');
  }
  const count = Array.isArray(output) ? output.length :
    Array.isArray(output?.rows) ? output.rows.length : 1;
  const summary = String(label).slice(0, 100) + ': ' + count + ' saved record(s)';
  const issued = await db.putResult({
    account: conn.account, owner: conn.resultOwner, summary, body: output
  });
  return {
    status: 'stored', handle: issued.handle, expiresAt: issued.expiresAt,
    count, summary, preview: encoded.slice(0, 500),
    next: 'Call vercel_get_result with this handle and optional page/fields'
  };
}
// AUD-Y (VMCP-011, second layer): store a value and return its
// reference UNCONDITIONALLY (safeShapeStored stores only past the
// inline bound). The write executor's audit fitting uses this when
// an audit entry's fields each fit the bound but their sum exceeds
// the audit writer's aggregate record cap. With no usable result
// store it throws the same error safeShape throws — the refusal is
// preserved, never a silent truncation.
export async function storedReference(ctx, value, label = 'vercel_write') {
  if (typeof ctx.shape !== 'function') throw new Error('Output shaper is unavailable');
  const db = ctx.db, conn = ctx.connection;
  if (typeof db?.putResult !== 'function' || !conn?.resultOwner || !conn?.account) {
    throw new Error('Output cannot be safely shaped within 8 KB');
  }
  let output;
  try { output = compact(ctx.shape(value), 1048576); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    output = compact(value, 1048576);
  }
  const encoded = JSON.stringify(output);
  if (output === undefined || !encoded) {
    throw new Error('Output cannot be safely shaped within 8 KB');
  }
  const count = Array.isArray(output) ? output.length :
    Array.isArray(output?.rows) ? output.rows.length : 1;
  const summary = String(label).slice(0, 100) + ': ' + count + ' saved record(s)';
  const issued = await db.putResult({
    account: conn.account, owner: conn.resultOwner, summary, body: output
  });
  return {
    status: 'stored', handle: issued.handle, expiresAt: issued.expiresAt,
    count, summary, preview: encoded.slice(0, 500),
    next: 'Call vercel_get_result with this handle and optional page/fields'
  };
}
// AUD-X (VMCP-011): the caller-facing sibling of safeShapeStored. A
// write result that shapes safely but exceeds the 8 KB display bound
// is returned screened at the storage cap instead of throwing after
// the write has landed and verified — the MCP delivery layer
// (AUD-D) then stores it and answers with the receipt plus handle.
// Only a size failure takes this path: a shaper refusal for any
// other reason (secrets, cycles, depth) still throws, exactly as
// safeShape does. The audit and replay copies of the same result go
// through safeShapeStored, so they become stored references.
export function safeShapeForReturn(ctx, value) {
  try { return safeShape(ctx, value); }
  catch (error) {
    const sizeOnly = error instanceof RangeError ||
      (error instanceof Error && error.message === 'Output cannot be safely shaped within 8 KB');
    if (!sizeOnly) throw error;
    try { return compact(ctx.shape(value), 1048576); }
    catch (shapeError) {
      if (!(shapeError instanceof RangeError)) throw shapeError;
      return compact(value, 1048576);
    }
  }
}
export async function writePreflight(spec, args, ctx) {
  const conn = ctx?.connection;
  if (!conn?.account || !['preview','production'].includes(conn.mode) ||
    !['read_only','everyday','full'].includes(conn.profile)) {
    return { refused: refusal('A verified scoped account connection is required') };
  }
  if (conn.profile === 'read_only') {
    return { refused: refusal('Read-only connections cannot change resources') };
  }
  // AUD-AQ gate 3 (preflight): the connection's own read-only switch,
  // refused in the same position — before the purchase branch — with the
  // remedy named. Only OAuth connections carry the flag; pass
  // connections are minted without it and never reach this refusal.
  if (conn.readOnly === true) {
    return { refused: refusal('This connection\'s read-only switch is on, so it cannot change resources. The switch is yours: flip it off with vercel_set_read_only when you want this connection to write again') };
  }
  if (['audit','shape','guardProtected','guardApp'].some(k => typeof ctx[k] !== 'function')) {
    return { refused: refusal('The mandatory write-safety services are unavailable') };
  }
  let before, production, targets, summary;
  try {
    before = await spec.before(args, ctx);
    production = await spec.production(args, ctx, before);
    targets = await spec.targets(args, before, ctx);
    summary = await safeShapeStored(ctx, await spec.preview(args, ctx, before), spec.name);
    if (typeof production?.production !== 'boolean' ||
      typeof production.why !== 'string' || !Array.isArray(targets)) {
      return { refused: refusal('Unknown production status or affected targets') };
    }
  } catch (error) {
    return { refused: refusal(refusalReason(error,
      'Could not safely preview or classify the change')) };
  }
  if (production.production && conn.mode !== 'production') {
    return { refused: refusal('Live resources cannot be changed from a preview connection') };
  }
  try {
    const protectedResult = await ctx.guardProtected(targets, ctx);
    const appResult = await ctx.guardApp(targets, ctx);
    if (protectedResult?.blocked !== false || appResult?.blocked !== false) {
      return { refused: refusal(protectedResult?.reason || appResult?.reason ||
        'A protected or app-owned resource cannot be changed') };
    }
  } catch {
    return { refused: refusal('A resource safety guard is unavailable') };
  }
  let moneyLine=null,spendCents=null,purchase=null,spendDeclaration=null;
  if(spec.risk?.spend){
    if(typeof spec.spend!=='function')
      return {refused:refusal('A declared provider price is required')};
    try {
      const spend=await spec.spend(args,ctx,before);
      if(!spend||spend.cents===undefined||!Number.isSafeInteger(spend.cents??0)||spend.cents<0||
        typeof spend.description!=='string'||!spend.description.trim()||
        typeof spend.recurring!=='boolean')
        return {refused:refusal('Provider pricing is invalid or unavailable')};
      spendCents=spend.cents;
      // Bind execution to the same fee declaration evaluated at preview.
      // A nominally free write may become paid while the owner confirms.
      spendDeclaration={cents:spend.cents,recurring:spend.recurring,
        description:spend.description.trim()};
      // An initial $0 is not free if recurring charges can follow.
      if(spend.cents===0 && spend.recurring===false){
        if(typeof ctx.checkSpend!=='function')
          return {refused:refusal('Zero-cost policy service is unavailable')};
        const check=await ctx.checkSpend(spend,Boolean(args.confirm));
        if(!check||typeof check.allowed!=='boolean')
          return {refused:refusal('Spend check did not return a decision')};
        moneyLine=check.explanation;
        if(!check.allowed&&check.code!=='needs_confirmation')
          return {refused:refusal(check.explanation||'Spending was refused',check.code)};
      }else if(conn?.kind==='pass'&&conn?.passAllowWrites===true){
        // R-1W pass delegation (BATCH-R amendment, 2026-10-30): a genuine
        // write pass — identified by the authority fields the RTC door
        // minted onto its frozen connection at authorization — is a
        // delegated credential, never the owner's word and never a grant
        // consumer. Its standing ceiling is the whole authority: a fixed
        // known price at or under the ceiling proceeds journaled as a pass
        // delegation; anything recurring or unquantified refuses, exactly
        // as on the grant path, because no provider-enforceable ceiling
        // exists. A pass-shaped connection WITHOUT the minted claim is not
        // a write pass and keeps the AUD-A2 grant path below, unchanged.
        if(!isWritePassConnection(conn))
          return {refused:refusal('Pass spend authority cannot be verified')};
        if(spend.recurring||spend.cents===null)
          return {refused:refusal('Recurring or unquantified spend cannot be delegated to a pass; it needs the account owner directly')};
        if(spend.cents>conn.passSpendLimitCents)
          return {refused:refusal('This purchase exceeds the spend ceiling on this pass')};
        purchase={cents:spend.cents,recurring:false,
          description:spend.description.trim(),
          delegation:{basis:'pass',ceilingCents:conn.passSpendLimitCents,
            quotedCents:spend.cents}};
        moneyLine=spend.description.trim()+': $'+(spend.cents/100).toFixed(2)+
          ' USD, within this pass spend ceiling of $'+
          (conn.passSpendLimitCents/100).toFixed(2)+' (delegated pass spend).';
      }else{
        // AUD-A2 policy branch (design D-A, OP-2): on the account owner's own
        // connection, AUD-A1's standing policy decides. With
        // grantRequired = false the owner's confirmed word executes: no
        // purchase intent is demanded, the budget only frames the dollar
        // line, and recurring/unquantified spend is disclosed honestly
        // instead of refused. Every other connection — delegated/pass,
        // builder/TEST, or any connection whose policy cannot be read —
        // keeps the grant path below byte-for-byte: no daily allowance and
        // no AI-supplied confirm can buy anything there; the central write
        // executor requests and consumes a separate owner-authenticated,
        // transaction-specific, immutable purchase grant.
        let ownerPolicy=null;
        if(isOwnerConnection(conn)&&typeof ctx.db?.getPurchasePolicy==='function'){
          try{ownerPolicy=await ctx.db.getPurchasePolicy(conn.account);}catch{ownerPolicy=null;}
          if(ownerPolicy!==null&&
            (typeof ownerPolicy!=='object'||typeof ownerPolicy.grantRequired!=='boolean'||
              !(ownerPolicy.budgetCents===null||
                (Number.isSafeInteger(ownerPolicy.budgetCents)&&ownerPolicy.budgetCents>=0))))
            return {refused:refusal('Purchase policy cannot be verified')};
        }
        if(ownerPolicy&&ownerPolicy.grantRequired===false){
          let spentToday=null;
          if(typeof ctx.db?.getTodaySpendCents==='function'){
            try{spentToday=await ctx.db.getTodaySpendCents(conn.account);}catch{spentToday=null;}
          }else if(Number.isSafeInteger(ctx.spentTodayCents)&&ctx.spentTodayCents>=0){
            spentToday=ctx.spentTodayCents;
          }
          if(!Number.isSafeInteger(spentToday)||spentToday<0)
            return {refused:refusal('Purchase policy cannot be verified')};
          const framed=purchaseDisclosure({description:spend.description.trim(),
            cents:spend.cents,recurring:spend.recurring,
            budgetCents:ownerPolicy.budgetCents,spentTodayCents:spentToday});
          purchase={cents:spend.recurring?null:spend.cents,recurring:spend.recurring,
            description:spend.description.trim(),delegation:framed.delegation};
          moneyLine=framed.moneyLine;
        }else{
          purchase={cents:spend.recurring?null:spend.cents,recurring:spend.recurring,
            description:spend.description.trim()};
          moneyLine=spend.description.trim()+': '+
            (spend.cents===null?'variable usage; a provider-enforceable total ceiling is required':
              String.fromCharCode(36)+(spend.cents/100).toFixed(2)+' USD'+
              (spend.recurring?' per billing period; provider-enforceable total ceiling required':''))+
            '. Separately authenticated approval for this transaction is mandatory.';
        }
      }
    }catch(error){
      return {refused:refusal(refusalReason(error,
        'Unable to verify pricing before the request'))};
    }
  }
  if (spec.risk?.access) {
    if (typeof spec.access !== 'function') return { refused: refusal('Access guard declaration missing') };
    try {
      const access = await spec.access(args, before, ctx);
      if (typeof access?.widens !== 'boolean' ||
        (access.widens && (!access.who || !access.what))) {
        return { refused: refusal('Access widening cannot be verified') };
      }
    } catch (error) {
      return { refused: refusal(refusalReason(error,
        'Access widening could not be verified')) };
    }
  }
  return { before, production, targets, summary, moneyLine, spendCents,
    mode: production.production ? 'PRODUCTION' : 'PREVIEW',purchase,spendDeclaration };
}
