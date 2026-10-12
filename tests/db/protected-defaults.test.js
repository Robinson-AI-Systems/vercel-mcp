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
    const oldDefaults=['vercel-mcp','stripe-mcp'];
    expect(PROTECTED_DEFAULTS).toEqual([]);
    await db.seedProtectedProjects(oldDefaults);
    await db.seedProtectedProjects(oldDefaults);
    const rows = await rawQuery(
      "SELECT match, source FROM protected_resources WHERE vercel_account IS NULL ORDER BY match"
    );
    expect(rows.map(r => r.match)).toEqual(oldDefaults.sort());
    expect(rows.every(r => r.source === 'default')).toBe(true);
    await rawQuery(
      "INSERT INTO protected_resources (kind, match, source) VALUES ('project', 'owner-added', 'setup_page')"
    );
    await db.seedProtectedProjects(oldDefaults);
    const owner = await rawQuery("SELECT source FROM protected_resources WHERE match='owner-added'");
    expect(owner[0].source).toBe('setup_page');
  });
  it('atomically clears old global and account project rules while retaining unrelated rules',async()=>{
    await rawQuery("INSERT INTO vercel_accounts (id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES ('team_FAKE','team_FAKE','fixture','Fixture','team','FAKE','FAKE')");
    await rawQuery("INSERT INTO protected_resources (vercel_account,kind,match,source) VALUES ('team_FAKE','project','only-team','setup_page')");
    await rawQuery("INSERT INTO protected_resources (vercel_account,kind,match,source) VALUES ('team_FAKE','token','tok_FAKE','setup_page')");
    expect(await db.clearProtectedProjectRules('team_FAKE')).toBe(true);
    const remainder=await db.listProtectedResources('team_FAKE');
    expect(remainder).toEqual(expect.arrayContaining([expect.objectContaining({kind:'token',match:'tok_FAKE'})]));
    expect(remainder.some(x=>x.kind==='project')).toBe(false);
    const audits=await rawQuery("SELECT tool FROM change_log WHERE tool='vercel_clear_project_protections'");
    expect(audits).toHaveLength(1);
    expect(await db.clearProtectedProjectRules('team_UNKNOWN')).toBe(false);
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
