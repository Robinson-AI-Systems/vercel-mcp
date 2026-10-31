// M-4: Blob files in connected stores (IN-15: a store with no
// connection is a connection state, never a rule). Reads answer with
// the setup steps when the store is not connected; writes refuse with
// them. File operations run through src/vercel/blob.js (the pinned
// @vercel/blob SDK) with the store's own token.
import { compact } from '../core/util.js';
import { defineWrite, bindGuardedWrite, RefusalError } from '../core/write.js';
import { checkProtected } from './self-guard.js';
import { checkApp } from './app-guard.js';
import { readProvider } from '../vercel/provider.js';
import { loadToken } from '../vercel/tokens.js';
import { resolveBlobStore, blobOps, BlobOpError } from '../vercel/blob.js';

const READ = ['read_only', 'everyday', 'full'];
const MAX_PUT_BYTES = 4 * 1024 * 1024;
const SETUP_STEPS = 'Connect it through the enrollment step of the ' +
  'sign-in flow: open /api/oauth/enroll, sign in as the owner, and use ' +
  'the Blob store form — you need the ' +
  'store ID and its read-write token from the Vercel dashboard (Storage ' +
  '→ the store → Settings). The token is stored encrypted and never ' +
  'shown again. Stores reachable only through a project OIDC token ' +
  'cannot be connected in this version.';

const output = value => ({ content: [{ type: 'text',
  text: JSON.stringify(compact(value, 1048576)) }] });
const storeArg = {
  store: { type: 'string', minLength: 1, maxLength: 200,
    description: 'Connected Blob store ID (connected through the enrollment step of the sign-in flow).' } };

function requireStoreId(args) {
  if (typeof args.store !== 'string' || !args.store.trim()) {
    throw new RefusalError('Name the Blob store ID to use.');
  }
  return args.store.trim();
}
async function connected(ctx, storeId) {
  return resolveBlobStore({ db: ctx.db, env: ctx.env,
    account: ctx.connection.account, storeId });
}
function unconnectedResult(storeId) {
  return output({ store: storeId, connected: false,
    message: 'This Blob store is not connected on this account. ' +
      SETUP_STEPS });
}
// Linked-project evidence for a store, through the M-3 store read.
// null = the provider did not prove the linkage either way.
async function storeProjects(ctx, storeId) {
  try {
    const { client } = await readProvider(ctx);
    const raw = await client.request('storage_store_get',
      { path: { id: storeId } });
    const store = raw?.store ?? raw;
    if (!store || typeof store !== 'object') return null;
    return (Array.isArray(store.projectsMetadata) ? store.projectsMetadata : [])
      .map(p => ({ projectId: p?.projectId ?? null,
        environments: Array.isArray(p?.environments) ? p.environments : [] }));
  } catch { return null; }
}
function blobRow(b) {
  return { pathname: b.pathname, size: b.size,
    uploadedAt: b.uploadedAt instanceof Date
      ? b.uploadedAt.toISOString() : (b.uploadedAt ?? null),
    etag: b.etag ?? null, url: b.url ?? null };
}

// ---------------------------------------------------------------- reads
async function listHandler(args, ctx) {
  const storeId = requireStoreId(args);
  const found = await connected(ctx, storeId);
  if (!found) return unconnectedResult(storeId);
  const mode = args.mode === 'expanded' ? 'expanded' : 'folded';
  const limit = Math.min(1000,
    Math.max(1, Number.isInteger(args.limit) ? args.limit : 100));
  const ops = blobOps();
  const blobs = []; let folders = []; let cursor; let hasMore = false;
  do {
    const page = await ops.list(found.token, {
      mode, limit: Math.min(1000, limit - blobs.length),
      ...(typeof args.prefix === 'string' && args.prefix ? { prefix: args.prefix } : {}),
      ...(cursor ? { cursor } : {}) });
    for (const b of page.blobs ?? []) blobs.push(blobRow(b));
    if (Array.isArray(page.folders)) folders = page.folders;
    hasMore = page.hasMore === true;
    cursor = page.cursor;
  } while (hasMore && cursor && blobs.length < limit);
  return output({ store: storeId, connected: true,
    label: found.row.label, mode, shown: blobs.length, blobs, folders,
    truncated: hasMore && blobs.length >= limit,
    ...(hasMore && blobs.length >= limit
      ? { note: 'More files exist beyond the limit shown; narrow with prefix or raise the limit.' } : {}) });
}
async function headHandler(args, ctx) {
  const storeId = requireStoreId(args);
  if (typeof args.pathname !== 'string' || !args.pathname.trim()) {
    throw new RefusalError('Name the file pathname to inspect.');
  }
  const found = await connected(ctx, storeId);
  if (!found) return unconnectedResult(storeId);
  const ops = blobOps();
  try {
    const meta = await ops.head(found.token, args.pathname.trim());
    return output({ store: storeId, connected: true, found: true,
      file: { ...blobRow(meta), contentType: meta.contentType ?? null,
        contentDisposition: meta.contentDisposition ?? null,
        cacheControl: meta.cacheControl ?? null,
        downloadUrl: meta.downloadUrl ?? null } });
  } catch (err) {
    if (err instanceof BlobOpError && err.blobKind === 'not_found') {
      return output({ store: storeId, connected: true, found: false,
        pathname: args.pathname.trim() });
    }
    throw err;
  }
}
export const blobReadTools = {
  tools: [
    { name: 'vercel_blob_list', writes: false, area: 'storage',
      profiles: READ, annotations: { readOnlyHint: true },
      description: 'List files in a connected Blob store (folder summary by default), with prefix filter and bounded pages.',
      inputSchema: { type: 'object', additionalProperties: false,
        required: ['store'],
        properties: { ...storeArg,
          prefix: { type: 'string', maxLength: 500 },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          mode: { type: 'string', enum: ['folded', 'expanded'] } } } },
    { name: 'vercel_blob_head', writes: false, area: 'storage',
      profiles: READ, annotations: { readOnlyHint: true },
      description: 'Read one Blob file\'s metadata (size, type, uploaded, cache settings) without downloading it.',
      inputSchema: { type: 'object', additionalProperties: false,
        required: ['store', 'pathname'],
        properties: { ...storeArg,
          pathname: { type: 'string', minLength: 1, maxLength: 1000 } } } }
  ],
  handlers: { vercel_blob_list: listHandler, vercel_blob_head: headHandler }
};

// --------------------------------------------------------------- writes
function writeCtxFor({ db, connection, env, fetchImpl }) {
  return { db, connection, env, fetchImpl, shape: compact,
    audit: x => db.recordChange(x), replayStore: db.requestReplayStore(),
    checkSpend: declaration => declaration.cents === 0
      ? { allowed: true, code: 'allowed', explanation: 'No charge for this change' }
      : { allowed: false, code: 'owner_required', explanation: 'Owner purchase grant required' },
    guardProtected: targets => checkProtected(targets, { db, connection, env }),
    guardApp: targets => checkApp(targets, { db, connection, env }) };
}
const writeProps = extra => ({ type: 'object', additionalProperties: false,
  properties: { ...extra,
    dryRun: { type: 'boolean' }, confirm: { type: 'boolean' },
    requestKey: { type: 'string', minLength: 8, maxLength: 190 } } });

async function requireConnected(ctx, storeId) {
  const found = await connected(ctx, storeId);
  if (!found) {
    throw new RefusalError('Blob store ' + storeId +
      ' is not connected on this account. ' + SETUP_STEPS);
  }
  return found;
}
async function teamId(ctx) {
  const { account } = await loadToken(ctx);
  return account.team_id;
}

const putWrite = defineWrite({
  name: 'vercel_blob_put',
  async before(args, ctx) {
    const storeId = requireStoreId(args);
    const found = await requireConnected(ctx, storeId);
    if (typeof args.pathname !== 'string' || !args.pathname.trim()) {
      throw new RefusalError('Name the destination pathname for the upload.');
    }
    if (typeof args.contentBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(args.contentBase64.replace(/\s/g, ''))) {
      throw new RefusalError('contentBase64 must be the file content encoded as base64.');
    }
    const body = Buffer.from(args.contentBase64, 'base64');
    if (!body.length) throw new RefusalError('The file content is empty.');
    if (body.length > MAX_PUT_BYTES) {
      throw new RefusalError('Inline uploads are limited to 4 MB; this file is ' +
        body.length + ' bytes.');
    }
    const access = args.access ?? found.row.access;
    if (!['public', 'private'].includes(access)) {
      throw new RefusalError('access must be public or private.');
    }
    const ops = blobOps();
    let existing = null;
    try {
      const meta = await ops.head(found.token, args.pathname.trim());
      existing = { size: meta.size, etag: meta.etag ?? null };
    } catch (err) {
      if (!(err instanceof BlobOpError && err.blobKind === 'not_found')) throw err;
    }
    if (existing && args.allowOverwrite !== true) {
      throw new RefusalError('A file already exists at ' + args.pathname.trim() +
        ' (' + existing.size + ' bytes). Pass allowOverwrite: true to replace it.');
    }
    const projects = await storeProjects(ctx, storeId);
    // NOTE: no Buffer in `before` — the executor's shaped copy of the
    // before-state drops binary values. Carry the base64 + size and
    // decode at apply time.
    return { storeId, token: found.token, label: found.row.label,
      pathname: args.pathname.trim(), contentBase64: args.contentBase64,
      size: body.length, access, existing,
      projects, teamId: await teamId(ctx) };
  },
  async production(_args, _ctx, before) {
    if (!before.projects) {
      return { production: true,
        why: 'the store project linkage could not be proven; gated as live' };
    }
    const live = before.projects.some(p =>
      p.environments.includes('production'));
    return { production: live,
      why: live ? 'the store is connected to a production-environment project'
        : 'no linked project targets the production environment' };
  },
  async targets(args, before) {
    // P-1: the profile guard judges store writes by the store's name
    // (the connection label) and the caller's outsideApp declaration.
    return [{ kind: 'store', id: before.storeId, accountId: before.teamId,
      name: before.pathname, storeName: before.label, storeAction: 'put',
      overwrite: before.existing != null,
      outsideApp: args.outsideApp === true }];
  },
  async preview(_args, _ctx, before) {
    return 'Upload ' + before.size + ' byte(s) to ' + before.pathname +
      ' in Blob store ' + before.storeId + ' (' + before.label + '), access ' +
      before.access + (before.existing
        ? '; this REPLACES the existing ' + before.existing.size + '-byte file.'
        : '.');
  },
  async apply(_args, _ctx, before) {
    const ops = blobOps();
    const result = await ops.put(before.token, before.pathname,
      Buffer.from(before.contentBase64, 'base64'), {
      access: before.access, allowOverwrite: before.existing != null,
      addRandomSuffix: false,
      ...(typeof _args.contentType === 'string' && _args.contentType
        ? { contentType: _args.contentType } : {}) });
    return { pathname: result.pathname, url: result.url,
      contentType: result.contentType ?? null, size: before.size };
  },
  async verify(_args, ctx, before) {
    // The token is never carried in the applied result (it would reach
    // the replay record); re-resolve it from the connection instead.
    const found = await connected(ctx, before.storeId);
    if (!found) return { confirmed: false };
    const ops = blobOps();
    try {
      const meta = await ops.head(found.token, before.pathname);
      return { confirmed: meta.size === before.size,
        after: { size: meta.size } };
    } catch { return { confirmed: false }; }
  },
  async publicReceipt(_args, _before, applied) {
    return { pathname: applied.pathname, size: applied.size };
  }
});

const deleteWrite = defineWrite({
  name: 'vercel_blob_delete',
  async before(args, ctx) {
    const storeId = requireStoreId(args);
    const found = await requireConnected(ctx, storeId);
    if (!Array.isArray(args.pathnames) || !args.pathnames.length ||
      args.pathnames.length > 100) {
      throw new RefusalError('List between 1 and 100 exact file pathnames to delete.');
    }
    const pathnames = args.pathnames.map(p => {
      if (typeof p !== 'string' || !p.trim()) {
        throw new RefusalError('Every pathname must be a non-empty string.');
      }
      if (/[*?]/.test(p)) {
        throw new RefusalError('Wildcards are not accepted: name each file exactly (' + p + ').');
      }
      return p.trim();
    });
    const projects = await storeProjects(ctx, storeId);
    const connectedProjects = projects?.map(p => p.projectId).filter(Boolean) ?? null;
    if ((connectedProjects === null || connectedProjects.length > 0) &&
      args.outsideApp !== true) {
      throw new RefusalError(connectedProjects === null
        ? 'Whether this store is connected to a project could not be proven, so deletion needs outsideApp: true to proceed.'
        : 'This store is connected to project(s) ' + connectedProjects.join(', ') +
          '; deleting its files can break a live app. Pass outsideApp: true only if you mean to work outside the app.');
    }
    const ops = blobOps();
    const files = [];
    for (const pathname of pathnames) {
      try {
        const meta = await ops.head(found.token, pathname);
        files.push({ pathname, size: meta.size, exists: true });
      } catch (err) {
        if (err instanceof BlobOpError && err.blobKind === 'not_found') {
          files.push({ pathname, size: null, exists: false });
        } else throw err;
      }
    }
    return { storeId, token: found.token, label: found.row.label,
      pathnames, files, projects, teamId: await teamId(ctx) };
  },
  async production(_args, _ctx, before) {
    if (!before.projects) {
      return { production: true,
        why: 'the store project linkage could not be proven; gated as live' };
    }
    const live = before.projects.some(p =>
      p.environments.includes('production'));
    return { production: live,
      why: live ? 'the store is connected to a production-environment project'
        : 'no linked project targets the production environment' };
  },
  async targets(args, before) {
    return [{ kind: 'store', id: before.storeId, accountId: before.teamId,
      name: before.pathnames[0], storeName: before.label,
      storeAction: 'delete', outsideApp: args.outsideApp === true }];
  },
  async preview(_args, _ctx, before) {
    const lines = before.files.map(f => f.exists
      ? f.pathname + ' (' + f.size + ' bytes)'
      : f.pathname + ' (already absent)');
    return 'Delete ' + before.pathnames.length + ' file(s) from Blob store ' +
      before.storeId + ' (' + before.label + '): ' + lines.join('; ') +
      '. Deletion cannot be undone.';
  },
  async apply(_args, _ctx, before) {
    const ops = blobOps();
    await ops.del(before.token, before.pathnames);
    return { deleted: before.files.filter(f => f.exists).map(f => f.pathname),
      alreadyAbsent: before.files.filter(f => !f.exists).map(f => f.pathname) };
  },
  async verify(_args, ctx, before) {
    const found = await connected(ctx, before.storeId);
    if (!found) return { confirmed: false };
    const ops = blobOps();
    let allGone = true;
    for (const pathname of before.pathnames) {
      try { await ops.head(found.token, pathname); allGone = false; }
      catch (err) {
        if (!(err instanceof BlobOpError && err.blobKind === 'not_found')) {
          return { confirmed: null };
        }
      }
    }
    return { confirmed: allGone };
  },
  async publicReceipt(_args, _before, applied) {
    return { deleted: applied.deleted, alreadyAbsent: applied.alreadyAbsent };
  }
});

const resultMapper = result => ({
  isError: ['refused_by_guard', 'outcome_unknown'].includes(result.status),
  content: [{ type: 'text', text: JSON.stringify(result) }] });
export const blobWriteTools = { tools: [], handlers: {} };
function registerBlobWrite(write, registryEntry) {
  blobWriteTools.tools.push(registryEntry);
  blobWriteTools.handlers[registryEntry.name] =
    bindGuardedWrite(write, writeCtxFor, resultMapper);
}
registerBlobWrite(putWrite, {
  name: 'vercel_blob_put', writes: true, guardedWrite: true, area: 'storage',
  profiles: ['everyday', 'full'],
  description: 'Upload one small file (≤4 MB, inline base64) to a connected Blob store; refuses to overwrite unless asked.',
  inputSchema: writeProps({ ...storeArg,
    pathname: { type: 'string', minLength: 1, maxLength: 1000 },
    contentBase64: { type: 'string', minLength: 1, maxLength: 6000000 },
    contentType: { type: 'string', maxLength: 200 },
    access: { type: 'string', enum: ['public', 'private'] },
    allowOverwrite: { type: 'boolean' },
    outsideApp: { type: 'boolean' } }),
  writeContract: putWrite.writeContract,
  annotations: { destructiveHint: false } });
registerBlobWrite(deleteWrite, {
  name: 'vercel_blob_delete', writes: true, guardedWrite: true, area: 'storage',
  profiles: ['full'],
  description: 'Delete named files (≤100, exact pathnames only) from a connected Blob store; preview lists each file and size.',
  inputSchema: writeProps({ ...storeArg,
    pathnames: { type: 'array', minItems: 1, maxItems: 100,
      items: { type: 'string', minLength: 1, maxLength: 1000 } },
    outsideApp: { type: 'boolean' } }),
  writeContract: deleteWrite.writeContract,
  annotations: { destructiveHint: true } });
