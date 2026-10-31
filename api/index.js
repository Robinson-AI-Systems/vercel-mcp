import { registry } from '../src/tools/index.js';
import { profileToolCounts } from '../src/core/mcp-server.js';
import { SERVICE_VERSION } from '../src/service-identity.js';
import { FRONT_DOOR_PRODUCT_NAME, frontDoorPage } from '../src/front-door.js';

export default function handler(req, res) {
  const counts = profileToolCounts(registry);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const body =
    '<p>Status: hosted service endpoint</p>' +
    '<p>' + FRONT_DOOR_PRODUCT_NAME + ' lets your AI assistant operate your ' +
    'Vercel account — projects, deployments, domains, DNS, storage and ' +
    'billing — through guarded tools that preview every change, ask before ' +
    'anything is spent, and keep a journal you can inspect.</p>' +
    '<div class="card">' +
    '<p>Registered tools: ' + registry.tools.length + '</p>' +
    '<p>Available by connection profile: read-only ' + counts.read_only +
    ' · everyday ' + counts.everyday + ' · full ' + counts.full + '</p>' +
    '<p>Service version: ' + SERVICE_VERSION + '</p>' +
    '<p>MCP endpoint: <code>/api/mcp</code></p>' +
    '<p>OAuth issuer: <code>/.well-known/oauth-authorization-server</code></p>' +
    '</div>' +
    '<p>Account connection and permissions are private; sign in through the ' +
    'authenticated setup page to inspect them. This public page does not ' +
    'certify live provider or RTC acceptance.</p>' +
    '<p><a class="cta" href="/connection">Connect an assistant</a>' +
    '<a href="https://github.com/Robinson-AI-Systems/vercel-mcp/blob/main/docs/START-HERE.md">Setup and documentation</a></p>';
  return res.status(200).send(frontDoorPage({
    title: FRONT_DOOR_PRODUCT_NAME,
    heading: FRONT_DOOR_PRODUCT_NAME,
    body
  }));
}
