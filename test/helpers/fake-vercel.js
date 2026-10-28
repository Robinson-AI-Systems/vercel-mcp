// Test-only fake of Vercel's REST API at the HTTP level, built for vercel-mcp (A-1).
// `makeFakeVercel()` returns a `fetch`-compatible function to inject into code under test (A-4's client takes `fetch`),
// the list of recorded calls, and `when()` to configure answers. Nothing here talks to the network.
//
//   const vercel = makeFakeVercel();
//   vercel.when('GET', '/v9/projects/{idOrName}').resolves({ id: 'prj_FAKE1', name: 'demo' });
//   vercel.when('GET', '/v6/deployments').rejects(503).resolves({ deployments: [] });   // 503 once, then 200
//   vercel.when('POST', '/v13/deployments').rateLimited(2000);                          // 429, resets in 2 s
//   await vercel.fetch('https://api.vercel.com/v9/projects/demo?teamId=team_FAKE1', { headers: { Authorization: 'Bearer vcp_FAKE' } });
//   vercel.calls[0] → { method: 'GET', path: '/v9/projects/demo', params: { idOrName: 'demo' },
//                       query: { teamId: 'team_FAKE1' }, body: undefined, headers: { authorization: 'Bearer [hidden]' } }
//
// Responses configured on one rule are used in order; the last one repeats. The newest matching rule wins.
// A call no rule matches rejects with an error naming it, is kept in `unmatched`, and makes `verify()` throw — so
// code that swallows fetch errors still fails the test.

const DEFAULT_BASE = 'https://api.vercel.com';

function compile(pattern) {
  const names = [];
  const source = pattern.split('/').map((part) => {
    const param = /^\{(\w+)\}$/.exec(part) || /^:(\w+)$/.exec(part);
    if (param) { names.push(param[1]); return '([^/]+)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  const regex = new RegExp(`^${source}/?$`);
  return (path) => {
    const m = regex.exec(path);
    if (!m) return null;
    return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(m[i + 1])]));
  };
}

function readHeaders(raw) {
  const out = {};
  new Headers(raw || {}).forEach((value, key) => {
    out[key] = key === 'authorization' ? value.replace(/^(\w+)\s+.*$/, '$1 [hidden]') : value;
  });
  return out;
}

function readQuery(searchParams) {
  const query = {};
  for (const [key, value] of searchParams) {
    if (!Object.hasOwn(query, key)) query[key] = value;
    else query[key] = [].concat(query[key], value);
  }
  return query;
}

function readBody(body, headers) {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'string') return body;
  if (/json/.test(headers['content-type'] || '') || /^[[{]/.test(body.trim())) {
    try { return JSON.parse(body); } catch { return body; }
  }
  return body;
}

function json(status, value, headers = {}) {
  const body = status === 204 || value === undefined ? null : JSON.stringify(value);
  return new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** Vercel's error envelope: { error: { code, message } } */
export function vercelError(status, code, message) {
  const defaults = { 400: 'bad_request', 401: 'not_authenticated', 403: 'forbidden', 404: 'not_found',
    409: 'conflict', 500: 'internal_server_error', 503: 'service_unavailable' };
  return { error: { code: code || defaults[status] || 'error', message: message || `Fake Vercel error ${status}` } };
}

/**
 * @param {{ base?: string, now?: () => number }} [options] base: the API origin the code under test uses;
 *   now: clock for rate-limit reset times.
 */
export function makeFakeVercel({ base = DEFAULT_BASE, now = () => Date.now() } = {}) {
  const calls = [];
  const unmatched = [];
  const rules = [];

  function when(method, pathPattern) {
    const rule = { method: method.toUpperCase(), pattern: pathPattern, match: compile(pathPattern), queue: [], used: 0 };
    rules.push(rule);
    const api = {
      resolves(value, status = 200, headers = {}) {
        rule.queue.push(() => json(status, value, headers));
        return api;
      },
      rejects(status, errorBody) {
        rule.queue.push(() => json(status, errorBody ?? vercelError(status)));
        return api;
      },
      rateLimited(resetMs = 1000, total = 100) {
        rule.queue.push(() => {
          const at = now() + resetMs;
          const reset = Math.ceil(at / 1000);
          return json(429, { error: { code: 'rate_limited', message: 'Rate limit exceeded',
            limit: { remaining: 0, reset, resetMs: at, total } } },
          { 'x-ratelimit-limit': String(total), 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) });
        });
        return api;
      }
    };
    return api;
  }

  async function fakeFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), base);
    const method = (init.method || request?.method || 'GET').toUpperCase();
    const headers = readHeaders(init.headers || request?.headers);
    const body = readBody(init.body ?? (request ? await request.clone().text() || undefined : undefined), headers);
    const call = { method, path: url.pathname, params: {}, query: readQuery(url.searchParams), body, headers };
    calls.push(call);
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      if (rule.method !== method) continue;
      const params = rule.match(url.pathname);
      if (!params) continue;
      if (!rule.queue.length) throw new Error(`fake-vercel: ${method} ${rule.pattern} has no response configured`);
      call.params = params;
      const respond = rule.queue[Math.min(rule.used, rule.queue.length - 1)];
      rule.used += 1;
      return respond();
    }
    unmatched.push(`${method} ${url.pathname}`);
    throw new Error(`fake-vercel: unexpected call ${method} ${url.pathname} — configure it with when()`);
  }

  function verify() {
    if (unmatched.length) throw new Error(`fake-vercel: unexpected calls: ${unmatched.join(', ')}`);
  }

  /**
   * Model a genuinely project-scoped token (AUD-F / VMCP-022): the user and
   * teams reads are outside the token's scope — refused with a provider-style
   * 403 by default, or empty when `teams: 'empty'` — while the projects read
   * returns exactly the scoped project (or none) and the direct project read
   * returns that project, whose `accountId` names its owning team. Register
   * this after any broader `when()` rules for the same paths; newest wins.
   */
  function scopedProject(project, { teams = 'refuse' } = {}) {
    when('GET', '/v2/user').rejects(403);
    if (teams === 'empty') {
      when('GET', '/v2/teams').resolves({ teams: [], pagination: { next: null } });
    } else {
      when('GET', '/v2/teams').rejects(403);
    }
    when('GET', '/v10/projects').resolves({
      projects: project ? [project] : [], pagination: { next: null }
    });
    if (project) when('GET', '/v9/projects/{idOrName}').resolves(project);
    return api;
  }

  const api = { fetch: fakeFetch, calls, unmatched, when, verify, scopedProject };
  return api;
}
