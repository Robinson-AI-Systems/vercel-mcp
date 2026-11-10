import { registry } from '../src/tools/index.js';
import { releaseVersion } from '../src/release.js';
import { BRANDED_ORIGIN, FRONT_DOOR_CSP, FRONT_DOOR_PRODUCT_NAME, frontDoorPage } from '../src/front-door.js';
import { iconBytes } from '../src/brand-assets.js';

// The anonymous root proves that this process can answer HTTP only.
// No public endpoint may infer owner setup, OAuth consent, provider
// access or acceptance (the reference implementation's rule, adopted).
export function publicInfo(buildSha = process.env.VERCEL_GIT_COMMIT_SHA) {
  const sourceSha = typeof buildSha === 'string' && /^[a-f0-9]{40}$/.test(buildSha)
    ? buildSha : null;
  return {
    name: FRONT_DOOR_PRODUCT_NAME, status: 'service-online',
    version: releaseVersion({ VERCEL_GIT_COMMIT_SHA: buildSha }), deployed_source_sha: sourceSha,
    tools: registry.tools.length,
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
      '<section id="start"><h2>How connecting works</h2><ol>' +
      '<li><a href="#connect">Add the address below</a> to your AI app.</li>' +
      '<li>Your app opens Vercel\'s own sign-in. Sign in to <b>your</b> Vercel account and approve the connection. ' +
      'We never see or ask for your Vercel password.</li>' +
      '<li>Then ask your assistant for what you need; changes are shown to you first.</li></ol>' +
      '<p><small>Later, <a href="/connection">My connection</a> is where you switch to read-only, see what a ' +
      'connection can do, or disconnect.</small></p></section>' +
      '<section id="connect"><h2>Connect your AI app</h2>' +
      '<p>Paste this address into your AI app when it asks for a server or connector address:</p>' +
      '<code class="addr" id="address">' + BRANDED_ORIGIN + '/api/mcp</code>' +
      '<h2>Muse</h2>' +
      '<p>In Muse, open <b>Settings</b>, then <b>Connectors</b>, then ' +
      '<b>Add custom connector</b>. Name it Vercel Unleashed and paste ' +
      'the address above as the server address.</p>' +
      '<p>If Muse shows the <b>Secure credentials store</b> screen ' +
      'asking for a Client ID, type this \u2014 the same for everyone, ' +
      'and nothing secret:</p>' +
      '<code class="addr" id="muse-client-id">muse</code>' +
      '<p class="muted"><small>Set up before? The longer address <code>' +
      BRANDED_ORIGIN + '/.well-known/muse-client.json</code> still works.</small></p>' +
      '<p><b>Client Secret: leave blank.</b> Then choose <b>Add</b>. ' +
      'Muse opens Vercel\'s own sign-in, where you sign in to your own ' +
      'Vercel account and approve the connection. Never enter a Vercel ' +
      'password or token in Muse \u2014 sign-in happens on Vercel\'s ' +
      'own page.</p>' +
      '<p><small>The Client ID identifies Muse, not you, and gives no ' +
      'access by itself. It works only in Muse: it accepts only ' +
      'Muse\'s own return address, so typing it into any other ' +
      'app fails. Every other app below leaves both boxes blank.</small></p>' +
      '<h2>Claude (web, desktop and phone app)</h2><ol>' +
      '<li>Open Claude on the web, or in the desktop or phone app, and ' +
      'go to <b>Settings</b> (called <b>Customize</b> in some versions), then <b>Connectors</b>.</li>' +
      '<li>Choose <b>+</b> or <b>Add</b>, then <b>Add custom connector</b>, give it a name and paste the address above.</li>' +
      '<li>Leave the Client ID and the Client Secret blank \u2014 the ' +
      'app identifies itself automatically.</li>' +
      '<li>Choose <b>Add</b>, then <b>Connect</b>, and sign in with ' +
      'your Vercel account.</li></ol>' +
      '<p><small>On a team or company plan, an owner adds it first ' +
      'under Organization settings, then members choose Connect.</small></p>' +
      '<h2>ChatGPT</h2>' +
      '<p><small>On a phone, add it from the phone\'s web browser at ' +
      'chatgpt.com. Once added, you can use it in the ChatGPT app too.</small></p><ol>' +
      '<li>Open ChatGPT on the web and go to <b>Plugins</b>.</li>' +
      '<li>Choose the plus button, then <b>Add custom MCP server</b>.</li>' +
      '<li>Enter a name and paste the address above. For authentication ' +
      'choose <b>OAuth</b>. Leave the Client ID and the Client Secret ' +
      'blank \u2014 the app identifies itself automatically.</li>' +
      '<li>Confirm the warning, choose <b>Create as a plugin</b>, then ' +
      'install it and sign in with your Vercel account.</li></ol>' +
      '<h2>Claude Code</h2>' +
      '<pre>claude mcp add --transport http vercel-unleashed ' +
      BRANDED_ORIGIN + '/api/mcp</pre>' +
      '<p><small>Then type /mcp inside Claude Code and sign in with ' +
      'your Vercel account.</small></p>' +
      '<h2>Cursor</h2>' +
      '<p>Add this to <code>.cursor/mcp.json</code> (or ' +
      '<code>~/.cursor/mcp.json</code>), then sign in when asked:</p>' +
      '<pre>{\n  "mcpServers": {\n    "vercel-unleashed": { "url": "' +
      BRANDED_ORIGIN + '/api/mcp" }\n  }\n}</pre>' +
      // Added 2026-11-10, checked against each app's current docs: VS Code
      // (code.visualstudio.com/docs/copilot/reference/mcp-configuration), OpenAI Codex
      // (developers.openai.com/codex/mcp), Gemini CLI (gemini mcp add --transport http,
      // /mcp auth), Windsurf (mcp_config.json "serverUrl").
      '<h2>VS Code (GitHub Copilot)</h2>' +
      '<p>Open the Command Palette (Ctrl+Shift+P, or Cmd+Shift+P on a Mac), run <b>MCP: Add Server</b>, ' +
      'choose <b>HTTP</b> and paste the address. Or add this to <code>.vscode/mcp.json</code>:</p>' +
      '<pre>{\n  "servers": {\n    "vercel-unleashed": { "type": "http", "url": "' +
      BRANDED_ORIGIN + '/api/mcp" }\n  }\n}</pre>' +
      '<p><small>Sign in with your Vercel account when VS Code asks.</small></p>' +
      '<h2>OpenAI Codex (and the ChatGPT desktop app)</h2>' +
      '<pre>codex mcp add vercel-unleashed --url ' + BRANDED_ORIGIN + '/api/mcp\n' +
      'codex mcp login vercel-unleashed</pre>' +
      '<p><small>In the desktop app instead: <b>Settings</b>, <b>MCP servers</b>, <b>Add server</b>, ' +
      'choose <b>Streamable HTTP</b>, paste the address, save, then <b>Authenticate</b>.</small></p>' +
      '<h2>Gemini CLI</h2>' +
      '<pre>gemini mcp add --transport http --scope user vercel-unleashed ' + BRANDED_ORIGIN + '/api/mcp</pre>' +
      '<p><small>Then start <code>gemini</code> and type <code>/mcp auth vercel-unleashed</code> to sign in.</small></p>' +
      '<h2>Windsurf</h2>' +
      '<p>In <b>Windsurf Settings</b>, <b>Cascade</b>, <b>MCP servers</b>, choose <b>View raw config</b> and add:</p>' +
      '<pre>{\n  "mcpServers": {\n    "vercel-unleashed": { "serverUrl": "' +
      BRANDED_ORIGIN + '/api/mcp" }\n  }\n}</pre>' +
      '<p><small>Save and refresh; Windsurf opens the Vercel sign-in.</small></p>' +
      '<h2>Any other app</h2>' +
      '<p>Any app that can add a remote MCP server with sign-in (OAuth) works: paste the address, ' +
      'leave any Client ID and Secret blank, and sign in with your Vercel account.</p>' +
      '<p>Already connected, or want to know what a connection can ' +
      'do and how to disconnect?</p>' +
      '<a class="button" href="/connection">Open My connection</a></section>' +
      '<section><h2>Service facts</h2>' +
      '<p>Registered tools: ' + registry.tools.length + '</p>' +
      '<p>Every sign-in gets the full tool set — there are no sign-in tiers.</p>' +
      '<p>Service version: ' + releaseVersion() + '</p>' +
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
