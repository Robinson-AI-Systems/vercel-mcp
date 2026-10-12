// Provider-neutral write policy. Unknown targets and missing guards always deny.
import { compact } from './util.js';
export function refusal(reason, status = 'refused_by_guard') {
  return { status, confirmed: false, reason };
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
export async function writePreflight(spec, args, ctx) {
  const conn = ctx?.connection;
  if (!conn?.account || !['preview','production'].includes(conn.mode) ||
    !['read_only','everyday','full'].includes(conn.profile)) {
    return { refused: refusal('A verified scoped account connection is required') };
  }
  if (conn.profile === 'read_only') {
    return { refused: refusal('Read-only connections cannot change resources') };
  }
  if (['audit','shape','guardProtected','guardApp'].some(k => typeof ctx[k] !== 'function')) {
    return { refused: refusal('The mandatory write-safety services are unavailable') };
  }
  let before, production, targets, summary;
  try {
    before = await spec.before(args, ctx);
    production = await spec.production(args, ctx, before);
    targets = await spec.targets(args, before, ctx);
    summary = safeShape(ctx, await spec.preview(args, ctx, before));
    if (typeof production?.production !== 'boolean' ||
      typeof production.why !== 'string' || !Array.isArray(targets)) {
      return { refused: refusal('Unknown production status or affected targets') };
    }
  } catch {
    return { refused: refusal('Could not safely preview or classify the change') };
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
      }else{
        // No daily allowance and no AI-supplied confirm can buy anything.
        // The central write executor requests and consumes a separate owner-
        // authenticated, transaction-specific, immutable purchase grant.
        purchase={cents:spend.recurring?null:spend.cents,recurring:spend.recurring,
          description:spend.description.trim()};
        moneyLine=spend.description.trim()+': '+
          (spend.cents===null||spend.recurring?'variable usage or ongoing recurring charges; a provider-enforceable total ceiling is required':
            '$'+(spend.cents/100).toFixed(2)+' USD')+
          '. Separately authenticated approval for this transaction is mandatory.';
      }
    }catch{
      return {refused:refusal('Unable to verify pricing before the request')};
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
    } catch {
      return { refused: refusal('Access widening could not be verified') };
    }
  }
  return { before, production, targets, summary, moneyLine, spendCents,
    mode: production.production ? 'PRODUCTION' : 'PREVIEW',purchase,spendDeclaration };
}
