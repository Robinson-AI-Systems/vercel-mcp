// Contract-generic OAuth HTTP handlers. Provider-specific behavior is injected via service.
import {
  randomToken, hashToken, secretsMatch, verifyPkce, validRedirectUri,
  evaluateLogin, clientIp, LOCKOUT_WINDOW_MINUTES
} from './oauth.js';
import { publicOrigin, send, escapeHtml, paramsOf, only } from './http.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const LISTINGS = ['catalog', 'compact'];
const bad = (res, status, code, description) => send(res, status, { error: code, error_description: description });
const str = (value) => typeof value === 'string' ? value : '';

export function createOAuthHandlers({ db, env = process.env, service }) {
  if (!service || typeof service.listAccounts !== 'function' || typeof service.modesFor !== 'function') {
    throw new TypeError('An OAuth service adapter is required');
  }
  function urls() {
    const origin = publicOrigin(env);
    return { origin, resource: origin + '/api/mcp' };
  }
  function validateResource(value) { return value === urls().resource; }

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
    if (params.token_endpoint_auth_method && params.token_endpoint_auth_method !== 'client_secret_post') {
      return bad(res, 400, 'invalid_client_metadata', 'Only client_secret_post is supported');
    }
    const clientId = randomToken(24);
    const clientSecret = randomToken(32);
    await db.createOAuthClient({
      clientId, clientSecret, redirectUris: params.redirect_uris,
      clientName: str(params.client_name).slice(0, 100)
    });
    return send(res, 201, {
      client_id: clientId, client_secret: clientSecret, client_secret_expires_at: 0,
      redirect_uris: params.redirect_uris, token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']
    });
  }

  function authorizePage(params, accounts, error = '') {
    const hiddenFields = [
      'client_id', 'redirect_uri', 'response_type', 'code_challenge',
      'code_challenge_method', 'state', 'resource'
    ];
    const hidden = hiddenFields.map((name) =>
      '<input type="hidden" name="' + name + '" value="' + escapeHtml(params[name]) + '">'
    ).join('');
    const selectedAccount = accounts.find((account) => params.account === account.id) || accounts[0];
    const accountList = accounts.map((account) =>
      '<option value="' + escapeHtml(account.id) + '"' +
      (selectedAccount?.id === account.id ? ' selected' : '') + '>' +
      escapeHtml(account.label) + '</option>'
    ).join('');
    const modes = selectedAccount ? service.modesFor(selectedAccount, env) : ['preview'];
    const selectedMode = modes.includes(params.mode) ? params.mode : 'preview';
    const modeList = modes.map((mode) =>
      '<option value="' + mode + '"' + (selectedMode === mode ? ' selected' : '') + '>' + mode + '</option>'
    ).join('');
    const profileList = PROFILES.map((profile) =>
      '<option value="' + profile + '"' + (params.profile === profile ? ' selected' : '') + '>' + profile + '</option>'
    ).join('');
    const listingList = LISTINGS.map((listing) =>
      '<option value="' + listing + '"' + (params.listing === listing ? ' selected' : '') + '>' + listing + '</option>'
    ).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Connect ' + escapeHtml(service.name) + ' MCP</title>' +
      '<style>body{font:16px system-ui,sans-serif;max-width:410px;margin:6vh auto;padding:20px}' +
      'form{display:grid;gap:14px}input,select,button{font:inherit;padding:10px}button{cursor:pointer}p{line-height:1.5}</style>' +
      '</head><body><h1>Connect ' + escapeHtml(service.name) + ' MCP</h1>' +
      (error ? '<p role="alert">' + escapeHtml(error) + '</p>' : '') +
      (accounts.length ? '<p>Choose the ' + escapeHtml(service.accountLabel) + ' and permissions for this AI connection.</p>' :
        '<p>No Vercel teams are connected yet. An administrator must add an account through the secure setup page.</p>') +
      '<form method="post">' + hidden +
      '<label>' + escapeHtml(service.accountLabel) + '<select name="account" required>' + accountList + '</select></label>' +
      '<label>Mode<select name="mode">' + modeList + '</select></label>' +
      '<label>Profile<select name="profile">' + profileList + '</select></label>' +
      '<label>Tool listing<select name="listing">' + listingList + '</select></label>' +
      '<label>Administrator passphrase<input type="password" name="passphrase" required autocomplete="current-password"></label>' +
      '<button type="submit"' + (!accounts.length ? ' disabled' : '') + '>Authorize this connection</button></form></body></html>';
  }

  async function authorize(req, res) {
    if (!only(res, req, ['GET', 'POST'])) return;
    let params;
    try { params = paramsOf(req); } catch {
      return bad(res, 400, 'invalid_request', 'Malformed authorization request');
    }
    const client = await db.getOAuthClient(str(params.client_id));
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
    const modes = account ? service.modesFor(account, env) : [];
    if (!account || !modes.includes(params.mode) ||
      !PROFILES.includes(params.profile) || !LISTINGS.includes(params.listing)) {
      return send(res, 400, authorizePage(params, accounts, 'Invalid account, mode, or connection settings'), 'text/html; charset=utf-8');
    }
    const code = randomToken(32);
    await db.createAuthCode({
      code, clientId: params.client_id, redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge, codeChallengeMethod: 'S256',
      vercelAccount: params.account, mode: params.mode, profile: params.profile, listing: params.listing
    });
    const destination = new URL(params.redirect_uri);
    destination.searchParams.set('code', code);
    if (typeof params.state === 'string') destination.searchParams.set('state', params.state);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', destination.toString());
    return res.status(302).end();
  }

  return { register, authorize };
}
