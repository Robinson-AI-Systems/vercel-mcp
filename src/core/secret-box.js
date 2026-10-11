// AES-256-GCM authenticated encryption for server-side stored credentials.
// Secret inputs and decrypted values must never enter logs, MCP results or PR text.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FORMAT = 'v1';
const MAX_BYTES = 64 * 1024;

function decodeKey(env) {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (typeof raw !== 'string' || !raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  }
  let key;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else if (/^[a-zA-Z0-9_-]{43}$/.test(raw)) {
    key = Buffer.from(raw, 'base64url');
    if (key.toString('base64url') !== raw) key = null;
  }
  if (!key || key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte hex or base64url key');
  return key;
}

function aadFor(purpose) {
  if (typeof purpose !== 'string' || !/^[a-zA-Z0-9_:./-]{1,180}$/.test(purpose)) {
    throw new TypeError('An explicit secret purpose is required');
  }
  return Buffer.from('vercel-mcp:' + FORMAT + ':' + purpose);
}

export function encryptSecret(plaintext, purpose, env = process.env) {
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
  const key = decodeKey(env);
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
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt stored secret; check the encryption key and record binding');
  }
}
