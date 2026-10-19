import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createDb} from '../../src/db.js';
import {requestPass,inspectPassRequest,consumePassRequest} from '../../src/vercel/pass-requests.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
let db;
const env={VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
beforeAll(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))throw Error('Disposable local PostgreSQL only');
 await openIsolatedSchema(url);db=createDb(neonShapedQuery());await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
it('keeps exact pass proposal encrypted, account-scoped, non-consuming until one atomic consumption',async()=>{
 const account='team_ALPHA',scope={mode:'test',hours:1,areas:['server']};
 const receipt=await requestPass({db,env,account,scope});
 const opts={db,env,account,reference:receipt.reference,knownAreas:['server','projects']};
 expect(await inspectPassRequest({...opts,account:'team_OTHER'})).toBeNull();
 const intended={version:1,account,...scope,rateLimitPerMinute:120};
 expect(await inspectPassRequest(opts)).toEqual(intended);expect(await inspectPassRequest(opts)).toEqual(intended);
 const stored=(await rawQuery("SELECT ciphertext FROM one_time_secrets WHERE id='"+receipt.reference+"'"))[0];
 expect(stored.ciphertext).not.toContain('server');
 const consumed=await Promise.all([consumePassRequest(opts),consumePassRequest(opts)]);
 expect(consumed.filter(Boolean)).toEqual([intended]);expect(await inspectPassRequest(opts)).toBeNull();
});
it('refuses expired proposals and never confuses another secret kind with a pass request',async()=>{
 const account='team_ALPHA',receipt=await requestPass({db,env,account,scope:{mode:'preview',hours:24,areas:['server']}});
 const opts={db,env,account,reference:receipt.reference,knownAreas:['server']};
 await rawQuery("UPDATE one_time_secrets SET expires_at=now()-interval '1 minute' WHERE id='"+receipt.reference+"'");
 expect(await inspectPassRequest(opts)).toBeNull();expect(await consumePassRequest(opts)).toBeNull();
 const other=await requestPass({db,env,account,scope:{mode:'test',hours:1,areas:['server']}});
 await rawQuery("UPDATE one_time_secrets SET kind='rtc_pass' WHERE id='"+other.reference+"'");
 expect(await inspectPassRequest({...opts,reference:other.reference})).toBeNull();
 await expect(db.getRtcPassRequest({account,reference:'not-a-reference'})).rejects.toThrow();
});
