// Provider-neutral, fail-closed output shaping. Never truncate or return an unsafe result.
const SECRET_FIELD = /^(?:value|decryptedValue|token|accessToken|refreshToken|secret|secretValue|bypass|bypassSecret|authCode|password|passphrase|privateKey|credential|connectionString|authorization)$/i;
const SECRET_STRING = /(?:vc[pikar]_|vercel_blob_rw_|(?:sk|rk)_(?:live|test)_|whsec_|gh[pousr]_|github_pat_|xox[a-z]?[-_]|AKIA[A-Z0-9]|-----BEGIN\b|postgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@)/i;
const HIGH_ENTROPY = /^(?:[A-Za-z0-9+/]{32,}={0,2}|[a-f0-9]{32,})$/;
const CURRENCY = /(?:Cents|_cents)$/;
const DATE_KEY = /(?:At|Timestamp|_ms|Ms|timestamp)$/;
const HIDDEN = '[hidden]';
const MAX_DEPTH = 20;
const MAX_RESULT_BYTES = 8192;

export function credentialLike(value) {
  return typeof value === 'string' &&
    (SECRET_STRING.test(value) || (HIGH_ENTROPY.test(value) &&
      /[0-9]/.test(value) && /[A-Za-z]/.test(value)));
}
function denver(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1e11 || milliseconds > 4102444800000) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: 'short',
    day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(milliseconds));
}
const usd = cents => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD'
}).format(cents / 100);

/**
 * Redacts nested credentials, adds Denver-local millisecond timestamps and
 * currency presentation while preserving the original integer-cents values.
 * Throws for cycles, excessive depth or oversized output (C-1 adds result handles).
 */
export function compact(input, maxBytes = MAX_RESULT_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576)
    throw new TypeError('Invalid output size limit');
  const seen = new WeakSet();
  function walk(value, depth) {
    if (depth > MAX_DEPTH) throw new TypeError('Result too deeply nested');
    if (typeof value === 'string') return credentialLike(value) ? HIDDEN : value;
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    if (seen.has(value)) throw new TypeError('Cyclic result cannot be presented safely');
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map(item => walk(item, depth + 1));
      const result = {};
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
        result[key] = SECRET_FIELD.test(key) ? HIDDEN : walk(child, depth + 1);
        if (typeof child === 'number' && Number.isSafeInteger(child)) {
          if (DATE_KEY.test(key)) {
            const local = denver(child);
            if (local) result[key + '_local'] = local;
          }
          if (CURRENCY.test(key)) result[key + '_display'] = usd(child);
        }
      }
      return result;
    } finally { seen.delete(value); }
  }
  const result = walk(input, 0);
  const serialized = JSON.stringify(result);
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new RangeError('Result exceeds safe response limit; request a smaller view');
  }
  return result;
}
