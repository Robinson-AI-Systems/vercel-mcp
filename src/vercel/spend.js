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
export function spendPreflight({ declaration, spentTodayCents, spendLimitCents, confirm = false }) {
  const quote = classifySpend(declaration);
  const known = quote.cents !== null;
  if (!Number.isSafeInteger(spendLimitCents) || spendLimitCents < 0 ||
    !Number.isSafeInteger(spentTodayCents) || spentTodayCents < 0) {
    return { allowed: false, code: 'spend_settings_unavailable',
      explanation: 'Spend limit or already-used amount cannot be verified' };
  }
  const line = known ?
    quote.description + ': ' + usd(quote.cents) + '. Today: ' + usd(spentTodayCents) +
      ' of ' + usd(spendLimitCents) + '.' :
    quote.description + ': usage-based pricing is not known in advance. ' +
      'The owner must confirm the charge and review provider pricing.';
  if (known && quote.cents + spentTodayCents > spendLimitCents) {
    return { allowed: false, code: 'spend_limit', explanation: line };
  }
  if (!confirm) return { allowed: false, code: 'needs_confirmation', explanation: line };
  return { allowed: true, code: 'allowed', explanation: line };
}
