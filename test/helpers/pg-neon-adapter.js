// Copied from Robinson-AI-Systems/stripe-mcp test/helpers/pg-neon-adapter.js @ e2f90e8 (itself adapted from google-workspace-mcp).
import crypto from 'node:crypto';
import pg from 'pg';

let client = null;
let schema = null;

export async function openIsolatedSchema(connectionString) {
  if (client) throw new Error('An isolated schema is already open.');
  client = new pg.Client({ connectionString });
  try {
    await client.connect();
    schema = `vercel_mcp_test_${crypto.randomBytes(6).toString('hex')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    return schema;
  } catch (error) {
    await client.end().catch(() => {});
    client = null;
    schema = null;
    throw error;
  }
}

export async function closeIsolatedSchema() {
  if (!client) return;
  try {
    if (schema) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end();
    client = null;
    schema = null;
  }
}

export async function rawQuery(text, params = []) {
  if (!client) throw new Error('Open an isolated schema first.');
  return (await client.query(text, params)).rows;
}

export function neonShapedQuery() {
  return async (strings, ...values) => {
    let statement = strings[0];
    for (let i = 0; i < values.length; i++) statement += `$${i + 1}${strings[i + 1]}`;
    return rawQuery(statement, values);
  };
}
