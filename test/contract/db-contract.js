// Copied from Robinson-AI-Systems/stripe-mcp test/contract/db-contract.js @ e2f90e8. Shared contract for a fake or a real database.
import { describe, expect, it } from 'vitest';

export function runDbContract(label, makeDb) {
  describe(`database contract: ${label}`, () => {
    it('persists and reads a value without altering the input', async () => {
      const db = await makeDb();
      const data = { n: 12, nested: { ok: true } };
      await db.put('id-1', data);
      data.nested.ok = false;
      expect(await db.get('id-1')).toEqual({ n: 12, nested: { ok: true } });
    });
    it('returns null for absent keys and replaces existing values', async () => {
      const db = await makeDb();
      expect(await db.get('missing')).toBeNull();
      await db.put('id-2', { status: 'old' });
      await db.put('id-2', { status: 'new' });
      expect(await db.get('id-2')).toEqual({ status: 'new' });
    });
  });
}
