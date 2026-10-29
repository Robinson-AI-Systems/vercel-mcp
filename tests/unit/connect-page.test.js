// AUD-I S2 — the two-doors connection page. One page: Door 1 (the
// Integrations connect flow) is the default with its install entry
// when the operator has configured it, and an honest note when not —
// never a dead button; Door 2 (the token tier) is fully visible on
// the same page with its Five Points and the route to the secure
// setup page. The page itself holds and asks for no secrets.
import { describe, it, expect } from 'vitest';
import { renderConnectPage, integrationInstallUrl, handleConnect }
  from '../../src/vercel/connect.js';

function fakeRes() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

const INSTALL = 'https://vercel.com/integrations/robinson-ai-systems-fake/new';

describe('AUD-I S2: install URL configuration', () => {
  it('honors an https vercel.com URL and rejects everything else', () => {
    expect(integrationInstallUrl({ VERCEL_INTEGRATION_INSTALL_URL: INSTALL })).toBe(INSTALL);
    expect(integrationInstallUrl({})).toBe(null);
    expect(integrationInstallUrl({ VERCEL_INTEGRATION_INSTALL_URL: 'http://vercel.com/x' })).toBe(null);
    expect(integrationInstallUrl({ VERCEL_INTEGRATION_INSTALL_URL: 'https://evil.example/x' })).toBe(null);
    expect(integrationInstallUrl({ VERCEL_INTEGRATION_INSTALL_URL: 'not a url' })).toBe(null);
  });
});

describe('AUD-I S2: the two-doors page', () => {
  it('shows Door 1 with its install entry when configured', () => {
    const html = renderConnectPage({ VERCEL_INTEGRATION_INSTALL_URL: INSTALL });
    expect(html).toContain('Connect a team — recommended');
    expect(html).toContain('href="' + INSTALL + '"');
    expect(html).toContain('Nothing permanent is handed over');
  });

  it('shows an honest note instead of a dead button when unconfigured', () => {
    const html = renderConnectPage({});
    expect(html).toContain('not switched on for this server yet');
    expect(html).not.toContain('integrations/');
  });

  it('keeps Door 2 fully visible with the Five Points and the setup route', () => {
    const html = renderConnectPage({});
    expect(html).toContain('Want account-wide control?');
    expect(html).toContain('freely reversible');
    expect(html).toContain('Your key is the only lock');
    expect(html).toContain('Full Account');
    expect(html).toContain('including never');
    expect(html).toContain('href="/api/vercel/setup"');
    // The page itself never asks for a token.
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('<form');
  });

  it('serves GET only', async () => {
    const get = fakeRes();
    await handleConnect({ method: 'GET', headers: {} }, get, { env: {} });
    expect(get.statusCode ?? 200).toBe(200);
    expect(String(get.body)).toContain('Connect your Vercel account');
    const post = fakeRes();
    await handleConnect({ method: 'POST', headers: {} }, post, { env: {} });
    expect(post.statusCode).toBe(405);
  });
});
