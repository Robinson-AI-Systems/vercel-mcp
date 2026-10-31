import { BRANDED_ORIGIN, FRONT_DOOR_CSP, FRONT_DOOR_PRODUCT_NAME, frontDoorPage } from '../src/front-door.js';

// O-6: the plain-English "My connection" page (RAS MCP Standard, "Branded
// front door"), in the fleet's dark look via the shared shell. Static,
// public and secret-free by construction: everything here is instruction,
// and every instructional address is the branded one.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', FRONT_DOOR_CSP);
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const body =
    '<p>This page explains, in plain words, how your assistants connect to ' +
    FRONT_DOOR_PRODUCT_NAME + ', what a connection can do, and how to ' +
    'disconnect.</p>' +

    '<section><h2>Connect from your AI client</h2>' +
    '<p>In your client (for example Muse), add a custom connector with ' +
    'this address:</p>' +
    '<code class="addr">' + BRANDED_ORIGIN + '/api/mcp</code>' +
    '<p>If the client asks for a Client ID, paste the server\'s own ' +
    'client document:</p>' +
    '<code class="addr">' + BRANDED_ORIGIN +
    '/.well-known/muse-client.json</code>' +
    '<p>Then you land on this server\'s own sign-in page. Pick your ' +
    'account and choose how much the connection may do.</p></section>' +

    '<section><h2>Signing in claims your existing identity</h2>' +
    '<p>Connecting never creates a Vercel account and never gives a ' +
    'connection more reach than your own Vercel sign-in already has. You ' +
    'are connecting the account that is already yours, under the name it ' +
    'already has.</p></section>' +

    '<section><h2>Passes for agents</h2>' +
    '<p>An owner can also issue a scoped pass through their own ' +
    'connection (the <code>vercel_issue_pass</code> tool) for an agent ' +
    'that should not sign in as you. A pass has its own profile, expiry ' +
    'and revocation, and the same pass works at either of this ' +
    'service\'s addresses.</p></section>' +

    '<section><h2>Your secrets stay yours</h2>' +
    '<p>Administrator passphrases, tokens and passwords are typed only on ' +
    'this server\'s own pages or into your client\'s protected credential ' +
    'setup — never in chat, and never on any other page.</p></section>' +

    '<section><h2>What a connection can do</h2>' +
    '<p>That depends on the choices you made when you connected: the ' +
    'profile (read-only, everyday or full) and the mode (preview or ' +
    'production). Changes are previewed first and ask for confirmation; ' +
    'spending follows the purchase policy you set; and everything a ' +
    'connection does is written to a journal you can inspect.</p></section>' +

    '<section><h2>What it cannot do</h2>' +
    '<p>A connection cannot reach beyond your own Vercel account\'s ' +
    'permissions, cannot touch another account, and cannot override ' +
    'Vercel\'s own plan limits — when Vercel refuses something, the ' +
    'refusal is explained in plain words. It also cannot spend beyond ' +
    'your purchase policy without your word.</p>' +
    '<p>Vercel Unleashed is provided as-is, without warranties of any ' +
    'kind, and with no service-level guarantee.</p></section>' +

    '<section><h2>Where things stand</h2>' +
    '<p>' + FRONT_DOOR_PRODUCT_NAME + ' is an independent product by ' +
    'Robinson AI Systems. It is not affiliated with or endorsed by ' +
    'Vercel. Connections are owner-issued today — there is no public ' +
    'sign-up. This page describes how connections work; it does not ' +
    'certify live provider or RTC acceptance.</p></section>' +

    '<section><h2>Disconnect</h2>' +
    '<p>Remove the connector in your client whenever you like. To cut ' +
    'access immediately, the owner revokes the connection ' +
    '(<code>vercel_revoke_connection</code>) or the pass ' +
    '(<code>vercel_revoke_pass</code>) through their own connection — ' +
    'revocation takes effect at once, on both addresses.</p></section>';
  return res.status(200).send(frontDoorPage({
    title: 'My connection — ' + FRONT_DOOR_PRODUCT_NAME,
    heading: 'My connection',
    body
  }));
}
