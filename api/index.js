import { registry } from '../src/tools/index.js';
import { profileToolCounts } from '../src/core/mcp-server.js';
import { SERVICE_DISPLAY_NAME } from '../src/service-identity.js';

export default function handler(req, res) {
  const counts = profileToolCounts(registry);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + SERVICE_DISPLAY_NAME + '</title></head><body>' +
    '<main><h1>' + SERVICE_DISPLAY_NAME + '</h1><p>Status: hosted service endpoint</p>' +
    '<p>Account connection and permissions are private; sign in through the authenticated setup page to inspect them. This public page does not certify live provider or RTC acceptance.</p>' +
    '<p>Registered tools: ' + registry.tools.length + '</p>' +
    '<p>Available by connection profile: read-only ' + counts.read_only +
    ' · everyday ' + counts.everyday + ' · full ' + counts.full + '</p>' +
    '<p>OAuth issuer: <code>/.well-known/oauth-authorization-server</code></p>' +
    '<p>MCP endpoint: <code>/api/mcp</code></p>' +
    '<p><a href="https://github.com/Robinson-AI-Systems/vercel-mcp/blob/main/docs/START-HERE.md">Setup and documentation</a></p>' +
    '</main></body></html>'
  );
}
