// Encrypt at rest, reveal only via an authenticated owner setup route.
import { randomUUID } from 'node:crypto';
import { encryptSecret, decryptSecret } from './secret-box.js';

export function oneTimeSecrets({ db, env = process.env, now = () => Date.now() }) {
  if (!db?.insertOneTimeSecret || !db?.consumeOneTimeSecret) throw new TypeError('A durable database is required');
  return {
    async issue({ account = null, kind, label = null, value, ttlMs = 600000 }) {
      if (!kind || typeof kind !== 'string' || !Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 600000) {
        throw new TypeError('Invalid one-time secret request');
      }
      const id = randomUUID();
      const expiresAt = new Date(now() + ttlMs);
      const ciphertext = encryptSecret(value, `once:${account || 'global'}:${kind}:${id}`, env);
      await db.insertOneTimeSecret({ id, account, kind, label, ciphertext, expiresAt });
      return { id, expiresAt: expiresAt.toISOString() };
    },
    async reveal({ id, account = null }) {
      const row = await db.consumeOneTimeSecret({ id, account });
      if (!row) return null;
      return {
        kind: row.kind, label: row.label,
        value: decryptSecret(row.ciphertext,
          `once:${row.vercel_account || 'global'}:${row.kind}:${row.id}`, env)
      };
    }
  };
}
