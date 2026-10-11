import { describe, expect, it } from 'vitest';
import { escapeHtml, only, paramsOf, publicOrigin, send } from '../../src/core/http.js';

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; }
  };
}

describe('service-neutral HTTP helpers', () => {
  it('requires a fixed HTTPS origin without credentials, path, query, or fragment', () => {
    expect(publicOrigin({ PUBLIC_BASE_URL: 'https://mcp.example.test/' })).toBe('https://mcp.example.test');
    for (const value of [
      '', 'http://mcp.example.test', 'https://mcp.example.test/path',
      'https://user:pass@mcp.example.test', 'https://mcp.example.test/?x=1',
      'https://mcp.example.test/#fragment'
    ]) expect(() => publicOrigin({ PUBLIC_BASE_URL: value })).toThrow(/HTTPS origin/);
  });

  it('escapes HTML metacharacters in user-provided text', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
    expect(escapeHtml(null)).toBe('');
  });

  it('sends no-store and nosniff headers for JSON and HTML responses', () => {
    const res = response();
    send(res, 200, { ok: true });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Type']).toContain('application/json');

    const html = response();
    send(html, 200, '<h1>safe</h1>', 'text/html; charset=utf-8');
    expect(html.body).toBe('<h1>safe</h1>');
    expect(html.headers['Content-Type']).toContain('text/html');
  });

  it('parses only supported request shapes and bounds string bodies', () => {
    expect(paramsOf({ method: 'GET', query: { code: 'abc' } })).toEqual({ code: 'abc' });
    expect(paramsOf({ method: 'POST', body: { code: 'abc' } })).toEqual({ code: 'abc' });
    expect(paramsOf({
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=abc&state=xyz'
    })).toEqual({ code: 'abc', state: 'xyz' });
    expect(paramsOf({
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"abc"}'
    })).toEqual({ code: 'abc' });
    expect(() => paramsOf({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '[' })).toThrow();
    expect(() => paramsOf({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).toThrow(/Unsupported/);
    expect(() => paramsOf({ method: 'POST', headers: {}, body: 'x'.repeat(16385) })).toThrow(/Invalid request/);
  });

  it('returns a safe 405 response for unsupported methods', () => {
    const res = response();
    expect(only(res, { method: 'PUT' }, ['GET', 'POST'])).toBe(false);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, POST');
    expect(JSON.parse(res.body)).toEqual({ error: 'method_not_allowed' });
  });
});
