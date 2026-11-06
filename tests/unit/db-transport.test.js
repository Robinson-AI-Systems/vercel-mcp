import { describe, it, expect } from 'vitest';
import {
  isNeonStoreUrl, selectStoreTransport, storeSql, pgStoreSql,
} from '../../src/db-transport.js';

// Store URLs are assembled at runtime: a literal credential-shaped
// URL in source is (correctly) refused by the repo's secrets check.
const pgUrl = (host) => {
  const u = new URL('postgres://placeholder/db');
  u.host = host;
  u.username = 'u';
  u.password = 'p';
  return u.toString();
};

// RACK-STAGING S-1: the own-store transport selection. The real query
// path against PostgreSQL is proven by tests/db/transport.test.js;
// these legs pin the selection rules and the handle contract without
// a server.
describe('own-store transport selection', () => {
  it('recognizes Neon endpoint hosts and nothing else', () => {
    expect(isNeonStoreUrl(pgUrl('ep-1.us-east-1.aws.neon.tech/db'))).toBe(true);
    expect(isNeonStoreUrl(pgUrl('ep-1.c-2.us-east-1.aws.neon.tech/db'))).toBe(true);
    expect(isNeonStoreUrl(pgUrl('localhost:5432/db'))).toBe(false);
    expect(isNeonStoreUrl(pgUrl('127.0.0.1:18781/db'))).toBe(false);
    expect(isNeonStoreUrl(pgUrl('neon.tech.evil.example/db'))).toBe(false);
    expect(isNeonStoreUrl('not a url')).toBe(false);
    expect(isNeonStoreUrl(undefined)).toBe(false);
  });

  it('lets an explicit STORE_TRANSPORT win, and validates it', () => {
    expect(selectStoreTransport({ STORE_TRANSPORT: 'pg', DATABASE_URL: pgUrl('x.neon.tech/db') })).toBe('pg');
    expect(selectStoreTransport({ STORE_TRANSPORT: 'neon', DATABASE_URL: pgUrl('localhost/db') })).toBe('neon');
    expect(selectStoreTransport({ STORE_TRANSPORT: ' PG ', DATABASE_URL: '' })).toBe('pg');
    expect(() => selectStoreTransport({ STORE_TRANSPORT: 'sqlite', DATABASE_URL: '' }))
      .toThrow(/STORE_TRANSPORT must be "neon" or "pg"/);
  });

  it('decides by hostname when nothing is declared', () => {
    expect(selectStoreTransport({ DATABASE_URL: pgUrl('ep-1.aws.neon.tech/db') })).toBe('neon');
    expect(selectStoreTransport({ DATABASE_URL: pgUrl('localhost:5432/db') })).toBe('pg');
    expect(selectStoreTransport({ DATABASE_URL: pgUrl('127.0.0.1:18781/db') })).toBe('pg');
  });

  it('throws the store configuration error when DATABASE_URL is absent', () => {
    expect(() => storeSql({})).toThrow('DATABASE_URL is not configured. Set DATABASE_URL before using the database.');
    expect(() => storeSql({ DATABASE_URL: '' })).toThrow(/DATABASE_URL is not configured/);
  });

  it('builds the pg handle contract without connecting', async () => {
    const sql = pgStoreSql(pgUrl('127.0.0.1:9/db'));
    expect(typeof sql).toBe('function');
    expect(typeof sql.query).toBe('function');
    expect(typeof sql.end).toBe('function');
    // Same URL, same shared pool entry: a second handle is a new
    // function over the same pool, and ending is idempotent.
    const again = pgStoreSql(pgUrl('127.0.0.1:9/db'));
    expect(again).not.toBe(sql);
    await sql.end();
    await again.end();
  });

  it('selects the neon handle for a Neon URL without connecting', () => {
    const sql = storeSql({ DATABASE_URL: pgUrl('ep-1.aws.neon.tech/db') });
    expect(typeof sql).toBe('function');
  });
});
