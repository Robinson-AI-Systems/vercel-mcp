// The public connection page (AUD-I S2): ONE page, TWO doors, per
// the AUD-I card. Door 1 is the default — the Vercel Integrations
// connect flow (S1's backend): the user picks the team and the
// projects on Vercel's own screens and hands over nothing permanent.
// Door 2 is the token tier ("god mode"), fully visible on the same
// page, never greyed or hidden: its Five Points in plain English and
// the route to the enrollment branch of the sign-in flow (AUD-AR),
// where the guided token enrollment itself lives with nothing else
// added. This page holds no secrets and asks for none; both doors
// end at surfaces that verify before anything activates.
// AUD-AX: the page renders on the shared fleet shell (frontDoorPage)
// like every other surviving public page.
import { FRONT_DOOR_CSP, FRONT_DOOR_PRODUCT_NAME, frontDoorPage } from '../front-door.js';
import { escapeHtml, send } from '../core/http.js';

const CONTENT_TYPE = 'text/html; charset=utf-8';
const ENROLL_PATH = '/api/oauth/enroll';

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
  return frontDoorPage({
    title: 'Connect your Vercel account — ' + FRONT_DOOR_PRODUCT_NAME,
    heading: 'Connect your Vercel account',
    body: content
  });
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
    'today — or ask the operator to finish creating the Vercel integration.</p>';
  const points = FIVE_POINTS.map(([head, tail]) =>
    '<li><strong>' + escapeHtml(head) + '</strong> ' + escapeHtml(tail) + '</li>').join('');
  return page(
    '<section><h2>Connect a team — recommended</h2>' + door1 + '</section>' +
    '<section><h2>Want account-wide control?</h2>' +
    '<p>A Vercel API token with Full Account scope, enrolled through the sign-in flow, gives ' +
    'this connection your whole account — every team, team creation, account settings. That ' +
    'is the widest door there is, so it comes with five plain facts:</p>' +
    '<ul>' + points + '</ul>' +
    '<p>How it works: on Vercel you create the token (any name, scope <strong>Full ' +
    'Account</strong>, expiration <strong>your choice — including never</strong>), then paste ' +
    'it into the enrollment step of the sign-in flow. Before anything activates, the server checks what the token can ' +
    'actually reach and shows you the scope it read back.</p>' +
    '<p><a class="button" href="' + ENROLL_PATH + '">Enroll a Vercel token</a></p></section>');
}

export async function handleConnect(req, res, { env = process.env } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', FRONT_DOOR_CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  }
  return send(res, 200, renderConnectPage(env), CONTENT_TYPE);
}
