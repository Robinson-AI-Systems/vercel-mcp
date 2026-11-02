// SR-1 (gate O-2.7): the upstream Sign in with Vercel leg - this
// server as a relying party of Vercel's own OAuth/OIDC provider.
// The documented contract is the sign-in replacement dossier
// section 3.1 (official docs + the live discovery read, which
// agree): authorize at vercel.com/oauth/authorize (PKCE S256
// REQUIRED), exchange at api.vercel.com/login/oauth/token,
// identity from the RS256 ID Token verified against
// vercel.com/.well-known/jwks, userinfo as belt-and-braces for
// display claims only.
//
// The leg proves WHO the signer is and nothing more: the ID
// Token is verified and discarded, the one-hour access token
// is used transiently for userinfo, and NO SiwV token is ever
// stored (offline_access is never requested - identity is
// re-attested per consent, dossier section 5.3). After SR-1
// the public authorize still proves consent with the
// passphrase; SR-2 wires this leg into that journey.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { publicOrigin, send, escapeHtml, paramsOf, only } from '../core/http.js';
import { hashToken, randomToken, secretsMatch } from '../core/oauth.js';
import { frontDoorPage } from '../front-door.js';

export const SIGNIN_ISSUER = 'https://vercel.com';
export const SIGNIN_AUTHORIZE_URL = 'https://vercel.com/oauth/authorize';
export const SIGNIN_TOKEN_URL = 'https://api.vercel.com/login/oauth/token';
export const SIGNIN_USERINFO_URL = 'https://api.vercel.com/login/oauth/userinfo';
export const SIGNIN_JWKS_URL = 'https://vercel.com/.well-known/jwks';
export const SIGNIN_SCOPES = 'openid profile email';
export const SIGNIN_CALLBACK_PATH = '/api/oauth/vercel/callback';
export const SIGNIN_BINDING_COOKIE = 'rmcp_signin_binding';

export class SigninError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SigninError';
    this.code = code;
  }
}

// The relying-party registration (the SiwV App) is env-carried,
// like the integration registration: created in the team
// Settings -> Apps by the owner (dossier section 8.2); the
// secret value is read here and never appears in code, logs or
// journal text. The callback derives from the one configured
// public origin - the branded identity gains no second source
// (AUD-BO).
export function signinConfig(env = process.env) {
  const clientId = env?.VERCEL_SIGNIN_CLIENT_ID;
  const clientSecret = env?.VERCEL_SIGNIN_CLIENT_SECRET;
  if (typeof clientId !== 'string' || !clientId ||
    typeof clientSecret !== 'string' || !clientSecret) return null;
  let origin;
  try { origin = publicOrigin(env); } catch { return null; }
  return { clientId, clientSecret, redirectUri: origin + SIGNIN_CALLBACK_PATH };
}

// A fresh PKCE pair for the Vercel leg (S256 is the only method
// the provider accepts): a 43-char verifier and its challenge.
export function createSigninPkce() {
  const verifier = randomToken(32);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildSigninAuthorizeUrl({ config, state, nonce, codeChallenge }) {
  if (!config || typeof state !== 'string' || !state ||
    typeof nonce !== 'string' || !nonce ||
    typeof codeChallenge !== 'string' || !codeChallenge) {
    throw new SigninError('signin_not_configured',
      'Sign in with Vercel is not configured on this server');
  }
  const url = new URL(SIGNIN_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SIGNIN_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const readJson = async (response) => {
  try { return await response.json(); } catch { return null; }
};

// The authorization_code exchange. Client authentication is
// client_secret_basic (the Q2 ruling: a stored secret for v1;
// the discovery document lists basic among its methods and the
// App may hold two active secrets, so rotation has no
// downtime). Returns only the two token strings; nothing is
// persisted by this module.
export async function exchangeSigninCode({ config, code, codeVerifier, fetchImpl = fetch }) {
  if (!config) {
    throw new SigninError('signin_not_configured',
      'Sign in with Vercel is not configured on this server');
  }
  if (typeof code !== 'string' || !code || code.length > 512 ||
    typeof codeVerifier !== 'string' || !codeVerifier) {
    throw new SigninError('exchange_refused', 'The sign-in did not return a usable code');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code,
    redirect_uri: config.redirectUri, code_verifier: codeVerifier
  });
  let response;
  try {
    response = await fetchImpl(SIGNIN_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64')
      },
      body
    });
  } catch {
    throw new SigninError('exchange_refused', 'Vercel did not answer the sign-in code exchange');
  }
  const data = response?.ok ? await readJson(response) : null;
  if (!data || typeof data.access_token !== 'string' || !data.access_token ||
    typeof data.id_token !== 'string' || !data.id_token) {
    throw new SigninError('exchange_refused', 'Vercel refused the sign-in code exchange');
  }
  return { accessToken: data.access_token, idToken: data.id_token };
}

export async function fetchSigninJwks({ fetchImpl = fetch } = {}) {
  let response;
  try { response = await fetchImpl(SIGNIN_JWKS_URL); } catch {
    throw new SigninError('jwks_unavailable', 'The signing keys for Vercel sign-in could not be read');
  }
  const data = response?.ok ? await readJson(response) : null;
  if (!data || !Array.isArray(data.keys)) {
    throw new SigninError('jwks_unavailable', 'The signing keys for Vercel sign-in could not be read');
  }
  return data.keys;
}

const base64urlJson = (part) => {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); }
  catch { return null; }
};

// RS256 ID-Token verification against a fetched JWKS. Every
// registered claim the design leans on is checked - signature,
// iss, aud, exp (and nbf when present), nonce - and the result
// is the claims object; any failure is a typed refusal, never
// a partial identity.
export function verifySigninIdToken({ idToken, jwks, clientId, nonce,
  nowSeconds = Math.floor(Date.now() / 1000) }) {
  const invalid = (message) => new SigninError('id_token_invalid', message);
  if (typeof idToken !== 'string') throw invalid('The identity Vercel returned is malformed');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw invalid('The identity Vercel returned is malformed');
  const header = base64urlJson(parts[0]);
  const claims = base64urlJson(parts[1]);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !claims) {
    throw invalid('The identity Vercel returned is malformed');
  }
  const jwk = (Array.isArray(jwks) ? jwks : [])
    .find((key) => key?.kid === header.kid && key?.kty === 'RSA');
  if (!jwk) throw invalid('The identity Vercel returned was signed with an unknown key');
  let keyObject;
  try {
    keyObject = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch { throw invalid('The identity Vercel returned was signed with an unusable key'); }
  const signed = Buffer.from(parts[0] + '.' + parts[1]);
  const signature = Buffer.from(parts[2], 'base64url');
  let verified = false;
  try { verified = cryptoVerify('RSA-SHA256', signed, keyObject, signature); } catch { verified = false; }
  if (!verified) throw invalid('The identity Vercel returned failed signature verification');
  if (claims.iss !== SIGNIN_ISSUER) throw invalid('The identity Vercel returned names the wrong issuer');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(clientId)) throw invalid('The identity Vercel returned was issued for a different app');
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    throw invalid('The identity Vercel returned has expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + 60) {
    throw invalid('The identity Vercel returned is not yet valid');
  }
  if (claims.nonce !== nonce) throw invalid('The identity Vercel returned does not match this sign-in');
  if (typeof claims.sub !== 'string' || !claims.sub) {
    throw invalid('The identity Vercel returned names no user');
  }
  return claims;
}

// Userinfo is belt-and-braces for display claims (dossier
// section 5.1 step 4): the ID Token's sub is the identity; the
// caller refuses when the two disagree.
export async function fetchSigninUserinfo({ accessToken, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(SIGNIN_USERINFO_URL, {
      headers: { authorization: 'Bearer ' + accessToken }
    });
  } catch {
    throw new SigninError('userinfo_refused', 'Vercel did not answer the identity read');
  }
  const data = response?.ok ? await readJson(response) : null;
  if (!data || typeof data.sub !== 'string' || !data.sub) {
    throw new SigninError('userinfo_refused', 'Vercel did not answer the identity read');
  }
  return data;
}

// Only display claims survive the leg - sliced, never tokens.
const displayClaims = (claims, userinfo) => {
  const pick = (source, key) =>
    typeof source?.[key] === 'string' && source[key] ? source[key].slice(0, 200) : null;
  return {
    name: pick(userinfo, 'name') ?? pick(claims, 'name'),
    username: pick(userinfo, 'preferred_username') ?? pick(claims, 'preferred_username'),
    email: pick(userinfo, 'email') ?? pick(claims, 'email'),
    picture: pick(userinfo, 'picture') ?? pick(claims, 'picture')
  };
};

function signinPage(res, status, heading, body) {
  res.setHeader('Cache-Control', 'no-store');
  return send(res, status, frontDoorPage({ title: heading, heading, body }), 'text/html; charset=utf-8');
}
const refusal = (res, status, heading, text, remedy) => signinPage(res, status, heading,
  '<p>' + escapeHtml(text) + '</p><p>' + escapeHtml(remedy) + '</p>');

function cookieValue(req, name) {
  const header = req?.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

// The Vercel-leg callback. SR-1 scope: it completes the leg -
// state match, code exchange, ID-Token verification, userinfo
// cross-check, attestation recorded on the flow - and renders
// a plain confirmation. It mints nothing and stores no
// credential; SR-2 replaces this terminal page with the
// consent render the attested flow unlocks. Every refusal is
// plain words naming the leg that failed and the remedy
// (IN-18's shape) - never a raw provider error.
export async function handleSigninCallback({ db, env = process.env, fetchImpl = fetch }, req, res) {
  if (!only(res, req, ['GET'])) return;
  let params;
  try { params = paramsOf(req); } catch {
    return refusal(res, 400, 'Sign-in could not be completed',
      'This sign-in link is malformed.', 'Start the connection again from your app.');
  }
  if (typeof params.error === 'string' && params.error) {
    return refusal(res, 400, 'Sign-in was not completed',
      'Vercel sign-in was cancelled or refused (' + params.error.slice(0, 60) + ').',
      "Start the connection again from your app and approve the sign-in on Vercel's page.");
  }
  const state = typeof params.state === 'string' ? params.state : '';
  const code = typeof params.code === 'string' ? params.code : '';
  if (!state || state.length > 256 || !code) {
    return refusal(res, 400, 'Sign-in could not be completed',
      'This sign-in link is incomplete.', 'Start the connection again from your app.');
  }
  const flow = await db.getSigninFlow(state);
  if (!flow) {
    return refusal(res, 400, 'Sign-in link not recognized',
      'This sign-in link is not recognized - it may have been replaced by a newer attempt.',
      'Start the connection again from your app.');
  }
  if (flow.consumed_at || flow.vercel_state_consumed_at) {
    return refusal(res, 400, 'Sign-in link already used',
      'This sign-in link was already used. Sign-in links work once.',
      'Start the connection again from your app.');
  }
  if (new Date(flow.expires_at).getTime() <= Date.now()) {
    return refusal(res, 400, 'Sign-in link expired',
      'This sign-in link has expired (sign-in links last ten minutes).',
      'Start the connection again from your app.');
  }
  if (flow.browser_binding_hash) {
    const binding = cookieValue(req, SIGNIN_BINDING_COOKIE);
    if (!binding || !secretsMatch(hashToken(binding), flow.browser_binding_hash)) {
      return refusal(res, 400, 'Sign-in browser mismatch',
        'This sign-in was started in a different browser.',
        'Start the connection again in this browser.');
    }
  }
  const config = signinConfig(env);
  if (!config) {
    return refusal(res, 503, 'Sign-in is not available yet',
      'Sign in with Vercel is not configured on this server yet.',
      'Try again later; nothing about your existing connections is affected.');
  }
  let exchanged;
  try {
    exchanged = await exchangeSigninCode({
      config, code, codeVerifier: flow.vercel_code_verifier, fetchImpl
    });
  } catch (error) {
    if (error instanceof SigninError) {
      return refusal(res, 502, 'Vercel did not complete the sign-in',
        error.message + '.', 'Start the connection again from your app.');
    }
    throw error;
  }
  let attestedClaims;
  let userId;
  try {
    const jwks = await fetchSigninJwks({ fetchImpl });
    const claims = verifySigninIdToken({
      idToken: exchanged.idToken, jwks, clientId: config.clientId, nonce: flow.nonce
    });
    const userinfo = await fetchSigninUserinfo({ accessToken: exchanged.accessToken, fetchImpl });
    if (userinfo.sub !== claims.sub) {
      throw new SigninError('id_token_invalid', 'The identity Vercel returned is inconsistent');
    }
    userId = claims.sub;
    attestedClaims = displayClaims(claims, userinfo);
  } catch (error) {
    if (error instanceof SigninError) {
      return refusal(res, 400, 'Vercel identity could not be verified',
        error.message + '.', 'Start the connection again from your app.');
    }
    throw error;
  }
  const attested = await db.attestSigninFlow({ handle: state, userId, claims: attestedClaims });
  if (!attested) {
    return refusal(res, 400, 'Sign-in link already used',
      'This sign-in link was already used. Sign-in links work once.',
      'Start the connection again from your app.');
  }
  const who = attestedClaims.username || attestedClaims.name || 'your Vercel account';
  return signinPage(res, 200, 'Vercel sign-in verified',
    '<p>Signed in to Vercel as ' + escapeHtml(who) + '. This step only proved your ' +
    'Vercel identity: nothing was connected, and no credential was stored.</p>' +
    '<p>Return to your app and continue connecting.</p>');
}
