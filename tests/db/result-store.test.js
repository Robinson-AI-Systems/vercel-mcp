import {afterAll,beforeAll,expect,it} from 'vitest';
import {createDb} from '../../src/db.js';
import {closeIsolatedSchema,neonShapedQuery,openIsolatedSchema,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
let db;
const a='resown_'+'a'.repeat(64),b='resown_'+'b'.repeat(64);
beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL required');
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))
    throw new Error('Only disposable Postgres');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db=createDb(neonShapedQuery());await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema()});
it('sanitizes storage and isolates same-team bearers and foreign teams',async()=>{
  const issued=await db.putResult({account:'team_ALPHA',owner:a,summary:'Two records',
    body:{rows:[{id:'fixture',token:'vcp_FAKE_hidden'},{password:'FAKE_PASS'}]}});
  expect(issued.handle).toMatch(/^res_[a-f0-9]{32}$/);
  const own=await db.getResult({account:'team_ALPHA',owner:a,handle:issued.handle});
  expect(own.summary).toBe('Two records');
  expect(own.body.rows[0].token).toBe('[hidden]');
  expect(own.body.rows[1].password).toBe('[hidden]');
  expect(JSON.stringify(await rawQuery('SELECT body FROM result_store'))).not.toContain('vcp_FAKE_hidden');
  expect(await db.getResult({account:'team_ALPHA',owner:b,handle:issued.handle})).toBeNull();
  expect(await db.getResult({account:'team_BETA',owner:a,handle:issued.handle})).toBeNull();
  expect(await db.getResult({account:'team_ALPHA',owner:a,handle:'res_invalid'})).toBeNull();
});
it('expires and deletes at most 100 expired rows per read',async()=>{
  const issued=await db.putResult({account:'team_ALPHA',owner:a,body:{ok:true}});
  await rawQuery("UPDATE result_store SET expires_at=now()-interval '1 minute' WHERE handle=$1",[issued.handle]);
  for(let i=0;i<120;i++)
    await rawQuery("INSERT INTO result_store(handle,connection,vercel_account,expires_at,body) VALUES($1,$2,$3,now()-interval '1 day','{}'::jsonb)",
      ['res_'+i.toString(16).padStart(32,'0'),a,'team_ALPHA']);
  expect(await db.getResult({account:'team_ALPHA',owner:a,handle:issued.handle})).toBeNull();
  const rows=await rawQuery("SELECT count(*)::integer AS n FROM result_store WHERE expires_at<now()");
  expect(rows[0].n).toBe(21);
});
it('refuses malformed ownership, excessive TTL and oversized contents',async()=>{
  await expect(db.putResult({account:'team_ALPHA',owner:'forged',body:{}})).rejects.toThrow();
  await expect(db.putResult({account:'team_ALPHA',owner:a,body:{},ttlMs:86400001})).rejects.toThrow();
  await expect(db.putResult({account:'team_ALPHA',owner:a,body:{message:'x'.repeat(1048577)}})).rejects.toThrow();
});
