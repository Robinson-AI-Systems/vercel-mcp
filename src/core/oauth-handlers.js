import { createHash } from 'node:crypto';
import {createOAuthRevocation} from './oauth-revocation.js';
// Contract-generic OAuth HTTP handlers. Provider-specific behavior is injected via service.
import {
  randomToken, hashToken, secretsMatch, verifyPkce, validRedirectUri,
  evaluateLogin, clientIp, LOCKOUT_WINDOW_MINUTES
} from './oauth.js';
import { publicOrigin, send, escapeHtml, paramsOf, only } from './http.js';
import { createCimdResolver, redirectUriAllowed } from './cimd.js';
import { frontDoorPage } from '../front-door.js';

// AUD-AZ: an OAuth connection's listing is always the OP-1 front
// door. catalog/compact survive only as RTC pass properties (the
// pass door's own contract), which are not sign-ins; stored rows
// issued before derivation keep the listing they were issued with
// (grandfathering, dossier D6) — this constant governs issuance.
const OAUTH_LISTING = 'front_door';
// Muse (Meta) publishes no client metadata document of its own, so a server
// that accepts Muse connections hosts one for it (the client-id metadata
// document pattern): the document's URL is the client_id, Muse's only
// redirect is its hosted callback, and it authenticates with PKCE only
// (token endpoint method "none"). The client is resolved locally from this
// server's own document — no registration row — and dynamic client
// registration for every other client is untouched.
const MUSE_CLIENT_PATH = '/.well-known/muse-client.json';
const MUSE_REDIRECT_URI = 'https://agent.meta.ai/api/hatch/oauth/callback';
// The authorization-server metadata document, built from the one public
// origin. Exported so the public health check (src/health.js) verifies the
// exact document this server serves — issuer and every endpoint derived
// from the same origin — instead of a second, drifting copy.
export function oauthServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: origin + '/api/oauth/authorize',
    token_endpoint: origin + '/api/oauth/token',
    registration_endpoint: origin + '/api/oauth/register',
    client_id_metadata_document_supported: true,
    revocation_endpoint: origin + '/api/oauth/revoke',
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none']
  };
}

// SR-2 — deployment class, one authority: the public class is
// exactly this server's production deployment — the same
// VERCEL_ENV conjunct the service's issuance derivation uses
// as its mode authority, so class and derivation can never
// disagree about which deployment this is. Everything else
// is the dev class.
export function deploymentClass(env = process.env) {
  return env?.VERCEL_ENV === 'production' ? 'public' : 'dev';
}

// SR-4 — the route split's two namespaces. The public paths
// are the shipped journey's; the dev paths are the
// developer-only backend route on the same deployment
// (docs/DEVELOPER-ACCESS.md). The legacy handlers serve
// either namespace: the links a page renders are re-based
// onto the namespace it was reached through, so a journey
// never crosses between the two.
const PUBLIC_PATHS = { authorizePath: '/api/oauth/authorize', enrollPath: '/api/oauth/enroll' };
const DEV_PATHS = { authorizePath: '/api/dev/authorize', enrollPath: '/api/dev/enroll' };

const tokenResponse = (access, refresh) => ({
  access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh
});
const bad = (res, status, code, description) => send(res, status, { error: code, error_description: description });
const str = (value) => typeof value === 'string' ? value : '';

export function createOAuthHandlers({ db, env = process.env, service, fetchDocument }) {
  if (!service || typeof service.listAccounts !== 'function' || typeof service.issuanceFor !== 'function') {
    throw new TypeError('An OAuth service adapter is required');
  }
  function urls() {
    const origin = publicOrigin(env);
    return { origin, resource: origin + '/api/mcp' };
  }
  function validateResource(value) { return value === urls().resource; }

  function museClientDocument() {
    const { origin } = urls();
    return {
      client_id: origin + MUSE_CLIENT_PATH,
      client_name: 'Muse',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [MUSE_REDIRECT_URI],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    };
  }
  // The Muse document client resolves to a fixed public-client record.
  // Any other URL-shaped client_id is a Client ID Metadata Document
  // (AUD-BX): it is fetched and validated by the CIMD resolver, and a
  // conforming document resolves to the same public-client record
  // shape. Every remaining client_id keeps the registered-client
  // lookup, unchanged. This one funnel serves authorize, the dev
  // authorize, the attested-flow re-check, the token endpoint and
  // revocation, so no surface can drift from another.
  const resolveCimdClient = createCimdResolver(fetchDocument ? { fetchDocument } : {});
  async function resolveClient(clientId) {
    if (typeof clientId === 'string' && clientId === museClientDocument().client_id) {
      return {
        client_id: clientId, client_name: 'Muse',
        redirect_uris: [MUSE_REDIRECT_URI],
        token_endpoint_auth_method: 'none', client_secret_hash: null
      };
    }
    if (typeof clientId === 'string' && clientId.startsWith('https://')) {
      const cimd = await resolveCimdClient(clientId);
      if (cimd) return cimd;
    }
    return db.getOAuthClient(clientId);
  }

  async function register(req, res) {
    if (!only(res, req, ['POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_client_metadata', 'Malformed registration');
    }
    if (!Array.isArray(params.redirect_uris) || params.redirect_uris.length < 1 ||
      params.redirect_uris.length > 8 ||
      !params.redirect_uris.every((uri) => typeof uri === 'string' && validRedirectUri(uri)) ||
      new Set(params.redirect_uris).size !== params.redirect_uris.length) {
      return bad(res, 400, 'invalid_client_metadata', 'One to eight valid, distinct redirect URIs required');
    }
    const authMethod = params.token_endpoint_auth_method ?? 'client_secret_post';
    if (!['client_secret_post', 'none'].includes(authMethod)) {
      return bad(res, 400, 'invalid_client_metadata', 'Unsupported client authentication');
    }
    const clientId = randomToken(24);
    // Public OAuth clients cannot securely hold a static client secret. PKCE
    // S256 and an exact, registered redirect protect their authorization code.
    const clientSecret = authMethod === 'client_secret_post' ? randomToken(32) : null;
    await db.createOAuthClient({
      clientId, clientSecret, redirectUris: params.redirect_uris,
      tokenEndpointAuthMethod: authMethod,
      clientName: str(params.client_name).slice(0, 100)
    });
    return send(res, 201, {
      client_id: clientId,
      ...(clientSecret === null ? {} : {client_secret: clientSecret, client_secret_expires_at: 0}),
      redirect_uris: params.redirect_uris, token_endpoint_auth_method: authMethod,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']
    });
  }

  // AUD-AZ: there are no mode/profile/listing pickers to render a
  // view for. The service's issuanceFor derivation is the single
  // authority for both layers that remain — each account option's
  // caption and posture note on this page, and the values bound to
  // the auth code at issuance — so the page can never drift from
  // what a consent actually issues (the AUD-AE lesson, kept without
  // the per-account script the pickers needed).
  // The in-flight OAuth parameters of a sign-in: carried by the
  // consent form itself, and by the enrollment branch (AUD-AR) so
  // enrolling returns to the SAME consent.
  const flowFields = [
    'client_id', 'redirect_uri', 'response_type', 'code_challenge',
    'code_challenge_method', 'state', 'resource'
  ];
  function authorizePage(params, accounts, error = '', paths = PUBLIC_PATHS) {
    const hidden = flowFields.map((name) =>
      '<input type="hidden" name="' + name + '" value="' + escapeHtml(params[name]) + '">'
    ).join('');
    // Preselection (AUD-AE): an explicit account choice (a resumed
    // flow or an error re-render) wins; otherwise the account the
    // owner flagged as the default (is_default — the same flag the
    // setup page sets and the removal guards read), never merely
    // the first row of the account list. List position only breaks
    // the tie when no account is flagged, the state the schema
    // permits before an owner picks a default.
    const selectedAccount = accounts.find((account) => params.account === account.id) ||
      accounts.find((account) => account.is_default) || accounts[0];
    // Every option is captioned with its own derivation (declared
    // box + the posture a connection on it starts in), so the page
    // is truthful for every account with no script at all.
    const accountList = accounts.map((account) =>
      '<option value="' + escapeHtml(account.id) + '"' +
      (selectedAccount?.id === account.id ? ' selected' : '') + '>' +
      escapeHtml(account.label) + ' — ' + escapeHtml(service.issuanceFor(account, env).caption) + '</option>'
    ).join('');
    const productionNote = selectedAccount ? service.issuanceFor(selectedAccount, env).note : '';
    // The enrollment branch of this same sign-in flow (AUD-AR)
    // carries the in-flight OAuth parameters, so enrolling returns
    // to this exact consent; the doors page covers the Door 1
    // install and the explainer. No setup page is named or linked:
    // enrollment is part of sign-in, not a separate surface.
    const enrollPairs = flowFields
      .filter((name) => typeof params[name] === 'string' && params[name] !== '')
      .map((name) => encodeURIComponent(name) + '=' + encodeURIComponent(params[name]));
    const enrollHref = paths.enrollPath + (enrollPairs.length ? '?' + enrollPairs.join('&') : '');
    const enrollLinks = '<p><a href="' + escapeHtml(enrollHref) + '">Enroll another account with a Vercel token</a>' +
      ' · <a href="/api/vercel/connect">How connecting works</a></p>';
    const body =
      (error ? '<p role="alert">' + escapeHtml(error) + '</p>' : '') +
      (accounts.length ? '<p>Choose the ' + escapeHtml(service.accountLabel) + ' for this AI connection. ' +
        'What the connection can do follows the account you pick — each caption states the reach it starts with.</p>' :
        '<p>No Vercel teams are connected yet. Enroll an account first, then return here to authorize this connection.</p>') +
      '<form method="post">' + hidden +
      '<label>' + escapeHtml(service.accountLabel) + '<select name="account" id="account-select" required>' + accountList + '</select></label>' +
      '<div id="mode-note">' + productionNote + '</div>' +
      '<label>Administrator passphrase<input type="password" name="passphrase" required autocomplete="current-password"></label>' +
      '<button type="submit"' + (!accounts.length ? ' disabled' : '') + '>Authorize this connection</button></form>' +
      enrollLinks;
    return frontDoorPage({
      title: 'Connect ' + escapeHtml(service.name) + ' MCP',
      heading: 'Connect ' + escapeHtml(service.name) + ' MCP',
      body
    });
  }


  // SR-2 (gate O-2.7, dossier §5.1) — the public-class journey.
  // The generic handlers stay provider-free: the sign-in leg is
  // reached only through the service adapter (signinConfigured /
  // signinAuthorizeUrl / signinBindingCookie / bindableAccounts),
  // which the Vercel login service implements over SR-1's leg.
  // The leg engages only when configured. SR-4 retired SR-2's
  // interim fallback: while the leg is unconfigured, the public
  // class renders the interim notice (authorizeInterim /
  // enrollInterim — no passphrase form or evaluation on this
  // surface) and the legacy passphrase path serves the dev
  // class and the developer route; the SR-4 card records the
  // no-stranding argument.
  const signinReady = () =>
    typeof service.signinConfigured === 'function' &&
    typeof service.signinAuthorizeUrl === 'function' &&
    service.signinConfigured(env);
  const bindingCookieName = () =>
    typeof service.signinBindingCookie === 'function' ?
      service.signinBindingCookie() : 'rmcp_signin_binding';
  function cookieValue(req, name) {
    const header = req?.headers?.cookie;
    if (typeof header !== 'string') return null;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
  }
  function attestedWho(flow) {
    const claims = claimsOf(flow);
    return claims.username || claims.name || claims.email || 'your Vercel account';
  }
  function claimsOf(flow) {
    const claims = flow?.attested_claims;
    if (!claims) return {};
    if (typeof claims === 'object') return claims;
    try {
      const parsed = JSON.parse(claims);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }
  // Plain-words refusals for the attested path: each names the
  // leg and the remedy, never a raw token or provider body.
  function refusal(res, status, heading, text) {
    return send(res, status, frontDoorPage({
      title: 'Connect ' + escapeHtml(service.name) + ' MCP',
      heading,
      body: '<p>' + escapeHtml(text) + '</p>'
    }), 'text/html; charset=utf-8');
  }

  // The attested consent: the verified identity, a picker of
  // ONLY the accounts that identity may bind (§5.4), each
  // captioned by the same derivation that will issue the code,
  // and no passphrase field — consent on this class is
  // authorized by the flow record, not by a shared secret. The
  // empty state offers the enrollment legs inside the journey:
  // token enrollment carrying the in-flight parameters, and the
  // doors page (Door 1 install + explainer).
  function consentPage(params, flow, bindable, totalAccounts, error = '') {
    const who = attestedWho(flow);
    // Preselection mirrors AUD-AE within the filtered set: the
    // flagged default wins, else the first bindable account.
    const selectedAccount = bindable.find((account) => account.is_default) || bindable[0];
    const accountList = bindable.map((account) =>
      '<option value="' + escapeHtml(account.id) + '"' +
      (selectedAccount?.id === account.id ? ' selected' : '') + '>' +
      escapeHtml(account.label) + ' — ' + escapeHtml(service.issuanceFor(account, env).caption) + '</option>'
    ).join('');
    const productionNote = selectedAccount ? service.issuanceFor(selectedAccount, env).note : '';
    const pairs = [...flowPairs(params), 'flow=' + encodeURIComponent(flow.handle)];
    const enrollHref = '/api/oauth/enroll?' + pairs.join('&');
    const enrollLinks = '<p><a href="' + escapeHtml(enrollHref) + '">Enroll another account with a Vercel token</a>' +
      ' · <a href="/api/vercel/connect">Connect a Vercel team</a></p>';
    const intro = bindable.length ?
      '<p>Choose the ' + escapeHtml(service.accountLabel) + ' for this AI connection. ' +
        'Only accounts your Vercel sign-in may use are listed — each caption states the reach it starts with.</p>' :
      (totalAccounts ?
        '<p>None of the accounts connected to this server can be used with this Vercel ' +
        'sign-in. An account can be connected by the Vercel user it belongs to, or by a ' +
        'member of its team. Enroll the account, or connect the team, and it will appear here.</p>' :
        '<p>No Vercel teams are connected yet. Enroll an account first, then return here to authorize this connection.</p>');
    const body =
      '<p>Signed in to Vercel as <strong>' + escapeHtml(who) + '</strong>.</p>' +
      (error ? '<p role="alert">' + escapeHtml(error) + '</p>' : '') +
      intro +
      (bindable.length ?
        '<form method="post">' +
        '<input type="hidden" name="flow" value="' + escapeHtml(flow.handle) + '">' +
        '<label>' + escapeHtml(service.accountLabel) + '<select name="account" id="account-select" required>' + accountList + '</select></label>' +
        '<div id="mode-note">' + productionNote + '</div>' +
        '<button type="submit">Authorize this connection</button></form>' : '') +
      enrollLinks;
    return frontDoorPage({
      title: 'Connect ' + escapeHtml(service.name) + ' MCP',
      heading: 'Connect ' + escapeHtml(service.name) + ' MCP',
      body
    });
  }

  // A fresh authorize on the configured public class starts
  // the detour: the flow record carries the client parameters,
  // a fresh Vercel-leg PKCE pair + nonce, and the hash of a
  // browser-binding secret whose cookie ties the returning
  // browser to this flow.
  async function authorizeSignin(req, res, params) {
    if (req.method === 'POST') {
      // Consent on this class is authorized by the flow record
      // alone; a POST without one has nothing to stand on —
      // the passphrase is not honored here.
      return refusal(res, 400, 'This sign-in needs Vercel sign-in first',
        'Open the connection from your AI app and sign in with Vercel; ' +
        'the consent step follows from that sign-in.');
    }
    const handle = randomToken(32);
    const verifier = randomToken(32);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const nonce = randomToken(24);
    const binding = randomToken(32);
    await db.createSigninFlow({
      handle, clientId: params.client_id, redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge, codeChallengeMethod: 'S256',
      clientState: typeof params.state === 'string' ? params.state : null,
      resource: params.resource, vercelCodeVerifier: verifier, nonce,
      browserBindingHash: hashToken(binding)
    });
    res.setHeader('Set-Cookie', bindingCookieName() + '=' + binding +
      '; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth; Max-Age=600');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', service.signinAuthorizeUrl(
      { state: handle, nonce, codeChallenge: challenge }, env));
    return res.status(302).end();
  }

  // The returning leg of the journey: the flow record IS the
  // request. It must be live, attested, unconsumed and
  // browser-bound; the client parameters are re-validated from
  // the record, never from anything re-posted; and the
  // eligible set is recomputed at POST time, so a tampered or
  // stale account id refuses without consuming the flow.
  // The guard every attested surface shares (consent in
  // SR-2, enrollment in SR-3): the flow record must be live,
  // attested, unconsumed and bound to this browser. Each
  // surface renders its own wording for the two refusals.
  async function liveAttestedFlow(req, handle) {
    const flow = await db.getSigninFlow(handle);
    if (!flow || flow.consumed_at || !(flow.expires_at > Date.now()) ||
      typeof flow.attested_user_id !== 'string' || !flow.attested_user_id) {
      return { refusal: 'unusable' };
    }
    flow.handle = handle;
    if (flow.browser_binding_hash) {
      const cookie = cookieValue(req, bindingCookieName());
      if (!cookie || !secretsMatch(hashToken(cookie), flow.browser_binding_hash)) {
        return { refusal: 'browser' };
      }
    }
    return { flow };
  }

  async function authorizeAttested(req, res, params) {
    const handle = str(params.flow);
    const guard = await liveAttestedFlow(req, handle);
    if (!guard.flow) {
      if (guard.refusal === 'browser') {
        return refusal(res, 400, 'Finish signing in from the browser that started it',
          'This sign-in belongs to the browser that began it. Return to that ' +
          'browser, or start the connection again.');
      }
      return refusal(res, 400, 'This sign-in link is no longer usable',
        'The sign-in may have expired, already been used, or its Vercel sign-in ' +
        'did not finish. Start the connection again from your AI app.');
    }
    const flow = guard.flow;
    const client = await resolveClient(flow.client_id);
    if (!client || !redirectUriAllowed(client, flow.redirect_uri)) {
      return refusal(res, 400, 'This sign-in link is no longer usable',
        'The app that asked for this connection is no longer registered here. ' +
        'Start the connection again from your AI app.');
    }
    if (typeof service.bindableAccounts !== 'function') {
      return refusal(res, 503, 'Sign-in is not fully set up on this server',
        'This server cannot check which accounts your Vercel sign-in may use yet.');
    }
    const flowParams = {
      client_id: flow.client_id, redirect_uri: flow.redirect_uri,
      response_type: 'code', code_challenge: flow.code_challenge,
      code_challenge_method: 'S256',
      state: typeof flow.client_state === 'string' ? flow.client_state : undefined,
      resource: flow.resource
    };
    const bindable = await service.bindableAccounts(flow.attested_user_id, env);
    if (req.method === 'GET') {
      const accounts = await service.listAccounts();
      return send(res, 200, consentPage(flowParams, flow, bindable, accounts.length),
        'text/html; charset=utf-8');
    }
    const chosen = bindable.find((account) => account.id === str(params.account));
    if (!chosen) {
      const accounts = await service.listAccounts();
      return send(res, 400, consentPage(flowParams, flow, bindable, accounts.length,
        'That account cannot be connected with this Vercel sign-in. Choose one of ' +
        'the accounts listed, or enroll the account first.'),
        'text/html; charset=utf-8');
    }
    const consumed = await db.consumeSigninFlow({ handle, chosenAccount: chosen.id });
    if (!consumed) {
      return refusal(res, 400, 'This sign-in link is no longer usable',
        'The sign-in may have expired or already been used. ' +
        'Start the connection again from your AI app.');
    }
    // AUD-AZ: issuance is DERIVED from the chosen account; any
    // mode/profile/listing a client posts is not read.
    const issuance = service.issuanceFor(chosen, env);
    const code = randomToken(32);
    await db.createAuthCode({
      code, clientId: consumed.client_id, redirectUri: consumed.redirect_uri,
      codeChallenge: consumed.code_challenge, codeChallengeMethod: 'S256',
      vercelAccount: chosen.id, mode: issuance.mode, profile: issuance.profile,
      listing: OAUTH_LISTING
    });
    const destination = new URL(consumed.redirect_uri);
    destination.searchParams.set('code', code);
    if (typeof consumed.client_state === 'string') {
      destination.searchParams.set('state', consumed.client_state);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', destination.toString());
    return res.status(302).end();
  }

  async function authorize(req, res) {
    if (!only(res, req, ['GET', 'POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_request', 'Malformed authorization request');
    }
    // SR-2: a returning attested flow is validated against its
    // own record (authorizeAttested re-checks the client and
    // redirect from it); only a fresh request validates the
    // posted client parameters below — and validates them
    // BEFORE any detour, exactly as before.
    if (deploymentClass(env) === 'public' && signinReady() &&
      typeof params.flow === 'string' && params.flow) {
      return authorizeAttested(req, res, params);
    }
    const client = await resolveClient(str(params.client_id));
    if (!client || !redirectUriAllowed(client, params.redirect_uri) || !validRedirectUri(params.redirect_uri)) {
      return bad(res, 400, 'invalid_request', 'Unknown client or redirect address');
    }
    if (params.response_type !== 'code' || params.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(str(params.code_challenge)) || !validateResource(params.resource)) {
      return bad(res, 400, 'invalid_request', 'Authorization code, S256 PKCE, and exact MCP resource are required');
    }
    if (deploymentClass(env) === 'public') {
      // SR-4: on the public class the passphrase is never
      // served or honored here. Configured, the journey is
      // the Vercel detour; unconfigured, the interim notice
      // (authorizeInterim). The operator's working door is
      // the developer route (devAuthorize).
      return signinReady() ?
        authorizeSignin(req, res, params) : authorizeInterim(req, res, params);
    }
    return authorizeLegacy(req, res, params);
  }

  // SR-4 — the developer route's authorize: the legacy
  // passphrase consent served on every deployment class
  // under the dev namespace. The client parameters are
  // validated exactly as a fresh public authorize validates
  // them, then the legacy handler runs with its links
  // re-based into the dev namespace. This is the door the
  // developer handoff's browser leg lands on.
  async function devAuthorize(req, res) {
    if (!only(res, req, ['GET', 'POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_request', 'Malformed authorization request');
    }
    const client = await resolveClient(str(params.client_id));
    if (!client || !redirectUriAllowed(client, params.redirect_uri) || !validRedirectUri(params.redirect_uri)) {
      return bad(res, 400, 'invalid_request', 'Unknown client or redirect address');
    }
    if (params.response_type !== 'code' || params.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(str(params.code_challenge)) || !validateResource(params.resource)) {
      return bad(res, 400, 'invalid_request', 'Authorization code, S256 PKCE, and exact MCP resource are required');
    }
    return authorizeLegacy(req, res, params, DEV_PATHS);
  }

  // SR-4 — the interim public authorize: while the Vercel
  // sign-in leg is unconfigured, the public class renders a
  // notice, never a form, and a POST refuses in plain words
  // (a posted passphrase is never evaluated). The notice
  // cannot strand a consent: existing connections refresh
  // through the token endpoint untouched, no completable
  // public consent exists in this state to take away, the
  // operator's door is the developer route on this same
  // deployment, and the state ends by configuration alone
  // when the owner creates the sign-in App (the SR-4 card
  // records the full argument).
  function interimAuthorizePage(params, accounts) {
    const enrollPairs = flowPairs(params);
    const enrollHref = '/api/oauth/enroll' + (enrollPairs.length ? '?' + enrollPairs.join('&') : '');
    const accountList = accounts.map((account) =>
      '<li>' + escapeHtml(account.label) + ' \u2014 ' +
      escapeHtml(service.issuanceFor(account, env).caption) + '</li>').join('');
    const body =
      '<p>Sign-in on this server is moving to Vercel\u2019s own sign-in, and that ' +
      'switch is not finished yet, so a new connection cannot be completed ' +
      'from this page right now.</p>' +
      '<p>Connections that already exist keep working. When Vercel sign-in ' +
      'is switched on, this page will take you to Vercel to sign in, then ' +
      'ask which account to connect.</p>' +
      (accounts.length ?
        '<p>Accounts already connected to this server:</p><ul>' + accountList + '</ul>' : '') +
      '<p><a href="' + escapeHtml(enrollHref) + '">Enroll another account with a Vercel token</a>' +
      ' \u00b7 <a href="/api/vercel/connect">How connecting works</a></p>';
    return frontDoorPage({
      title: 'Connect ' + escapeHtml(service.name) + ' MCP',
      heading: 'Connect ' + escapeHtml(service.name) + ' MCP',
      body
    });
  }
  async function authorizeInterim(req, res, params) {
    if (req.method === 'POST') {
      return refusal(res, 400, 'This sign-in needs Vercel sign-in first',
        'Open the connection from your AI app and sign in with Vercel; ' +
        'the consent step follows from that sign-in.');
    }
    const accounts = await service.listAccounts();
    return send(res, 200, interimAuthorizePage(params, accounts), 'text/html; charset=utf-8');
  }

  // The pre-SR-2 authorize, unchanged: the dev class on the
  // public paths, and every class on the developer route
  // (devAuthorize passes the dev paths, re-basing the page's
  // enrollment link into the dev namespace).
  async function authorizeLegacy(req, res, params, paths = PUBLIC_PATHS) {
    const accounts = await service.listAccounts();
    if (req.method === 'GET') return send(res, 200, authorizePage(params, accounts, '', paths), 'text/html; charset=utf-8');
    if (!env.ADMIN_PASSPHRASE) {
      return bad(res, 503, 'server_not_configured', 'Admin passphrase is not configured');
    }
    const verdict = await evaluateLogin({
      ip: clientIp(req), supplied: str(params.passphrase), expected: env.ADMIN_PASSPHRASE, store: db
    });
    if (verdict.status === 'locked') {
      res.setHeader('Retry-After', String(LOCKOUT_WINDOW_MINUTES * 60));
      return send(res, 429, authorizePage(params, accounts, 'Too many sign-in attempts', paths), 'text/html; charset=utf-8');
    }
    if (verdict.status !== 'ok') {
      return send(res, 401, authorizePage(params, accounts, 'Incorrect passphrase', paths), 'text/html; charset=utf-8');
    }
    const account = accounts.find((item) => item.id === params.account);
    if (!account) {
      return send(res, 400, authorizePage(params, accounts, 'Invalid account', paths), 'text/html; charset=utf-8');
    }
    // AUD-AZ: mode, profile and listing are DERIVED from the chosen
    // account at issuance (dossier §2.3) — any mode/profile/listing
    // a client posts is not read and cannot steer the connection.
    const issuance = service.issuanceFor(account, env);
    const code = randomToken(32);
    await db.createAuthCode({
      code, clientId: params.client_id, redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge, codeChallengeMethod: 'S256',
      vercelAccount: params.account, mode: issuance.mode, profile: issuance.profile, listing: OAUTH_LISTING
    });
    const destination = new URL(params.redirect_uri);
    destination.searchParams.set('code', code);
    if (typeof params.state === 'string') destination.searchParams.set('state', params.state);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', destination.toString());
    return res.status(302).end();
  }

  // AUD-AR — the enrollment branch of the sign-in flow (dossier
  // §2.2): a stateless branch of this OAuth surface, not a new
  // session and not a setup page. The same administrator-passphrase
  // proof as the authorize POST gates every submission; the flow's
  // parameters ride along as hidden fields so completing (or
  // abandoning) enrollment returns to the SAME consent; and the
  // enrollment operations themselves live behind the service
  // adapter, so this generic handler imports nothing
  // provider-specific. Enrollment stores; only the authorize step
  // binds — a pasted token's reach is read back before anything is
  // stored, and nothing is activated by enrolling.
  function flowPairs(params) {
    return flowFields
      .filter((name) => typeof params[name] === 'string' && params[name] !== '')
      .map((name) => encodeURIComponent(name) + '=' + encodeURIComponent(params[name]));
  }
  function flowHidden(params) {
    return flowFields.map((name) =>
      '<input type="hidden" name="' + name + '" value="' + escapeHtml(params[name]) + '">'
    ).join('');
  }
  // SR-3: with `attested` set (the public class under a
  // Vercel sign-in) the page carries NO passphrase field —
  // the flow record is the authorization, restated as a
  // hidden field — and says whose sign-in enrollment is
  // tied to. Without it the page is byte-for-byte AUD-AR's.
  function enrollPage(params, accounts, error = '', attested = null, paths = PUBLIC_PATHS) {
    const hidden = flowHidden(params);
    const pairs = flowPairs(params);
    const backLink = attested ?
      '<p><a href="/api/oauth/authorize?flow=' + encodeURIComponent(attested.handle) +
        '">Back to sign-in</a></p>' :
      (pairs.length ?
        '<p><a href="' + paths.authorizePath + '?' + pairs.join('&') + '">Back to sign-in</a></p>' :
        '<p><a href="/api/vercel/connect">How connecting works</a></p>');
    const accountOptions = accounts.map((account) =>
      '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(account.label) + '</option>').join('');
    const passphraseField = attested ? '' :
      '<label>Administrator passphrase<input type="password" name="passphrase" ' +
      'required autocomplete="current-password"></label>';
    const flowField = attested ?
      '<input type="hidden" name="flow" value="' + escapeHtml(attested.handle) + '">' : '';
    const body =
      (error ? '<p role="alert">' + escapeHtml(error) + '</p>' : '') +
      (attested ?
        '<p>Signed in to Vercel as <strong>' + escapeHtml(attested.who) + '</strong>. ' +
        'Enrollment is tied to this sign-in: a token can be enrolled for the ' +
        'Vercel user it belongs to, or for a team that user belongs to.</p>' : '') +
      '<p>Enrollment adds an account to this server. A pasted token is checked with the ' +
      'provider and its reach is read back before anything is stored, and enrolling never ' +
      'switches anything on: a connection uses the account only when you finish signing in.</p>' +
      '<h2>Enroll a token</h2>' +
      '<ol><li>On the provider\u2019s site, open your avatar menu, then Settings, then Tokens, ' +
      'and create a token. Full Account scope gives the connection account-wide reach; a ' +
      'narrower scope keeps it to the team (and optionally one project) you name below.</li>' +
      '<li>Choose the token\u2019s own expiration — including never. This server respects the ' +
      'choice and warns ahead of an expiry it knows about.</li>' +
      '<li>Paste the token and the team ID below and enroll. To rotate a token later, enroll ' +
      'its replacement the same way — the stored token is replaced, nothing else changes.</li></ol>' +
      '<form method="post">' + hidden + flowField +
      '<input type="hidden" name="kind" value="token">' +
      '<label>Team ID<input name="teamId" required autocomplete="off"></label>' +
      '<label>Project ID (optional — for a token limited to one project)' +
      '<input name="projectId" autocomplete="off"></label>' +
      '<label>Token<input type="password" name="token" required autocomplete="off"></label>' +
      '<label><input type="checkbox" name="allowFull" value="yes"> Allow broader ' +
      'account-visible token (explicit owner choice)</label>' +
      passphraseField +
      '<button type="submit">Enroll token</button></form>' +
      '<h2>Connect a Blob store</h2>' +
      (accounts.length ?
        '<p>Connect a Blob store to an enrolled account so its files can be listed, read and ' +
        'written through the connection. The store\u2019s read-write token is stored encrypted ' +
        'and is not shown again.</p>' +
        '<form method="post">' + hidden + flowField +
        '<input type="hidden" name="kind" value="blob">' +
        '<label>' + escapeHtml(service.accountLabel) + '<select name="account" required>' +
        accountOptions + '</select></label>' +
        '<label>Store ID<input name="storeId" required autocomplete="off"></label>' +
        '<label>Label<input name="label" required autocomplete="off"></label>' +
        '<label>Access<select name="access"><option value="public">Public</option>' +
        '<option value="private">Private</option></select></label>' +
        '<label>Blob read-write token<input type="password" name="token" required autocomplete="off"></label>' +
        passphraseField +
        '<button type="submit">Connect Blob store</button></form>' :
        '<p>Enroll a token first; its Blob stores can be connected here afterwards.</p>') +
      backLink;
    return frontDoorPage({
      title: 'Enroll an account — ' + escapeHtml(service.name),
      heading: 'Enroll an account',
      body
    });
  }
  const ENROLL_BOX_WORDS = {
    account: 'Full Account', team: 'One team', personal: 'Personal account',
    'team-projects': 'Chosen projects on the team', project: 'One project'
  };
  function enrollContinue(params, accountId = null, authorizePath = PUBLIC_PATHS.authorizePath) {
    // SR-3: the attested journey returns to its own consent.
    if (typeof params.flow === 'string' && params.flow) {
      return '<p><a class="button" href="' + authorizePath + '?flow=' +
        encodeURIComponent(params.flow) + '">Continue to sign-in</a></p>';
    }
    const pairs = flowPairs(params);
    if (pairs.length) {
      const query = pairs.join('&') +
        (accountId ? '&account=' + encodeURIComponent(accountId) : '');
      return '<p><a class="button" href="' + authorizePath + '?' + query + '">Continue to sign-in</a></p>';
    }
    return '<p><a href="/api/vercel/connect">Return to how connecting works</a> — start the ' +
      'connection from your AI client and this account will be offered when you sign in.</p>';
  }
  function enrollTokenReadbackPage(params, result, authorizePath = PUBLIC_PATHS.authorizePath) {
    const scopeText = result.scope === 'full' ? 'Full Account (account-wide)' :
      result.scope === 'project' ? 'one project (' + result.project + ')' : 'one team';
    const boxLine = result.declaredBox ?
      '<p>Declared box: ' + (ENROLL_BOX_WORDS[result.declaredBox] || result.declaredBox) +
      '. Probed box: ' + (ENROLL_BOX_WORDS[result.probedBox] || result.probedBox || '') + '.</p>' : '';
    const body =
      '<p>Connected ' + escapeHtml(result.teamSlug) + ' — reach read back as ' +
      escapeHtml(scopeText) + '; token ending ' + escapeHtml(result.last4) + ', saved encrypted.</p>' +
      boxLine +
      '<p>Nothing has been switched on: the account is enrolled, and a connection binds it ' +
      'only when you finish signing in.</p>' +
      enrollContinue(params, result.accountId, authorizePath);
    return frontDoorPage({
      title: 'Account enrolled — ' + escapeHtml(service.name),
      heading: 'Account enrolled',
      body
    });
  }
  function enrollBlobReadbackPage(params, result, authorizePath = PUBLIC_PATHS.authorizePath) {
    const body =
      '<p>Blob store ' + escapeHtml(result.storeId) + ' connected as ' + escapeHtml(result.label) +
      '; its token is stored encrypted and will not be shown again.</p>' +
      enrollContinue(params, null, authorizePath);
    return frontDoorPage({
      title: 'Blob store connected — ' + escapeHtml(service.name),
      heading: 'Blob store connected',
      body
    });
  }

  // SR-3 — enrollment under attested identity (dossier
  // section 7.2): the flow record authorizes, validated by
  // the same guard as consent. A request without a usable
  // flow detours first — into the authorize detour when the
  // client parameters ride along, else a plain-words
  // refusal naming the route in. A posted passphrase is
  // never evaluated on this class. The Blob form offers
  // only accounts the signer may bind; the token dispatch
  // carries the attested identity into the service, which
  // enforces the binding rule before storing.
  async function enrollAttested(req, res, params) {
    const guard = await liveAttestedFlow(req, str(params.flow));
    if (!guard.flow) {
      if (req.method === 'GET') {
        const pairs = flowPairs(params);
        if (pairs.length) {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Location', '/api/oauth/authorize?' + pairs.join('&'));
          return res.status(302).end();
        }
      }
      return refusal(res, 400, 'Enrollment needs Vercel sign-in first',
        'Enrollment on this server happens inside the sign-in: start the ' +
        'connection from your AI app, sign in with Vercel, and use the ' +
        'enrollment link on the consent step.');
    }
    const flow = guard.flow;
    if (typeof service.enrollToken !== 'function' ||
      typeof service.enrollBlobStore !== 'function') {
      return bad(res, 503, 'server_not_configured',
        'Enrollment is not available on this server');
    }
    const attested = { handle: flow.handle, who: attestedWho(flow) };
    const bindable = typeof service.bindableAccounts === 'function' ?
      await service.bindableAccounts(flow.attested_user_id, env) : [];
    if (req.method === 'GET') {
      return send(res, 200, enrollPage(params, bindable, '', attested),
        'text/html; charset=utf-8');
    }
    if (params.kind === 'blob') {
      const result = await service.enrollBlobStore({
        account: str(params.account), storeId: str(params.storeId),
        label: str(params.label), access: str(params.access),
        token: str(params.token), attestedUserId: flow.attested_user_id
      }, env);
      if (!result.ok) {
        return send(res, 400, enrollPage(params, bindable, result.error, attested),
          'text/html; charset=utf-8');
      }
      return send(res, 200, enrollBlobReadbackPage(params, result),
        'text/html; charset=utf-8');
    }
    if (params.kind !== 'token') {
      return send(res, 400,
        enrollPage(params, bindable, 'Choose an enrollment to complete.', attested),
        'text/html; charset=utf-8');
    }
    const result = await service.enrollToken({
      token: str(params.token), teamId: str(params.teamId),
      projectId: str(params.projectId) || null,
      allowFull: params.allowFull === 'yes',
      attestedUserId: flow.attested_user_id
    }, env);
    if (!result.ok) {
      return send(res, 400, enrollPage(params, bindable, result.error, attested),
        'text/html; charset=utf-8');
    }
    return send(res, 200, enrollTokenReadbackPage(params, result),
      'text/html; charset=utf-8');
  }

  async function enroll(req, res) {
    if (!only(res, req, ['GET', 'POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_request', 'Malformed enrollment request');
    }
    // SR-3 + SR-4: on the public class, enrollment runs
    // under the attested sign-in when the leg is configured
    // and renders the interim notice while it is not; the
    // passphrase branch (enrollLegacy) serves the dev class
    // on this path and every class on the developer route.
    if (deploymentClass(env) === 'public') {
      return signinReady() ?
        enrollAttested(req, res, params) : enrollInterim(req, res, params);
    }
    return enrollLegacy(req, res, params);
  }

  // SR-4 — the developer route's enroll: the AUD-AR branch
  // under the dev namespace, on every deployment class.
  async function devEnroll(req, res) {
    if (!only(res, req, ['GET', 'POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_request', 'Malformed enrollment request');
    }
    return enrollLegacy(req, res, params, DEV_PATHS);
  }

  // SR-4 — the interim public enroll: the notice matching
  // authorizeInterim. No token form is rendered either:
  // enrollment without its gate would be an ungated
  // credential intake, worse than none. A POST refuses in
  // plain words; a posted passphrase is never evaluated.
  function interimEnrollPage(params) {
    const pairs = flowPairs(params);
    const back = pairs.length ?
      '<p><a href="/api/oauth/authorize?' + pairs.join('&') + '">Back to sign-in</a></p>' :
      '<p><a href="/api/vercel/connect">How connecting works</a></p>';
    const body =
      '<p>Enrollment adds an account to this server, and on this server it ' +
      'happens inside the sign-in. Sign-in is moving to Vercel\u2019s own ' +
      'sign-in and that switch is not finished yet, so enrollment cannot ' +
      'be completed from this page right now.</p>' +
      '<p>Accounts already enrolled keep working, and connections that ' +
      'already exist are unaffected.</p>' + back;
    return frontDoorPage({
      title: 'Enroll an account \u2014 ' + escapeHtml(service.name),
      heading: 'Enroll an account',
      body
    });
  }
  async function enrollInterim(req, res, params) {
    if (req.method === 'POST') {
      return refusal(res, 400, 'Enrollment needs Vercel sign-in first',
        'Enrollment on this server happens inside the sign-in: start the ' +
        'connection from your AI app, sign in with Vercel, and use the ' +
        'enrollment link on the consent step.');
    }
    return send(res, 200, interimEnrollPage(params), 'text/html; charset=utf-8');
  }

  // The AUD-AR branch, unchanged: the dev class on the
  // public paths, and every class on the developer route
  // (devEnroll passes the dev paths).
  async function enrollLegacy(req, res, params, paths = PUBLIC_PATHS) {
    const accounts = await service.listAccounts();
    if (req.method === 'GET') {
      return send(res, 200, enrollPage(params, accounts, '', null, paths), 'text/html; charset=utf-8');
    }
    if (!env.ADMIN_PASSPHRASE) {
      return bad(res, 503, 'server_not_configured', 'Admin passphrase is not configured');
    }
    if (typeof service.enrollToken !== 'function' || typeof service.enrollBlobStore !== 'function') {
      return bad(res, 503, 'server_not_configured', 'Enrollment is not available on this server');
    }
    // The same per-request passphrase proof as the authorize POST —
    // no session is minted here and none is consulted.
    const verdict = await evaluateLogin({
      ip: clientIp(req), supplied: str(params.passphrase), expected: env.ADMIN_PASSPHRASE, store: db
    });
    if (verdict.status === 'locked') {
      res.setHeader('Retry-After', String(LOCKOUT_WINDOW_MINUTES * 60));
      return send(res, 429, enrollPage(params, accounts, 'Too many sign-in attempts', null, paths), 'text/html; charset=utf-8');
    }
    if (verdict.status !== 'ok') {
      return send(res, 401, enrollPage(params, accounts, 'Incorrect passphrase', null, paths), 'text/html; charset=utf-8');
    }
    if (params.kind === 'blob') {
      const result = await service.enrollBlobStore({
        account: str(params.account), storeId: str(params.storeId), label: str(params.label),
        access: str(params.access), token: str(params.token)
      }, env);
      if (!result.ok) {
        return send(res, 400, enrollPage(params, accounts, result.error, null, paths), 'text/html; charset=utf-8');
      }
      return send(res, 200, enrollBlobReadbackPage(params, result, paths.authorizePath), 'text/html; charset=utf-8');
    }
    if (params.kind !== 'token') {
      return send(res, 400, enrollPage(params, accounts, 'Choose an enrollment to complete.', null, paths),
        'text/html; charset=utf-8');
    }
    const result = await service.enrollToken({
      token: str(params.token), teamId: str(params.teamId),
      projectId: str(params.projectId) || null, allowFull: params.allowFull === 'yes'
    }, env);
    if (!result.ok) {
      return send(res, 400, enrollPage(params, accounts, result.error, null, paths), 'text/html; charset=utf-8');
    }
    return send(res, 200, enrollTokenReadbackPage(params, result, paths.authorizePath), 'text/html; charset=utf-8');
  }

  async function token(req, res) {
    if (!only(res, req, ['POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_request', 'Malformed token request');
    }
    if (!validateResource(params.resource)) return bad(res, 400, 'invalid_target', 'Token resource must be this MCP');
    const client = await resolveClient(str(params.client_id));
    // Legacy records without an explicit authentication method remain
    // confidential clients; a public client never treats a client ID as proof
    // of possession of a non-existent client secret.
    const authMethod = client?.token_endpoint_auth_method ?? 'client_secret_post';
    const authenticated = authMethod === 'none' ?
      client?.client_secret_hash === null && !Object.hasOwn(params, 'client_secret') :
      authMethod === 'client_secret_post' && typeof params.client_secret === 'string' &&
      params.client_secret.length > 0 && typeof client?.client_secret_hash === 'string' &&
      secretsMatch(hashToken(params.client_secret), client.client_secret_hash);
    if (!client || !authenticated) {
      return bad(res, 401, 'invalid_client', 'Client credentials rejected');
    }
    if (params.grant_type === 'authorization_code') {
      if (!params.code || !redirectUriAllowed(client, params.redirect_uri) || !params.code_verifier) {
        return bad(res, 400, 'invalid_grant', 'Missing or invalid authorization details');
      }
      const record = await db.consumeAuthCode(params.code);
      if (!record || record.client_id !== params.client_id || record.redirect_uri !== params.redirect_uri ||
        !verifyPkce(params.code_verifier, record.code_challenge, record.code_challenge_method)) {
        return bad(res, 400, 'invalid_grant', 'Code is expired, used, or failed PKCE');
      }
      const accessToken = randomToken(32);
      const refreshToken = randomToken(32);
      await db.createAccessToken({
        accessToken, refreshToken, clientId: params.client_id,
        vercelAccount: record.vercel_account, mode: record.mode,
        profile: record.profile, listing: record.listing
      });
      return send(res, 200, tokenResponse(accessToken, refreshToken));
    }
    if (params.grant_type === 'refresh_token') {
      if (!str(params.refresh_token)) return bad(res, 400, 'invalid_grant', 'Missing refresh token');
      const accessToken = randomToken(32);
      const refreshToken = randomToken(32);
      const rotated = await db.rotateRefreshToken({
        refreshToken: params.refresh_token, clientId: params.client_id,
        accessToken, newRefreshToken: refreshToken
      });
      if (!rotated) return bad(res, 400, 'invalid_grant', 'Refresh credential is expired, used, or revoked');
      return send(res, 200, tokenResponse(accessToken, refreshToken));
    }
    return bad(res, 400, 'unsupported_grant_type', 'Supported grants: authorization_code and refresh_token');
  }

  function metadata(req, res) {
    if (!only(res, req, ['GET'])) return;
    const { origin } = urls();
    return send(res, 200, oauthServerMetadata(origin));
  }

  function resourceMetadata(req, res) {
    if (!only(res, req, ['GET'])) return;
    const { origin, resource } = urls();
    return send(res, 200, { resource, authorization_servers: [origin] });
  }

  function museClient(req, res) {
    if (!only(res, req, ['GET'])) return;
    return send(res, 200, museClientDocument());
  }

  return { register, authorize, enroll, devAuthorize, devEnroll, token, metadata, resourceMetadata, museClient,
    revoke:createOAuthRevocation({db,env,getClient:resolveClient}) };
}
