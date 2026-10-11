import {afterAll,beforeAll,expect,it} from 'vitest';
import pg from 'pg';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
let db,schema;
const url=process.env.TEST_DATABASE_URL;
beforeAll(async()=>{
  if(!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw new Error('Disposable localhost Postgres only');
  schema=await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts(id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES ('team_A','team_A','a','A','team','cipher_FAKE_a','1234'),('team_B','team_B','b','B','team','cipher_FAKE_b','5678')");
  await rawQuery("INSERT INTO oauth_tokens(token_hash,client_id,vercel_account,refresh_hash,kind,expires_at) VALUES ('hash_a1','a1','team_A','rh_a1','connector',now()+interval '1 day'),('hash_a2','a2','team_A','rh_a2','connector',now()+interval '1 day'),('hash_b1','b1','team_B','rh_b1','connector',now()+interval '1 day')");
});
afterAll(async()=>{await closeIsolatedSchema();});
const ref=async client=>(await rawQuery("SELECT 'conn_' || LEFT(md5(token_hash),20) AS ref FROM oauth_tokens WHERE client_id='"+client+"'"))[0].ref;
const logs=()=>rawQuery("SELECT vercel_account,tool,summary FROM change_log WHERE tool='vercel_revoke_connection'");
it('rejects invalid, cross-account, stale and last-active selectors without audit',async()=>{
  const a=await ref('a1'),b=await ref('b1');
  for(const invalid of ['','conn_abc','conn_'+ 'z'.repeat(20)]){
    await expect(db.revokeOwnerConnection({account:'team_A',connectionId:invalid})).rejects.toThrow();
  }
  expect(await db.revokeOwnerConnection({account:'team_A',connectionId:b})).toBe(false);
  expect(await db.revokeOwnerConnection({account:'team_B',connectionId:b})).toBe(false);
  expect(await db.revokeOwnerConnection({account:'team_A',connectionId:'conn_'+'0'.repeat(20)})).toBe(false);
  expect(await logs()).toHaveLength(0);
  expect(a).toMatch(/^conn_[a-f0-9]{20}$/);
});
it('revokes exactly one row and audits safely without changing server credential',async()=>{
  const before=await rawQuery('SELECT id,token_enc,production_enabled,spend_limit_cents FROM vercel_accounts ORDER BY id');
  const a=await ref('a1');
  expect(await db.revokeOwnerConnection({account:'team_A',connectionId:a})).toBe(true);
  expect(await db.revokeOwnerConnection({account:'team_A',connectionId:a})).toBe(false);
  expect(await db.revokeOwnerConnection({account:'team_A',connectionId:await ref('a2')})).toBe(false);
  expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='a1'"))[0].revoked_at).not.toBeNull();
  expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='a2'"))[0].revoked_at).toBeNull();
  expect(await rawQuery('SELECT id,token_enc,production_enabled,spend_limit_cents FROM vercel_accounts ORDER BY id')).toEqual(before);
  expect(await logs()).toMatchObject([{vercel_account:'team_A',tool:'vercel_revoke_connection'}]);
  expect(JSON.stringify(await logs())).not.toContain('hash_a1');
});
it('refresh changes opaque identifier and cannot be revoked by stale ID',async()=>{
  await db.createAccessToken({accessToken:'access_FAKE_old',refreshToken:'refresh_FAKE_old',
    clientId:'rotation',vercelAccount:'team_A'});
  const old=await ref('rotation');
  expect(await db.rotateRefreshToken({refreshToken:'refresh_FAKE_old',clientId:'rotation',
    accessToken:'access_FAKE_new',newRefreshToken:'refresh_FAKE_new'})).not.toBeNull();
  expect(await db.revokeOwnerConnection({account:'team_A',connectionId:old})).toBe(false);
  const current=await ref('rotation');
  expect(current).not.toBe(old);
  expect(await db.revokeOwnerConnection({account:'team_A',connectionId:current})).toBe(true);
  expect(await db.getTokenByRefreshToken('refresh_FAKE_new')).toBeNull();
  expect(await db.getAccessToken('access_FAKE_new')).toBeNull();
});
it('concurrent revocations serialize and leave one account connector',async()=>{
  await db.createAccessToken({accessToken:'access_FAKE_extra',refreshToken:'refresh_FAKE_extra',
    clientId:'extra',vercelAccount:'team_B'});
  const b1=await ref('b1'),b2=await ref('extra');
  const client=async()=>{
    const c=new pg.Client({connectionString:url});
    await c.connect();
    await c.query('SET search_path TO "'+schema+'"');
    const query=async(strings,...values)=>{
      let text=strings[0];
      for(let i=0;i<values.length;i++)text+='$'+(i+1)+strings[i+1];
      return (await c.query(text,values)).rows;
    };
    return {c,db:createDb(query)};
  };
  const x=await client(),y=await client();
  try{
    const results=await Promise.all([x.db.revokeOwnerConnection({account:'team_B',connectionId:b1}),
      y.db.revokeOwnerConnection({account:'team_B',connectionId:b2})]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const alive=await rawQuery("SELECT count(*)::int AS n FROM oauth_tokens WHERE vercel_account='team_B' AND revoked_at IS NULL");
    expect(alive[0].n).toBe(1);
  } finally {await Promise.all([x.c.end(),y.c.end()]);}
});
