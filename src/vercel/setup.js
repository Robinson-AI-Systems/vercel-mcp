// Authenticated owner-only credential setup. Never log or echo submitted secrets.
// Session is an encrypted, short-lived HttpOnly cookie with a per-session CSRF key.
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../core/secret-box.js';
import { evaluateLogin, clientIp, secretsMatch } from '../core/oauth.js';
import { escapeHtml, paramsOf, only, send } from '../core/http.js';
import { storeToken, recheckStoredToken } from './tokens.js';
import { pendingInputs } from '../core/pending-inputs.js';
import { oneTimeSecrets } from '../core/one-time-secrets.js';
import { approveProductionEnable } from '../tools/production-guard.js';

export const PROTECTED_DEFAULTS = Object.freeze([
  'vercel-mcp', 'stripe-mcp', 'google-workspace-mcp', 'neon-mcp',
  'github-mcp', 'robinsons-toolkit-hub'
]);
const COOKIE = 'rmcp_owner';
const TTL_MS = 15 * 60 * 1000;
const CONTENT_TYPE = 'text/html; charset=utf-8';

function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
}
function page(title, content) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + ' — Robinson Vercel MCP</title>' +
    '<style>body{font:16px system-ui;max-width:650px;margin:4vh auto;padding:20px}' +
    'form{display:grid;gap:12px;margin:24px 0;padding:12px;border:1px solid #ccc}' +
    'input,select,button{font:inherit;padding:10px}button{cursor:pointer}' +
    'label{display:grid;gap:5px}section{margin:22px 0}</style></head><body><main>' +
    '<h1>' + escapeHtml(title) + '</h1>' + content + '</main></body></html>';
}
function html(res, status, title, content) {
  return send(res, status, page(title, content), CONTENT_TYPE);
}
function csrfInput(value) {
  return '<input type="hidden" name="csrf" value="' + escapeHtml(value) + '">';
}
function sessionFrom(req, env, now) {
  const raw = String(req.headers?.cookie || '');
  const token = raw.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!token || token.length > 1500) return null;
  try {
    const data = JSON.parse(decryptSecret(token.slice(COOKIE.length + 1),
      'setup:session', env));
    if (!data || !Number.isFinite(data.exp) || data.exp <= now() ||
      data.exp > now() + TTL_MS ||
      typeof data.csrf !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(data.csrf)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
function loginForm(message = '') {
  return (message ? '<p role="alert">' + escapeHtml(message) + '</p>' : '') +
    '<p>Only the administrator can manage Vercel credentials here.</p>' +
    '<form method="post"><input type="hidden" name="action" value="login">' +
    '<label>Administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Sign in</button></form>';
}
function panel(accounts, csrf, message = '') {
  const options = accounts.map(a => '<option value="' + escapeHtml(a.id) + '">' +
    escapeHtml(a.label) + '</option>').join('');
  const list = accounts.length ? '<ul>' + accounts.map(a => '<li>' +
    escapeHtml(a.label) + ' — ' + escapeHtml(a.scope) + '</li>').join('') + '</ul>' :
    '<p>No Vercel accounts connected yet.</p>';
  return (message ? '<p role="status">' + escapeHtml(message) + '</p>' : '') +
    '<p>Setup is limited to this account owner. Production changes are disabled by default.</p>' +
    '<section><h2>Connected teams</h2>' + list + '</section>' +
    '<section><h2>Add or rotate a Vercel token</h2><form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="add_token">' +
    '<label>Team ID<input name="teamId" required autocomplete="off"></label>' +
    '<label>Project ID (optional)<input name="projectId" autocomplete="off"></label>' +
    '<label>Vercel token<input name="token" type="password" required autocomplete="off"></label>' +
    '<label><input type="checkbox" name="allowFull" value="yes">Allow broader account-visible token (explicit owner choice)</label>' +
    '<button type="submit">Verify and save encrypted token</button></form></section>' +
    '<section><h2>Recheck stored token read access</h2>' +
    '<p>Checks access to the stored team/project without replacing credentials, enabling writes or proving expiry.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="recheck_token">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<button type="submit">Recheck read access</button></form></section>' +
    '<section><h2>Provide a one-use input</h2><form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="pending_input">' +
    '<label>Account<select name="account">' + options + '</select></label>' +
    '<label>Type<select name="kind"><option value="env_value">Environment value</option>' +
    '<option value="deploy_password">Deployment password</option>' +
    '<option value="transfer_auth_code">Domain transfer code</option></select></label>' +
    '<label>Label<input name="label" required></label>' +
    '<label>Secret value<input name="value" type="password" required autocomplete="off"></label>' +
    '<button type="submit">Save one-use input</button></form></section>' +
    '<section><h2>Reveal a one-time secret</h2><form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="reveal">' +
    '<label>Secret reference<input name="id" required></label>' +
    '<label>Account<select name="account"><option value="">Server / global</option>' + options + '</select></label>' +
    '<button type="submit">Reveal once</button></form></section>' +
    '<section><h2>Approve production access (second step)</h2>' +
    '<p>Production is disabled by default. First request it using vercel_enable_production, ' +
    'then reenter the administrator passphrase here within 10 minutes. Preview deployments cannot enable it.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="approve_production">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Pending request reference<input name="id" required></label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Approve production access for this team</button></form></section>' +
    '<section><h2>Add a protected project</h2>' +
    '<p>Add-only until the owner approves a different baseline. Protected defaults cannot be removed here.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="add_protected">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Project name<input name="projectName" pattern="[a-z0-9-]+" required></label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Protect project</button></form></section>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="logout"><button type="submit">Sign out</button></form>';
}

/**
 * Injections are exclusively for offline tests. Production uses stored DB,
 * validated Vercel reads and the AES-GCM cookie mechanism.
 */
export async function handleSetup(req, res, {
  db, env = process.env, now = () => Date.now(), storeTokenFn = storeToken,
  recheckTokenFn = recheckStoredToken
}) {
  headers(res);
  if (!only(res, req, ['GET', 'POST'])) return;
  if (!env.ADMIN_PASSPHRASE || !env.TOKEN_ENCRYPTION_KEY) {
    return html(res, 503, 'Setup unavailable', '<p>Administrator secrets are not configured.</p>');
  }
  const session = sessionFrom(req, env, now);
  if (req.method === 'GET') {
    if (!session) return html(res, 200, 'Administrator sign in', loginForm());
    const accounts = await db.listVercelAccounts();
    return html(res, 200, 'Vercel account setup', panel(accounts, session.csrf));
  }
  let params;
  try { params = paramsOf(req); } catch {
    return html(res, 400, 'Invalid form', '<p>Invalid form submission.</p>');
  }
  if (params.action === 'login') {
    const verdict = await evaluateLogin({
      ip: clientIp(req), supplied: String(params.passphrase || ''),
      expected: env.ADMIN_PASSPHRASE, store: db
    });
    if (verdict.status === 'locked') {
      res.setHeader('Retry-After', '900');
      return html(res, 429, 'Administrator sign in', loginForm('Too many sign-in attempts'));
    }
    if (verdict.status !== 'ok') {
      return html(res, 401, 'Administrator sign in', loginForm('Incorrect passphrase'));
    }
    await db.seedProtectedProjects(PROTECTED_DEFAULTS);
    const csrf = randomBytes(32).toString('base64url');
    const cookie = encryptSecret(JSON.stringify({ csrf, exp: now() + TTL_MS }),
      'setup:session', env);
    res.setHeader('Set-Cookie', COOKIE + '=' + cookie +
      '; Path=/api/vercel/setup; Max-Age=900; HttpOnly; Secure; SameSite=Strict');
    res.setHeader('Location', '/api/vercel/setup');
    return res.status(303).end();
  }
  if (!session || !secretsMatch(String(params.csrf || ''), session.csrf)) {
    return html(res, 403, 'Permission denied', '<p>Please sign in again.</p>');
  }
  if (params.action === 'logout') {
    res.setHeader('Set-Cookie', COOKIE +
      '=; Path=/api/vercel/setup; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    res.setHeader('Location', '/api/vercel/setup');
    return res.status(303).end();
  }
  const accounts = await db.listVercelAccounts();
  try {
    let message;
    if (params.action === 'add_token') {
      const result = await storeTokenFn({
        db, token: params.token, teamId: params.teamId,
        projectId: params.projectId || null, allowFull: params.allowFull === 'yes', env
      });
      message = 'Token verified and encrypted for ' + result.id;
    } else if (params.action === 'recheck_token') {
      if (!accounts.some(a => a.id === params.account)) {
        return html(res, 403, 'Invalid account', '<p>Choose a connected account.</p>');
      }
      // Only an authenticated, CSRF-checked owner page can select a target.
      // This is a read, not approval to widen scope or spend.
      await recheckTokenFn({ db, accountId: params.account, env });
      message = 'Stored token read access was rechecked. Write permissions and expiry remain unverified.';
    } else if (params.action === 'approve_production') {
      if (env.VERCEL_ENV !== 'production') {
        return html(res, 403, 'Unavailable', '<p>Production access cannot be enabled from preview.</p>');
      }
      if (!accounts.some(a => a.id === params.account)) {
        return html(res, 403, 'Unavailable', '<p>That account is not connected.</p>');
      }
      const decision = await evaluateLogin({
        ip: clientIp(req), supplied: String(params.passphrase || ''),
        expected: env.ADMIN_PASSPHRASE, store: db
      });
      if (decision.status === 'locked') {
        res.setHeader('Retry-After', '900');
        return html(res, 429, 'Permission denied', '<p>Too many passphrase attempts.</p>');
      }
      if (decision.status !== 'ok') {
        return html(res, 401, 'Permission denied', '<p>Incorrect passphrase.</p>');
      }
      const approved = await approveProductionEnable({
        db, env, account: params.account, reference: params.id, now
      });
      if (approved.status !== 'enabled') {
        return html(res, 403, 'Unavailable', '<p>Production approval is invalid or expired.</p>');
      }
      message = 'Production access enabled for ' + approved.account;
    } else if (params.action === 'add_protected') {
      if (!accounts.some(a => a.id === params.account)) {
        return html(res, 403, 'Invalid account', '<p>Choose a connected account.</p>');
      }
      const attempt = await evaluateLogin({
        ip: clientIp(req), supplied: String(params.passphrase || ''),
        expected: env.ADMIN_PASSPHRASE, store: db
      });
      if (attempt.status === 'locked') {
        res.setHeader('Retry-After', '900');
        return html(res, 429, 'Permission denied', '<p>Too many sign-in attempts.</p>');
      }
      if (attempt.status !== 'ok') return html(res, 401, 'Permission denied', '<p>Incorrect passphrase.</p>');
      await db.addProtectedResource({ account: params.account, kind: 'project',
        match: params.projectName, note: 'Owner protected on setup' });
      await db.recordChange({ account: params.account, mode: 'preview',
        tool: 'vercel_add_protected_resource',
        summary: 'Owner added project protection: ' + params.projectName,
        dryRun: false, production: false });
      message = 'Project protected: ' + params.projectName;
    } else if (params.action === 'pending_input') {
      if (!accounts.some(a => a.id === params.account)) {
        return html(res, 400, 'Invalid account', '<p>Choose a connected account.</p>');
      }
      const receipt = await pendingInputs({ db, env, now }).submit({
        account: params.account, kind: params.kind,
        label: params.label, value: params.value
      });
      message = 'One-use input reference: ' + receipt.id;
    } else if (params.action === 'reveal') {
      const account = params.account || null;
      if (account && !accounts.some(a => a.id === account)) {
        return html(res, 400, 'Invalid account', '<p>Choose a connected account.</p>');
      }
      const one = await oneTimeSecrets({ db, env, now }).reveal({ id: params.id, account });
      if (!one) return html(res, 404, 'Secret unavailable', '<p>Expired, already viewed, or incorrect account.</p>');
      // Display to the authenticated owner exactly once; no token leaves via MCP.
      return html(res, 200, 'One-time secret', '<p>Copy this value now. It cannot be viewed again.</p>' +
        '<pre>' + escapeHtml(one.value) + '</pre>');
    } else {
      return html(res, 400, 'Invalid form', '<p>Unknown operation.</p>');
    }
    return html(res, 200, 'Vercel account setup', panel(await db.listVercelAccounts(), session.csrf, message));
  } catch {
    // Do not reflect provider exceptions or credentials.
    return html(res, 400, 'Setup failed', '<p>Could not complete the request. Check configuration and account access.</p>');
  }
}
