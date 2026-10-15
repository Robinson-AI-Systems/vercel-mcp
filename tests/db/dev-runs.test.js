import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery}
  from '../../test/helpers/pg-neon-adapter.js';
let db;
const owner='acct_dev_fixture_A',other='acct_dev_fixture_B',id='run_20261014_abcdef1234';
beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw new Error('Local disposable Postgres required');
  const url=new URL(process.env.TEST_DATABASE_URL);
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))
    throw new Error('Refusing remote development run DB fixture');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db=createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
it('durably scopes runs, resources, collisions and cleanup results to one account',async()=>{
  const first=await db.createDevRun({id,account:owner,connection:'conn_one',
    description:'Synthetic static-site'});
  expect(first.created).toBe(true);
  expect((await db.createDevRun({id,account:owner,connection:'conn_one',
    description:'Synthetic static-site'})).created).toBe(false);
  await expect(db.createDevRun({id,account:other,connection:'conn_other',
    description:'Synthetic static-site'})).rejects.toThrow();
  expect(await db.getDevRun({id,account:other})).toBe(null);
  expect(await db.listDevRuns({account:other})).toEqual([]);
  expect(await db.addDevRunObject({account:owner,id,type:'deployment',
    objectId:'dpl_FAKE_DEV_1',projectId:'prj_FAKE_DEV_1',detail:{target:'preview'}}))
    .toBe(true);
  await expect(db.addDevRunObject({account:owner,id,type:'deployment',
    objectId:'dpl_FAKE_DEV_1',projectId:'prj_FAKE_DEV_1'})).rejects.toThrow();
  await expect(db.addDevRunObject({account:other,id,type:'project',
    objectId:'prj_FAKE_DEV_1',projectId:'prj_FAKE_DEV_1'})).rejects.toThrow();
  expect(await db.listDevRunObjects({account:other,id})).toEqual([]);
  expect(await db.completeDevRunCleanup({account:owner,id})).toBe(false);
  expect(await db.setDevRunObjectOutcome({account:other,id,type:'deployment',
    objectId:'dpl_FAKE_DEV_1',status:'cleaned'})).toBe(false);
  expect(await db.setDevRunObjectOutcome({account:owner,id,type:'deployment',
    objectId:'dpl_FAKE_DEV_1',status:'blocked',error:'Expected preview refusal'})).toBe(true);
  expect(await db.completeDevRunCleanup({account:owner,id})).toBe(false);
  expect((await db.listDevRunObjects({account:owner,id}))[0].status).toBe('blocked');
  expect(await db.setDevRunObjectOutcome({account:owner,id,type:'deployment',
    objectId:'dpl_FAKE_DEV_1',status:'cleaned'})).toBe(true);
  expect(await db.completeDevRunCleanup({account:owner,id})).toBe(true);
  expect((await db.getDevRun({account:owner,id})).status).toBe('cleaned');
  await expect(db.addDevRunObject({account:owner,id,type:'project',
    objectId:'prj_FAKE_DEV_2',projectId:'prj_FAKE_DEV_2'})).rejects.toThrow();
});
it('makes ownership and uniqueness visible in the underlying database',async()=>{
  const rows=await rawQuery('SELECT object_type,object_id,status FROM dev_run_objects WHERE run_id=$1',[id]);
  expect(rows).toEqual([{object_type:'deployment',object_id:'dpl_FAKE_DEV_1',status:'cleaned'}]);
  const cross=await rawQuery('SELECT count(*)::integer AS n FROM dev_runs WHERE id=$1 AND vercel_account=$2',[id,other]);
  expect(cross[0].n).toBe(0);
});
