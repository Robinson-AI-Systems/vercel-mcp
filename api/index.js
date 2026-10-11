import { registry } from '../src/tools/index.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }
  const count = registry.tools.length;
  const toolText = count === 1 ? '1 tool is available' : count + ' tools are available';
  return res.status(200).send(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Robinson Vercel MCP</title></head><body>' +
    '<main><h1>Robinson Vercel MCP</h1>' +
    '<p>A hosted, safety-first connector for building and operating Vercel projects.</p>' +
    '<p>' + toolText + ' to this connection.</p>' +
    '<p><a href="https://github.com/Robinson-AI-Systems/vercel-mcp">Project documentation</a></p>' +
    '</main></body></html>'
  );
}
