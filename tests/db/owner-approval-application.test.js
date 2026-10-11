import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createDb} from '../../src/db.js';
import {oneTimeSecrets} from '../../src/core/one-time-secrets.js';
import {consumeOwnerAccountChange,applyApprovedOwnerAccountChange} from '../../src/vercel/owner-approvals.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
let db;
const env={TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw Error('Disposable local Postgres only');
  await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts(id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES ('team_ALPHA','team_ALPHA','a','A','team','cipher_FAKE_a','1234'),('team_BETA','team_BETA','b','B','team','cipher_FAKE_b','5678')");
  await rawQuery("INSERT INTO oauth_tokens(token_hash,client_id,vercel_account,refresh_hash,kind,expires_at) VALUES ('hash_a1','a1','team_ALPHA','rh_a1','connector',now()+interval '1 day'),('hash_a2','a2','team_ALPHA','rh_a2','connector',now()+interval '1 day'),('hash_b1','b1','team_BETA','rh_b1','connector',now()+interval '1 day')");
});
afterAll(async()=>{await closeIsolatedSchema();});
const issue=async payload=>(await oneTimeSecrets({db,env}).issue({
  account:'team_ALPHA',kind:'owner_account_change',value:JSON.stringify(payload)
})).id;
const make=(action,data={})=>({version:1,issuerAccount:'team_ALPHA',action,
  targetAccount:null,connectionRef:null,limitCents:null,...data});
it('applies exact spent cents once using database atomic audit and preserves other tenant',async()=>{
  const id=await issue(make('spend',{limitCents:1125}));
  expect(await consumeOwnerAccountChange({db,env,account:'team_BETA',reference:id})).toBeNull();
  const payload=await consumeOwnerAccountChange({db,env,account:'team_ALPHA',reference:id});
  expect(payload.limitCents).toBe(1125);
  expect(await applyApprovedOwnerAccountChange({db,request:payload}))
    .toMatchObject({status:'applied',confirmed:true});
  expect(await consumeOwnerAccountChange({db,env,account:'team_ALPHA',reference:id})).toBeNull();
  expect((await rawQuery("SELECT id,spend_limit_cents FROM vercel_accounts ORDER BY id")))
    .toMatchObject([{id:'team_ALPHA',spend_limit_cents:1125},{id:'team_BETA',spend_limit_cents:0}]);
  const logs=await rawQuery("SELECT tool,vercel_account,summary FROM change_log WHERE tool='vercel_set_spend_limit'");
  expect(logs).toHaveLength(1);
  expect(JSON.stringify(logs)).not.toContain('cipher_FAKE');
});
it('applies default selection with audit and exact resulting default',async()=>{
  const id=await issue(make('default',{targetAccount:'team_BETA'}));
  const payload=await consumeOwnerAccountChange({db,env,account:'team_ALPHA',reference:id});
  expect(await applyApprovedOwnerAccountChange({db,request:payload}))
    .toMatchObject({status:'applied',confirmed:true});
  expect((await rawQuery("SELECT id FROM vercel_accounts WHERE is_default=TRUE")))
    .toMatchObject([{id:'team_BETA'}]);
});
it('last-active protected connector cannot be revoked; scoped exact ref can',async()=>{
  const ref=(await rawQuery("SELECT 'conn_' || LEFT(md5(token_hash),20) AS id FROM oauth_tokens WHERE client_id='a1'"))[0].id;
  const id=await issue(make('revoke',{connectionRef:ref}));
  const payload=await consumeOwnerAccountChange({db,env,account:'team_ALPHA',reference:id});
  expect(await applyApprovedOwnerAccountChange({db,request:payload}))
    .toMatchObject({status:'applied',confirmed:true});
  expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='a1'"))[0].revoked_at).not.toBeNull();
  const finalRef=(await rawQuery("SELECT 'conn_' || LEFT(md5(token_hash),20) AS id FROM oauth_tokens WHERE client_id='a2'"))[0].id;
  const fail=await applyApprovedOwnerAccountChange({db,request:make('revoke',{connectionRef:finalRef})});
  expect(fail).toMatchObject({status:'unverified',confirmed:false});
  expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='a2'"))[0].revoked_at).toBeNull();
});
