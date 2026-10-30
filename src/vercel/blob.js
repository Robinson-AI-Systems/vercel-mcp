// M-4: the Blob file surface. The repo's one documented exception to
// "Vercel only through src/vercel/client.js" (AGENTS.md, BATCH-M M6):
// Blob files go through the pinned official @vercel/blob package
// (@vercel/blob@2.8.2), always with the connected store's own
// read-write token — never an ambient env token, so a store this
// server was never connected to stays out of reach, and this server's
// own project is never implicitly connected.
//
// Connection state lives in blob_store_connections (setup page only);
// the token is decrypted here, at the point of use, and never returned
// to a tool result, journal or log.
import { list as sdkList, head as sdkHead, put as sdkPut, del as sdkDel }
  from '@vercel/blob';
import { decryptSecret } from '../core/secret-box.js';

export const BLOB_CONTEXT = (account, storeId) => `blob:${account}:${storeId}`;

// Error classification by SDK error class name only — provider text
// never surfaces (it can carry store URLs and request detail).
const ERROR_KINDS = {
  BlobNotFoundError: 'not_found',
  BlobStoreNotFoundError: 'store_not_found',
  BlobStoreSuspendedError: 'store_suspended',
  BlobAccessError: 'access_refused',
  BlobPreconditionFailedError: 'precondition_failed',
  BlobServiceRateLimited: 'rate_limited',
  BlobServiceNotAvailable: 'unavailable',
  BlobContentTypeNotAllowedError: 'content_type_refused',
  BlobPathnameMismatchError: 'pathname_mismatch'
};
export class BlobOpError extends Error {
  constructor(kind) {
    super(`Blob operation failed: ${kind}`);
    this.name = 'BlobOpError';
    this.blobKind = kind;
  }
}
export function classifyBlobError(err) {
  return ERROR_KINDS[err?.name] ?? 'unknown_error';
}
async function guarded(fn) {
  try { return await fn(); }
  catch (err) { throw new BlobOpError(classifyBlobError(err)); }
}

// Resolve the connected store for (account, storeId): the safe row
// plus its decrypted token. Returns null when the store is not
// connected on this account — a connection state, not an error.
export async function resolveBlobStore({ db, env, account, storeId }) {
  if (!db || typeof db.listBlobStoreConnections !== 'function') return null;
  const rows = await db.listBlobStoreConnections(account);
  const row = rows.find(r => r.storeId === storeId);
  if (!row) return null;
  const ciphertext = await db.getBlobStoreConnectionCiphertext({ account, storeId });
  if (!ciphertext) return null;
  let token;
  try { token = decryptSecret(ciphertext, BLOB_CONTEXT(account, storeId), env); }
  catch { return null; }
  return { row, token };
}

// Injectable op set: production passes nothing and gets the SDK;
// tests pass a recorded fake with the same call shapes.
export function blobOps(impl = {}) {
  const list = impl.list ?? sdkList;
  const head = impl.head ?? sdkHead;
  const put = impl.put ?? sdkPut;
  const del = impl.del ?? sdkDel;
  return {
    list: (token, options) => guarded(() => list({ token, ...options })),
    head: (token, pathname) => guarded(() => head(pathname, { token })),
    put: (token, pathname, body, options) =>
      guarded(() => put(pathname, body, { token, ...options })),
    del: (token, pathnames) => guarded(() => del(pathnames, { token }))
  };
}
