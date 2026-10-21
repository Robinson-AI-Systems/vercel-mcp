import {createVercelLoginService} from '../../src/vercel/login.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {runOAuthRevocationContract} from '../../test/contract/oauth-revocation-contract.js';
import {createOAuthHandlers} from '../../src/core/oauth-handlers.js';
import {it,expect} from 'vitest';
runOAuthRevocationContract('fake store',()=>createFakeDb(),{allowBasic:false});
it('advertises and exposes the actual client revocation handler',()=>{
 const db=createFakeDb();
 const h=createOAuthHandlers({db,service:createVercelLoginService(db),env:{PUBLIC_BASE_URL:'https://mcp.example.test'}});
 const res={setHeader(){},status(){return this;},send(body){this.body=JSON.parse(body);return this;}};
 h.metadata({method:'GET'},res);
 expect(res.body.revocation_endpoint).toBe('https://mcp.example.test/api/oauth/revoke');
 expect(res.body.revocation_endpoint_auth_methods_supported).toEqual(res.body.token_endpoint_auth_methods_supported);
 expect(typeof h.revoke).toBe('function');
});
