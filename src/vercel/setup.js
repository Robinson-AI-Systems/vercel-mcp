// Authenticated owner-only credential setup. Never log or echo submitted secrets.
// Session is an encrypted, short-lived HttpOnly cookie with a per-session CSRF key.
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../core/secret-box.js';
import { evaluateLogin, clientIp, secretsMatch } from '../core/oauth.js';
import { SERVICE_DISPLAY_NAME } from '../service-identity.js';
import { escapeHtml, paramsOf, only, send } from '../core/http.js';
import { storeToken, recheckStoredToken } from './tokens.js';
import { tokenExpiryPosture } from './token-expiry.js';
import { pendingInputs } from '../core/pending-inputs.js';
import { oneTimeSecrets } from '../core/one-time-secrets.js';
import { approveProductionEnable } from '../tools/production-guard.js';
import {inspectPassRequest,consumePassRequest} from './pass-requests.js';
import {registry} from '../tools/index.js';
import { inspectOwnerAccountChange, consumeOwnerAccountChange,
  applyApprovedOwnerAccountChange } from './owner-approvals.js';

// IN-07: existing seeded records persist until the authenticated owner clears them.
export const PROTECTED_DEFAULTS = Object.freeze([]);
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
    '<title>' + escapeHtml(title) + ' — ' + escapeHtml(SERVICE_DISPLAY_NAME) + '</title>' +
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
// A separate technical JavaScript-safe bound, not a discretionary owner limit.
function purchaseDollarCents(value) {
  if(typeof value!=='string' || !/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole,fraction='']=value.split('.');
  const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  return amount>0n && amount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(amount):null;
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
  // AUD-E (D-E/VMCP-003/IN-04): each account row states its token expiry
  // posture from the same stored values vercel_whoami reports. Unknown and
  // attested-no-expiry accounts never trigger the banner; the banner sits
  // at the top of the account list and fires only inside the 14-day window
  // or once expired.
  const postures = accounts.map(a => tokenExpiryPosture(a));
  const banner = accounts.map((a, i) => ({ a, p: postures[i] })).filter(x => x.p.inWindow)
    .map(x => '<p role="alert">' + escapeHtml(x.p.posture === 'expired' ?
      'Vercel token for ' + x.a.label + ' expired; rotate it using this setup page.' :
      'Vercel token for ' + x.a.label + ' ' + x.p.label +
        '; verify renewal through owner setup.') + '</p>').join('');
  const list = accounts.length ? banner + '<ul>' + accounts.map((a, i) => '<li>' +
    escapeHtml(a.label) + ' — ' + escapeHtml(a.scope) + ' — ' +
    escapeHtml(postures[i].label) + '</li>').join('') + '</ul>' :
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
    '<section><h2>Purchase policy (owner only)</h2>' +
    '<p>Current policy: ' + (accounts.map(a =>
      escapeHtml(a.label) + ' — ' +
      escapeHtml(a.purchase_budget_cents == null ? 'no agent budget set' :
        'agent budget ' + dollars(a.purchase_budget_cents)) + '; ' +
      escapeHtml(a.purchase_grant_required ?
        'per-purchase grant required' : 'per-purchase grant not required')).join('; ') || 'none') +
    '. The agent budget is optional and frames cost disclosure; it is your ' +
    'standing delegation setting, separate from the legacy daily spend limit ' +
    'above. Checking the grant box opts this account into the strictest ' +
    'setting, where each purchase needs its own one-time owner grant. ' +
    'Saving a policy changes only the server database and does not itself ' +
    'authorize any purchase; preview deployments cannot change it.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="set_purchase_policy">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Agent budget in USD (leave blank for no budget)<input name="budgetDollars" inputmode="decimal"></label>' +
    '<label><input type="checkbox" name="grantRequired" value="yes">Require a per-purchase owner grant (strictest setting)</label>' +
    '<label><input type="checkbox" name="confirm" value="yes" required>Confirm this account policy</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Update purchase policy</button></form></section>' +
    '<section><h2>Token expiry (owner only)</h2>' +
    '<p>Current state: ' + (accounts.map((a, i) =>
      escapeHtml(a.label) + ' — ' + escapeHtml(postures[i].label)).join('; ') || 'none') +
    '. A token enrolled here records no expiry date, so its state is ' +
    '"expiry not recorded for this token" until you attest otherwise. ' +
    'If the enrolled key has no expiry — your choice when you created it — ' +
    'attest that below and the account will state “no expiry — owner’s ' +
    'choice”. An attestation belongs to the token enrolled now: enrolling ' +
    'or rotating a token clears it, and each form below is bound to the ' +
    'token it was shown for — a form left open across a rotation is ' +
    'refused, never applied to the replacement token. Saving changes ' +
    'only the server database; preview deployments cannot change it.</p>' +
    (accounts.length ? accounts.map((a, i) =>
      '<form method="post">' + csrfInput(csrf) +
      '<input type="hidden" name="action" value="set_token_no_expiry">' +
      '<input type="hidden" name="account" value="' + escapeHtml(a.id) + '">' +
      '<input type="hidden" name="tokenVersion" value="' +
        escapeHtml(a.token_version || '') + '">' +
      '<p>' + escapeHtml(a.label) + ' — ' + escapeHtml(postures[i].label) + '</p>' +
      '<label><input type="checkbox" name="noExpiry" value="yes"' +
        (a.token_no_expiry ? ' checked' : '') +
        '>The enrolled token for this account has no expiry (owner’s choice)</label>' +
      '<label><input type="checkbox" name="confirm" value="yes" required>Confirm this attestation (leave the box above unchecked to clear an attestation)</label>' +
      '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
      '<button type="submit">Save token expiry attestation</button></form>').join('') :
      '<p>No Vercel accounts connected yet.</p>') + '</section>' +
    '<section><h2>Review an agent pass request</h2>' +
    '<p>Review the exact read-only scope before issuing a pass. Agents cannot approve their own requests.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="review_rtc_pass_request">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Pass request reference<input name="reference" required autocomplete="off"></label>' +
    '<button type="submit">Review requested pass</button></form></section>' +
    '<section><h2>Temporary read-only RTC passes</h2>' +
    '<p>Preview passes can read owner-scoped Vercel areas; TEST is service ' +
    'identity only with no provider resources. Both are read-only, zero-spend, ' +
    'owner-revocable and expire within 720 hours (24 by default).</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="issue_rtc_pass">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Pass mode<select name="mode" required>' +
    '<option value="preview">Preview — scoped provider reads</option>' +
    '<option value="test">TEST — service identity only</option></select></label>' +
    '<label>Allowed areas, comma-separated (TEST requires server only)' +
    '<input name="areas" value="server" required></label>' +
    '<label>Lifetime in hours (1–720)<input name="hours" value="24" required></label>' +
    '<label>Calls per minute (1–600; 120 default)<input name="rateLimitPerMinute" type="number" min="1" max="600" value="120" required></label>' +
    '<label><input type="checkbox" name="confirm" value="yes" required>Issue one scoped read-only pass</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required></label>' +
    '<button type="submit">Issue read-only pass</button></form>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="revoke_rtc_pass">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Exact pass reference<input name="id" pattern="pass_[a-f0-9]{20}" required></label>' +
    '<label><input type="checkbox" name="confirm" value="yes" required>Revoke the selected pass</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required></label>' +
    '<button type="submit">Revoke read-only pass</button></form></section>' +
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
    '<section><h2>Approve one exact purchase (owner only)</h2>' +
    '<p>AI agents cannot approve charges. Enter the purchase reference first to inspect the operation, quoted price or usage class. Approval requires your current passphrase and a separately chosen maximum; no provider charge is made during approval.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="review_purchase">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Exact purchase reference<input name="reference" required autocomplete="off"></label>' +
    '<button type="submit">Review proposed purchase</button></form></section>' +
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
    '<section><h2>Production enable strictness (owner only)</h2>' +
    '<p>Current teams: ' + (accounts.map(a =>
      escapeHtml(a.label) + ' — production ' +
      escapeHtml(a.production_enabled ? 'enabled' : 'disabled') +
      '; enable strictness ' +
      escapeHtml(a.production_enable_strictness === 'passphrase' ? 'passphrase' : 'word')).join('; ') || 'none') +
    '. Word strictness (the default) means vercel_enable_production completes ' +
    'on your confirmed word, with no setup step. Passphrase strictness is your ' +
    'own stricter choice for a team: enabling then also needs the second step ' +
    'below. This setting changes only on this page, never through a tool; ' +
    'saving it changes only the server database and does not itself enable ' +
    'production; preview deployments cannot change it.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="set_production_strictness">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Enable strictness<select name="strictness" required>' +
    '<option value="word">Word — enable on my confirmed word</option>' +
    '<option value="passphrase">Passphrase — also require my setup passphrase</option></select></label>' +
    '<label><input type="checkbox" name="confirm" value="yes" required>Confirm this team strictness</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Update production enable strictness</button></form></section>' +
    '<section><h2>Approve production access (second step, passphrase teams only)</h2>' +
    '<p>Production is disabled by default. For a team set to word strictness, ' +
    'vercel_enable_production with confirm enables it on your word and no setup ' +
    'step is needed. For a team set to passphrase strictness, first request it ' +
    'using vercel_enable_production, then reenter the administrator passphrase ' +
    'here within 10 minutes. Preview deployments cannot enable it.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="approve_production">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Pending request reference<input name="id" required></label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Approve production access for this team</button></form></section>' +
    '<section><h2>Optional project exclusions</h2>' +
    '<p>No project name is permanently excluded. A project may still require separate approval for production, destructive, credential or paid actions.</p>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="add_protected">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label>Project name<input name="projectName" pattern="[a-z0-9-]+" required></label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Protect project</button></form>' +
    '<form method="post">' + csrfInput(csrf) +
    '<input type="hidden" name="action" value="clear_protected">' +
    '<label>Account<select name="account" required>' + options + '</select></label>' +
    '<label><input type="checkbox" name="acknowledge" value="remove-all" required> Remove old global defaults and all account project exclusions; separate safety approvals still apply</label>' +
    '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
    '<button type="submit">Remove all project exclusions for this account</button></form></section>' +
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
    if(params.action==='review_rtc_pass_request'||params.action==='approve_rtc_pass_request'){
      if(env.VERCEL_ENV!=='production'||!accounts.some(x=>x.id===params.account))
        return html(res,403,'Permission denied','<p>Owner production setup session required.</p>');
      const knownAreas=['server',...new Set(registry.tools.filter(t=>t.writes===false).map(t=>t.area).filter(Boolean))];
      const request=await inspectPassRequest({db,env,account:params.account,reference:params.reference,knownAreas,now});
      if(!request)return html(res,409,'Unavailable','<p>Request expired, missing, or belongs to another account.</p>');
      if(params.action==='review_rtc_pass_request')
        return html(res,200,'Review read-only pass',
          '<p>No pass has been issued. Read-only '+escapeHtml(request.mode)+'; '+request.hours+
          ' hours; areas: '+escapeHtml(request.areas.join(', '))+'; '+request.rateLimitPerMinute+' calls/minute. No spending or writes. TEST is service identity only.</p>'+
          '<form method="post">'+csrfInput(session.csrf)+
          '<input type="hidden" name="action" value="approve_rtc_pass_request">'+
          '<input type="hidden" name="account" value="'+escapeHtml(params.account)+'">'+
          '<input type="hidden" name="reference" value="'+escapeHtml(params.reference)+'">'+
          '<label><input type="checkbox" name="confirm" value="yes" required>Issue this exact read-only pass</label>'+
          '<label>Reenter administrator passphrase<input name="passphrase" type="password" required></label>'+
          '<button type="submit">Approve and issue pass</button></form>');
      if(params.confirm!=='yes')return html(res,403,'Permission denied','<p>Explicit confirmation required.</p>');
      const proof=await evaluateLogin({ip:clientIp(req),supplied:String(params.passphrase||''),
        expected:env.ADMIN_PASSPHRASE,store:db});
      if(proof.status==='locked'){
        res.setHeader('Retry-After','900');return html(res,429,'Permission denied','<p>Too many attempts.</p>');
      }
      if(proof.status!=='ok')return html(res,401,'Permission denied','<p>Incorrect passphrase.</p>');
      const approved=await consumePassRequest({db,env,account:params.account,reference:params.reference,knownAreas,now});
      if(!approved||JSON.stringify(approved)!==JSON.stringify(request))
        return html(res,409,'Unavailable','<p>Request changed, expired, or was already consumed.</p>');
      const issued=await db.issueReadOnlyRtcPass({account:approved.account,
        mode:approved.mode,hours:approved.hours,areas:approved.areas,
        rateLimitPerMinute:approved.rateLimitPerMinute});
      if(!issued)return html(res,409,'Unavailable','<p>Pass was not issued; request is consumed.</p>');
      let once;
      try{
        const verifiedPass=await db.inspectRtcPass(issued.token);
        if(verifiedPass?.status!=='ok'||verifiedPass.id!==issued.id||verifiedPass.account!==approved.account||
          verifiedPass.profile!=='read_only'||verifiedPass.mode!==approved.mode||
          JSON.stringify(verifiedPass.areas)!==JSON.stringify(approved.areas)||
          verifiedPass.rateLimitPerMinute!==approved.rateLimitPerMinute)
          throw new TypeError('Pass scope was not independently verified');
        once=await oneTimeSecrets({db,env,now}).issue({account:approved.account,
          kind:'rtc_pass',label:'Owner-approved read-only pass',value:issued.token,ttlMs:600000});
      }catch{
        // No bearer reaches output when scope readback or delivery is uncertain.
        await db.revokeRtcPass({account:approved.account,id:issued.id});
        return html(res,409,'Unavailable','<p>Pass verification or one-time delivery failed; inspect revocation before retrying.</p>');
      }
      message='Owner-approved read-only '+approved.mode+' pass issued. Reference '+issued.id+
        '. Reveal it once with secret reference '+once.id+'. This request cannot be reused.';
    } else if (params.action === 'issue_rtc_pass' || params.action === 'revoke_rtc_pass') {
      if(env.VERCEL_ENV!=='production'||params.confirm!=='yes'||
        !accounts.some(x=>x.id===params.account))
        return html(res,403,'Permission denied','<p>Owner production setup session and confirmation required.</p>');
      const proof=await evaluateLogin({ip:clientIp(req),
        supplied:String(params.passphrase||''),expected:env.ADMIN_PASSPHRASE,store:db});
      if(proof.status==='locked'){
        res.setHeader('Retry-After','900');
        return html(res,429,'Permission denied','<p>Too many attempts.</p>');
      }
      if(proof.status!=='ok')
        return html(res,401,'Permission denied','<p>Incorrect passphrase.</p>');
      if(params.action==='issue_rtc_pass'){
        const hours=Number(params.hours);
        const rateLimitPerMinute=Number(params.rateLimitPerMinute??120);
        const mode=params.mode??'preview';
        const areas=typeof params.areas==='string'?params.areas.split(',').map(x=>x.trim()):[];
        const validAreas=new Set(['server',...registry.tools.map(x=>x.area).filter(Boolean)]);
        if(!Number.isInteger(hours)||hours<1||hours>720||
          !Number.isInteger(rateLimitPerMinute)||rateLimitPerMinute<1||rateLimitPerMinute>600||!areas.length||
          areas.length>12||new Set(areas).size!==areas.length||
          areas.some(x=>!validAreas.has(x))||
          !['preview','test'].includes(mode)||
          (mode==='test'&&(areas.length!==1||areas[0]!=='server')))
          return html(res,400,'Invalid pass','<p>Choose known areas and a short lifetime.</p>');
        const issued=await db.issueReadOnlyRtcPass({account:params.account,hours,areas,mode,rateLimitPerMinute});
        if(!issued)return html(res,409,'Unavailable','<p>Pass was not issued.</p>');
        const once=await oneTimeSecrets({db,env,now}).issue({
          account:params.account,kind:'rtc_pass',label:'Read-only RTC pass',
          value:issued.token,ttlMs:600000
        });
        message='Read-only '+mode+' pass issued. Reference '+issued.id+
          '. Reveal the secret once using reference '+once.id+
          ' with the selected account; it is not shown in any tool result.';
      }else{
        if(typeof params.id!=='string'||!/^pass_[a-f0-9]{20}$/.test(params.id)||
          !await db.revokeRtcPass({account:params.account,id:params.id}))
          return html(res,409,'Unavailable','<p>Pass missing, already revoked or belongs to another account.</p>');
        message='The selected RTC pass was revoked.';
      }
    } else if (params.action === 'add_token') {
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
    } else if (params.action === 'set_purchase_policy') {
      // AUD-A1: sibling action on the same authenticated owner seam as
      // set_spend_limit (session, CSRF, production-only, fresh passphrase).
      if (env.VERCEL_ENV !== 'production') {
        return html(res, 403, 'Unavailable', '<p>Purchase policy changes require the production server.</p>');
      }
      const rawBudget = typeof params.budgetDollars === 'string' ?
        params.budgetDollars.trim() : params.budgetDollars;
      const parsed = rawBudget === '' || rawBudget === undefined ?
        null : exactDollarCents(rawBudget);
      const budgetInvalid = !(rawBudget === '' || rawBudget === undefined) && parsed === null;
      if (!accounts.some(a => a.id === params.account) || params.confirm !== 'yes' || budgetInvalid) {
        return html(res, 403, 'Permission denied', '<p>Select an account, confirm, and enter an exact USD budget or leave it blank.</p>');
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
      const grantRequired = params.grantRequired === 'yes';
      if (typeof db.setPurchasePolicy !== 'function' ||
          !(await db.setPurchasePolicy(params.account,
            { budgetCents: parsed, grantRequired }))) {
        return html(res, 409, 'Unavailable', '<p>Purchase policy change could not be verified.</p>');
      }
      message = 'Purchase policy saved: ' +
        (parsed === null ? 'no agent budget set' : 'agent budget ' + dollars(parsed)) +
        (grantRequired ? '; per-purchase grant required.' : '; per-purchase grant not required.') +
        ' No spending, purchase or production access was authorized.';
    } else if (params.action === 'set_token_no_expiry') {
      // AUD-E: sibling action on the same authenticated owner seam as
      // set_purchase_policy (session, CSRF, production-only, fresh
      // passphrase). Setup-only by design: no MCP tool can set the
      // attestation, so an agent can never present its own claim as the
      // owner's choice.
      if (env.VERCEL_ENV !== 'production') {
        return html(res, 403, 'Unavailable', '<p>Token expiry attestation changes require the production server.</p>');
      }
      if (!accounts.some(a => a.id === params.account) || params.confirm !== 'yes' ||
        typeof params.tokenVersion !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.tokenVersion)) {
        return html(res, 403, 'Permission denied', '<p>Select an account, confirm the attestation change, and use the form as loaded for the current token.</p>');
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
      const attested = params.noExpiry === 'yes';
      if (typeof db.setTokenNoExpiry !== 'function' ||
          !(await db.setTokenNoExpiry(params.account, attested, params.tokenVersion))) {
        return html(res, 409, 'Unavailable', '<p>Token expiry attestation change could not be verified. If the token was rotated since this page loaded, reload and attest for the current token.</p>');
      }
      message = attested ?
        "No-expiry attestation saved: the enrolled token is stated as no expiry — owner's choice." :
        'No-expiry attestation cleared: the enrolled token expiry is not recorded.';
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
    } else if (params.action === 'review_purchase') {
      if(env.VERCEL_ENV!=='production')
        return html(res,403,'Unavailable','<p>Purchase approval requires the production server.</p>');
      if(!accounts.some(a=>a.id===params.account) ||
        typeof params.reference!=='string'||!/^[0-9a-f-]{36}$/.test(params.reference))
        return html(res,403,'Permission denied','<p>Invalid account or purchase reference.</p>');
      if(typeof db.getPurchaseIntent!=='function')
        return html(res,503,'Unavailable','<p>Purchase approval database is unavailable.</p>');
      const pending=await db.getPurchaseIntent({account:params.account,reference:params.reference});
      const cents=pending?.price_cents===null?null:Number(pending?.price_cents);
      if(!pending||pending.status!=='pending' ||
        new Date(pending.expires_at).getTime()<=now() ||
        (cents!==null&&(!Number.isSafeInteger(cents)||cents<=0)))
        return html(res,409,'Unavailable','<p>Purchase intent is missing, expired, or already processed.</p>');
      return html(res,200,'Review exact purchase',
        '<p>Read-only review. No Vercel charge has been authorized or made.</p>' +
        '<p>Account: '+escapeHtml(params.account)+'</p>' +
        '<p>Operation: '+escapeHtml(pending.operation)+'</p>' +
        '<p>Pricing evidence: '+escapeHtml(pending.pricing_source)+'</p>' +
        '<p>'+escapeHtml(cents===null?'Metered usage: no fixed provider total available':
          'Quoted total: '+dollars(cents))+'</p>' +
        '<p>Expires: '+escapeHtml(new Date(pending.expires_at).toISOString())+'</p>' +
        '<form method="post">'+csrfInput(session.csrf)+
        '<input type="hidden" name="action" value="approve_purchase">' +
        '<input type="hidden" name="account" value="'+escapeHtml(params.account)+'">' +
        '<input type="hidden" name="reference" value="'+escapeHtml(params.reference)+'">' +
        (cents===null&&pending.operation==='vercel_dev_sandbox_create'&&pending.pricing_source==='metered'?
          '<p><strong>Variable Sandbox billing:</strong> runtime is finite but the provider does not guarantee a total-dollar ceiling. Charges may exceed your planned amount. An AI confirmation or daily allowance cannot grant this risk.</p>'+ 
          '<label><input type="checkbox" name="unboundedMetered" value="yes" required>I explicitly accept non-guaranteed variable charges for this one Sandbox operation</label>':
          '')+
        '<label>'+ (cents===null?'Advisory planning threshold (NOT an enforced maximum), USD':'Maximum amount approved, USD')+
          '<input name="ceilingDollars" inputmode="decimal" required value="'+
          escapeHtml(cents===null?'':(cents/100).toFixed(2))+'"></label>' +
        '<label><input type="checkbox" name="confirm" value="yes" required>Authorize only this transaction and quoted price or stated maximum</label>' +
        '<label>Reenter administrator passphrase<input name="passphrase" type="password" required autocomplete="current-password"></label>' +
        '<button type="submit">Approve this exact purchase only</button></form>');
    } else if (params.action === 'approve_purchase') {
      if(env.VERCEL_ENV!=='production')
        return html(res,403,'Unavailable','<p>Purchase approval requires the production server.</p>');
      const ceiling=purchaseDollarCents(params.ceilingDollars);
      const meteredAck=params.unboundedMetered==='yes';
      if(!accounts.some(a=>a.id===params.account)||params.confirm!=='yes'||
        typeof params.reference!=='string'||!/^[0-9a-f-]{36}$/.test(params.reference)||
        ceiling===null)
        return html(res,403,'Permission denied','<p>Exact account, reference, cost and confirmation required.</p>');
      const auth=await evaluateLogin({ip:clientIp(req),supplied:String(params.passphrase||''),
        expected:env.ADMIN_PASSPHRASE,store:db});
      if(auth.status==='locked'){
        res.setHeader('Retry-After','900');
        return html(res,429,'Permission denied','<p>Too many sign-in attempts.</p>');
      }
      if(auth.status!=='ok')
        return html(res,401,'Permission denied','<p>Incorrect passphrase.</p>');
      if(typeof db.getPurchaseIntent!=='function'||typeof db.approvePurchaseIntent!=='function')
        return html(res,503,'Unavailable','<p>Purchase approval database is unavailable.</p>');
      const pending=await db.getPurchaseIntent({account:params.account,reference:params.reference});
      const quoted=pending?.price_cents===null?null:Number(pending?.price_cents);
      if(!pending||pending.status!=='pending'||new Date(pending.expires_at).getTime()<=now()||
        (quoted!==null&&(!Number.isSafeInteger(quoted)||quoted<=0||ceiling!==quoted||meteredAck))||
        (quoted===null&&(!meteredAck||pending.operation!=='vercel_dev_sandbox_create'||
          pending.pricing_source!=='metered')))
        return html(res,409,'Unavailable','<p>Purchase quote, metered-risk choice or authorization changed.</p>');
      const ok=await db.approvePurchaseIntent({account:params.account,
        reference:params.reference,ceilingCents:ceiling,acknowledgeUnbounded:meteredAck});
      if(ok!==true)
        return html(res,409,'Unavailable','<p>Could not commit one-use owner approval.</p>');
      const verified=await db.getPurchaseIntent({account:params.account,reference:params.reference});
      if(verified?.status!=='approved'||Number(verified.ceiling_cents)!==ceiling||
        verified.allow_unbounded_metered!==meteredAck)
        return html(res,409,'Unverified','<p>Approval and distinct metered-risk acknowledgment were not proven.</p>');
      message='Owner approved one transaction for '+escapeHtml(params.account)+
        (meteredAck?' with a non-guaranteed planning threshold ':' with ceiling ')+
        dollars(ceiling)+'. No charge or production activation was performed.';
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
    } else if (params.action === 'set_production_strictness') {
      // AUD-B: sibling action on the same authenticated owner seam as
      // set_purchase_policy (session, CSRF, production-only, fresh
      // passphrase). Strictness is settable only here, never via a tool.
      if (env.VERCEL_ENV !== 'production') {
        return html(res, 403, 'Unavailable', '<p>Production strictness changes require the production server.</p>');
      }
      if (!accounts.some(a => a.id === params.account) || params.confirm !== 'yes' ||
        !['word', 'passphrase'].includes(params.strictness)) {
        return html(res, 403, 'Permission denied', '<p>Select an account, a strictness and confirm the change.</p>');
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
      if (typeof db.setProductionEnableStrictness !== 'function' ||
          !(await db.setProductionEnableStrictness(params.account, params.strictness))) {
        return html(res, 409, 'Unavailable', '<p>Production strictness change could not be verified.</p>');
      }
      message = 'Production enable strictness saved as ' + params.strictness +
        ' for ' + params.account +
        '. No production access was enabled by this change.';
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
      // AUD-B: a word-strictness team needs no receipt — the tool call
      // itself completes the enable on the owner's confirmed word. Report
      // that here instead of consuming (or demanding) a passphrase receipt.
      const target = accounts.find(a => a.id === params.account);
      if (target?.production_enable_strictness !== 'passphrase') {
        message = 'That team is set to word strictness, so production ' +
          'enable completes on your confirmed word with ' +
          'vercel_enable_production — no setup receipt is needed.';
        const updated = await db.listVercelAccounts();
        return html(res, 200, 'Vercel account setup',
          panel(updated, session.csrf, message, await connectionChoices(db, updated)));
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
    } else if (params.action === 'clear_protected') {
      if(!accounts.some(a=>a.id===params.account) || params.acknowledge!=='remove-all')
        return html(res,403,'Permission denied','<p>Explicit account and removal acknowledgment required.</p>');
      const attempt=await evaluateLogin({
        ip:clientIp(req),supplied:String(params.passphrase||''),
        expected:env.ADMIN_PASSPHRASE,store:db
      });
      if(attempt.status==='locked'){
        res.setHeader('Retry-After','900');
        return html(res,429,'Permission denied','<p>Too many sign-in attempts.</p>');
      }
      if(attempt.status!=='ok')
        return html(res,401,'Permission denied','<p>Incorrect passphrase.</p>');
      if(await db.clearProtectedProjectRules(params.account)!==true)
        return html(res,409,'Unverified','<p>Exclusions could not be independently cleared.</p>');
      message='Project exclusions removed. All projects are eligible within credential scope, but production, spending, destructive and self-credential safeguards remain.';
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

  } catch (err) {
    // AUD-F (VMCP-022): a probe-originated failure names its leg — the leg
    // identifier and the probe's own message, which never carry token
    // material or a provider response body. Anything else keeps the
    // unnamed catch-all and reflects nothing from the exception.
    const legs = { input: 'input', identity: 'identity', teams: 'teams',
      projects: 'projects', project_team_match: 'project-team match',
      broad_visibility: 'broad-visibility', storage: 'storage' };
    const leg = legs[err?.probeLeg];
    if (leg) {
      return html(res, 400, 'Setup failed', '<p>Setup failed at the ' + leg +
        ' check: ' + escapeHtml(err.message) + '</p>');
    }
    return html(res, 400, 'Setup failed', '<p>Could not complete the request. Check configuration and account access.</p>');
  }
}
