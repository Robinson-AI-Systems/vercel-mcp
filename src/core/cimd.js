// AUD-BX — Client ID Metadata Document (CIMD) resolution.
//
// A CIMD client_id is an HTTPS URL; the document served at that
// URL IS the client's registration (MCP authorization spec
// 2025-11-25, draft-ietf-oauth-client-id-metadata-document-00).
// This module is the one resolver the OAuth core consults for
// URL-shaped client IDs other than this server's own Muse
// document (which keeps its local fixed record). The shape map
// and the security decisions live on the card
// (docs/pr-cards/AUD-BX.md); the invariants are:
//
//   - the fetched document's client_id must equal the URL by
//     exact string comparison;
//   - only public clients are admitted: the document must
//     declare token_endpoint_auth_method "none" and carry no
//     client_secret material;
//   - the fetch is guarded as an SSRF surface: HTTPS only,
//     public addresses only, no redirects, a 5s timeout and a
//     64 KB cap;
//   - successes are cached in memory for an hour (PenPal's
//     proven per-process TTL); failures
//     are never cached; nothing is persisted to the client
//     table — the document at its URL stays the registration.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { validRedirectUri } from './oauth.js';

export const CIMD_FETCH_TIMEOUT_MS = 5000;
export const CIMD_MAX_BYTES = 65536;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Is this IP address globally routable? Rejects loopback,
// private, link-local (incl. the cloud metadata range),
// CGNAT, multicast, benchmarking, documentation and reserved
// ranges, for both families.
export function isPublicIp(ip) {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 192 && b === 88) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (ip === '192.0.2.1' || ip.startsWith('192.0.2.')) return false;
    if (ip.startsWith('198.51.100.')) return false;
    if (ip.startsWith('203.0.113.')) return false;
    return true;
  }
  if (kind === 6) {
    const text = ip.toLowerCase();
    if (text === '::1' || text === '::') return false;
    const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    const first = text.split(':')[0];
    const head = Number.parseInt(first || '0', 16);
    if ((head & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if ((head & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((head & 0xff00) === 0xff00) return false; // multicast ff00::/8
    if (text.startsWith('2001:db8:')) return false; // documentation
    if (text.startsWith('64:ff9b:')) return false; // NAT64 well-known
    return true;
  }
  return false;
}

// The URL-level guard, applied before any network work: an
// https URL with a path component, no fragment, no userinfo,
// and a hostname that is not loopback-shaped or a non-public
// IP literal. Returns the parsed URL, or null to refuse.
export function cimdUrl(clientId) {
  if (typeof clientId !== 'string') return null;
  let url;
  try { url = new URL(clientId); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
  if (url.pathname.length < 2) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return null;
  if (isIP(host) && !isPublicIp(host)) return null;
  return url;
}

// The production fetcher. Resolves the hostname first and
// refuses when ANY resolved address is not public, then
// fetches with redirects refused outright (a redirect is a
// refusal, not a hop — the real documents are served at their
// own URLs). Returns the parsed JSON document; throws on any
// failure, and the resolver turns a throw into a refusal.
async function defaultFetchDocument(url) {
  const host = url.hostname;
  let addresses;
  if (isIP(host)) {
    addresses = [host];
  } else {
    const records = await lookup(host, { all: true });
    addresses = records.map((record) => record.address);
  }
  if (!addresses.length || addresses.some((address) => !isPublicIp(address))) {
    throw new Error('CIMD host does not resolve to a public address');
  }
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' }
  });
  if (!res.ok) throw new Error('CIMD fetch failed');
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > CIMD_MAX_BYTES) {
    throw new Error('CIMD document too large');
  }
  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > CIMD_MAX_BYTES) {
    throw new Error('CIMD document too large');
  }
  return JSON.parse(text);
}

// The token-endpoint methods this server itself supports (the
// set its authorization-server metadata advertises).
const SERVER_TOKEN_METHODS = ['client_secret_post', 'none'];

// Whether a document admits treatment as a public "none"
// client — the PenPal rule, imported after its ChatGPT
// conviction (PenPal PR #45 pattern; see the AUD-BX card).
// ChatGPT's live document declares the SINGULAR method
// "private_key_jwt" and the PLURAL supported list
// ["none", "private_key_jwt"]; reading only the singular field
// refuses ChatGPT as an unknown client even though it offers
// "none". So: the document's supported methods are its plural
// list when present, else its singular method, else (PenPal's
// shipped default) "none"; the client is admitted as a public
// "none" client exactly when "none" is in the intersection of
// that list with this server's own methods. Full
// private_key_jwt support is out of scope — a document that
// offers ONLY private_key_jwt (or only a shared-secret method)
// has no "none" in the intersection and is refused.
export function admitsPublicNone(doc) {
  const declared = Array.isArray(doc.token_endpoint_auth_methods_supported) &&
      doc.token_endpoint_auth_methods_supported.length
    ? doc.token_endpoint_auth_methods_supported
    : typeof doc.token_endpoint_auth_method === 'string'
      ? [doc.token_endpoint_auth_method]
      : ['none'];
  return declared.some((method) => method === 'none' && SERVER_TOKEN_METHODS.includes(method));
}

// Validate a fetched document and build the client record —
// the same shape the Muse branch and the DCR lookup return,
// plus the `cimd` marker the redirect helper keys on. Returns
// null for any document that does not conform.
export function clientFromCimdDocument(clientId, doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  if (JSON.stringify(doc).length > CIMD_MAX_BYTES) return null;
  if (doc.client_id !== clientId) return null;
  if (typeof doc.client_name !== 'string' || !doc.client_name) return null;
  if (!admitsPublicNone(doc)) return null;
  if (Object.hasOwn(doc, 'client_secret') || Object.hasOwn(doc, 'client_secret_expires_at')) return null;
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length < 1 || doc.redirect_uris.length > 8) return null;
  if (!doc.redirect_uris.every((uri) => typeof uri === 'string' && validRedirectUri(uri))) return null;
  if (new Set(doc.redirect_uris).size !== doc.redirect_uris.length) return null;
  return {
    client_id: clientId,
    client_name: doc.client_name.slice(0, 100),
    redirect_uris: [...doc.redirect_uris],
    token_endpoint_auth_method: 'none',
    client_secret_hash: null,
    cimd: true
  };
}

// The resolver factory. `fetchDocument` is the injection seam
// unit tests use (it receives the parsed, URL-guarded URL and
// returns the parsed document); production uses the guarded
// fetcher above. Successful resolutions are cached for
// CACHE_TTL_MS; failures are never cached.
export function createCimdResolver({ fetchDocument = defaultFetchDocument, now = Date.now } = {}) {
  const cache = new Map();
  return async function resolveCimdClient(clientId) {
    const url = cimdUrl(clientId);
    if (!url) return null;
    const hit = cache.get(clientId);
    if (hit && hit.expiresAt > now()) return hit.record;
    if (hit) cache.delete(clientId);
    let doc;
    try {
      doc = await fetchDocument(url);
    } catch {
      return null;
    }
    const record = clientFromCimdDocument(clientId, doc);
    if (!record) return null;
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(clientId, { record, expiresAt: now() + CACHE_TTL_MS });
    return record;
  };
}

// Redirect admission for a resolved client: exact match
// first — the rule every client has always lived under — and,
// for CIMD-resolved clients only, the RFC 8252 section 7.3
// loopback rule: when both the registered and the presented
// URI are http loopback URIs with the same host and path, the
// port is ignored (a native client listens on an ephemeral
// port; its document can only name the portless form).
export function redirectUriAllowed(client, uri) {
  const registered = client?.redirect_uris;
  if (!Array.isArray(registered) || typeof uri !== 'string') return false;
  if (registered.includes(uri)) return true;
  if (!client.cimd) return false;
  let presented;
  try { presented = new URL(uri); } catch { return false; }
  if (presented.protocol !== 'http:' || !LOOPBACK_HOSTS.has(presented.hostname)) return false;
  if (presented.username || presented.password || presented.hash) return false;
  return registered.some((candidate) => {
    try {
      const known = new URL(candidate);
      return known.protocol === 'http:' && known.hostname === presented.hostname &&
        known.pathname === presented.pathname && !known.username && !known.password;
    } catch {
      return false;
    }
  });
}
