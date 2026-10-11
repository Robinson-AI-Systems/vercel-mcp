import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createDb} from '../../src/db.js';
import {oneTimeSecrets} from '../../src/core/one-time-secrets.js';
import {inspectOwnerAccountChange,consumeOwnerAccountChange} from '../../src/vercel/owner-approvals.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';

let db;
const env={TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw Error('Disposable local PostgreSQL only');
  await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
it('inspects encrypted account-scoped request repeatedly without consuming it',async()=>{
  const payload={version:1,issuerAccount:'team_ALPHA',action:'spend',
    targetAccount:null,connectionRef:null,limitCents:1125};
  const issued=await oneTimeSecrets({db,env}).issue({
    account:'team_ALPHA',kind:'owner_account_change',value:JSON.stringify(payload)
  });
  const stored=(await rawQuery("SELECT ciphertext FROM one_time_secrets WHERE id='"+issued.id+"'"))[0];
  expect(stored.ciphertext).not.toContain('1125');
  expect(await inspectOwnerAccountChange({db,env,account:'team_BETA',reference:issued.id})).toBeNull();
  expect(await inspectOwnerAccountChange({db,env,account:'team_ALPHA',reference:issued.id})).toEqual(payload);
  expect(await inspectOwnerAccountChange({db,env,account:'team_ALPHA',reference:issued.id})).toEqual(payload);
  expect(await consumeOwnerAccountChange({db,env,account:'team_ALPHA',reference:issued.id})).toEqual(payload);
  expect(await inspectOwnerAccountChange({db,env,account:'team_ALPHA',reference:issued.id})).toBeNull();
  expect(await consumeOwnerAccountChange({db,env,account:'team_ALPHA',reference:issued.id})).toBeNull();
});
it('refuses expired, invalid or mismatched references',async()=>{
  const issued=await oneTimeSecrets({db,env}).issue({
    account:'team_ALPHA',kind:'owner_account_change',
    value:JSON.stringify({version:1,issuerAccount:'team_ALPHA',action:'default',
      targetAccount:'team_BETA',connectionRef:null,limitCents:null})
  });
  await rawQuery("UPDATE one_time_secrets SET expires_at=now()-interval '1 minute' WHERE id='"+issued.id+"'");
  expect(await inspectOwnerAccountChange({db,env,account:'team_ALPHA',reference:issued.id})).toBeNull();
  await expect(db.getOwnerApprovalRequest({account:'team_ALPHA',reference:'bad'})).rejects.toThrow();
});
