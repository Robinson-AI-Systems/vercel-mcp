// Copied from Robinson-AI-Systems/stripe-mcp test/helpers/fake-db.js @ 6cb3f64 (A-1 form; extended for Vercel MCP schema).
import { SCHEMA_TABLES } from '../../src/db.js';

export function createFakeDb() {
  const rows = new Map();
  const tables = new Set();
  return {
    async initSchema() {
      for (const table of SCHEMA_TABLES) tables.add(table);
    },
    listTables() { return [...tables].sort(); },
    async put(key, value) { rows.set(key, structuredClone(value)); },
    async get(key) { return rows.has(key) ? structuredClone(rows.get(key)) : null; }
  };
}
