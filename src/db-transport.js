// Own-store transport selection (RACK-STAGING S-1).
//
// One handle contract for every production caller (src/db.js's
// createDb default and api/developer/connect.js):
//   - callable as a tagged template — sql`... ${value} ...` — and
//     resolves to an array of row objects;
//   - sql.query(text, values) runs a parameterized statement and
//     resolves to an array of row objects;
//   - sql.end() releases the underlying resources (idempotent).
//
// Selection (selectStoreTransport):
//   1. An explicit STORE_TRANSPORT of "neon" or "pg" wins; any other
//      value is a configuration error and throws.
//   2. Otherwise the DATABASE_URL host decides: a Neon endpoint host
//      (*.neon.tech) keeps the Neon HTTP driver — the Vercel build's
//      behavior, identical to before this module existed — and any
//      other host (the Development Rack's plain PostgreSQL) uses
//      node-postgres.
// The Neon branch returns the driver's own handle untouched, so the
// hosted build's query path does not change. The pg branch shares one
// pool per connection string across every handle built for it, the
// way a serverless instance reuses one store across its modules.
import { neon } from '@neondatabase/serverless';
import pg from 'pg';

export function isNeonStoreUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const host = new URL(value).hostname;
    return host === 'neon.tech' || host.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

export function selectStoreTransport(env = process.env) {
  const declared = typeof env.STORE_TRANSPORT === 'string'
    ? env.STORE_TRANSPORT.trim().toLowerCase()
    : '';
  if (declared) {
    if (declared === 'neon' || declared === 'pg') return declared;
    throw new TypeError('STORE_TRANSPORT must be "neon" or "pg" when set.');
  }
  return isNeonStoreUrl(env.DATABASE_URL) ? 'neon' : 'pg';
}

const pools = new Map();

export function pgStoreSql(connectionString) {
  let entry = pools.get(connectionString);
  if (!entry) {
    entry = {
      pool: new pg.Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30_000,
      }),
      ended: false,
    };
    pools.set(connectionString, entry);
  }
  const sql = async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) {
      text += `$${i + 1}${strings[i + 1]}`;
    }
    return (await entry.pool.query(text, values)).rows;
  };
  sql.query = async (text, values) => (await entry.pool.query(text, values)).rows;
  sql.end = async () => {
    if (entry.ended) return;
    entry.ended = true;
    pools.delete(connectionString);
    await entry.pool.end();
  };
  return sql;
}

export function storeSql(env = process.env) {
  const url = env.DATABASE_URL;
  if (typeof url !== 'string' || !url) {
    throw new Error(
      'DATABASE_URL is not configured. Set DATABASE_URL before using the database.');
  }
  return selectStoreTransport(env) === 'neon' ? neon(url) : pgStoreSql(url);
}
