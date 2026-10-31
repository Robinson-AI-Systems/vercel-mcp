// Batch U (U-1 write side): the universal write policy. Every documented
// write operation is classified before any provider I/O beyond identity
// reads: hand-built tools win, credential-returning operations refuse,
// spend and access are declared to the write executor, production is
// decided from proven target evidence, and request bodies are screened
// so a credential value can never ride the escape hatch (B5).
import {validateRequest} from './openapi-validation.js';
import {apiIndex,apiOperation} from './openapi-index.js';
import {secretWriteOperation} from './secret-operations.js';
import {handBuiltWrites} from './hand-built-map.js';
import {spendOperation} from './spend-operations.js';
import {credentialLike} from '../core/util.js';
import {RefusalError} from '../core/write.js';
import {readProvider,writeProvider} from './provider.js';
import {deploymentIsProduction,isLiveProject} from './production.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REQUEST_KEY = /^[a-zA-Z0-9_-]{8,128}$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const CREDENTIAL_KEY = /(?:token|secret|password|passwd|credential|private.?key|auth.?code|api.?key|bypass)/i;
const IDENTITY_FIELDS = ['id', 'uid', 'slug', 'name', 'status', 'state', 'type',
  'target', 'createdAt', 'updatedAt', 'projectId', 'teamId', 'ownerId'];
const ACCESS_OPS = new Set(['inviteUserToTeam', 'updateTeamMember',
  'postTeamDsyncRoles', 'createAccessGroup', 'updateAccessGroup',
  'createAccessGroupProject', 'updateAccessGroupProject', 'deleteAccessGroup',
  'deleteAccessGroupProject', 'removeTeamMember']);

function plain(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function safeText(value, max) {
  return typeof value === 'string' && value.length >= 1 && value.length <= max &&
    !CONTROL.test(value) && !credentialLike(value);
}
function screenPathValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RefusalError('Unsafe resource identifier');
    return value;
  }
  if (typeof value !== 'string' || value.length < 1 || value.length > 253 ||
    CONTROL.test(value) || /\s|\//.test(value) || credentialLike(value))
    throw new RefusalError('Unsafe resource identifier');
  return value;
}
function screenQueryValue(value, depth = 0) {
  if (depth > 3) throw new RefusalError('Query is too deeply nested');
  if (typeof value === 'string') {
    if (value.length > 256 || CONTROL.test(value) || credentialLike(value))
      throw new RefusalError('Unsafe query text');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) throw new RefusalError('Too many query values');
    value.forEach(v => screenQueryValue(v, depth + 1));
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  throw new RefusalError('Query values must be scalars or short lists');
}
// B5: a credential-shaped value anywhere in the body refuses the write,
// and a credential-named field may not carry a string value at all —
// secret inputs belong to hand-built tools (AUD-AV: the pending-input
// vault is gone; hand-built tools generate secrets or refuse).
function screenBody(value, depth = 0) {
  if (depth > 8) throw new RefusalError('Request body is too deeply nested');
  if (typeof value === 'string') {
    if (credentialLike(value))
      throw new RefusalError('Request body carries a credential-shaped value; use a hand-built tool that generates the secret, or set it in the Vercel dashboard');
    return;
  }
  if (Array.isArray(value)) { value.forEach(v => screenBody(v, depth + 1)); return; }
  if (plain(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_KEY.test(key) && typeof child === 'string' && child.length > 0)
        throw new RefusalError('Request body field "' + key.slice(0, 40) +
          '" cannot carry a credential value through the universal tool; use a hand-built tool that generates the secret, or set it in the Vercel dashboard');
      screenBody(child, depth + 1);
    }
  }
}
function accessFor(row, body) {
  const teamMemberPath = /\/teams\/\{teamId\}\/members/.test(row.path);
  if (!ACCESS_OPS.has(row.op) && !teamMemberPath && !row.path.includes('/access-groups/'))
    return null;
  let who = 'a team member or access group';
  if (plain(body) && safeText(body.email, 254)) who = body.email;
  else if (plain(body) && safeText(body.username, 128)) who = body.username;
  let what = 'the access this operation grants or changes';
  if (plain(body) && safeText(body.role, 64)) what = 'role ' + body.role;
  return { widens: true, who, what };
}
function sameTemplateGet(row) {
  if (!row.path.endsWith('}')) return null;
  return apiIndex().find(x => x.path === row.path && ['GET', 'HEAD'].includes(x.method)) ?? null;
}
// Read-back for collection creates (U8): a GET on the write path plus
// exactly one more placeholder segment names the created object when the
// response carries its id or slug.
function childGet(row) {
  const prefix = row.path + '/{';
  const found = apiIndex().find(x => ['GET', 'HEAD'].includes(x.method) &&
    x.path.startsWith(prefix) && x.path.endsWith('}') &&
    !x.path.slice(prefix.length, -1).includes('/'));
  if (!found) return null;
  return { op: found.op, extraKey: found.path.slice(prefix.length, -1) };
}
function identityProjection(value) {
  if (!plain(value)) return null;
  const out = {};
  for (const field of IDENTITY_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const v = value[field];
    if (typeof v === 'string') out[field] = safeText(v, 256) ? v : null;
    else if (typeof v === 'boolean' || Number.isSafeInteger(v)) out[field] = v;
  }
  return out;
}
// The shaped apply result: identity fields only, through the same scalar
// screen as the read projections. The client's replay screen is a second
// net; a response that cannot be projected is a named shape failure.
export function shapeApiWriteResult(row, envelope) {
  if (envelope === null || envelope === undefined) return { op: row.op, responded: true };
  if (Array.isArray(envelope)) {
    return { op: row.op, items: envelope.slice(0, 20).map(identityProjection),
      capped: envelope.length > 20 };
  }
  const projected = identityProjection(envelope);
  if (!projected) throw new TypeError('Provider response could not be safely shaped');
  return { op: row.op, ...projected };
}

/** Pure classification: no I/O. Throws RefusalError with the reason. */
export function parseApiWrite(args, account) {
  if (!plain(args) || Object.keys(args).some(k =>
    !['op', 'params', 'dryRun', 'confirm', 'requestKey'].includes(k)))
    throw new RefusalError('Invalid universal write request');
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean' ||
    args.confirm !== undefined && typeof args.confirm !== 'boolean')
    throw new RefusalError('Invalid universal write request');
  if (args.requestKey !== undefined &&
    (typeof args.requestKey !== 'string' || !REQUEST_KEY.test(args.requestKey)))
    throw new RefusalError('Invalid universal write request key');
  let row;
  try { row = apiOperation(args.op); }
  catch { throw new RefusalError('Unknown documented API operation'); }
  if (!WRITE_METHODS.has(row.method))
    throw new RefusalError('vercel_api_write cannot run a read operation; use vercel_api_read or the hand-built read');
  if (handBuiltWrites[row.op])
    throw new RefusalError('Use ' + handBuiltWrites[row.op] +
      ' for this operation; the hand-built tool carries the curated checks');
  if (secretWriteOperation(row))
    throw new RefusalError('This operation returns a credential and is refused by the universal tools; ' +
      'use the hand-built tool for it, or vercel_where_is_setting for the dashboard path');
  const params = args.params;
  if (!plain(params) || Object.keys(params).some(k => !['path', 'query', 'body'].includes(k)) ||
    !plain(params.path) || (params.query !== undefined && !plain(params.query)))
    throw new RefusalError('Only documented path, query and body parameters are accepted');
  const path = {};
  for (const [key, value] of Object.entries(params.path)) path[key] = screenPathValue(value);
  if (Object.hasOwn(path, 'teamId'))
    throw new RefusalError('Team authority comes from the stored account');
  const query = { ...(params.query ?? {}) };
  if (Object.hasOwn(query, 'teamId') || Object.hasOwn(query, 'slug'))
    throw new RefusalError('Team authority comes from the stored account');
  Object.values(query).forEach(v => screenQueryValue(v));
  const body = params.body;
  if (body !== undefined) {
    if (JSON.stringify(body)?.length > 65536)
      throw new RefusalError('Request body is too large for the universal tool');
    screenBody(body);
  }
  // Full snapshot validation before any I/O (U2). The fake team value is
  // a validation stand-in only, mirroring the read policy; the transport
  // substitutes the stored account's team where the operation declares it.
  const declaresTeamQuery = [...(row.pathItem.parameters || []), ...(row.doc.parameters || [])]
    .some(p => p.in === 'query' && p.name === 'teamId');
  try {
    validateRequest('api:' + row.op, {
      path: row.path.includes('{teamId}') ? { ...path, teamId: 'team_FAKE_validation' } : path,
      query: declaresTeamQuery ? { ...query, teamId: 'team_FAKE_validation' } : query,
      body
    });
  } catch (error) {
    // The validator's messages name the failed predicate and the
    // parameter key only — never a value — so they pass the refusal
    // screen; anything unexpected genericizes there instead.
    throw new RefusalError(error instanceof TypeError ? error.message :
      'The request does not match the documented operation');
  }
  if (account?.scope === 'project') {
    const bound = projectBinding(row, path);
    if (!bound || bound.value !== account.project_id)
      throw new RefusalError('A project-scoped connection can only write its own project through the universal tool');
  }
  return { row, path, query, body,
    spend: spendOperation(row), access: accessFor(row, body) };
}
function projectBinding(row, path) {
  if (!row.path.includes('/projects/')) return null;
  for (const key of ['projectIdOrName', 'projectId', 'idOrName']) {
    if (typeof path[key] === 'string') return { key, value: path[key] };
  }
  return null;
}
function deploymentBinding(row, path) {
  if (typeof path.deploymentId === 'string') return path.deploymentId;
  if (row.path.includes('/deployments/') && typeof path.id === 'string') return path.id;
  return null;
}

/** defineWrite spec for vercel_api_write (see src/tools/universal.js). */
export const apiWriteSpec = {
  name: 'vercel_api_write',
  risk: { spend: true, access: true },
  async before(args, ctx) {
    if (ctx.connection?.profile !== 'full')
      throw new RefusalError('The universal write requires the full profile');
    const { client, account } = await readProvider(ctx);
    const parsed = parseApiWrite(args, account);
    const { row } = parsed;
    const path = { ...parsed.path };
    if (row.path.includes('{teamId}')) path.teamId = account.team_id;
    // Identity evidence: prove the project/deployment target before the
    // executor classifies production or dispatches anything.
    let project = null, projectState = 'none';
    const binding = projectBinding(row, path);
    if (binding) {
      try {
        const proof = await client.request('projects_get', { path: { idOrName: binding.value } });
        if (proof?.id && proof.accountId === account.team_id) {
          project = proof; projectState = 'proven';
        } else projectState = 'unproven';
      } catch { projectState = 'unproven'; }
      if (account.scope === 'project' && projectState === 'proven' && project.id !== account.project_id)
        throw new RefusalError('A project-scoped connection can only write its own project through the universal tool');
    }
    let deployment = null;
    const deploymentId = deploymentBinding(row, path);
    if (deploymentId) {
      try {
        const proof = await client.request('deployments_get', { path: { idOrUrl: deploymentId } });
        if (proof && (proof.id === deploymentId || proof.uid === deploymentId)) deployment = proof;
      } catch { deployment = null; }
    }
    // U3: the object as it is now, when the path identifies one object
    // and a same-template GET exists. Display evidence only; a failed
    // read never blocks the write and never invents state.
    let current = null;
    const getRow = sameTemplateGet(row);
    if (getRow && !secretWriteOperation(getRow)) {
      try {
        const reply = await client.request('api:' + getRow.op, { path }, { timeoutMs: 5000 });
        current = identityProjection(reply);
      } catch { current = null; }
    }
    return {
      op: row.op, method: row.method, template: row.path, summary: row.summary,
      path, query: parsed.query, body: parsed.body ?? null,
      bodyFields: parsed.body === undefined ? [] : Object.keys(Object(parsed.body)),
      queryFields: Object.keys(parsed.query),
      spend: parsed.spend, access: parsed.access,
      teamId: account.team_id, accountScope: account.scope,
      projectId: project?.id ?? null, projectState,
      projectLive: project ? isLiveProject(project) : null,
      deploymentTarget: deployment ?
        (deploymentIsProduction(deployment) ? 'production' : 'preview') : null,
      deploymentProjectId: deployment?.projectId ?? deployment?.project?.id ?? null,
      current, readBackOp: getRow?.op ?? null,
      readBackChild: getRow ? null : childGet(row)
    };
  },
  async preview(args, ctx, before) {
    const shownPath = before.template.replace(/\{([^}]+)\}/g,
      (_, key) => String(before.path[key] ?? '{' + key + '}'));
    let text = before.method + ' ' + shownPath + ' — ' + before.summary +
      '. Operation: ' + before.op + '.';
    if (before.bodyFields.length) text += ' Body fields: ' + before.bodyFields.join(', ') + '.';
    if (before.queryFields.length) text += ' Query fields: ' + before.queryFields.join(', ') + '.';
    text += before.current ?
      ' Current object: ' + JSON.stringify(before.current) + '.' :
      ' No current object could be read for this path.';
    if (before.spend) text += ' This operation can charge the account (' + before.spend.reason + ').';
    if (before.access) text += ' This changes access for ' + before.access.who +
      ' (' + before.access.what + ').';
    text += ' Undo is not available for universal writes.';
    return text;
  },
  async production(args, ctx, before) {
    if (before.projectState === 'proven') {
      return before.projectLive ?
        { production: true, why: 'Changes a live project (it has a production deployment)' } :
        { production: false, why: 'The target project has no production deployment' };
    }
    if (before.projectState === 'unproven')
      return { production: true, why: 'Project liveness could not be proven; treated as production' };
    if (before.deploymentTarget)
      return { production: before.deploymentTarget === 'production',
        why: before.deploymentTarget === 'production' ?
          'Targets the deployment serving production' : 'Targets a non-production deployment' };
    if (/\/(?:domains|dns|certificates|nameservers)(?:\/|$)/.test(before.template))
      return { production: true, why: 'Domain, DNS and certificate writes are always live' };
    return { production: true,
      why: 'Team or account-layer operation, or a target that cannot be proven non-production' };
  },
  async targets(args, before) {
    const targets = [{ kind: 'account', id: before.teamId }];
    if (before.projectId) targets.push({ kind: 'project', id: before.projectId });
    if (before.deploymentProjectId && before.deploymentTarget) {
      const deploymentId = deploymentBinding({ path: before.template }, before.path);
      if (deploymentId) targets.push({ kind: 'deployment', id: deploymentId,
        projectId: before.deploymentProjectId });
    }
    return targets;
  },
  async spend(args, ctx, before) {
    if (before.spend) {
      return { cents: null, recurring: before.spend.recurring,
        description: before.spend.reason + ' via ' + before.op +
          ' (' + before.method + ' ' + before.template + ')' };
    }
    return { cents: 0, recurring: false,
      description: before.summary + ' via ' + before.op + ' — no charge' };
  },
  async access(args, before) {
    return before.access ?? { widens: false };
  },
  async apply(args, ctx, before, requestKey) {
    const provider = await writeProvider(ctx);
    if (provider.account.team_id !== before.teamId ||
      ctx.connection?.profile !== 'full')
      throw new TypeError('Universal write authority changed');
    const parsed = parseApiWrite(args, provider.account);
    if (parsed.row.op !== before.op)
      throw new TypeError('Universal write operation changed');
    const path = { ...parsed.path };
    if (parsed.row.path.includes('{teamId}')) path.teamId = provider.account.team_id;
    try {
      return await provider.writeApi(before.op,
        { path, query: parsed.query, ...(parsed.body !== undefined ? { body: parsed.body } : {}) },
        { requestKey, tool: 'vercel_api_write',
          shapeResult: envelope => shapeApiWriteResult(parsed.row, envelope) });
    } catch (error) {
      // AUD-AG's lesson: an apply-path outcome_unknown must not be
      // journal-silent. One best-effort row carries the redacted
      // fingerprint — status/code class and field names/types, never
      // values — and never changes the outcome.
      try {
        const status = Number.isSafeInteger(error?.status) ? error.status : 'none';
        const code = typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(error.code) ?
          error.code : 'unknown';
        const bodyShape = parsed.body === undefined ? 'absent' :
          Object.entries(Object(parsed.body)).map(([k, v]) =>
            k + ':' + (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)).join(' ');
        await ctx.audit({ account: ctx.connection.account, mode: ctx.connection.mode,
          tool: 'vercel_api_write', dryRun: false,
          production: before.projectState === 'proven' ? before.projectLive === true :
            before.deploymentTarget ? before.deploymentTarget === 'production' : true,
          summary: 'SHAPE-FP api_write failed=[' + status + ':' + code + '] op:' + before.op +
            ' types: path:' + Object.keys(path).join(',') + ' body:' + bodyShape });
      } catch { /* best-effort: the audit trail never changes the outcome */ }
      throw error;
    }
  },
  async verify(args, ctx, before, applied) {
    if (!applied?.id) return { confirmed: null };
    let op = before.readBackOp, path = before.path;
    if (!op && before.readBackChild) {
      const fill = applied.id ?? applied.slug;
      if (!fill) return { confirmed: null };
      op = before.readBackChild.op;
      path = { ...before.path, [before.readBackChild.extraKey]: fill };
    }
    if (!op) return { confirmed: null };
    try {
      const { client } = await readProvider(ctx);
      const reply = await client.request('api:' + op, { path }, { timeoutMs: 5000 });
      if (!plain(reply)) return { confirmed: null };
      return { confirmed: reply.id === undefined || reply.id === applied.id, id: applied.id };
    } catch { return { confirmed: null }; }
  },
  async publicReceipt(args, before, applied) {
    return { op: before.op, ...(applied?.id ? { id: applied.id } : {}),
      ...(before.projectId ? { projectId: before.projectId } : {}) };
  },
  async inverse() { return null; }
};
