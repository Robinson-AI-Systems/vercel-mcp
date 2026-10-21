import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {hashToken} from '../../src/core/oauth.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
import {runOAuthRevocationContract} from '../../test/contract/oauth-revocation-contract.js';
let db;
beforeAll(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))
  throw Error('Disposable localhost PostgreSQL required');
 await openIsolatedSchema(url);
 db=createDb(neonShapedQuery());await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
runOAuthRevocationContract('real PostgreSQL',()=>db,{allowBasic:false});
it('cannot revoke an RTC pass through the OAuth connector door',async()=>{
 await rawQuery("INSERT INTO oauth_tokens(token_hash,refresh_hash,client_id,kind) VALUES($1,$2,$3,'pass')",
  [hashToken('FAKE-rtc-pass'),hashToken('FAKE-rtc-refresh'),'FAKE-client']);
 expect(await db.revokeOAuthToken({token:'FAKE-rtc-pass',clientId:'FAKE-client'})).toBe(false);
 expect(await db.revokeOAuthToken({token:'FAKE-rtc-refresh',clientId:'FAKE-client'})).toBe(false);
 expect((await rawQuery('SELECT revoked_at FROM oauth_tokens WHERE token_hash=$1',
  [hashToken('FAKE-rtc-pass')]))[0].revoked_at).toBeNull();
});
