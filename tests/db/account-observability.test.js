import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { closeIsolatedSchema, neonShapedQuery, openIsolatedSchema,
  rawQuery } from '../../test/helpers/pg-neon-adapter.js';

let db;
beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
  const url=new URL(process.env.TEST_DATABASE_URL);
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)) {
    throw new Error('Only disposable local Postgres can be used');
  }
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery([
    'INSERT INTO oauth_tokens(token_hash,client_id,vercel_account,mode,profile,listing,kind,expires_at)',
    'VALUES',
    "('hash_fixture_one','client_one','team_one','preview','read_only','catalog','connector',now()+interval '1 day'),",
    "('hash_fixture_two','client_two','team_two','preview','full','compact','connector',now()+interval '1 day'),",
    "('hash_fixture_revoked','client_revoked','team_one','preview','everyday','catalog','connector',now()+interval '1 day')"
  ].join(' '));
  await rawQuery("UPDATE oauth_tokens SET revoked_at=now() WHERE client_id='client_revoked'");
  await rawQuery([
    'INSERT INTO change_log(vercel_account,mode,tool,summary,dry_run,production)',
    'VALUES',
    "('team_one','preview','vercel_project_get','ordinary read',FALSE,FALSE),",
    "('team_one','preview','vercel_project_get','preview only',TRUE,FALSE),",
    "('team_one','production','vercel_other','different action',FALSE,TRUE),",
    "('team_two','production','vercel_project_get','other tenant secret',FALSE,TRUE)"
  ].join(' '));
});
afterAll(async()=>{await closeIsolatedSchema();});

it('returns scoped active connections without token hashes',async()=>{
  const rows=await db.listAccountConnections({account:'team_one'});
  expect(rows).toHaveLength(1);
  expect(rows[0].client_id).toBe('client_one');
  expect(rows[0].id).toMatch(/^conn_[a-f0-9]{20}$/);
  expect(JSON.stringify(rows)).not.toContain('hash_fixture_one');
  expect(JSON.stringify(rows)).not.toContain('token_hash');
  expect(await db.listAccountConnections({account:'team_two'})).toHaveLength(1);
  expect(await db.listAccountConnections({account:'team_one',includeRevoked:true})).toHaveLength(2);
  await expect(db.listAccountConnections({account:'team_one',limit:100})).rejects.toThrow();
});
it('filters audit by account and hides preview simulations unless requested',async()=>{
  const visible=await db.listRecentChanges({account:'team_one'});
  expect(visible).toHaveLength(2);
  expect(JSON.stringify(visible)).not.toContain('other tenant secret');
  expect(JSON.stringify(visible)).not.toContain('before');
  const all=await db.listRecentChanges({account:'team_one',includePreviews:true});
  expect(all).toHaveLength(3);
  const filtered=await db.listRecentChanges({account:'team_one',tool:'vercel_project_get',mode:'preview'});
  expect(filtered).toHaveLength(1);
  expect(filtered[0].summary).toBe('ordinary read');
  await expect(db.listRecentChanges({account:'team_one',tool:'DROP TABLE'})).rejects.toThrow();
  await expect(db.listRecentChanges({account:'team_one',since:'not-a-date'})).rejects.toThrow();
});
