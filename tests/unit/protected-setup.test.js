import { describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../../src/core/secret-box.js';
import { handleSetup } from '../../src/vercel/setup.js';
const env={ADMIN_PASSPHRASE:'fake-admin-passphrase',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex'),VERCEL_ENV:'preview'};
const csrf='a'.repeat(43);
const cookie='rmcp_owner='+encryptSecret(JSON.stringify({csrf,exp:Date.now()+600000}),'setup:session',env);
function response(){return {headers:{},statusCode:0,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},status(n){this.statusCode=n;return this;},send(x){this.body=x;return this;},json(x){this.body=JSON.stringify(x);return this;},end(){return this;}};}
function fixture(){
 let bad=0;
 const db={
  listVercelAccounts:async()=>[{id:'team_FAKE',label:'Fixture',scope:'team'}],
  addProtectedResource:vi.fn(async()=>{}),
  clearProtectedProjectRules:vi.fn(async()=>true),
  recordChange:vi.fn(async()=>1),
  recordLoginAttempt:async()=>1,
  countRecentFailedLogins:async()=>bad++,
  markLoginAttemptSucceeded:async()=>{}
 };
 const send=async(body,cookieValue=cookie)=>{
   const res=response();
   await handleSetup({method:'POST',headers:{cookie:cookieValue,'x-real-ip':'127.0.0.1'},body},res,{db,env});
   return res;
 };
 return {db,send};
}
describe('B-3 protected project setup editor',()=>{
 it('requires a fresh passphrase even under a valid owner session',async()=>{
   const f=fixture();
   const body={action:'add_protected',csrf,account:'team_FAKE',projectName:'protected-app'};
   expect((await f.send(body)).statusCode).toBe(401);
   expect((await f.send({...body,passphrase:'wrong'})).statusCode).toBe(401);
   expect(f.db.addProtectedResource).not.toHaveBeenCalled();
   expect((await f.send({...body,passphrase:env.ADMIN_PASSPHRASE},'')).statusCode).toBe(403);
   expect((await f.send({...body,csrf:'incorrect',passphrase:env.ADMIN_PASSPHRASE})).statusCode).toBe(403);
 });
 it('adds a team-scoped project rule and safe audit only after reauthentication',async()=>{
   const f=fixture();
   const response=await f.send({action:'add_protected',csrf,account:'team_FAKE',projectName:'protected-app',passphrase:env.ADMIN_PASSPHRASE});
   expect(response.statusCode).toBe(200);
   expect(f.db.addProtectedResource).toHaveBeenCalledWith({
     account:'team_FAKE',kind:'project',match:'protected-app',note:'Owner protected on setup'
   });
   expect(f.db.recordChange).toHaveBeenCalledOnce();
   expect(response.body).not.toContain(env.ADMIN_PASSPHRASE);
 });
 it('removes all project exclusions only with independent fresh owner approval',async()=>{
   const f=fixture();
   const request={action:'clear_protected',csrf,account:'team_FAKE',acknowledge:'remove-all'};
   for(const attempt of [
     request,{...request,passphrase:'wrong'},
     {...request,acknowledge:'yes',passphrase:env.ADMIN_PASSPHRASE},
     {...request,account:'team_OTHER',passphrase:env.ADMIN_PASSPHRASE}
   ]){
     expect((await f.send(attempt)).statusCode).not.toBe(200);
   }
   expect(f.db.clearProtectedProjectRules).not.toHaveBeenCalled();
   const approved=await f.send({...request,passphrase:env.ADMIN_PASSPHRASE});
   expect(approved.statusCode).toBe(200);
   expect(f.db.clearProtectedProjectRules).toHaveBeenCalledExactlyOnceWith('team_FAKE');
   expect(approved.body).not.toContain(env.ADMIN_PASSPHRASE);
   f.db.clearProtectedProjectRules.mockResolvedValue(false);
   expect((await f.send({...request,passphrase:env.ADMIN_PASSPHRASE})).statusCode).toBe(409);
 });
 it('rejects attempts to protect another unconfigured account',async()=>{
   const f=fixture();
   const result=await f.send({action:'add_protected',csrf,account:'team_UNKNOWN',projectName:'test-app',passphrase:env.ADMIN_PASSPHRASE});
   expect(result.statusCode).toBe(403);
   expect(f.db.addProtectedResource).not.toHaveBeenCalled();
 });
});
