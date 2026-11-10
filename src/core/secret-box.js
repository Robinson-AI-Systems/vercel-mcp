// AES-256-GCM authenticated encryption for server-side stored credentials.
// Secret inputs and decrypted values must never enter logs, MCP results or PR text.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FORMAT = 'v1';
const MAX_BYTES = 64 * 1024;

function decodeKeyString(raw, name) {
  let key;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else if (/^[a-zA-Z0-9_-]{43}$/.test(raw)) {
    key = Buffer.from(raw, 'base64url');
    if (key.toString('base64url') !== raw) key = null;
  }
  if (!key || key.length !== 32) throw new Error(name + ' must be a 32-byte hex or base64url key');
  return key;
}

function decodeKey(env) {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (typeof raw !== 'string' || !raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  }
  return decodeKeyString(raw, 'TOKEN_ENCRYPTION_KEY');
}

/** Older keys still accepted for READING during a key change (comma-separated, at most two,
 * each in the same hex/base64url shapes as TOKEN_ENCRYPTION_KEY). New values are always sealed
 * with the current key, so a previous key can be dropped once nothing sealed with it is left.
 * Mirrors the github-mcp TOKEN_ENCRYPTION_KEY_PREVIOUS contract. */
export function readPreviousKeys(env = process.env) {
  const raw = env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 2) throw new Error('TOKEN_ENCRYPTION_KEY_PREVIOUS may list at most two keys');
  return parts.map((part) => decodeKeyString(part, 'TOKEN_ENCRYPTION_KEY_PREVIOUS'));
}

function aadFor(purpose) {
  if (typeof purpose !== 'string' || !/^[a-zA-Z0-9_:./-]{1,180}$/.test(purpose)) {
    throw new TypeError('An explicit secret purpose is required');
  }
  return Buffer.from('vercel-mcp:' + FORMAT + ':' + purpose);
}

export function encryptSecret(plaintext, purpose, env = process.env) {
  // Sealing always uses the current key only; previous keys (readPreviousKeys) are read-only.
  if (typeof plaintext !== 'string' || !plaintext) throw new TypeError('Secret must be non-empty');
  const bytes = Buffer.from(plaintext, 'utf8');
  if (bytes.length > MAX_BYTES) throw new TypeError('Secret is too large');
  const key = decodeKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(purpose));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return [FORMAT, iv.toString('base64url'), encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptSecret(box, purpose, env = process.env) {
  // The current key first; during a key change the previous key(s) are tried too. Every attempt
  // is authenticated (AES-GCM with the same purpose binding), so a wrong key can never return
  // wrong plaintext. A malformed TOKEN_ENCRYPTION_KEY_PREVIOUS is ignored here — it is reported
  // by readPreviousKeys where the setting is consumed directly — and never weakens the current key.
  let keys = [decodeKey(env)];
  try { keys = [...keys, ...readPreviousKeys(env)]; } catch { /* see note above */ }
  const aad = aadFor(purpose);
  if (typeof box !== 'string') throw new TypeError('Invalid encrypted secret');
  const chunks = box.split('.');
  if (chunks.length !== 4 || chunks[0] !== FORMAT) throw new TypeError('Invalid encrypted secret');
  const [iv, ciphertext, tag] = chunks.slice(1).map(part => {
    if (!/^[a-zA-Z0-9_-]+$/.test(part)) throw new TypeError('Invalid encrypted secret');
    const decoded = Buffer.from(part, 'base64url');
    if (decoded.toString('base64url') !== part) throw new TypeError('Invalid encrypted secret');
    return decoded;
  });
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_BYTES) {
    throw new TypeError('Invalid encrypted secret');
  }
  for (const key of keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch { /* try the next key */ }
  }
  throw new Error('Unable to decrypt stored secret; check the encryption key and record binding');
}
