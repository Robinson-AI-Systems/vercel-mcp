// The public connection page (AUD-I S2): ONE page, TWO doors, per
// the AUD-I card. Door 1 is the default — the Vercel Integrations
// connect flow (S1's backend): the user picks the team and the
// projects on Vercel's own screens and hands over nothing permanent.
// Door 2 is the token tier ("god mode"), fully visible on the same
// page, never greyed or hidden: its Five Points in plain English and
// the route to the secure setup page, where the guided enrollment
// itself lives (setup.js) with nothing else added. This page holds
// no secrets and asks for none; both doors end at surfaces that
// verify before anything activates.
import { SERVICE_DISPLAY_NAME } from '../service-identity.js';
import { escapeHtml, send } from '../core/http.js';

const CONTENT_TYPE = 'text/html; charset=utf-8';
const SETUP_PATH = '/api/vercel/setup';

// The install entry is operator configuration (the integration's
// page on Vercel), never user input. Only an https URL on vercel.com
// or a subdomain is honored; anything else is treated as unset, so a
// misconfiguration degrades to the honest note instead of a link to
// somewhere unexpected.
export function integrationInstallUrl(env = process.env) {
  const raw = env?.VERCEL_INTEGRATION_INSTALL_URL;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'vercel.com' && !url.hostname.endsWith('.vercel.com')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function page(content) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Connect your Vercel account — ' + escapeHtml(SERVICE_DISPLAY_NAME) + '</title>' +
    '<style>body{font:16px system-ui;max-width:650px;margin:4vh auto;padding:20px}' +
    'section{margin:22px 0;padding:16px;border:1px solid #ccc}' +
    'a.button{display:inline-block;font:inherit;padding:10px 14px;border:1px solid #333;' +
    'text-decoration:none;color:inherit}li{margin:6px 0}</style></head><body><main>' +
    '<h1>Connect your Vercel account</h1>' + content + '</main></body></html>';
}

const FIVE_POINTS = [
  ['You are choosing the team tier on purpose.', 'Nothing about this connection is hidden in a higher plan.'],
  ['It is freely reversible.', 'Remove the token in Vercel or disconnect here, and access ends — no lock-in, no call to make.'],
  ['It grants only through this tool.', 'The key works here and in your own hands; it is never shown, forwarded, or reused elsewhere.'],
  ['Everything is audited.', 'Every call is journaled with its outcome, so you can see exactly what was done with it.'],
  ['Your key is the only lock.', 'There is no second gatekeeper — which is why the choice is yours, stated plainly, and reversible at any moment.']
];

export function renderConnectPage(env = process.env) {
  const installUrl = integrationInstallUrl(env);
  const door1 = installUrl ?
    '<p><a class="button" href="' + escapeHtml(installUrl) + '">Connect a Vercel team</a></p>' +
    '<p>Vercel opens its own screens: you pick the team and the projects this connection can ' +
    'reach. Nothing permanent is handed over — you can change the projects or remove the ' +
    'connection from your Vercel dashboard at any time.</p>' :
    '<p><strong>Team connect is not switched on for this server yet.</strong> The operator ' +
    'still has to finish creating the Vercel integration. The account-wide door below works ' +
    'today — or ask the operator to complete the team setup.</p>';
  const points = FIVE_POINTS.map(([head, tail]) =>
    '<li><strong>' + escapeHtml(head) + '</strong> ' + escapeHtml(tail) + '</li>').join('');
  return page(
    '<section><h2>Connect a team — recommended</h2>' + door1 + '</section>' +
    '<section><h2>Want account-wide control?</h2>' +
    '<p>A Vercel API token with Full Account scope, enrolled on the secure setup page, gives ' +
    'this connection your whole account — every team, team creation, account settings. That ' +
    'is the widest door there is, so it comes with five plain facts:</p>' +
    '<ul>' + points + '</ul>' +
    '<p>How it works: on Vercel you create the token (any name, scope <strong>Full ' +
    'Account</strong>, expiration <strong>your choice — including never</strong>), then paste ' +
    'it on the setup page. Before anything activates, the server checks what the token can ' +
    'actually reach and shows you the scope it read back.</p>' +
    '<p><a class="button" href="' + SETUP_PATH + '">Go to the secure setup page</a></p></section>');
}

export async function handleConnect(req, res, { env = process.env } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  }
  return send(res, 200, renderConnectPage(env), CONTENT_TYPE);
}
