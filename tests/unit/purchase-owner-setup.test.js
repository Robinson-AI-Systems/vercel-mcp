import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {encryptSecret} from '../../src/core/secret-box.js';
import {handleSetup} from '../../src/vercel/setup.js';
const env={VERCEL_ENV:'production',ADMIN_PASSPHRASE:'fake-owner-passphrase',
 TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
const csrf='a'.repeat(43),ref='12345678-1234-1234-1234-123456789abc';
const cookie='rmcp_owner='+encryptSecret(JSON.stringify({csrf,exp:Date.now()+600000}), 'setup:session',env);
function response(){return {headers:{},statusCode:0,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},status(n){this.statusCode=n;return this;},send(x){this.body=x;return this;},json(x){this.body=JSON.stringify(x);return this;},end(){return this;}};}
function fixture(priceCents=2000){
 let row={id:ref,vercel_account:'team_FAKE',operation:'vercel_project_create',
  status:'pending',price_cents:priceCents,pricing_source:priceCents===null?'metered':'provider_quote',
  ceiling_cents:null,expires_at:new Date(Date.now()+600000)};
 const db={
  listVercelAccounts:async()=>[{id:'team_FAKE',label:'Fixture',scope:'team'}],
  getPurchaseIntent:vi.fn(async({account,reference})=>account==='team_FAKE'&&reference===ref?{...row}:null),
  approvePurchaseIntent:vi.fn(async({account,reference,ceilingCents})=>{
   if(account!=='team_FAKE'||reference!==ref||row.status!=='pending')return false;
   row={...row,status:'approved',ceiling_cents:ceilingCents};return true;
  }),
  recordLoginAttempt:async()=>1,countRecentFailedLogins:async()=>0,
  markLoginAttemptSucceeded:async()=>{}
 };
 async function send(body,e=env,c=cookie){
  const res=response();await handleSetup({method:'POST',body,
   headers:{cookie:c,'x-real-ip':'127.0.0.1'}},res,{db,env:e});return res;
 }
 return {db,send,setRow:next=>{row={...row,...next}}};
}
describe('IN-08 separately authenticated purchase approval',()=>{
 it('reviews a specific quote but never charges or approves during review',async()=>{
  const f=fixture();
  const r=await f.send({action:'review_purchase',account:'team_FAKE',reference:ref,csrf});
  expect(r.statusCode).toBe(200);
  expect(r.body).toContain('vercel_project_create');
  expect(r.body).toContain('$20.00');
  expect(r.body).not.toContain(env.ADMIN_PASSPHRASE);
  expect(f.db.approvePurchaseIntent).not.toHaveBeenCalled();
 });
 it('rejects absent/incorrect fresh owner approval, wrong account, forged ceiling and replay',async()=>{
  const f=fixture();
  const req={action:'approve_purchase',csrf,account:'team_FAKE',reference:ref,
   ceilingDollars:'20.00',confirm:'yes'};
  for(const attempt of [
   req,{...req,passphrase:'wrong'},
   {...req,ceilingDollars:'19.99',passphrase:env.ADMIN_PASSPHRASE},
   {...req,account:'team_OTHER',passphrase:env.ADMIN_PASSPHRASE}
  ])expect((await f.send(attempt)).statusCode).not.toBe(200);
  expect((await f.send({...req,passphrase:env.ADMIN_PASSPHRASE},env,'')).statusCode).toBe(403);
  expect((await f.send({...req,csrf:'bad',passphrase:env.ADMIN_PASSPHRASE})).statusCode).toBe(403);
  expect(f.db.approvePurchaseIntent).not.toHaveBeenCalled();
  const ok=await f.send({...req,passphrase:env.ADMIN_PASSPHRASE});
  expect(ok.statusCode).toBe(200);
  expect(f.db.approvePurchaseIntent).toHaveBeenCalledOnce();
  expect((await f.send({...req,passphrase:env.ADMIN_PASSPHRASE})).statusCode).toBe(409);
 });
 it('permits independently approved variable ceilings without a discretionary amount cap',async()=>{
  const f=fixture(null);
  const request={action:'approve_purchase',csrf,account:'team_FAKE',reference:ref,
   ceilingDollars:'90071992547409.91',confirm:'yes',passphrase:env.ADMIN_PASSPHRASE};
  expect((await f.send(request)).statusCode).toBe(200);
  expect(f.db.approvePurchaseIntent).toHaveBeenCalledWith({
   account:'team_FAKE',reference:ref,ceilingCents:Number.MAX_SAFE_INTEGER
  });
 });
 it('refuses approval from a preview deployment or an expired quote',async()=>{
  const f=fixture();
  const args={action:'approve_purchase',csrf,account:'team_FAKE',reference:ref,
    ceilingDollars:'20.00',confirm:'yes',passphrase:env.ADMIN_PASSPHRASE};
  expect((await f.send(args,{...env,VERCEL_ENV:'preview'})).statusCode).toBe(403);
  f.setRow({expires_at:new Date(Date.now()-5000)});
  expect((await f.send(args)).statusCode).toBe(409);
  expect(f.db.approvePurchaseIntent).not.toHaveBeenCalled();
 });
});
