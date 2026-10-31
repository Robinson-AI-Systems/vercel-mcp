import {createOAuthRevocation} from './oauth-revocation.js';
// Contract-generic OAuth HTTP handlers. Provider-specific behavior is injected via service.
import {
  randomToken, hashToken, secretsMatch, verifyPkce, validRedirectUri,
  evaluateLogin, clientIp, LOCKOUT_WINDOW_MINUTES
} from './oauth.js';
import { publicOrigin, send, escapeHtml, paramsOf, only } from './http.js';
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

const tokenResponse = (access, refresh) => ({
  access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh
});
const bad = (res, status, code, description) => send(res, status, { error: code, error_description: description });
const str = (value) => typeof value === 'string' ? value : '';

export function createOAuthHandlers({ db, env = process.env, service }) {
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
  // The Muse document client resolves to a fixed public-client record; every
  // other client_id keeps the registered-client lookup, unchanged.
  async function resolveClient(clientId) {
    if (typeof clientId === 'string' && clientId === museClientDocument().client_id) {
      return {
        client_id: clientId, client_name: 'Muse',
        redirect_uris: [MUSE_REDIRECT_URI],
        token_endpoint_auth_method: 'none', client_secret_hash: null
      };
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
  function authorizePage(params, accounts, error = '') {
    const hiddenFields = [
      'client_id', 'redirect_uri', 'response_type', 'code_challenge',
      'code_challenge_method', 'state', 'resource'
    ];
    const hidden = hiddenFields.map((name) =>
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
    const enrollPairs = hiddenFields
      .filter((name) => typeof params[name] === 'string' && params[name] !== '')
      .map((name) => encodeURIComponent(name) + '=' + encodeURIComponent(params[name]));
    const enrollHref = '/api/oauth/enroll' + (enrollPairs.length ? '?' + enrollPairs.join('&') : '');
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

  async function authorize(req, res) {
    if (!only(res, req, ['GET', 'POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_request', 'Malformed authorization request');
    }
    const client = await resolveClient(str(params.client_id));
    if (!client || !client.redirect_uris?.includes(params.redirect_uri) || !validRedirectUri(params.redirect_uri)) {
      return bad(res, 400, 'invalid_request', 'Unknown client or redirect address');
    }
    if (params.response_type !== 'code' || params.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(str(params.code_challenge)) || !validateResource(params.resource)) {
      return bad(res, 400, 'invalid_request', 'Authorization code, S256 PKCE, and exact MCP resource are required');
    }
    const accounts = await service.listAccounts();
    if (req.method === 'GET') return send(res, 200, authorizePage(params, accounts), 'text/html; charset=utf-8');
    if (!env.ADMIN_PASSPHRASE) {
      return bad(res, 503, 'server_not_configured', 'Admin passphrase is not configured');
    }
    const verdict = await evaluateLogin({
      ip: clientIp(req), supplied: str(params.passphrase), expected: env.ADMIN_PASSPHRASE, store: db
    });
    if (verdict.status === 'locked') {
      res.setHeader('Retry-After', String(LOCKOUT_WINDOW_MINUTES * 60));
      return send(res, 429, authorizePage(params, accounts, 'Too many sign-in attempts'), 'text/html; charset=utf-8');
    }
    if (verdict.status !== 'ok') {
      return send(res, 401, authorizePage(params, accounts, 'Incorrect passphrase'), 'text/html; charset=utf-8');
    }
    const account = accounts.find((item) => item.id === params.account);
    if (!account) {
      return send(res, 400, authorizePage(params, accounts, 'Invalid account'), 'text/html; charset=utf-8');
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
      if (!params.code || !client.redirect_uris.includes(params.redirect_uri) || !params.code_verifier) {
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

  return { register, authorize, token, metadata, resourceMetadata, museClient,
    revoke:createOAuthRevocation({db,env,getClient:resolveClient}) };
}
