// Batch O-3 (design BATCH-O section 5.5 + IN-04 amendment): the owner's API
// tokens. Listing never returns values. Creation is team- or project-scoped
// ONLY (never full account — storeToken enforces it again on the server
// delivery route with allowFull:false), the creator chooses the expiry
// including none (IN-04 supersedes the design's original <=1-year bound),
// and the value leaves exactly once: either as a one-time owner reveal on
// the setup page, or stored directly as another account of this server.
// Deletion refuses the credential this connection runs on.
import {compact, credentialLike} from '../core/util.js';
import {checkProtected} from './self-guard.js';
import {checkApp} from './app-guard.js';
import {createHash} from 'node:crypto';
import {validateRequest} from '../vercel/openapi-validation.js';
import {readProvider, writeProvider} from '../vercel/provider.js';
import {bindGuardedWrite, defineWrite, RefusalError} from '../core/write.js';
import {storeToken} from '../vercel/tokens.js';
import {oneTimeSecrets} from '../core/one-time-secrets.js';

const PROFILES = ['read_only', 'everyday', 'full'];
const text = value => ({content: [{type: 'text', text: JSON.stringify(value)}]});
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function safe(value) {
  if (typeof value !== 'string' || credentialLike(value)) return null;
  return value;
}
function tokenRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const scopes = Array.isArray(row.scopes) ? row.scopes.map(s => {
    if (!s || typeof s !== 'object') return null;
    const out = {type: safe(s.type)};
    if (typeof s.teamId === 'string') out.teamId = s.teamId;
    if (typeof s.projectId === 'string') out.projectId = s.projectId;
    return out;
  }).filter(Boolean) : [];
  const iso = ms => typeof ms === 'number' ? new Date(ms).toISOString() : null;
  return {
    id: typeof row.id === 'string' ? row.id : null,
    name: safe(row.name),
    type: safe(row.type),
    prefix: safe(row.prefix),
    suffix: safe(row.suffix),
    scopes,
    createdAt: iso(row.createdAt),
    // IN-04 honesty: expiresAt is optional in the contract; null here means
    // Vercel reported no expiry for this token, nothing more.
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.activeAt),
    leaked: typeof row.leakedAt === 'number',
    revoked: typeof row.revokedAt === 'number'
  };
}

// --- vercel_token_list ------------------------------------------------------
const list = {
  name: 'vercel_token_list',
  title: 'List API tokens',
  description: 'Your Vercel API tokens: name, scope (team/project), created, expires, last used. Values are never shown.',
  inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  annotations: {readOnlyHint: true},
  async handler(_args, ctx) {
    const {client, account} = await readProvider(ctx);
    const page = await client.request('tokens_list', {});
    const rows = (Array.isArray(page?.tokens) ? page.tokens : []).map(tokenRow).filter(Boolean);
    return text({
      account: account.id, tokens: rows,
      truncated: page?.pagination?.next !== null && page?.pagination?.next !== undefined
    });
  }
};

// --- vercel_token_create ----------------------------------------------------
const createProps = {
  confirm: {type: 'boolean'}, dryRun: {type: 'boolean'},
  name: {type: 'string', minLength: 1, maxLength: 100},
  scope: {type: 'string', enum: ['team', 'project']},
  projectId: {type: 'string', pattern: '^prj_[A-Za-z0-9]+$'},
  expiresAt: {type: 'string', minLength: 10, maxLength: 40},
  delivery: {type: 'string', enum: ['reveal', 'server']}
};
const FRAMEWORK_KEYS = new Set(['confirm', 'dryRun', 'requestKey']);
function exact(args, props, required) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Invalid arguments');
  for (const key of Object.keys(args)) {
    if (FRAMEWORK_KEYS.has(key)) {
      if (key !== 'requestKey' && typeof args[key] !== 'boolean') throw new TypeError('Invalid arguments');
      continue;
    }
    if (!Object.hasOwn(props, key)) throw new TypeError('Unexpected argument');
  }
  for (const key of required) if (args[key] === undefined) throw new TypeError(`Missing ${key}`);
}
const tokenCreate = defineWrite({
  name: 'vercel_token_create', risk: {access: true}, secretOut: true, oneTimeDelivery: true,
  oneTimeWhen: a => (a.delivery ?? 'reveal') === 'reveal',
  async before(a, ctx) {
    exact(a, createProps, ['name', 'scope']);
    if (credentialLike(a.name)) throw new RefusalError('Choose a plain name for the token');
    if (a.scope === 'project' && typeof a.projectId !== 'string')
      throw new RefusalError('A project-scoped token needs the projectId of the project it is limited to');
    if (a.scope === 'team' && a.projectId !== undefined)
      throw new RefusalError('projectId only applies to a project-scoped token');
    let expiresMs = null;
    if (a.expiresAt !== undefined) {
      expiresMs = Date.parse(a.expiresAt);
      if (!Number.isFinite(expiresMs) || expiresMs <= Date.now())
        throw new RefusalError('expiresAt must be a date in the future — or leave it out for a token with no expiry (your choice, IN-04)');
    }
    const {client, account} = await readProvider(ctx);
    await client.request('teams_get', {path: {teamId: account.team_id}});
    let projectName = null;
    if (a.scope === 'project') {
      const project = await client.request('projects_get', {
        path: {idOrName: a.projectId}, query: {teamId: account.team_id}});
      projectName = safe(project?.name);
    }
    const body = {name: a.name};
    if (expiresMs !== null) body.expiresAt = expiresMs;
    if (a.scope === 'project') body.projectId = a.projectId;
    validateRequest('tokens_create', {query: {teamId: account.team_id}, body});
    return {
      account, name: a.name, scope: a.scope, projectId: a.projectId ?? null,
      projectName, expiresMs,
      delivery: a.delivery ?? 'reveal',
      etag: sha256({team: account.team_id, scope: a.scope, project: a.projectId ?? null})
    };
  },
  async preview(_a, _ctx, b) {
    const scopeLine = b.scope === 'project' ?
      `limited to project ${b.projectName ?? b.projectId}` : 'scoped to this team (never the full account)';
    const expiryLine = b.expiresMs !== null ?
      `It expires ${new Date(b.expiresMs).toISOString()}.` : 'It has NO expiry — your choice (IN-04); revoke it here when it is no longer needed.';
    const deliveryLine = b.delivery === 'server' ?
      'The value is stored directly as another account of this server and is never shown.' :
      'The value is shown ONCE on the authenticated setup page and never travels in chat or tool results.';
    return `Create an API token named "${b.name}", ${scopeLine}. ${expiryLine} ${deliveryLine}`;
  },
  async production() {
    return {production: true, why: 'The new token authenticates against the production account'};
  },
  async access(_a, b) {
    return {widens: true, who: 'Whoever holds the new token',
      what: b.scope === 'project' ?
        `Call the Vercel API as you, limited to project ${b.projectName ?? b.projectId}` :
        'Call the Vercel API as you, limited to this team'};
  },
  async targets(_a, b) {
    const out = [{kind: 'account', id: b.account.team_id}];
    if (b.projectId) out.push({kind: 'project', id: b.projectId, name: b.projectName ?? b.projectId});
    return out;
  },
  async apply(_a, ctx, b, key) {
    const provider = await writeProvider(ctx);
    const body = {name: b.name};
    if (b.expiresMs !== null) body.expiresAt = b.expiresMs;
    if (b.projectId) body.projectId = b.projectId;
    // The bearer value is captured in this closure ONLY: the write result
    // that enters the replay log is screened for credential-shaped content
    // and sensitive field names, so the secret never travels in it.
    let bearer = null;
    const created = await provider.write('tokens_create', {
      body
    }, {requestKey: key, tool: 'vercel_token_create', shapeResult: row => {
      if (typeof row?.bearerToken !== 'string' || !row.bearerToken ||
          typeof row?.token?.id !== 'string')
        throw new TypeError('Provider did not prove the created token');
      bearer = row.bearerToken;
      return {createdId: row.token.id};
    }});
    const base = {tokenId: created.createdId, name: b.name, scope: b.scope,
      tokenExpiresAt: b.expiresMs !== null ? new Date(b.expiresMs).toISOString() : null};
    if (b.delivery === 'server') {
      const stored = await storeToken({
        db: ctx.db, token: bearer, teamId: b.account.team_id,
        projectId: b.projectId, allowFull: false, env: ctx.env,
        fetchImpl: ctx.fetchImpl,
        probeExtra: {createdByTool: 'vercel_token_create', providerTokenId: created.createdId},
        expiresAt: b.expiresMs
      });
      return {...base, delivery: 'server', storedAsAccount: stored.id};
    }
    const receipt = await oneTimeSecrets({db: ctx.db, env: ctx.env}).issue({
      account: ctx.connection.account, kind: 'vercel_api_token',
      label: b.name, value: bearer});
    // The write framework's one-time delivery block reads ownerRevealRef +
    // expiresAt from the apply result (expiresAt = the REVEAL window here).
    return {...base, delivery: 'reveal', ownerRevealRef: receipt.id,
      expiresAt: receipt.expiresAt};
  },
  async verify(_a, ctx, b, r) {
    if (typeof r?.tokenId !== 'string') return {confirmed: null};
    const {client} = await readProvider(ctx);
    const row = tokenRow(await client.request('tokens_get', {path: {tokenId: r.tokenId}}));
    const confirmed = row !== null && row.id === r.tokenId && row.name === b.name;
    return {confirmed, tokenId: r.tokenId, name: b.name, scope: b.scope,
      tokenExpiresAt: r.tokenExpiresAt ?? null, delivery: r.delivery,
      ...(r.ownerRevealRef ? {ownerRevealRef: r.ownerRevealRef, expiresAt: r.expiresAt} : {}),
      ...(r.storedAsAccount ? {storedAsAccount: r.storedAsAccount} : {})};
  },
  async publicReceipt(_a, _b, r) {
    return {tokenId: r.tokenId, name: r.name, scope: r.scope,
      tokenExpiresAt: r.tokenExpiresAt ?? null, delivery: r.delivery,
      ...(r.storedAsAccount ? {storedAsAccount: r.storedAsAccount} : {})};
  }
});

// --- vercel_token_delete ----------------------------------------------------
const deleteProps = {
  confirm: {type: 'boolean'}, dryRun: {type: 'boolean'},
  tokenId: {type: 'string', minLength: 1, maxLength: 200}};
const tokenDelete = defineWrite({
  name: 'vercel_token_delete', risk: {destructive: true},
  async before(a, ctx) {
    exact(a, deleteProps, ['tokenId']);
    const {client, account} = await readProvider(ctx);
    let row = null;
    try {
      row = tokenRow(await client.request('tokens_get', {path: {tokenId: a.tokenId}}));
    } catch { row = null; }
    if (!row || row.id !== a.tokenId)
      throw new RefusalError('That token could not be read back — it may already be revoked. Nothing was changed.');
    // Never lock Chris out: refuse the credential this connection runs on.
    // Exact match first (tokens this server created record their provider
    // id in the account probe), then the documented suffix against the
    // stored account row's own last-4.
    const accounts = typeof ctx.db?.listVercelAccounts === 'function' ?
      await ctx.db.listVercelAccounts() : [];
    const mine = accounts.find(x => x.id === ctx.connection.account);
    let probe = mine?.token_probe ?? null;
    if (typeof probe === 'string') { try { probe = JSON.parse(probe); } catch { probe = null; } }
    if (probe?.providerTokenId === a.tokenId)
      throw new RefusalError('That token is the credential this server itself runs on — revoking it would cut this connection off. It is refused here; rotate it from the setup page instead.');
    if (mine?.token_last4 && row.suffix && mine.token_last4 === row.suffix)
      throw new RefusalError('That token ends with the same four characters as the credential this connection runs on, so it is treated as the server\u2019s own token and refused here. If it is a different token that happens to share those characters, revoke it from the Vercel dashboard.');
    return {account, tokenId: a.tokenId, name: row.name, suffix: row.suffix,
      etag: sha256({token: a.tokenId, name: row.name})};
  },
  async preview(_a, _ctx, b) {
    return `Revoke the API token "${b.name ?? b.tokenId}"${b.suffix ? ` (ends ${b.suffix})` : ''}. ` +
      'Anything authenticating with it loses API access immediately. This cannot be undone.';
  },
  async production() {
    return {production: true, why: 'Revoking a token changes the production account\u2019s credentials'};
  },
  async targets(_a, b) {
    return [{kind: 'token', id: b.tokenId, name: b.name ?? b.tokenId}];
  },
  async apply(_a, ctx, b, key) {
    const provider = await writeProvider(ctx);
    await provider.write('tokens_delete', {path: {tokenId: b.tokenId}},
      {requestKey: key, tool: 'vercel_token_delete',
       shapeResult: () => ({revoked: true})});
    return {tokenId: b.tokenId, name: b.name};
  },
  async verify(_a, ctx, _b, r) {
    const {client} = await readProvider(ctx);
    let gone = false;
    try {
      const row = await client.request('tokens_get', {path: {tokenId: r.tokenId}});
      gone = !row || typeof row !== 'object';
    } catch { gone = true; }
    return {confirmed: gone, tokenId: r.tokenId, name: r.name};
  },
  async publicReceipt(_a, _b, r) {
    return {tokenId: r.tokenId, name: r.name, revoked: true};
  }
});

function ctxFor({db, connection, env, fetchImpl}) {
  return {db, connection, env, fetchImpl, shape: compact,
    audit: x => db.recordChange(x), replayStore: db.requestReplayStore(),
    guardProtected: targets => checkProtected(targets, {db, connection, env}),
    guardApp: targets => checkApp(targets, {db, connection, env})};
}
const wrap = update => bindGuardedWrite(update, ctxFor, result => ({
  isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
  content: [{type: 'text', text: JSON.stringify(result)}]}));

export const tokenTools = {
  tools: [
    {name: 'vercel_token_list', area: 'owner', writes: false, profiles: PROFILES,
     description: 'List your Vercel API tokens: name, scope (team/project), created, expires and last used. Token values are never shown.',
     inputSchema: {type: 'object', properties: {}, additionalProperties: false},
     annotations: {readOnlyHint: true}},
    {name: 'vercel_token_create', area: 'owner', writes: true, guardedWrite: true, profiles: ['full'],
     description: 'Create a team- or project-scoped API token; expiry is your choice, including none. Shown once on setup, or stored as a server account.',
     inputSchema: {type: 'object', required: ['name', 'scope'], properties: createProps, additionalProperties: false},
     writeContract: tokenCreate.writeContract,
     annotations: {readOnlyHint: false, destructiveHint: false}},
    {name: 'vercel_token_delete', area: 'owner', writes: true, guardedWrite: true, profiles: ['full'],
     description: 'Revoke one of your API tokens by id. Refused for the token this server itself runs on.',
     inputSchema: {type: 'object', required: ['tokenId'], properties: deleteProps, additionalProperties: false},
     writeContract: tokenDelete.writeContract,
     annotations: {readOnlyHint: false, destructiveHint: true}}
  ],
  handlers: {
    vercel_token_list: list.handler,
    vercel_token_create: wrap(tokenCreate),
    vercel_token_delete: wrap(tokenDelete)
  }
};
