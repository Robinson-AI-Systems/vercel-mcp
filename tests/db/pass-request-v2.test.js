// R-1W: pass-request payload v2 (write-capable scopes) at the database seam.
import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createDb} from '../../src/db.js';
import {requestPass,inspectPassRequest,consumePassRequest,writePassScope}
  from '../../src/vercel/pass-requests.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery}
  from '../../test/helpers/pg-neon-adapter.js';
let db;
const env={VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
beforeAll(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
   throw Error('Disposable local PostgreSQL only');
 await openIsolatedSchema(url);db=createDb(neonShapedQuery());await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
const readAreas=['server'],writeAreas=['server','deployments'];
it('round-trips a v2 write scope through inspect and one atomic consumption',async()=>{
 const account='team_ALPHA';
 const scope=writePassScope({writes:true,profile:'full',mode:'production',hours:48,
   areas:['deployments','server'],spendLimitCents:2500,projectIds:['prj_FAKEONE']},writeAreas);
 const receipt=await requestPass({db,env,account,scope});
 const opts={db,env,account,reference:receipt.reference,knownAreas:readAreas,knownWriteAreas:writeAreas};
 const intended={version:2,account,...scope};
 expect(await inspectPassRequest(opts)).toEqual(intended);
 expect(await inspectPassRequest(opts)).toEqual(intended);
 const stored=(await rawQuery("SELECT ciphertext FROM one_time_secrets WHERE id='"+receipt.reference+"'"))[0];
 expect(stored.ciphertext).not.toContain('deployments');
 const consumed=await Promise.all([consumePassRequest(opts),consumePassRequest(opts)]);
 expect(consumed.filter(Boolean)).toEqual([intended]);
 expect(await inspectPassRequest(opts)).toBeNull();
});
it('never decodes a write scope against read-only areas, and v1 stays v1',async()=>{
 const account='team_ALPHA';
 const scope=writePassScope({writes:true,areas:['deployments']},writeAreas);
 const receipt=await requestPass({db,env,account,scope});
 // Without the write-area list, the deployments area is unknown: refuse.
 expect(await inspectPassRequest({db,env,account,reference:receipt.reference,
   knownAreas:readAreas})).toBeNull();
 const readReceipt=await requestPass({db,env,account,
   scope:{mode:'preview',hours:24,areas:['server'],rateLimitPerMinute:120}});
 expect(await inspectPassRequest({db,env,account,reference:readReceipt.reference,
   knownAreas:readAreas,knownWriteAreas:writeAreas}))
   .toEqual({version:1,account,mode:'preview',hours:24,areas:['server'],rateLimitPerMinute:120});
});
it('writePassScope validates the delegated shape strictly',()=>{
 for(const bad of [
   {writes:false,areas:['server']},
   {areas:['server']},
   {writes:true},
   {writes:true,areas:['server'],mode:'test'},
   {writes:true,areas:['server'],profile:'read_only'},
   {writes:true,areas:['server'],spendLimitCents:-5},
   {writes:true,areas:['server'],projectIds:[]},
   {writes:true,areas:['server'],unknown:1}
 ])expect(()=>writePassScope(bad,writeAreas)).toThrow();
 expect(writePassScope({writes:true,areas:['server']},writeAreas)).toEqual({
   writes:true,profile:'everyday',mode:'preview',hours:24,areas:['server'],
   rateLimitPerMinute:120,spendLimitCents:0,projectIds:null});
});
