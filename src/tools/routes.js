import { createHash } from 'node:crypto';
import { defineWrite, bindGuardedWrite, requirePreDispatch, RefusalError } from '../core/write.js';
import { compact } from '../core/util.js';
import { readProvider, writeProvider } from '../vercel/provider.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';
import { validateRequest } from '../vercel/openapi-validation.js';

// Batch F-3: project routes, bulk redirects and edge-cache invalidation.
// Staging never changes what visitors see (catalog mark P: production()
// is false); publishing, restoring and cache invalidation are production
// changes (PR). The dangerously-delete cache operations are never called
// (design F5) — invalidation only.

const READ_PROFILES = ['read_only', 'everyday', 'full'];
const EVERYDAY = ['everyday', 'full'];
const fp = value => createHash('sha256').update(String(value)).digest('hex');

function context({ db, connection, env, fetchImpl }) {
  return { db, connection, env, fetchImpl, shape: compact,
    audit: entry => db.recordChange(entry),
    replayStore: db.requestReplayStore(),
    guardProtected: target => checkProtected(target, { db, connection, env }),
    guardApp: target => checkApp(target, { db, connection, env }) };
}
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const text = result;
function strictArgs(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(k => !allowed.includes(k)))
    throw new RefusalError('Invalid arguments');
}
async function resolveProject(ctx, ref) {
  if (typeof ref !== 'string' || !ref) throw new RefusalError('Invalid project reference');
  const { client } = await readProvider(ctx);
  const row = await client.request('projects_get', { path: { idOrName: ref } });
  if (ctx.connection.projectScoped && row?.id !== ctx.connection.projectId)
    throw new RefusalError('Project is outside this connection\u2019s scope');
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string')
    throw new RefusalError('Project identity unavailable');
  return { row };
}
const schema = (properties, required) => ({ type: 'object', properties:
  { project: { type: 'string' }, confirm: { type: 'boolean' },
    dryRun: { type: 'boolean' },
    requestKey: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$' },
    ...properties }, required: ['project', ...required],
  additionalProperties: false });
const plainObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// ---- route / redirect input shapes (documented request keys only) ----
const ROUTE_KEYS = ['src', 'dest', 'headers', 'caseSensitive', 'status', 'has',
  'missing', 'transforms', 'respectOriginCacheControl'];
function validRouteObject(r) {
  if (!plainObject(r) || Object.keys(r).some(k => !ROUTE_KEYS.includes(k))) return false;
  if (typeof r.src !== 'string' || !r.src || r.src.length > 2048) return false;
  if (r.dest !== undefined && (typeof r.dest !== 'string' || r.dest.length > 2048)) return false;
  if (r.headers !== undefined && (!plainObject(r.headers) ||
    Object.keys(r.headers).length > 50 ||
    Object.values(r.headers).some(v => typeof v !== 'string' || v.length > 1024))) return false;
  if (r.status !== undefined &&
    (!Number.isSafeInteger(r.status) || r.status < 100 || r.status > 599)) return false;
  if (r.caseSensitive !== undefined && typeof r.caseSensitive !== 'boolean') return false;
  if (r.respectOriginCacheControl !== undefined &&
    typeof r.respectOriginCacheControl !== 'boolean') return false;
  for (const k of ['has', 'missing', 'transforms'])
    if (r[k] !== undefined && (!Array.isArray(r[k]) || r[k].length > 25 ||
      r[k].some(x => !plainObject(x)) ||
      JSON.stringify(r[k]).length > 4096)) return false;
  return true;
}
const SRC_SYNTAX = ['equals', 'path-to-regexp', 'regex'];
function routeInput(v) {
  if (!plainObject(v) || typeof v.name !== 'string' || !v.name || v.name.length > 256 ||
    (v.description !== undefined && (typeof v.description !== 'string' || v.description.length > 1024)) ||
    (v.enabled !== undefined && typeof v.enabled !== 'boolean') ||
    (v.srcSyntax !== undefined && !SRC_SYNTAX.includes(v.srcSyntax)) ||
    !validRouteObject(v.route)) return null;
  return { name: v.name,
    ...(v.description !== undefined ? { description: v.description } : {}),
    ...(v.enabled !== undefined ? { enabled: v.enabled } : {}),
    ...(v.srcSyntax !== undefined ? { srcSyntax: v.srcSyntax } : {}),
    route: v.route };
}
function redirectItem(v) {
  if (!plainObject(v) || typeof v.source !== 'string' || !v.source || v.source.length > 2048 ||
    typeof v.destination !== 'string' || !v.destination || v.destination.length > 2048) return null;
  if (v.statusCode !== undefined &&
    (!Number.isSafeInteger(v.statusCode) || v.statusCode < 300 || v.statusCode > 399)) return null;
  for (const k of ['permanent', 'caseSensitive', 'query', 'preserveQueryParams'])
    if (v[k] !== undefined && typeof v[k] !== 'boolean') return null;
  return { source: v.source, destination: v.destination,
    ...(v.statusCode !== undefined ? { statusCode: v.statusCode } : {}),
    ...(v.permanent !== undefined ? { permanent: v.permanent } : {}),
    ...(v.caseSensitive !== undefined ? { caseSensitive: v.caseSensitive } : {}),
    ...(v.query !== undefined ? { query: v.query } : {}),
    ...(v.preserveQueryParams !== undefined ? { preserveQueryParams: v.preserveQueryParams } : {}) };
}
const stringList = (v, max, each = 2048) => Array.isArray(v) && v.length >= 1 && v.length <= max &&
  v.every(x => typeof x === 'string' && x.length > 0 && x.length <= each);

// ---- read-backs ----
async function getRoutes(ctx, id) {
  const { client } = await readProvider(ctx);
  const page = await client.request('project_routes_list', { path: { projectId: id } });
  if (!page || !Array.isArray(page.routes)) return null; // documented opaque branch
  return page.routes.map(r => ({ id: r.id ?? null, name: r.name ?? null,
    description: r.description ?? null, enabled: r.enabled ?? null,
    src: r.route?.src ?? r.rawSrc ?? null, dest: r.route?.dest ?? r.rawDest ?? null,
    status: r.route?.status ?? null }));
}
async function getRouteVersions(ctx, id) {
  const { client } = await readProvider(ctx);
  const page = await client.request('project_routes_versions_list', { path: { projectId: id } });
  return (Array.isArray(page?.versions) ? page.versions : []).map(v => ({
    id: v.id ?? null, alias: v.alias ?? null, isLive: v.isLive === true,
    isStaging: v.isStaging === true, lastModified: v.lastModified ?? null,
    ruleCount: v.ruleCount ?? null }));
}
async function getRedirects(ctx, id) {
  const { client } = await readProvider(ctx);
  const page = await client.request('bulk_redirects_list', { query: { projectId: id } });
  if (!page || !Array.isArray(page.redirects)) return null;
  return page.redirects.map(r => ({ source: r.source ?? null,
    destination: r.destination ?? null, statusCode: r.statusCode ?? null,
    permanent: r.permanent ?? null, caseSensitive: r.caseSensitive ?? null,
    preserveQueryParams: r.preserveQueryParams ?? null }));
}
async function getRedirectVersions(ctx, id) {
  const { client } = await readProvider(ctx);
  const page = await client.request('bulk_redirects_versions_list', { query: { projectId: id } });
  return (Array.isArray(page?.versions) ? page.versions : []).map(v => ({
    id: v.id ?? null, alias: v.alias ?? null, name: v.name ?? null,
    isLive: v.isLive === true, isStaging: v.isStaging === true,
    lastModified: v.lastModified ?? null, redirectCount: v.redirectCount ?? null }));
}
const versionIdOf = row => typeof row?.version === 'string' ? row.version
  : (typeof row?.version?.id === 'string' ? row.version.id : null);

// ---- staging writes (P: visitors see no change until publish) ----
function stageCheck(b, fresh) {
  if (fp(fresh) !== b.fingerprint)
    throw new TypeError('Routing changed since the confirmed preview');
}
const routeStage = defineWrite({
  name: 'vercel_route_stage',
  async before(args, ctx) {
    strictArgs(args, ['project', 'action', 'route', 'routeId', 'routeIds', 'routes',
      'position', 'overwrite', 'confirm', 'dryRun', 'requestKey']);
    const action = args?.action;
    if (!['add', 'update', 'remove', 'replace'].includes(action))
      throw new RefusalError('Invalid staging action');
    const plan = { action };
    if (action === 'add') {
      plan.input = routeInput(args.route);
      if (!plan.input) throw new RefusalError('Invalid route to stage');
      if (args.position !== undefined) {
        const p = args.position;
        if (!plainObject(p) || !['start', 'end', 'after', 'before'].includes(p.placement) ||
          (['after', 'before'].includes(p.placement) && typeof p.referenceId !== 'string'))
          throw new RefusalError('Invalid route position');
        plan.position = { placement: p.placement,
          ...(p.referenceId ? { referenceId: p.referenceId } : {}) };
      }
      plan.words = 'Stage a new route ' + plan.input.route.src + ' \u2192 ' +
        (plan.input.route.dest ?? 'middleware') + ' on this project.';
    } else if (action === 'update') {
      plan.input = routeInput(args.route);
      if (typeof args.routeId !== 'string' || !args.routeId || !plan.input)
        throw new RefusalError('Invalid route update');
      plan.routeId = args.routeId;
      plan.words = 'Stage an update to route ' + args.routeId + ' (' +
        plan.input.route.src + ') on this project.';
    } else if (action === 'remove') {
      if (!stringList(args.routeIds, 100, 256)) throw new RefusalError('Invalid route removals');
      plan.routeIds = args.routeIds;
      plan.words = 'Stage removing ' + args.routeIds.length + ' route(s) from this project.';
    } else {
      if (!Array.isArray(args.routes) || args.routes.length < 1 || args.routes.length > 500)
        throw new RefusalError('Invalid replacement route set');
      plan.items = args.routes.map(r => {
        const input = routeInput(r);
        if (!input || typeof r.id !== 'string' || !r.id) return null;
        return { id: r.id, ...input };
      });
      if (plan.items.some(x => !x)) throw new RefusalError('Invalid replacement route set');
      plan.overwrite = args.overwrite === true;
      plan.words = 'Stage a replacement set of ' + plan.items.length + ' route(s) on this project.';
    }
    const { row } = await resolveProject(ctx, args.project);
    const [routes, versions] = await Promise.all(
      [getRoutes(ctx, row.id), getRouteVersions(ctx, row.id)]);
    if (routes && action === 'update' && !routes.some(r => r.id === plan.routeId))
      throw new RefusalError('No route with that id exists on this project');
    if (routes && action === 'remove' &&
      plan.routeIds.some(id => !routes.some(r => r.id === id)))
      throw new RefusalError('One of the routes to remove does not exist on this project');
    const live = versions.find(v => v.isLive);
    plan.fingerprint = fp(JSON.stringify([live?.id ?? null,
      routes ? routes.map(r => [r.id, r.src, r.dest]) : 'unverifiable']));
    plan.versionsNote = routes === null;
    return { id: row.id, name: row.name, ...plan };
  },
  async preview(_args, _ctx, b) {
    return b.words + ' Staged only: visitors see no change until the staged ' +
      'version is published with vercel_route_publish.' +
      (b.versionsNote ? ' (The current route list could not be read back, so no diff is shown.)' : '');
  },
  async production() {
    return { production: false,
      why: 'Staging only: visitors see no change until the staged version is published' };
  },
  async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
  async apply(_args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    await requirePreDispatch(async () => {
      const [routes, versions] = await Promise.all(
        [getRoutes(ctx, b.id), getRouteVersions(ctx, b.id)]);
      const live = versions.find(v => v.isLive);
      stageCheck(b, JSON.stringify([live?.id ?? null,
        routes ? routes.map(r => [r.id, r.src, r.dest]) : 'unverifiable']));
    });
    const call = {
      add: ['project_routes_add', { path: { projectId: b.id },
        body: { route: b.input, ...(b.position ? { position: b.position } : {}) } }],
      update: ['project_route_update', { path: { projectId: b.id, routeId: b.routeId },
        body: { route: b.input } }],
      remove: ['project_routes_delete', { path: { projectId: b.id },
        body: { routeIds: b.routeIds } }],
      replace: ['project_routes_stage', { path: { projectId: b.id },
        body: { overwrite: b.overwrite, routes: b.items } }]
    }[b.action];
    return provider.write(call[0], call[1], { requestKey, tool: 'vercel_route_stage',
      shapeResult: row => {
        if (!row || typeof row !== 'object') throw new TypeError('Route stage response unproven');
        return { stagedVersionId: versionIdOf(row) };
      } });
  },
  async verify(_args, ctx, b, applied) {
    const versions = await getRouteVersions(ctx, b.id);
    return { confirmed: applied?.stagedVersionId
        ? versions.some(v => v.id === applied.stagedVersionId) : null,
      stagedVersionId: applied?.stagedVersionId ?? null, project: b.id };
  },
  async inverse(args, _b, applied) {
    if (!applied?.stagedVersionId) return undefined;
    return { tool: 'vercel_route_publish', project: args.project,
      versionId: applied.stagedVersionId, action: 'discard' };
  }
});

const redirectStage = defineWrite({
  name: 'vercel_redirect_stage',
  async before(args, ctx) {
    strictArgs(args, ['project', 'action', 'redirect', 'redirects', 'sources', 'name',
      'confirm', 'dryRun', 'requestKey']);
    const action = args?.action;
    if (!['replace', 'update', 'remove', 'restoreItems'].includes(action))
      throw new RefusalError('Invalid staging action');
    if (args.name !== undefined && (typeof args.name !== 'string' || args.name.length > 256))
      throw new RefusalError('Invalid staged version name');
    const plan = { action, name: args.name };
    if (action === 'replace') {
      if (!Array.isArray(args.redirects) || args.redirects.length < 1 || args.redirects.length > 5000)
        throw new RefusalError('Invalid replacement redirect set');
      plan.items = args.redirects.map(redirectItem);
      if (plan.items.some(x => !x)) throw new RefusalError('Invalid replacement redirect set');
      plan.words = 'Stage a replacement set of ' + plan.items.length + ' redirect(s) on this project.';
    } else if (action === 'update') {
      plan.item = redirectItem(args.redirect);
      if (!plan.item) throw new RefusalError('Invalid redirect update');
      plan.words = 'Stage an update to the redirect from ' + plan.item.source + '.';
    } else {
      if (!stringList(args.sources, 1000)) throw new RefusalError('Invalid redirect sources');
      plan.sources = args.sources;
      plan.words = action === 'remove'
        ? 'Stage removing ' + args.sources.length + ' redirect(s) from this project.'
        : 'Stage restoring ' + args.sources.length + ' previously removed redirect(s).';
    }
    const { row } = await resolveProject(ctx, args.project);
    const [redirects, versions] = await Promise.all(
      [getRedirects(ctx, row.id), getRedirectVersions(ctx, row.id)]);
    const live = versions.find(v => v.isLive);
    plan.fingerprint = fp(JSON.stringify([live?.id ?? null, live?.redirectCount ?? null,
      redirects ? redirects.map(r => r.source) : 'unverifiable']));
    return { id: row.id, name: row.name, ...plan };
  },
  async preview(_args, _ctx, b) {
    return b.words + ' Staged only: visitors see no change until the staged ' +
      'version is published with vercel_redirect_publish.';
  },
  async production() {
    return { production: false,
      why: 'Staging only: visitors see no change until the staged version is published' };
  },
  async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
  async apply(_args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    await requirePreDispatch(async () => {
      const [redirects, versions] = await Promise.all(
        [getRedirects(ctx, b.id), getRedirectVersions(ctx, b.id)]);
      const live = versions.find(v => v.isLive);
      stageCheck(b, JSON.stringify([live?.id ?? null, live?.redirectCount ?? null,
        redirects ? redirects.map(r => r.source) : 'unverifiable']));
    });
    const named = b.name ? { name: b.name } : {};
    const call = {
      replace: ['bulk_redirects_stage', { body: { projectId: b.id,
        teamId: provider.account.team_id, redirects: b.items, ...named } }],
      update: ['bulk_redirects_update', { query: { projectId: b.id },
        body: { redirect: b.item, ...named } }],
      remove: ['bulk_redirects_delete', { query: { projectId: b.id },
        body: { redirects: b.sources, ...named } }],
      restoreItems: ['bulk_redirects_restore_items', { query: { projectId: b.id },
        body: { redirects: b.sources, ...named } }]
    }[b.action];
    return provider.write(call[0], call[1], { requestKey, tool: 'vercel_redirect_stage',
      shapeResult: row => {
        if (!row || typeof row !== 'object') throw new TypeError('Redirect stage response unproven');
        return { stagedVersionId: versionIdOf(row),
          ...(Number.isSafeInteger(row.restored) ? { restored: row.restored } : {}),
          ...(Number.isSafeInteger(row.failedToRestore) ? { failedToRestore: row.failedToRestore } : {}) };
      } });
  },
  async verify(_args, ctx, b, applied) {
    const versions = await getRedirectVersions(ctx, b.id);
    return { confirmed: applied?.stagedVersionId
        ? versions.some(v => v.id === applied.stagedVersionId) : null,
      stagedVersionId: applied?.stagedVersionId ?? null, project: b.id,
      ...(applied?.restored !== undefined ? { restored: applied.restored,
        failedToRestore: applied.failedToRestore ?? null } : {}) };
  },
  async inverse(args, _b, applied) {
    if (!applied?.stagedVersionId) return undefined;
    return { tool: 'vercel_redirect_publish', project: args.project,
      versionId: applied.stagedVersionId, action: 'discard' };
  }
});

// ---- publish / restore (PR) ----
function versionWrite({ name, family, actions, inverseTool }) {
  const isRoutes = family === 'routes';
  const list = isRoutes ? getRouteVersions : getRedirectVersions;
  const op = isRoutes ? 'project_routes_versions_update' : 'bulk_redirects_versions_update';
  return defineWrite({
    name,
    async before(args, ctx) {
      strictArgs(args, ['project', 'versionId', ...(actions.length > 1 ? ['action'] : []),
        'confirm', 'dryRun', 'requestKey']);
      const action = actions.length > 1 ? args?.action : actions[0];
      if (!actions.includes(action) || typeof args?.versionId !== 'string' || !args.versionId)
        throw new RefusalError('Invalid version change');
      const { row } = await resolveProject(ctx, args.project);
      const versions = await list(ctx, row.id);
      const target = versions.find(v => v.id === args.versionId);
      if (!target) throw new RefusalError('No routing version with that id exists for this project');
      if (action !== 'discard' && target.isLive)
        throw new RefusalError('That version is already the live one');
      if (action === 'discard' && target.isLive)
        throw new RefusalError('The live version cannot be discarded');
      const live = versions.find(v => v.isLive);
      validateRequest(op, isRoutes
        ? { path: { projectId: row.id }, body: { id: args.versionId, action } }
        : { query: { projectId: row.id, teamId: 'team_FAKE_validation' },
            body: { id: args.versionId, action } });
      return { id: row.id, name: row.name, versionId: args.versionId, action,
        liveId: live?.id ?? null };
    },
    async preview(_args, _ctx, b) {
      return { promote: 'Publish routing version ' + b.versionId + ' on this project: ' +
          'it becomes the live version visitors get.',
        restore: 'Make routing version ' + b.versionId + ' live again on this project.',
        discard: 'Discard staged routing version ' + b.versionId + ' on this project.' }[b.action];
    },
    async production() {
      return { production: true, why: 'Publishing changes the routing live visitors get' };
    },
    async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
    async apply(_args, ctx, b, requestKey) {
      const provider = await writeProvider(ctx);
      await requirePreDispatch(async () => {
        const versions = await list(ctx, b.id);
        const target = versions.find(v => v.id === b.versionId);
        const live = versions.find(v => v.isLive);
        if (!target || (live?.id ?? null) !== b.liveId)
          throw new TypeError('Routing versions changed since the confirmed preview');
      });
      return provider.write(op, isRoutes
        ? { path: { projectId: b.id }, body: { id: b.versionId, action: b.action } }
        : { query: { projectId: b.id }, body: { id: b.versionId, action: b.action } },
        { requestKey, tool: name, shapeResult: row => {
          if (!row || typeof row !== 'object') throw new TypeError('Version change response unproven');
          return { acknowledged: true };
        } });
    },
    async verify(_args, ctx, b) {
      const versions = await list(ctx, b.id);
      const target = versions.find(v => v.id === b.versionId);
      return { confirmed: b.action === 'discard' ? !target : target?.isLive === true,
        project: b.id, liveVersion: versions.find(v => v.isLive)?.id ?? null };
    },
    async inverse(args, b) {
      if (b.action === 'discard' || !b.liveId) return undefined;
      return { tool: inverseTool, project: args.project, versionId: b.liveId,
        ...(inverseTool === name && actions.length > 1 ? { action: 'restore' } : {}) };
    }
  });
}
const routePublish = versionWrite({ name: 'vercel_route_publish', family: 'routes',
  actions: ['promote', 'restore', 'discard'], inverseTool: 'vercel_route_publish' });
const redirectPublish = versionWrite({ name: 'vercel_redirect_publish', family: 'redirects',
  actions: ['promote', 'discard'], inverseTool: 'vercel_redirect_restore' });
const redirectRestore = versionWrite({ name: 'vercel_redirect_restore', family: 'redirects',
  actions: ['restore'], inverseTool: 'vercel_redirect_restore' });

// ---- cache invalidation (PR; no read-back exists) ----
const cacheInvalidate = defineWrite({
  name: 'vercel_cache_invalidate',
  async before(args, ctx) {
    strictArgs(args, ['project', 'tags', 'srcImages', 'target', 'confirm', 'dryRun', 'requestKey']);
    const hasTags = args?.tags !== undefined, hasImages = args?.srcImages !== undefined;
    if (hasTags === hasImages ||
      (hasTags && !stringList(args.tags, 50, 256)) ||
      (hasImages && !stringList(args.srcImages, 50, 2048)) ||
      (args.target !== undefined && !['production', 'preview'].includes(args.target)))
      throw new RefusalError('Give exactly one of tags or srcImages to invalidate');
    const { row } = await resolveProject(ctx, args.project);
    const op = hasTags ? 'edge_cache_invalidate_tags' : 'edge_cache_invalidate_src_images';
    const body = { ...(hasTags ? { tags: args.tags } : { srcImages: args.srcImages }),
      ...(args.target ? { target: args.target } : {}) };
    validateRequest(op, { query: { projectIdOrName: row.id }, body });
    return { id: row.id, name: row.name, op, body,
      kind: hasTags ? 'tags' : 'srcImages',
      count: (args.tags ?? args.srcImages).length };
  },
  async preview(_args, _ctx, b) {
    return 'Mark the CDN cache stale for ' + b.count + ' ' +
      (b.kind === 'tags' ? 'cache tag(s)' : 'source image(s)') + ' on this project: ' +
      'content is refetched on the next visit. This does not hard-delete anything.';
  },
  async production() {
    return { production: true, why: 'Invalidation changes what live visitors are served next' };
  },
  async targets(_args, b) { return [{ kind: 'project', id: b.id, name: b.name }]; },
  async apply(_args, ctx, b, requestKey) {
    const provider = await writeProvider(ctx);
    return provider.write(b.op, { query: { projectIdOrName: b.id }, body: b.body },
      { requestKey, tool: 'vercel_cache_invalidate',
        shapeResult: () => ({ acknowledged: true }) });
  },
  async verify(_args, _ctx, b) {
    // The provider offers no cache read-back: dispatch is the whole proof.
    return { confirmed: null, project: b.id,
      note: 'Cache state cannot be read back; the invalidation was dispatched' };
  }
});

const stageGeneric = { type: 'object', additionalProperties: true };
function writeTool(write, { name, profiles, description, inputSchema }) {
  return { tool: { name, writes: true, guardedWrite: true, profiles, area: 'routes',
      description, inputSchema, writeContract: write.writeContract,
      annotations: { readOnlyHint: false, destructiveHint: false } },
    handler: bindGuardedWrite(write, context, result) };
}
const routeStageTool = writeTool(routeStage, { name: 'vercel_route_stage', profiles: EVERYDAY,
  description: 'Stage route additions, updates, removals or a replacement set. Nothing changes for visitors until the staged version is published.',
  inputSchema: schema({ action: { type: 'string', enum: ['add', 'update', 'remove', 'replace'] },
    route: stageGeneric, routeId: { type: 'string' }, routeIds: { type: 'array' },
    routes: { type: 'array' }, position: stageGeneric, overwrite: { type: 'boolean' } }, ['action']) });
const redirectStageTool = writeTool(redirectStage, { name: 'vercel_redirect_stage', profiles: EVERYDAY,
  description: 'Stage redirect replacements, updates, removals or restores. Nothing changes for visitors until the staged version is published.',
  inputSchema: schema({ action: { type: 'string', enum: ['replace', 'update', 'remove', 'restoreItems'] },
    redirect: stageGeneric, redirects: { type: 'array' }, sources: { type: 'array' },
    name: { type: 'string' } }, ['action']) });
const routePublishTool = writeTool(routePublish, { name: 'vercel_route_publish', profiles: EVERYDAY,
  description: 'Publish a staged routes version (promote), make an earlier one live again (restore), or discard a staged version.',
  inputSchema: schema({ versionId: { type: 'string' },
    action: { type: 'string', enum: ['promote', 'restore', 'discard'] } }, ['versionId', 'action']) });
const redirectPublishTool = writeTool(redirectPublish, { name: 'vercel_redirect_publish', profiles: EVERYDAY,
  description: 'Publish a staged redirects version, or discard a staged version.',
  inputSchema: schema({ versionId: { type: 'string' },
    action: { type: 'string', enum: ['promote', 'discard'] } }, ['versionId', 'action']) });
const redirectRestoreTool = writeTool(redirectRestore, { name: 'vercel_redirect_restore', profiles: EVERYDAY,
  description: 'Make an earlier redirects version live again.',
  inputSchema: schema({ versionId: { type: 'string' } }, ['versionId']) });
const cacheTool = writeTool(cacheInvalidate, { name: 'vercel_cache_invalidate', profiles: EVERYDAY,
  description: 'Mark CDN cache stale by tag or by source image; content refetches on the next visit. Hard delete is not offered here.',
  inputSchema: schema({ tags: { type: 'array', items: { type: 'string' } },
    srcImages: { type: 'array', items: { type: 'string' } },
    target: { type: 'string', enum: ['production', 'preview'] } }, []) });

export const routesTools = {
  tools: [
    { name: 'vercel_route_list', writes: false, area: 'routes', profiles: READ_PROFILES,
      description: 'A project\u2019s routing rules (live set) and its route versions.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } },
        required: ['project'], additionalProperties: false },
      annotations: { readOnlyHint: true } },
    { name: 'vercel_redirect_list', writes: false, area: 'routes', profiles: READ_PROFILES,
      description: 'A project\u2019s bulk redirects (live set) and its redirect versions.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } },
        required: ['project'], additionalProperties: false },
      annotations: { readOnlyHint: true } },
    routeStageTool.tool, redirectStageTool.tool, routePublishTool.tool,
    redirectPublishTool.tool, redirectRestoreTool.tool, cacheTool.tool
  ],
  handlers: {
    async vercel_route_list(args, ctx) {
      strictArgs(args, ['project']);
      const { row } = await resolveProject(ctx, args?.project);
      const [routes, versions] = await Promise.all(
        [getRoutes(ctx, row.id), getRouteVersions(ctx, row.id)]);
      return text({ project: { id: row.id, name: row.name }, routes,
        ...(routes === null ? { note: 'The provider did not return a readable route list for this project' } : {}),
        versions });
    },
    async vercel_redirect_list(args, ctx) {
      strictArgs(args, ['project']);
      const { row } = await resolveProject(ctx, args?.project);
      const [redirects, versions] = await Promise.all(
        [getRedirects(ctx, row.id), getRedirectVersions(ctx, row.id)]);
      return text({ project: { id: row.id, name: row.name }, redirects,
        ...(redirects === null ? { note: 'The provider did not return a readable redirect list for this project' } : {}),
        versions });
    },
    vercel_route_stage: routeStageTool.handler,
    vercel_redirect_stage: redirectStageTool.handler,
    vercel_route_publish: routePublishTool.handler,
    vercel_redirect_publish: redirectPublishTool.handler,
    vercel_redirect_restore: redirectRestoreTool.handler,
    vercel_cache_invalidate: cacheTool.handler
  }
};
