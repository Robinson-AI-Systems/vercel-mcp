// AUD-I S1 — the Vercel Integrations connect tier (Door 1).
//
// The user installs this server's integration on their own Vercel team
// from Vercel's own pages; Vercel redirects back here with a one-time
// `code`; this module exchanges it for the long-lived installation
// token and enrolls it (src/vercel/tokens.js). The user never handles
// a token. AUD-K: team installs enroll through the installation-aware
// probe — an installation token is granted the configuration read,
// the single-team read and the team-scoped projects list, NOT the
// teams list or a load-bearing user read the standard pasted-token
// probe leans on (VMCP-026 / A-1: that probe 403'd every Door-1 team
// install at enrollment).
//
// Platform contract (Vercel docs, read 2026-10-28 —
// /docs/integrations/create-integration/vercel-api-integrations,
// updated 2026-09-16): the exchange is
//   POST https://api.vercel.com/v2/oauth/access_token
//   application/x-www-form-urlencoded:
//     client_id, client_secret, code, redirect_uri
// the code is valid 30 minutes and exchangeable once, and the JSON
// response is shaped:
//   { "token_type": "Bearer", "access_token": "…",
//     "installation_id": "icfg_…", "user_id": "…", "team_id": null }
// `team_id` is non-null exactly when the install landed on a team;
// null means a personal-account install. Every fake in this build's
// tests cites this documented shape.
//
// Operator secrets: the integration's client id/secret are server
// environment values (VERCEL_INTEGRATION_CLIENT_ID /
// VERCEL_INTEGRATION_CLIENT_SECRET / VERCEL_INTEGRATION_REDIRECT_URI).
// They are never logged, never echoed, never returned.
import { storePersonalToken, storeInstallationToken } from './tokens.js';
import { escapeHtml, send } from '../core/http.js';
import { SERVICE_DISPLAY_NAME } from '../service-identity.js';

const EXCHANGE_PATH = '/v2/oauth/access_token';
const DEFAULT_BASE = 'https://api.vercel.com';

export class IntegrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
  }
}

export function integrationConfig(env = process.env) {
  const clientId = env?.VERCEL_INTEGRATION_CLIENT_ID;
  const clientSecret = env?.VERCEL_INTEGRATION_CLIENT_SECRET;
  const redirectUri = env?.VERCEL_INTEGRATION_REDIRECT_URI;
  if (typeof clientId !== 'string' || !clientId ||
    typeof clientSecret !== 'string' || !clientSecret ||
    typeof redirectUri !== 'string' || !/^https:\/\//.test(redirectUri)) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

// Exchange the one-time install code for the installation token.
// Returns the validated identity fields; the token value itself is
// returned only so the caller can hand it straight to the store path.
export async function exchangeInstallCode({ code, env = process.env,
  fetchImpl = fetch, baseUrl } = {}) {
  const config = integrationConfig(env);
  if (!config) {
    throw new IntegrationError('integration_not_configured',
      'The Vercel integration is not configured on this server');
  }
  if (typeof code !== 'string' || !code || code.length > 512) {
    throw new IntegrationError('exchange_refused',
      'The install did not return a usable code');
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri
  });
  let response;
  try {
    response = await fetchImpl((baseUrl || DEFAULT_BASE) + EXCHANGE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
  } catch {
    throw new IntegrationError('exchange_refused',
      'Vercel could not be reached to complete the install');
  }
  if (!response || response.status !== 200) {
    throw new IntegrationError('exchange_refused',
      'Vercel refused the install code (it may have expired — codes last 30 minutes and work once)');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new IntegrationError('exchange_malformed',
      'Vercel answered the install exchange in an unexpected shape');
  }
  if (!data || typeof data.access_token !== 'string' || !data.access_token ||
    data.token_type !== 'Bearer' ||
    typeof data.installation_id !== 'string' ||
    !data.installation_id.startsWith('icfg_') ||
    typeof data.user_id !== 'string' || !data.user_id ||
    !(data.team_id === null || (typeof data.team_id === 'string' && data.team_id))) {
    throw new IntegrationError('exchange_malformed',
      'Vercel answered the install exchange in an unexpected shape');
  }
  return {
    accessToken: data.access_token,
    installationId: data.installation_id,
    userId: data.user_id,
    teamId: data.team_id
  };
}

// Enroll an exchanged installation. Team installs go through the
// installation-aware probe (AUD-K, tokens.js): the installation's
// own configuration record — read with the installation token —
// proves the install, its team and its granted scopes, so no
// broader-visibility allowance is ever in play. Personal installs
// (team_id null) enroll through the user-keyed probe (AUD-I S1b,
// tokens.js): identity cross-checked against the exchange's
// installer claim, account keyed on the user id — never faked
// through the team probe.
export async function enrollInstallation({ db, exchange, declaredBox,
  env = process.env, fetchImpl, baseUrl } = {}) {
  if (!exchange || typeof exchange.accessToken !== 'string') {
    throw new IntegrationError('exchange_malformed',
      'No exchanged installation to enroll');
  }
  if (exchange.teamId === null) {
    const receipt = await storePersonalToken({
      db, token: exchange.accessToken, userId: exchange.userId, env,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      probeExtra: {
        source: 'integration',
        installationId: exchange.installationId,
        installerUserId: exchange.userId,
        declaredBox: declaredBox ?? 'personal'
      }
    });
    return { enrolled: true, kind: 'personal',
      installationId: exchange.installationId, account: receipt };
  }
  const config = integrationConfig(env);
  if (!config) {
    throw new IntegrationError('integration_not_configured',
      'The Vercel integration is not configured on this server');
  }
  const receipt = await storeInstallationToken({
    db, token: exchange.accessToken, teamId: exchange.teamId,
    installationId: exchange.installationId, integrationId: config.clientId,
    userId: exchange.userId, env,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    probeExtra: {
      source: 'integration',
      installationId: exchange.installationId,
      installerUserId: exchange.userId,
      declaredBox: declaredBox ?? 'team'
    }
  });
  return { enrolled: true, kind: 'team', installationId: exchange.installationId,
    account: receipt };
}

function page(title, content) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + ' — ' + escapeHtml(SERVICE_DISPLAY_NAME) + '</title>' +
    '<style>body{font:16px system-ui;max-width:650px;margin:4vh auto;padding:20px}</style>' +
    '</head><body><main><h1>' + escapeHtml(title) + '</h1>' + content + '</main></body></html>';
}

function html(res, status, title, content) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return send(res, status, page(title, content), 'text/html; charset=utf-8');
}

// The integration's redirect target. Vercel sends the user back with
// ?code=… after install. GET only; nothing here is authenticated —
// the code itself is the one-time credential, and enrollment still
// passes the probe before anything is stored.
export async function handleIntegrationCallback(req, res, { db,
  env = process.env, fetchImpl, baseUrl } = {}) {
  if (req.method !== 'GET') return html(res, 405, 'Not available',
    '<p>This address only completes a Vercel install.</p>');
  const url = new URL(req.url || '/', 'https://placeholder.invalid');
  const code = url.searchParams.get('code');
  if (!code) return html(res, 400, 'Install incomplete',
    '<p>No install code arrived. Start the install again from the connection page.</p>');
  let exchange;
  try {
    exchange = await exchangeInstallCode({ code, env, fetchImpl, baseUrl });
  } catch (err) {
    const status = err?.code === 'integration_not_configured' ? 503 : 502;
    return html(res, status, 'Install could not be completed',
      '<p>' + escapeHtml(err?.message || 'The install exchange failed.') + '</p>');
  }
  // AUD-K hardening: the redirect also names the installation and
  // the team (configurationId / teamId). The exchange's validated
  // values are the probe's inputs; a redirect that disagrees with
  // them is refused before any probe call is made.
  const redirectConfigurationId = url.searchParams.get('configurationId');
  const redirectTeamId = url.searchParams.get('teamId');
  if ((redirectConfigurationId !== null &&
      redirectConfigurationId !== exchange.installationId) ||
    (redirectTeamId !== null && exchange.teamId !== null &&
      redirectTeamId !== exchange.teamId)) {
    return html(res, 502, 'Install could not be completed',
      '<p>The install Vercel reported does not match the install that was started. ' +
      'Start the install again from the connection page.</p>');
  }
  let result;
  try {
    result = await enrollInstallation({ db, exchange, env, fetchImpl, baseUrl });
  } catch (err) {
    return html(res, 502, 'Install could not be completed',
      '<p>' + escapeHtml(err?.message ||
        'The installed credential could not be verified or saved.') + '</p>');
  }
  if (result.kind === 'personal') {
    return html(res, 200, 'Connected',
      '<p>Your Vercel <strong>personal account</strong> is connected. ' +
      'You can close this page and return to your assistant.</p>');
  }
  return html(res, 200, 'Connected',
    '<p>Your Vercel team is connected. You can close this page and return to your assistant.</p>');
}
