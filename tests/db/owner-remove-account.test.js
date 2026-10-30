import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {createDb} from '../../src/db.js';
import {oneTimeSecrets} from '../../src/core/one-time-secrets.js';
import {consumeOwnerAccountChange,applyApprovedOwnerAccountChange} from '../../src/vercel/owner-approvals.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
let db,schema;
const url=process.env.TEST_DATABASE_URL;
const env={TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
beforeAll(async()=>{
  if(!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw new Error('Disposable localhost Postgres only');
  schema=await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts(id,team_id,team_slug,label,scope,token_enc,token_last4,is_default) VALUES "+
    "('team_A','team_A','a','A','team','cipher_FAKE_a','1111',TRUE),"+
    "('team_B','team_B','b','B','team','cipher_FAKE_b','2222',FALSE),"+
    "('team_C','team_C','c','C','team','cipher_FAKE_c','3333',FALSE)");
  await rawQuery("INSERT INTO oauth_tokens(token_hash,client_id,vercel_account,refresh_hash,kind,expires_at) VALUES "+
    "('hash_a1','a1','team_A','rh_a1','connector',now()+interval '1 day'),"+
    "('hash_a2','a2','team_A','rh_a2','connector',now()+interval '1 day'),"+
    "('hash_b1','b1','team_B','rh_b1','connector',now()+interval '1 day'),"+
    "('hash_c1','c1','team_C','rh_c1','connector',now()+interval '1 day')");
  await rawQuery("INSERT INTO rtc_passes(pass_id,token_hash,vercel_account,areas,expires_at) VALUES "+
    "('pass_FAKE_a','passhash_FAKE_a','team_A','[]'::jsonb,now()+interval '1 day')");
  await rawQuery("INSERT INTO oauth_codes(code,client_id,data,vercel_account,expires_at) VALUES "+
    "('code_FAKE_a','ca','{}'::jsonb,'team_A',now()+interval '10 minutes')");
  await rawQuery("INSERT INTO pending_inputs(id,vercel_account,kind,label,ciphertext,expires_at) VALUES "+
    "('input_FAKE_a','team_A','env','Fixture input','cipher_FAKE_input',now()+interval '10 minutes')");
  await rawQuery("INSERT INTO one_time_secrets(id,vercel_account,kind,ciphertext,expires_at) VALUES "+
    "('11111111-2222-3333-4444-555555555555','team_A','rtc_pass_request','cipher_FAKE_secret',now()+interval '10 minutes')");
  await rawQuery("INSERT INTO protected_resources(vercel_account,kind,match,note,source) VALUES "+
    "('team_A','project','proj_FAKE_a','fixture','owner'),(NULL,'project','proj_GLOBAL','fixture','default')");
  await rawQuery("INSERT INTO purchase_intents(id,vercel_account,operation,request_key,fingerprint,pricing_source,expires_at) VALUES "+
    "('intent_FAKE_a','team_A','domain_purchase','rk_FAKE_a','fp_FAKE','fixture',now()+interval '1 day')");
  await rawQuery("INSERT INTO change_log(vercel_account,tool,summary) VALUES "+
    "('team_A','vercel_test_prior','prior history entry')");
});
afterAll(async()=>{await closeIsolatedSchema();});
const auditRows=()=>rawQuery("SELECT vercel_account,tool,summary,after FROM change_log WHERE tool='vercel_remove_account'");
const issue=async payload=>(await oneTimeSecrets({db,env}).issue({
  account:payload.issuerAccount,kind:'owner_account_change',value:JSON.stringify(payload)
})).id;
const make=(issuer,action,data={})=>({version:1,issuerAccount:issuer,action,
  targetAccount:null,connectionRef:null,limitCents:null,...data});
it('reports exact removal facts per account and rejects bad ids',async()=>{
  expect(await db.getAccountRemovalFacts('team_A')).toMatchObject({
    label:'A',scope:'team',is_default:true,account_count:3,live_tokens:2,
    live_passes:1,pending_codes:1,pending_inputs:1,pending_secrets:1,protections:1});
  expect(await db.getAccountRemovalFacts('team_B')).toMatchObject({
    label:'B',is_default:false,live_tokens:1,live_passes:0,protections:0});
  expect(await db.getAccountRemovalFacts('team_NOPE')).toBeNull();
  await expect(db.getAccountRemovalFacts('x')).rejects.toThrow();
  await expect(db.removeOwnerAccount('x')).rejects.toThrow();
  await expect(db.removeOwnerAccount(42)).rejects.toThrow();
  expect(await db.removeOwnerAccount('team_NOPE')).toBe('missing');
});
it('removes exactly the target row, revokes its tokens and audits the counts',async()=>{
  expect(await db.removeOwnerAccount('team_B')).toBe('removed');
  expect(await db.removeOwnerAccount('team_B')).toBe('missing');
  expect((await rawQuery("SELECT id FROM vercel_accounts ORDER BY id")).map(r=>r.id))
    .toEqual(['team_A','team_C']);
  // Tokens are revoked, not deleted: the rows (and their conn_ ids) survive.
  const b1=await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='b1'");
  expect(b1).toHaveLength(1);
  expect(b1[0].revoked_at).not.toBeNull();
  expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='a1'"))[0].revoked_at).toBeNull();
  const logs=await auditRows();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({vercel_account:'team_B',tool:'vercel_remove_account'});
  expect(logs[0].after).toMatchObject({tokensRevoked:1,passesRevoked:0,wasDefault:false});
  expect(JSON.stringify(logs)).not.toContain('cipher_FAKE');
  expect(JSON.stringify(logs)).not.toContain('hash_b1');
});
it('refuses the default account while others remain, then removes it with the full cascade once the default moves',async()=>{
  expect(await db.removeOwnerAccount('team_A')).toBe('is_default');
  expect((await rawQuery("SELECT id FROM vercel_accounts WHERE id='team_A'"))).toHaveLength(1);
  expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='a1'"))[0].revoked_at).toBeNull();
  expect(await auditRows()).toHaveLength(1);
  expect(await db.setDefaultOwnerAccount('team_C')).toBe(true);
  expect(await db.removeOwnerAccount('team_A')).toBe('removed');
  expect((await rawQuery("SELECT id FROM vercel_accounts ORDER BY id")).map(r=>r.id)).toEqual(['team_C']);
  for(const client of ['a1','a2']){
    expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='"+client+"'"))[0].revoked_at).not.toBeNull();
  }
  expect((await rawQuery("SELECT revoked_at FROM rtc_passes WHERE pass_id='pass_FAKE_a'"))[0].revoked_at).not.toBeNull();
  expect(await rawQuery("SELECT code FROM oauth_codes WHERE vercel_account='team_A'")).toHaveLength(0);
  expect(await rawQuery("SELECT id FROM pending_inputs WHERE vercel_account='team_A'")).toHaveLength(0);
  expect(await rawQuery("SELECT id FROM one_time_secrets WHERE vercel_account='team_A'")).toHaveLength(0);
  expect(await rawQuery("SELECT id FROM protected_resources WHERE vercel_account='team_A'")).toHaveLength(0);
  // Retained by design: the global protection, the purchase ledger, prior history.
  expect(await rawQuery("SELECT id FROM protected_resources WHERE vercel_account IS NULL")).toHaveLength(1);
  expect(await rawQuery("SELECT id FROM purchase_intents WHERE vercel_account='team_A'")).toHaveLength(1);
  expect(await rawQuery("SELECT id FROM change_log WHERE vercel_account='team_A' AND tool='vercel_test_prior'")).toHaveLength(1);
  const logs=(await auditRows()).filter(r=>r.vercel_account==='team_A');
  expect(logs).toHaveLength(1);
  expect(logs[0].after).toMatchObject({tokensRevoked:2,passesRevoked:1,codesDeleted:1,
    pendingInputsDeleted:1,pendingSecretsDeleted:1,protectionsDeleted:1,wasDefault:false});
  expect(JSON.stringify(logs)).not.toContain('cipher_FAKE');
});
it('applies a remove envelope end-to-end, rejects tampered envelopes, and removes the sole default account',async()=>{
  const tampered=await issue(make('team_C','remove',{targetAccount:null}));
  expect(await consumeOwnerAccountChange({db,env,account:'team_C',reference:tampered})).toBeNull();
  const wrongKind=await issue(make('team_C','remove',{targetAccount:'team_C',connectionRef:'conn_0123456789abcdef0123'}));
  expect(await consumeOwnerAccountChange({db,env,account:'team_C',reference:wrongKind})).toBeNull();
  const id=await issue(make('team_C','remove',{targetAccount:'team_C'}));
  expect(await consumeOwnerAccountChange({db,env,account:'team_A',reference:id})).toBeNull();
  const payload=await consumeOwnerAccountChange({db,env,account:'team_C',reference:id});
  expect(payload).toMatchObject({action:'remove',targetAccount:'team_C'});
  expect(await applyApprovedOwnerAccountChange({db,request:payload}))
    .toMatchObject({status:'applied',confirmed:true});
  expect(await rawQuery('SELECT id FROM vercel_accounts')).toHaveLength(0);
  expect((await rawQuery("SELECT revoked_at FROM oauth_tokens WHERE client_id='c1'"))[0].revoked_at).not.toBeNull();
  // A fresh request against the now-missing target refuses at apply.
  expect(await applyApprovedOwnerAccountChange({db,request:make('team_C','remove',{targetAccount:'team_C'})}))
    .toMatchObject({status:'refused',confirmed:false});
});
it('concurrent removals serialize: exactly one removes, exactly one audit row',async()=>{
  await rawQuery("INSERT INTO vercel_accounts(id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES "+
    "('team_X','team_X','x','X','team','cipher_FAKE_x','4444'),('team_Y','team_Y','y','Y','team','cipher_FAKE_y','5555')");
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
  const a=await client(),b=await client();
  try{
    const results=await Promise.all([a.db.removeOwnerAccount('team_X'),
      b.db.removeOwnerAccount('team_X')]);
    expect(results.sort()).toEqual(['missing','removed']);
    expect((await auditRows()).filter(r=>r.vercel_account==='team_X')).toHaveLength(1);
    expect((await rawQuery("SELECT id FROM vercel_accounts WHERE id='team_Y'"))).toHaveLength(1);
  } finally {await Promise.all([a.c.end(),b.c.end()]);}
});
