// Only API transport boundary. Tokens never appear in errors, logs or persisted results.
import { createHash } from 'node:crypto';
import { operation } from './operations.js';
import { readBoundedJson } from './bounded-json.js';
import {readBoundedRuntimeLogs} from './runtime-log-stream.js';
import { validateRequest,documentedRead } from './openapi-validation.js';
import { createDb } from '../db.js';

export const VERCEL_API_BASE = 'https://api.vercel.com';
export const OPENAPI_SNAPSHOT = Object.freeze({
  date: '2026-10-11',
  sha256: 'af1db6e9c95e446468f0c3974653298afe8079db03ee2872429a65cb60a72544',
  operations: 451
});

const TEN_MINUTES = 600000;
const RETRYABLE = new Set(['GET', 'HEAD', 'DELETE']);
const READS = new Set(['GET', 'HEAD']);
const FORBIDDEN_FLAGS = new Set(['dryRun', 'confirm', 'fields', 'detail', 'requestKey']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([name, item]) => !FORBIDDEN_FLAGS.has(name) && item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => [name, canonical(item)]));
}

/** Consistent ten-minute request key. Caller-provided override wins. */
export function requestKey(ctx, tool, args = {}) {
  if (typeof args.requestKey === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(args.requestKey)) {
    return args.requestKey;
  }
  if (args.requestKey !== undefined) throw new TypeError('Invalid request key');
  const at = ctx.now ?? Date.now();
  const scoped = { account: ctx.account || ctx.vercel_account, mode: ctx.mode || 'preview',
    tool, args: canonical(args) };
  const hash = createHash('sha256').update(JSON.stringify(scoped)).digest('hex').slice(0, 40);
  const name = String(tool).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  return 'rmcp_' + name + '_' + hash + '_' + Math.floor(at / TEN_MINUTES);
}

function error(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function parseWaitMs(response, envelope, now) {
  const retry = response.headers.get('retry-after');
  if (retry) {
    const seconds = Number(retry);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
    const date = Date.parse(retry);
    if (Number.isFinite(date)) return Math.max(0, date - now());
  }
  const resetMs = envelope?.error?.limit?.resetMs;
  if (Number.isFinite(Number(resetMs)) && resetMs != null) {
    return Math.max(0, Number(resetMs) - now());
  }
  const reset = envelope?.error?.limit?.reset ?? response.headers.get('x-ratelimit-reset');
  if (reset == null) return null;
  const n = Number(reset);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, (n < 1e11 ? n * 1000 : n) - now());
}

function asQuery(url, query) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else url.searchParams.set(key, String(value));
  }
}

function safeReplayResult(value) {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > 8192) {
    throw error('unsafe_write_result', 'Result must be small and safely shaped');
  }
  const walk = item => {
    if (!item || typeof item !== 'object') return;
    for (const [name, child] of Object.entries(item)) {
      if (/(token|password|secret|credential|private.?key|auth.?code|env.?value)/i.test(name)) {
        throw error('unsafe_write_result', 'Result contains a sensitive field');
      }
      walk(child);
    }
  };
  walk(value);
  if (/(?:vcp_|vca_|vci_|vcr_|github_pat_|ghp_|sk_live_|whsec_)[a-zA-Z0-9_-]{12,}/.test(text)) {
    throw error('unsafe_write_result', 'Result contains credential-shaped content');
  }
  return value;
}

function responseError(response, envelope) {
  const code = typeof envelope?.error?.code === 'string' && /^[\w-]{1,80}$/.test(envelope.error.code)
    ? envelope.error.code : 'vercel_api_error';
  // Intentionally omit the upstream message: it can include provider secrets.
  return error(code, 'Vercel API request failed (HTTP ' + response.status + ')', { status: response.status });
}

/**
 * replayStore must implement atomic claim({key,account,mode,tool,ttlMs}) returning
 * {state:'claimed'|'pending'|'completed',result?}, and complete({key,result}).
 * It must be durable and shared across instances; no memory fallback is supplied.
 * Writes also require shapeResult so raw Vercel output cannot enter the replay log.
 */
export function makeVercelClient({
  token, account, fetchImpl = fetch, baseUrl = VERCEL_API_BASE,
  replayStore = createDb().requestReplayStore(), now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (typeof token !== 'string' || !token || !account?.team_id) {
    throw new TypeError('A server-side token and selected team account are required');
  }
  const base = new URL(baseUrl);
  if (baseUrl === VERCEL_API_BASE && base.protocol !== 'https:') throw new TypeError('Invalid Vercel API origin');

  async function request(id, params = {}, options = {}) {
    const indexed=typeof id==='string'&&id.startsWith('api:');
    const spec = indexed?documentedRead(id.slice(4)):operation(id);
    const method = spec.method;
    if(options.fileContent===true && (id!=='deployments_file_get'||method!=='GET'))
      throw new TypeError('Bounded file reads apply only to the pinned deployment file endpoint');
    if(options.streamLogs===true && (id!=='runtime_logs_get'||method!=='GET'))
      throw new TypeError('Streaming is only available for runtime log reads');
    // Short read-only status polling must not inherit a 25s network stall.
    const timeoutMs = options.timeoutMs ?? 25000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 25000 ||
        (method !== 'GET' && options.timeoutMs !== undefined))
      throw new TypeError('Invalid provider read timeout');
    if(indexed&&params.path?.teamId!==undefined&&params.path.teamId!==account.team_id)
      throw error('team_scope_mismatch','Documented read cannot address another team');
    const query = { ...params.query };
    if (query.teamId !== undefined && query.teamId !== account.team_id) {
      throw error('team_scope_mismatch', 'The operation cannot access a different Vercel team');
    }
    // Git namespace discovery is token-scoped and its published endpoint does not
    // accept teamId. Only explicitly declared exceptions may omit the stored team.
    if (spec.teamScoped === false) {
      if (query.teamId !== undefined) throw error('team_scope_mismatch', 'This operation does not accept a team override');
    } else query.teamId = account.team_id;
    validateRequest(id, { path: params.path || {}, query, body: params.body });
    let pathname = spec.path;
    for (const [key, value] of Object.entries(params.path || {})) {
      if (!['string', 'number'].includes(typeof value)) throw new TypeError('Invalid path parameter');
      pathname = pathname.replace('{' + key + '}', encodeURIComponent(String(value)));
    }
    if (pathname.includes('{')) throw new TypeError('Missing API path parameter');
    const url = new URL(pathname, base);
    asQuery(url, query);
    const isWrite = !READS.has(method);
    let key, claimId;
    if (isWrite) {
      if (!replayStore?.claim || !replayStore?.complete || typeof options.shapeResult !== 'function') {
        throw error('write_guard_unavailable', 'Safe persistent replay and output shaping are required for writes');
      }
      key = requestKey({ account: account.id, mode: options.mode || 'preview', now: now() },
        options.tool || id, { ...params, requestKey: options.requestKey });
      const claimed = await replayStore.claim({ key, account: account.id, mode: options.mode || 'preview',
        tool: options.tool || id, ttlMs: TEN_MINUTES });
      if (claimed?.state === 'completed') return claimed.result;
      if (claimed?.state !== 'claimed') {
        throw error('request_in_progress', 'Write outcome not yet verified; do not retry blindly', { confirmed: null });
      }
      claimId = claimed.claimId;
    }
    let response, envelope;
    for (let attempt = 0; attempt < 2; attempt++) {
      const signal=AbortSignal.timeout(timeoutMs);
      try {
        response = await fetchImpl(url.toString(), {
          method, headers: { authorization: 'Bearer ' + token,
            accept: options.streamLogs === true ? 'application/stream+json' : 'application/json',
            ...(params.body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
          signal, ...(indexed?{redirect:'error'}:{})
        });
      } catch (cause) {
        if (attempt === 0 && RETRYABLE.has(method) && cause?.name !== 'TimeoutError' &&
            cause?.name !== 'AbortError') continue;
        throw error('outcome_unknown', 'Vercel request outcome needs read-back verification',
          { confirmed: null });
      }
      if(response.ok && options.streamLogs===true){
        // An empty HTTP success is not a readable stream. It also cannot
        // establish that the requested historical window had no log events.
        if(response.status===204)return {records:[],stream:{
          bytesRead:0,received:0,cutoff:'no_content',complete:false,
          reason:'Provider returned no content; runtime log window completeness is unknown'
        }};
        // A live stream can remain open with no events. Never translate
        // unreadable upstream framing into a successful empty log window.
        try {
          return await readBoundedRuntimeLogs(response,signal);
        } catch {
          throw error('runtime_log_stream_invalid',
            'Runtime log stream could not be safely decoded', { status: response.status });
        }
      }
      if(response.ok && options.fileContent===true)
        return readBoundedJson(response,signal,8192);
      if(indexed)envelope=response.status===204?null:await readBoundedJson(response,signal,65536);
      else {try { envelope = response.status === 204 ? null : await response.json(); } catch { envelope = null; }}
      if (response.ok) break;
      if (response.status === 429) {
        const waitMs = parseWaitMs(response, envelope, now);
        if (attempt === 0 && READS.has(method) && waitMs !== null && waitMs <= 5000) {
          await sleep(waitMs);
          continue;
        }
        throw error('rate_limited', 'Vercel rate limit reached', { status: 429, retryAfterMs: waitMs });
      }
      if (attempt === 0 && RETRYABLE.has(method) && response.status >= 500) continue;
      if (isWrite && response.status >= 500) {
        throw error('outcome_unknown', 'Vercel write outcome needs read-back verification', { confirmed: null });
      }
      throw responseError(response, envelope);
    }
    if (!response?.ok) throw error('vercel_api_error', 'Vercel API request did not succeed');
    if (isWrite) {
      // Never persist raw provider output, and do not cache secrets in memory.
      const safe = await options.shapeResult(envelope);
      if (safe === undefined) throw error('unsafe_write_result', 'Write result must be safely shaped');
      const verified = safeReplayResult(safe);
      await replayStore.complete({ key, claimId, result: verified });
      return verified;
    }
    return envelope;
  }

  async function paginate(id, params = {}, { max = 100 } = {}) {
    if (!Number.isSafeInteger(max) || max < 1 || max > 10000) throw new TypeError('Invalid pagination cap');
    if (!READS.has(operation(id).method)) throw new TypeError('Pagination requires a read operation');
    const items = [], seen = new Set();
    let cursor;
    while (items.length < max) {
      const query = { ...params.query, limit: Math.min(20, max - items.length) };
      if (cursor !== undefined) query.until = cursor;
      const page = await request(id, { ...params, query });
      const records = Array.isArray(page) ? page : page?.projects || page?.deployments || page?.items || page?.data;
      if (!Array.isArray(records)) throw error('invalid_pagination', 'Vercel API did not provide a list');
      items.push(...records.slice(0, max - items.length));
      const next = page?.pagination?.next;
      if (next == null) return { items, capped: false };
      if (seen.has(String(next))) throw error('invalid_pagination', 'Vercel returned a repeated pagination cursor');
      seen.add(String(next));
      cursor = next;
    }
    return { items, capped: true };
  }
  return { request, paginate };
}
