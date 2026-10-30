// One-time encrypted inputs from the owner setup page to an authorized tool.
import { randomUUID } from 'node:crypto';
import { encryptSecret, decryptSecret } from './secret-box.js';

export const PENDING_KINDS = Object.freeze(['env_value', 'deploy_password', 'transfer_auth_code', 'registrar_contact']);

export function pendingInputs({ db, env = process.env, now = () => Date.now() }) {
  if (!db?.insertPendingInput || !db?.consumePendingInput) throw new TypeError('A durable database is required');
  return {
    async submit({ account, kind, label, value, ttlMs = 600000 }) {
      if (!account || !PENDING_KINDS.includes(kind) || !label ||
        !Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 600000) {
        throw new TypeError('Invalid pending input request');
      }
      const id = randomUUID();
      const expiresAt = new Date(now() + ttlMs);
      const ciphertext = encryptSecret(value, `pending:${account}:${kind}:${id}`, env);
      await db.insertPendingInput({ id, account, kind, label, ciphertext, expiresAt });
      return { id, kind, expiresAt: expiresAt.toISOString() };
    },
    async consume({ id, account, kind }) {
      if (!account || !PENDING_KINDS.includes(kind)) return null;
      const row = await db.consumePendingInput({ id, account, kind });
      if (!row) return null;
      return decryptSecret(row.ciphertext, `pending:${row.vercel_account}:${row.kind}:${row.id}`, env);
    }
  };
}
