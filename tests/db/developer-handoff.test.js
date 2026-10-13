import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {openIsolatedSchema,closeIsolatedSchema,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
import {handoffStore,HANDOFF_SCHEMA} from '../../src/developer/handoff-store.js';
let store;
const state='s'.repeat(43),hash='b'.repeat(64);
const input=()=>({state,client_id:'developer_test_client',challenge:'c'.repeat(43),poll_hash:hash,public_key:'FAKE_PUBLIC_KEY',ip:'a'.repeat(64),expires:new Date(Date.now()+600000)});
beforeAll(async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);
 if(!['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname))throw Error('Only isolated localhost Postgres is permitted');
 await openIsolatedSchema(url.href);await rawQuery(HANDOFF_SCHEMA);store=handoffStore(rawQuery);
});
afterAll(async()=>{await closeIsolatedSchema();});
describe('developer OAuth handoff persistence',()=>{
 it('atomically allows only one pending request per client',async()=>{
  const results=await Promise.all([store.start(input()),store.start({...input(),state:'t'.repeat(43)})]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await rawQuery('SELECT count(*)::int AS count FROM developer_oauth_handoffs'))[0].count).toBe(1);
 });
 it('retains only sealed callback data and binds delivery to the polling hash',async()=>{
  const row=(await rawQuery('SELECT * FROM developer_oauth_handoffs'))[0];
  expect(await store.approve(row.state,'FAKE_SEALED_CODE')).toBe(true);expect(await store.approve(row.state,'OTHER')).toBe(false);
  expect(await store.poll(row.state,'wrong')).toBe(null);
  const delivered=await Promise.all([store.poll(row.state,hash),store.poll(row.state,hash)]);
  expect(delivered.filter(Boolean)).toHaveLength(1);expect(delivered.find(Boolean)).toEqual({status:'authorized',sealed_code:'FAKE_SEALED_CODE'});
  expect(await store.start({...input(),state:'n'.repeat(43)})).toBe(true);
 });
 it('refuses expired requests and permits a new request after expiry',async()=>{
  await rawQuery("UPDATE developer_oauth_handoffs SET expires_at=now()-interval '1 second'");
  expect(await store.find('n'.repeat(43))).toBe(null);expect(await store.poll('n'.repeat(43),hash)).toBe(null);
  expect(await store.start({...input(),state:'z'.repeat(43)})).toBe(true);
 });
});
