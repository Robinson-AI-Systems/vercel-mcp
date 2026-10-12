// Money stays in integer cents; no price is ever accepted from raw user args.
export function usd(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError('Invalid USD cents amount');
  return '$' + (cents / 100).toFixed(2) + ' USD';
}
export function classifySpend({ cents, recurring = false, description = '' }) {
  if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0)) {
    throw new TypeError('Spend must be nonnegative integer cents or null');
  }
  if (typeof recurring !== 'boolean' || typeof description !== 'string' || !description.trim()) {
    throw new TypeError('Spend declaration must explain the charge');
  }
  return { cents, recurring, description: description.trim() };
}
// Legacy daily-limit helper is advisory only. A positive owner limit and
// AI confirm do not authorize a purchase; all paid writes use the separately
// authenticated one-use purchase ledger in core/write.js.
export function spendPreflight({ declaration, spentTodayCents, spendLimitCents, confirm = false }) {
  const quote = classifySpend(declaration);
  if (!Number.isSafeInteger(spendLimitCents) || spendLimitCents < 0 ||
      !Number.isSafeInteger(spentTodayCents) || spentTodayCents < 0) {
    return { allowed:false, code:'spend_settings_unavailable',
      explanation:'Spend settings or already-used amount cannot be verified' };
  }
  const amount = quote.cents === null ? 'unquantified usage' : usd(quote.cents);
  const line = quote.description + ': ' + amount + (quote.recurring ? '; recurring charges' : '') +
    '. Owner daily policy: ' + usd(spentTodayCents) + ' of ' + usd(spendLimitCents) + '.';
  if (quote.recurring || quote.cents === null) {
    return {allowed:false, code:'provider_ceiling_required',
      explanation:line + ' A provider-enforceable total ceiling is required.'};
  }
  if (quote.cents > 0) {
    return {allowed:false, code:'owner_required',
      explanation:line + ' Separately authenticated transaction approval is required.'};
  }
  if (!confirm) return {allowed:false, code:'needs_confirmation',explanation:line};
  return {allowed:true, code:'allowed', explanation:line};
}

// Legacy account-bound advisory adapter; never authorizes a charge. No cost or
// account selection is accepted from MCP caller arguments.
export function accountSpendGuard({db,account}){
  if(typeof account!=='string'||!account ||
    typeof db?.getVercelAccountSafe!=='function'||
    typeof db?.getTodaySpendCents!=='function')
    throw new TypeError('Account-bound spend policy is unavailable');
  return async (declaration,confirm)=>{
    const row=await db.getVercelAccountSafe(account);
    if(!row||row.id!==account||
      !Number.isSafeInteger(row.spend_limit_cents)||row.spend_limit_cents<0)
      return {allowed:false,code:'spend_settings_unavailable',
        explanation:'Owner-approved account spend limit cannot be verified'};
    const spent=await db.getTodaySpendCents(account);
    return spendPreflight({declaration,spentTodayCents:spent,
      spendLimitCents:row.spend_limit_cents,confirm});
  };
}
