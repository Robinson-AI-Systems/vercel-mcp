// AUD-AX: front-door production polish acceptance (sign-in cleanup
// dossier, the dossier's AUD-AU card). Every surviving user-facing
// page renders on the shared fleet shell, and rendered public HTML
// carries no reference to the deleted setup route (in the route
// string or in words), no sign-in class language, and no mode
// picker language: grep of rendered public HTML for `setup`,
// `read-only profile`, `choose your mode` -> zero.
import { describe, it, expect } from 'vitest';
import rootHandler from '../../api/index.js';
import connectionHandler from '../../api/connection.js';
import { renderConnectPage } from '../../src/vercel/connect.js';
import { handleIntegrationCallback } from '../../src/vercel/integration.js';
import { createHandoff } from '../../src/developer/handoff.js';
import { FRONT_DOOR_TAGLINE } from '../../src/front-door.js';

const BANNED = [/setup/i, /read-only profile/i, /choose your mode/i];
const SHELL_MARKS = ['--bg:#0C0C0C', FRONT_DOOR_TAGLINE,
  'Vercel Unleashed is an independent service by Robinson AI Systems'];

function stubRes() {
  const headers = {};
  return {
    headers, statusCode: 200, body: '',
    setHeader(k, v) { headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = JSON.stringify(value); return this; }
  };
}

function expectPolished(html) {
  for (const mark of SHELL_MARKS) expect(html).toContain(mark);
  for (const pattern of BANNED) expect(html).not.toMatch(pattern);
}

describe('AUD-AX front-door polish', () => {
  it('the root page is on the shell with no banned copy', () => {
    const res = stubRes();
    rootHandler({ headers: { accept: 'text/html' }, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expectPolished(res.body);
    // AUD-AX copy-truth: derivation and the switch, not pickers.
    expect(res.body).not.toContain('choose what the assistant may do');
    expect(res.body).toContain('Switch a connection to read-only');
  });

  it('the /connection page describes the shipped sign-in shape', () => {
    const res = stubRes();
    connectionHandler({}, res);
    expect(res.statusCode).toBe(200);
    expectPolished(res.body);
    expect(res.body).toContain('vercel_set_working_box');
    expect(res.body).toContain('vercel_set_read_only');
    expect(res.body).not.toContain('choose how much the connection may do');
    expect(res.body).not.toContain('the profile (read-only, everyday or full)');
  });

  it('the two-doors page renders on the shell in both configurations', () => {
    for (const env of [{}, { VERCEL_INTEGRATION_INSTALL_URL: 'https://vercel.com/integrations/fake' }]) {
      const html = renderConnectPage(env);
      expectPolished(html);
      expect(html).toContain('<h1>Connect your Vercel account</h1>');
    }
    expect(renderConnectPage({})).not.toContain('team setup');
  });

  it('the integration callback result pages render on the shell', async () => {
    const noCode = stubRes();
    await handleIntegrationCallback(
      { method: 'GET', url: '/api/vercel/integration', headers: {} }, noCode, { db: {}, env: {} });
    expect(noCode.statusCode).toBe(400);
    expectPolished(noCode.body);
    expect(noCode.body).toContain('<h1>Install incomplete</h1>');
    expect(noCode.headers['Content-Security-Policy']).toContain("img-src 'self'");

    const wrongMethod = stubRes();
    await handleIntegrationCallback(
      { method: 'POST', url: '/api/vercel/integration', headers: {} }, wrongMethod, { db: {}, env: {} });
    expect(wrongMethod.statusCode).toBe(405);
    expectPolished(wrongMethod.body);
  });

  it('the developer handoff result pages render on the shell, JSON keeps the stricter CSP', async () => {
    const store = { async find() { return { expires_at: new Date(0) }; } };
    const handler = createHandoff({
      store, origin: 'https://service.example', getClient: async () => null
    });
    const res = stubRes();
    await handler(
      { method: 'GET', query: { state: 'a'.repeat(43), code: 'b'.repeat(43) }, headers: {} }, res);
    expect(res.statusCode).toBe(410);
    expectPolished(res.body);
    expect(res.body).toContain('This connection request expired');
    expect(res.headers['Content-Security-Policy']).toContain("img-src 'self'");
  });
});
