// Copied from Robinson-AI-Systems/stripe-mcp test/helpers/fake-db.js @ 6cb3f64 (its A-1 form; no service tables).
// A-1's service-independent fake database; A-2 extends it with the real Vercel MCP schema (src/db.js).
export function createFakeDb() {
  const rows = new Map();
  return {
    async initSchema() {},
    async put(key, value) { rows.set(key, structuredClone(value)); },
    async get(key) { return rows.has(key) ? structuredClone(rows.get(key)) : null; }
  };
}
