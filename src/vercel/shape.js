// Vercel-specific secret paths and MCP presentation built on provider-neutral core.
import { randomBytes } from 'node:crypto';
import { compact, credentialLike } from '../core/util.js';

const BANNER = 'PRODUCTION — live resources may be affected.';
// AUD-AU (dossier D8): one-time secrets are revealed through the
// owner's reveal tool now, not the setup page AUD-AV deletes.
const OWNER_REVEAL_TOOL = 'vercel_reveal_one_time_secret';

export function shapeVercelResult(value, { mode = 'preview' } = {}) {
  const safe = compact(value);
  if (mode !== 'production') return safe;
  return compact({ mode: 'PRODUCTION', banner: BANNER, result: safe });
}

/** Final output boundary: JSON text from handlers is parsed and redacted too. */
export function shapeMcpResult(response, { connection } = {}) {
  if (!response || !Array.isArray(response.content)) throw new TypeError('Invalid MCP result');
  const isProduction = connection?.mode === 'production';
  const shaped = response.content.map(item => {
    if (item?.type !== 'text' || typeof item.text !== 'string') return compact(item);
    let parsed;
    try { parsed = JSON.parse(item.text); } catch { parsed = item.text; }
    const safe = shapeVercelResult(parsed, { mode: isProduction ? 'production' : 'preview' });
    const text = typeof safe === 'string' ? safe : JSON.stringify(safe);
    return { type: 'text', text: isProduction && typeof safe === 'string' ? BANNER + '\n' + text : text };
  });
  return compact({ ...response, content: shaped });
}

/** Never allow credential-shaped plain arguments. Secrets must use server generation.
 * AUD-AV (dossier D9): the pendingInputId source is removed with the
 * setup page — the one-use owner-input vault no longer exists. */
export async function resolveVercelInput(args, {
  secret = false, random = randomBytes
} = {}) {
  if (!args || typeof args !== 'object') throw new TypeError('An input source is required');
  if (Object.hasOwn(args, 'pendingInputId')) {
    throw new TypeError('pendingInputId is no longer accepted: the protected ' +
      'pending-input path was removed with the owner setup page. Supply the ' +
      'value in the Vercel dashboard, or use generation.');
  }
  const sources = [Object.hasOwn(args, 'value'),
    Object.hasOwn(args, 'generate')].filter(Boolean).length;
  if (sources !== 1) throw new TypeError('Choose exactly one input source');
  if (Object.hasOwn(args, 'value')) {
    if (secret || typeof args.value !== 'string' || credentialLike(args.value)) {
      throw new TypeError('Secret-like values must be supplied through generation');
    }
    return { value: args.value, source: 'plain' };
  }
  const gen = args.generate;
  if (!gen || !Number.isInteger(gen.bytes) || gen.bytes < 16 || gen.bytes > 64 ||
    !['hex', 'base64url'].includes(gen.encoding)) {
    throw new TypeError('Generation requires 16–64 bytes and hex or base64url encoding');
  }
  const bytes = random(gen.bytes);
  if (!Buffer.isBuffer(bytes) || bytes.length !== gen.bytes) throw new TypeError('Random source unavailable');
  return { value: bytes.toString(gen.encoding), source: 'generated' };
}

/** Secret values are persisted encrypted by the existing one-time-secrets store, never returned. */
export async function issueVercelSecret({ store, account, kind, label, value }) {
  if (!store?.issue || typeof value !== 'string' || !value || !kind) {
    throw new TypeError('Encrypted one-time secret store and value required');
  }
  const { id, expiresAt } = await store.issue({ account, kind, label, value });
  return { secret: '[hidden]', secretRef: id, revealAt: OWNER_REVEAL_TOOL, expiresAt };
}

/** Safe change-log descriptions never contain the incoming configuration value. */
export function hiddenChangeSummary(label) {
  if (typeof label !== 'string' || credentialLike(label)) return 'value set (hidden)';
  return { label: compact(label), action: 'value set (hidden)' };
}
