import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { PROTECTED_DEFAULTS } from '../../src/vercel/setup.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let db;
beforeAll(async () => {
  const u = process.env.TEST_DATABASE_URL;
  if (!u || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(u).hostname)) {
    throw new Error('Only disposable localhost PostgreSQL permitted');
  }
  await openIsolatedSchema(u);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => closeIsolatedSchema());

describe('protected-resource defaults and owner spend read', () => {
  it('seeds protections idempotently without deleting owner rules', async () => {
    await db.seedProtectedProjects(PROTECTED_DEFAULTS);
    await db.seedProtectedProjects(PROTECTED_DEFAULTS);
    const rows = await rawQuery(
      "SELECT match, source FROM protected_resources WHERE vercel_account IS NULL ORDER BY match"
    );
    expect(rows.map(r => r.match)).toEqual([...PROTECTED_DEFAULTS].sort());
    expect(rows.every(r => r.source === 'default')).toBe(true);
    await rawQuery(
      "INSERT INTO protected_resources (kind, match, source) VALUES ('project', 'owner-added', 'setup_page')"
    );
    await db.seedProtectedProjects(PROTECTED_DEFAULTS);
    const owner = await rawQuery("SELECT source FROM protected_resources WHERE match='owner-added'");
    expect(owner[0].source).toBe('setup_page');
  });
  it('reports daily spend only for selected account', async () => {
    expect(await db.getTodaySpendCents('team_FAKE')).toBe(0);
    await rawQuery(
      "INSERT INTO change_log (vercel_account,tool,summary,spend_cents) VALUES ('team_FAKE','fixture','fake',235)"
    );
    await rawQuery(
      "INSERT INTO change_log (vercel_account,tool,summary,spend_cents) VALUES ('team_OTHER','fixture','fake',999)"
    );
    expect(await db.getTodaySpendCents('team_FAKE')).toBe(235);
  });
});
