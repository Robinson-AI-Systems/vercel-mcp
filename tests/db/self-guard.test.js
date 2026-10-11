import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery } from '../../test/helpers/pg-neon-adapter.js';
let db;
beforeAll(async()=>{const u=process.env.TEST_DATABASE_URL;if(!u||!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(u).hostname))throw Error('Disposable localhost database required');await openIsolatedSchema(u);db=createDb(neonShapedQuery());await db.initSchema();});
afterAll(async()=>closeIsolatedSchema());
describe('B-3 additive protected rules',()=>{
  it('adds safe owner rules without overwriting global defaults',async()=>{
    await db.seedProtectedProjects(['vercel-mcp','stripe-mcp']);
    await db.addProtectedResource({account:'team_FAKE',match:'fixture-app',note:'owner protected'});
    await db.addProtectedResource({account:'team_FAKE',match:'fixture-app',note:'should not overwrite'});
    const rows=await db.listProtectedResources('team_FAKE');
    expect(rows.filter(x=>x.match==='fixture-app')).toHaveLength(1);
    expect(rows.find(x=>x.match==='fixture-app').note).toBe('owner protected');
    expect(rows.some(x=>x.match==='stripe-mcp')).toBe(true);
    const other=await db.listProtectedResources('team_OTHER');
    expect(other.some(x=>x.match==='fixture-app')).toBe(false);
    expect(other.some(x=>x.match==='vercel-mcp')).toBe(true);
  });
  it('rejects malformed project names and keeps owner/global entries intact',async()=>{
    await expect(db.addProtectedResource({account:'team_FAKE',match:'../unsafe'})).rejects.toThrow();
    const count=await rawQuery("SELECT count(*)::integer AS n FROM protected_resources");
    expect(count[0].n).toBe(3);
  });
});
