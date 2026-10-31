import { registry } from '../src/tools/index.js';
import { profileToolCounts } from '../src/core/mcp-server.js';
import { SERVICE_VERSION } from '../src/service-identity.js';
import { BRANDED_ORIGIN, FRONT_DOOR_CSP, FRONT_DOOR_PRODUCT_NAME, frontDoorPage } from '../src/front-door.js';
import { iconBytes } from '../src/brand-assets.js';

// The anonymous root proves that this process can answer HTTP only.
// No public endpoint may infer owner setup, OAuth consent, provider
// access or acceptance (the reference implementation's rule, adopted).
export function publicInfo(buildSha = process.env.VERCEL_GIT_COMMIT_SHA) {
  const counts = profileToolCounts(registry);
  const sourceSha = typeof buildSha === 'string' && /^[a-f0-9]{40}$/.test(buildSha)
    ? buildSha : null;
  return {
    name: FRONT_DOOR_PRODUCT_NAME, status: 'service-online',
    version: SERVICE_VERSION, deployed_source_sha: sourceSha,
    tools: registry.tools.length,
    tools_by_profile: { read_only: counts.read_only, everyday: counts.everyday, full: counts.full },
    oauth: '/.well-known/oauth-authorization-server', endpoint: '/api/mcp', health: '/api/health',
    note: 'HTTP reachability is not provider setup, OAuth consent or RTC acceptance. ' +
      'Use authenticated owner diagnostics and direct custom MCP calls to verify those separately.'
  };
}

export default function handler(req, res) {
  // The product icon (/brand/icon-256.png, /brand/icon-64.png) is served
  // here too: one function, no static folder (the reference's pattern).
  const icon = String(req.query?.brand_icon || '');
  if (icon === '256' || icon === '64') {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(iconBytes(Number(icon)));
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // People opening the address in a browser get the front-door page;
  // programs (health checks, scripts) keep the plain JSON status.
  if (/\btext\/html\b/.test(String(req.headers?.accept ?? ''))) {
    const counts = profileToolCounts(registry);
    res.setHeader('Content-Security-Policy', FRONT_DOOR_CSP);
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const body =
      '<p class="muted">Status: hosted service endpoint</p>' +
      '<p>' + FRONT_DOOR_PRODUCT_NAME + ' connects Claude, ChatGPT and other AI ' +
      'apps to your Vercel account. You sign in with your own Vercel account; ' +
      'what a connection can do follows the account you connect.</p>' +
      '<ul>' +
      '<li>Work across projects, deployments, domains, DNS, storage, teams and billing.</li>' +
      '<li>Changes are previewed first; spending follows the purchase policy you set, and everything is journaled.</li>' +
      '<li>Switch a connection to read-only and it can look but not change anything — switch it back whenever you like. You can disconnect at any time.</li>' +
      '</ul>' +
      '<section id="connect"><h2>Connect your AI app</h2>' +
      '<p>Paste this address into your AI app when it asks for a server or connector address:</p>' +
      '<code class="addr" id="address">' + BRANDED_ORIGIN + '/api/mcp</code>' +
      '<a class="button" href="/connection">How connecting works</a></section>' +
      '<section><h2>Service facts</h2>' +
      '<p>Registered tools: ' + registry.tools.length + '</p>' +
      '<p>Available by connection profile: read-only ' + counts.read_only +
      ' · everyday ' + counts.everyday + ' · full ' + counts.full + '</p>' +
      '<p>Service version: ' + SERVICE_VERSION + '</p>' +
      '<p>MCP endpoint: <code>/api/mcp</code></p>' +
      '<p>OAuth issuer: <code>/.well-known/oauth-authorization-server</code></p>' +
      '<p>Account connection and permissions are private; sign in to ' +
      'inspect them. This public page does not ' +
      'certify live provider or RTC acceptance.</p></section>';
    return res.status(200).send(frontDoorPage({
      title: FRONT_DOOR_PRODUCT_NAME,
      heading: 'Let your AI assistant run your Vercel, safely',
      body
    }));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).send(JSON.stringify(publicInfo()));
}
