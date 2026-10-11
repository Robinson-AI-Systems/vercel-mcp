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
import { inspectOwnerAccountChange, consumeOwnerAccountChange,
  applyApprovedOwnerAccountChange } from './owner-approvals.js';

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
function exactDollarCents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 2147483647 ? cents : null;
}
function dollars(cents) {
  return '$' + Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
}
async function connectionChoices(db, accounts) {
  if (typeof db.listAccountConnections !== 'function') return [];
  const groups = await Promise.all(accounts.map(async account =>
    db.listAccountConnections({account: account.id, limit: 20})));
  return groups.flat().filter(row => row.kind === 'connector' && row.revoked_at == null);
}
function ownerRequestSummary(req) {
  if (req.action==='default') return 'Select '+req.targetAccount+' as the new default Vercel account';
  if (req.action==='spend') return 'Set '+req.issuerAccount+' daily spend limit to '+dollars(req.limitCents);
  return 'Revoke connector '+req.connectionRef+' from '+req.issuerAccount+
    ' (subject to last-active protection)';
}
function panel(accounts, csrf, message = '', connections = []) {
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
    '<section><h2>Default account for new connections (owner only)</h2>' +
    '<p>This account appears first for new connections. Existing connections keep their team, profile and mode. ' +
    'This setting changes the server database, not any real Vercel resource. Disabled on preview deployments.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="set_default_account">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label><input type="checkbox" name="confirm" value="yes" required>Confirm the account-wide selection</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Set default account</button></form></section>' +
    '<section><h2>Daily spend limit (owner only)</h2>' +
    '<p>Existing account limits: ' + (accounts.map(a =>
      escapeHtml(a.label) + ' ' + escapeHtml(dollars(a.spend_limit_cents ?? 0))).join('; ') || 'none') +
    '. Default is $0.00. Raising a limit does not authorize purchases or enable production. ' +
    'This changes only the server database; preview deployments cannot change the limit.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="set_spend_limit">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Daily limit in USD (e.g. 0.00 or 11.25)<input name="limitDollars" inputmode="decimal" required></label>' +
    '<label><input type="checkbox" name="confirm" value="yes" required>Confirm this account limit</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Update daily spend limit</button></form></section>' +
    '<section><h2>Revoke one OAuth connector (owner only)</h2>' +
    '<p>Current account-scoped references (may change on refresh). The last active connector ' +
    'and server credential cannot be revoked. A stale reference is refused.</p>' +
    (connections.length ? '<ul>' + connections.map(row =>
      '<li>' + escapeHtml(row.vercel_account) + ' — ' + escapeHtml(row.id) + '</li>').join('') +
      '</ul>' : '<p>No active connector references listed.</p>') +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="revoke_connection">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Exact current connection reference<input name="connectionRef" required pattern="conn_[a-f0-9]{20}" autocomplete="off"></label>' +
    '<label><input type="checkbox" name="confirm" value="yes" required>Confirm targeted revocation</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Revoke selected connector</button></form></section>' +
    '<section><h2>Review a pending owner change</h2>' +
    '<p>Review the exact action and target before separately approving. Review never applies or consumes a request.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="review_owner_request">' +
    '<label>Requesting account<select name="account" required>' + options + '</select></label>' +
    '<label>Pending reference<input name="reference" required autocomplete="off"></label>' +
    '<button type="submit">Review request</button></form></section>' +
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
  recheckTokenFn = recheckStoredToken,
  inspectOwnerChangeFn = inspectOwnerAccountChange,
  consumeOwnerChangeFn = consumeOwnerAccountChange,
  applyApprovedChangeFn = applyApprovedOwnerAccountChange
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
    return html(res, 200, 'Vercel account setup', panel(accounts, session.csrf,
      '', await connectionChoices(db, accounts)));

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
    } else if (params.action === 'set_default_account') {
      // No MCP/profile argument can stand in for this owner session, CSRF,
      // explicit confirmation and independent passphrase reentry.
      if (env.VERCEL_ENV !== 'production') {
        return html(res, 403, 'Unavailable', '<p>Default-account changes require the production server.</p>');
      }
      if (!accounts.some(a => a.id === params.account) || params.confirm !== 'yes') {
        return html(res, 403, 'Permission denied', '<p>Select a connected account and confirm the change.</p>');
      }
      const approval = await evaluateLogin({
        ip: clientIp(req), supplied: String(params.passphrase || ''),
        expected: env.ADMIN_PASSPHRASE, store: db
      });
      if (approval.status === 'locked') {
        res.setHeader('Retry-After', '900');
        return html(res, 429, 'Permission denied', '<p>Too many passphrase attempts.</p>');
      }
      if (approval.status !== 'ok') {
        return html(res, 401, 'Permission denied', '<p>Incorrect passphrase.</p>');
      }
      if (typeof db.setDefaultOwnerAccount !== 'function' ||
          !(await db.setDefaultOwnerAccount(params.account))) {
        return html(res, 409, 'Unavailable', '<p>Account selection could not be verified.</p>');
      }
      message = 'Default account updated for new connections; existing connections remain unchanged.';
    } else if (params.action === 'set_spend_limit') {
      if (env.VERCEL_ENV !== 'production') {
        return html(res, 403, 'Unavailable', '<p>Account limit changes require the production server.</p>');
      }
      const cents = exactDollarCents(params.limitDollars);
      if (!accounts.some(a => a.id === params.account) || params.confirm !== 'yes' || cents === null) {
        return html(res, 403, 'Permission denied', '<p>Select an account and confirm an exact USD limit.</p>');
      }
      const approval = await evaluateLogin({
        ip: clientIp(req), supplied: String(params.passphrase || ''),
        expected: env.ADMIN_PASSPHRASE, store: db
      });
      if (approval.status === 'locked') {
        res.setHeader('Retry-After', '900');
        return html(res, 429, 'Permission denied', '<p>Too many passphrase attempts.</p>');
      }
      if (approval.status !== 'ok') {
        return html(res, 401, 'Permission denied', '<p>Incorrect passphrase.</p>');
      }
      if (typeof db.setOwnerSpendLimit !== 'function' ||
          !(await db.setOwnerSpendLimit(params.account, cents))) {
        return html(res, 409, 'Unavailable', '<p>Account limit change could not be verified.</p>');
      }
      message = 'Daily spending limit saved as ' + dollars(cents) +
        '. No spending, purchase or production access was authorized.';
    } else if (params.action === 'revoke_connection') {
      if (env.VERCEL_ENV !== 'production') {
        return html(res, 403, 'Unavailable', '<p>Revocation requires the production server.</p>');
      }
      if (!accounts.some(a => a.id === params.account) || params.confirm !== 'yes' ||
        typeof params.connectionRef !== 'string' ||
        !/^conn_[a-f0-9]{20}$/.test(params.connectionRef)) {
        return html(res, 403, 'Permission denied', '<p>Select an exact current account connector and confirm.</p>');
      }
      const approval = await evaluateLogin({
        ip: clientIp(req), supplied: String(params.passphrase || ''),
        expected: env.ADMIN_PASSPHRASE, store: db
      });
      if (approval.status === 'locked') {
        res.setHeader('Retry-After', '900');
        return html(res, 429, 'Permission denied', '<p>Too many passphrase attempts.</p>');
      }
      if (approval.status !== 'ok') return html(res, 401, 'Permission denied', '<p>Incorrect passphrase.</p>');
      if (typeof db.revokeOwnerConnection !== 'function' ||
        !(await db.revokeOwnerConnection({account:params.account,connectionId:params.connectionRef}))) {
        return html(res, 409, 'Unavailable', '<p>Connector missing, stale or the last active one.</p>');
      }
      message = 'The selected connector was revoked and independently verified.';
    } else if (params.action === 'review_owner_request') {
      if(env.VERCEL_ENV!=='production')
        return html(res,403,'Unavailable','<p>Review requires the production server.</p>');
      if(!accounts.some(a=>a.id===params.account) ||
        typeof params.reference!=='string' || !/^[0-9a-f-]{36}$/.test(params.reference)) {
        return html(res,403,'Permission denied','<p>Invalid account or pending reference.</p>');
      }
      const request=await inspectOwnerChangeFn({db,env,account:params.account,reference:params.reference});
      if(!request)
        return html(res,404,'Unavailable','<p>Request expired, missing, or belongs to another account.</p>');
      return html(res,200,'Review owner change',
        '<p>Read-only review: no account change has been approved or applied.</p>' +
        '<p>Requested action: '+escapeHtml(ownerRequestSummary(request))+'</p>' +
        '<p>Issuing account: '+escapeHtml(request.issuerAccount)+'</p>' +
        '<form method="post">' + csrfInput(session.csrf) +
        '<input type="hidden" name="action" value="approve_owner_request">' +
        '<input type="hidden" name="account" value="'+escapeHtml(params.account)+'">' +
        '<input type="hidden" name="reference" value="'+escapeHtml(params.reference)+'">' +
        '<label><input type="checkbox" name="confirm" value="yes" required>Confirm this exact owner account change</label>' +
        '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
        '<button type="submit">Approve and apply this exact change</button></form>');
    } else if (params.action === 'approve_owner_request') {
      if(env.VERCEL_ENV!=='production') {
        return html(res,403,'Unavailable','<p>Approval requires the production server.</p>');
      }
      if(!accounts.some(a=>a.id===params.account) || params.confirm!=='yes' ||
        typeof params.reference!=='string' || !/^[0-9a-f-]{36}$/.test(params.reference)) {
        return html(res,403,'Permission denied','<p>Select a valid request and explicitly confirm.</p>');
      }
      const verified=await evaluateLogin({
        ip:clientIp(req),supplied:String(params.passphrase||''),
        expected:env.ADMIN_PASSPHRASE,store:db
      });
      if(verified.status==='locked') {
        res.setHeader('Retry-After','900');
        return html(res,429,'Permission denied','<p>Too many passphrase attempts.</p>');
      }
      if(verified.status!=='ok') {
        return html(res,401,'Permission denied','<p>Incorrect passphrase.</p>');
      }
      // Read exact request before consuming. The encrypted reference is scoped,
      // expiring and single-use; no wildcard or client-supplied target is accepted.
      const preview=await inspectOwnerChangeFn({
        db,env,account:params.account,reference:params.reference
      });
      if(!preview) return html(res,409,'Unavailable','<p>Request missing or expired.</p>');
      if(!accounts.some(a=>a.id===preview.issuerAccount)) {
        return html(res,409,'Unavailable','<p>Issuing account is no longer configured.</p>');
      }
      // Consume only after all independent owner proofs; any concurrent second
      // attempt observes missing receipt. Do not re-use or reissue on failure.
      const approved=await consumeOwnerChangeFn({
        db,env,account:params.account,reference:params.reference,now
      });
      if(!approved || JSON.stringify(approved)!==JSON.stringify(preview)) {
        return html(res,409,'Unavailable','<p>Owner request was used, changed, or expired.</p>');
      }
      const outcome=await applyApprovedChangeFn({db,request:approved});
      if(outcome?.status!=='applied' || outcome.confirmed!==true) {
        return html(res,409,'Not verified','<p>The change was not verified. Inspect current account state before making another request.</p>');
      }
      message='Owner-approved '+approved.action+
        ' change independently verified. The approval reference cannot be reused.';
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
    const updated = await db.listVercelAccounts();
    return html(res, 200, 'Vercel account setup',
      panel(updated, session.csrf, message, await connectionChoices(db, updated)));

  } catch {
    // Do not reflect provider exceptions or credentials.
    return html(res, 400, 'Setup failed', '<p>Could not complete the request. Check configuration and account access.</p>');
  }
}
