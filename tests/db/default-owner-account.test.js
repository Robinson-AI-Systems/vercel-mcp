import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery }
  from '../../test/helpers/pg-neon-adapter.js';

let db, schema;
const url=process.env.TEST_DATABASE_URL;
beforeAll(async()=>{
  if(!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname)) {
    throw new Error('Disposable localhost Postgres only');
  }
  schema=await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery(`INSERT INTO vercel_accounts
    (id,team_id,team_slug,label,scope,token_enc,token_last4)
    VALUES ('team_ALPHA','team_ALPHA','a','Alpha','team','ciphertext_FAKE_alpha','1234'),
           ('team_BETA','team_BETA','b','Beta','team','ciphertext_FAKE_beta','5678')`);
  await rawQuery(`INSERT INTO oauth_tokens(token_hash,vercel_account,mode,profile,listing,kind,expires_at)
    VALUES ('hash_FAKE_alpha','team_ALPHA','preview','read_only','compact','connector',now()+interval '1 day')`);
});
afterAll(async()=>{await closeIsolatedSchema();});
const defaults=()=>rawQuery('SELECT id,is_default,token_enc FROM vercel_accounts ORDER BY id');
const changes=()=>rawQuery("SELECT vercel_account,tool,summary,production,dry_run FROM change_log WHERE tool='vercel_set_default_account' ORDER BY id");
it('does not set a default, audit or touch bearer settings for a missing/invalid account',async()=>{
  expect(await db.setDefaultOwnerAccount('team_UNKNOWN')).toBe(false);
  await expect(db.setDefaultOwnerAccount('bad name')).rejects.toThrow();
  await expect(db.setDefaultOwnerAccount('')).rejects.toThrow();
  expect((await defaults()).every(x=>x.is_default===false)).toBe(true);
  expect(await changes()).toHaveLength(0);
  const bearer=await rawQuery('SELECT mode,profile,listing,revoked_at FROM oauth_tokens');
  expect(bearer).toMatchObject([{mode:'preview',profile:'read_only',listing:'compact',revoked_at:null}]);
});
it('selects exactly one default with a safe same-statement audit and no credential changes',async()=>{
  expect(await db.setDefaultOwnerAccount('team_ALPHA')).toBe(true);
  expect((await defaults()).map(x=>[x.id,x.is_default])).toEqual([
    ['team_ALPHA',true],['team_BETA',false]
  ]);
  expect((await changes())).toMatchObject([{
    vercel_account:'team_ALPHA',tool:'vercel_set_default_account',
    summary:'Owner selected default Vercel account',production:true,dry_run:false
  }]);
  const before=await defaults();
  expect(await db.setDefaultOwnerAccount('team_BETA')).toBe(true);
  expect((await defaults()).map(x=>[x.id,x.is_default])).toEqual([
    ['team_ALPHA',false],['team_BETA',true]
  ]);
  expect((await defaults()).map(x=>x.token_enc)).toEqual(before.map(x=>x.token_enc));
  expect(await changes()).toHaveLength(2);
  expect((await rawQuery('SELECT mode,profile,listing,revoked_at FROM oauth_tokens'))[0])
    .toMatchObject({mode:'preview',profile:'read_only',listing:'compact',revoked_at:null});
});
it('concurrent owner selections cannot produce two defaults or a defaultless table',async()=>{
  async function clientDb() {
    const c=new pg.Client({connectionString:url});
    await c.connect();
    await c.query('SET search_path TO "'+schema+'"');
    const query=async(strings,...values)=>{
      let text=strings[0];
      for(let i=0;i<values.length;i++)text+='$'+(i+1)+strings[i+1];
      return (await c.query(text,values)).rows;
    };
    return {c,db:createDb(query)};
  }
  const a=await clientDb(),b=await clientDb();
  try {
    const results=await Promise.allSettled([
      a.db.setDefaultOwnerAccount('team_ALPHA'),b.db.setDefaultOwnerAccount('team_BETA')
    ]);
    expect(results.some(r=>r.status==='fulfilled' && r.value===true)).toBe(true);
    const rows=await defaults();
    expect(rows.filter(x=>x.is_default)).toHaveLength(1);
    const audits=await changes();
    expect(audits).toHaveLength(2+results.filter(r=>r.status==='fulfilled' && r.value===true).length);
  } finally {await Promise.all([a.c.end(),b.c.end()]);}
});
