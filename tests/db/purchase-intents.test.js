import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery}
  from '../../test/helpers/pg-neon-adapter.js';
let db;
beforeAll(async()=>{
  const u=process.env.TEST_DATABASE_URL;
  if(!u||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(u).hostname))
    throw new Error('Disposable localhost PostgreSQL required');
  await openIsolatedSchema(u);
  db=createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO vercel_accounts (id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES ('team_FAKE','team_FAKE','fake','Fake','team','FAKE','FAKE')");
});
afterAll(async()=>closeIsolatedSchema());
const request={account:'team_FAKE',operation:'vercel_project_create',
  requestKey:'rmcp_scoped_'+'a'.repeat(64),fingerprint:'b'.repeat(64),
  priceCents:2000,pricingSource:'provider_quote'};
describe('IN-08 purchase intent ledger',()=>{
  it('refuses unregistered accounts, mismatched payloads and unauthorized consumption',async()=>{
    expect(await db.requestPurchaseIntent({...request,account:'team_UNKNOWN'})).toBeNull();
    const issued=await db.requestPurchaseIntent(request);
    expect(issued.status).toBe('pending');
    expect((await db.requestPurchaseIntent({...request,fingerprint:'c'.repeat(64)}))).toBeNull();
    expect(await db.consumePurchaseIntent({...request,reference:issued.reference})).toBe(false);
    expect(await db.approvePurchaseIntent({account:request.account,reference:issued.reference,
      ceilingCents:1999})).toBe(false);
    expect(await db.approvePurchaseIntent({account:request.account,reference:issued.reference,
      ceilingCents:2000})).toBe(true);
    expect(await db.approvePurchaseIntent({account:request.account,reference:issued.reference,
      ceilingCents:2000})).toBe(false);
    expect(await db.consumePurchaseIntent({...request,reference:issued.reference,
      fingerprint:'c'.repeat(64)})).toBe(false);
    expect(await db.consumePurchaseIntent({...request,reference:issued.reference,
      priceCents:1000})).toBe(false);
    expect(await db.consumePurchaseIntent({...request,reference:issued.reference})).toBe(true);
    expect(await db.consumePurchaseIntent({...request,reference:issued.reference})).toBe(false);
    expect((await db.getPurchaseIntent({account:request.account,reference:issued.reference})).status)
      .toBe('consumed');
  });
  it('requires a separate acknowledged one-use variable charge risk exclusively for bounded Sandbox create',async()=>{
    const unsafe=await db.requestPurchaseIntent({...request,
      requestKey:'rmcp_scoped_'+'d'.repeat(64),priceCents:null,pricingSource:'metered'});
    expect(unsafe.status).toBe('pending');
    expect(await db.approvePurchaseIntent({account:request.account,
      reference:unsafe.reference,ceilingCents:1000,acknowledgeUnbounded:true})).toBe(false);
    expect(await db.approvePurchaseIntent({account:request.account,
      reference:unsafe.reference,ceilingCents:1000})).toBe(false);
    const metered={...request,operation:'vercel_dev_sandbox_create',
      requestKey:'rmcp_scoped_'+'e'.repeat(64),priceCents:null,pricingSource:'metered'};
    const intent=await db.requestPurchaseIntent(metered);
    expect(intent.status).toBe('pending');
    expect(await db.consumePurchaseIntent({...metered,reference:intent.reference})).toBe(false);
    expect(await db.approvePurchaseIntent({account:request.account,
      reference:intent.reference,ceilingCents:1000})).toBe(false);
    expect(await db.approvePurchaseIntent({account:request.account,
      reference:intent.reference,ceilingCents:1000,acknowledgeUnbounded:true})).toBe(true);
    const stored=await db.getPurchaseIntent({account:request.account,reference:intent.reference});
    expect(stored).toMatchObject({status:'approved',allow_unbounded_metered:true});
    expect(await db.consumePurchaseIntent({...metered,reference:intent.reference,
      fingerprint:'c'.repeat(64)})).toBe(false);
    expect(await db.consumePurchaseIntent({...metered,reference:intent.reference})).toBe(true);
    expect(await db.consumePurchaseIntent({...metered,reference:intent.reference})).toBe(false);
    expect(await db.getPurchaseIntent({account:'team_OTHER',reference:intent.reference})).toBeNull();
  });
});
