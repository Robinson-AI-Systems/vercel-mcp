import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,createHash,privateDecrypt,constants} from 'node:crypto';
import {createHandoff,validateStart} from '../../src/developer/handoff.js';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const origin='https://service.example';
const secret='p'.repeat(43),challenge='c'.repeat(43),code='a'.repeat(43);
const body=()=>({client_id:'developer_client',challenge,poll_hash:createHash('sha256').update(secret).digest('hex'),
  public_key:keys.publicKey.export({type:'spki',format:'pem'}),profile:'full'});
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.data=v;return this;},send(v){this.data=v;return this;}};}
function fixture(){
 let row;
 const store={async start(p){row={...p,expires_at:p.expires,status:'pending'};return true;},async find(state){return row?.state===state?row:null;},
  async codeProof(value){return value===code?{client_id:row.client_id,redirect_uri:origin+'/api/developer/connect',code_challenge:row.challenge,code_challenge_method:'S256'}:null;},
  async approve(_state,sealed){if(row.status!=='pending')return false;row.status='authorized';row.sealed_code=sealed;return true;},
  async deny(){row.status='denied';},async poll(state,hash){if(row?.state!==state||row.poll_hash!==hash||row.delivered)return null;if(row.status!=='pending')row.delivered=true;return row;}};
 const handler=createHandoff({store,origin,getClient:async()=>({redirect_uris:[origin+'/api/developer/connect']})});
 return {handler,store,row:()=>row};
}
describe('mobile developer OAuth handoff',()=>{
 it('preserves owner-selected full development authorization; no production catalog restriction',async()=>{
  const {handler,row}=fixture();const r=response();await handler({method:'POST',body:body(),headers:{}},r);
  expect(r.statusCode).toBe(201);const u=new URL(r.data.authorization_url);
  expect(u.searchParams.get('profile')).toBe('full');expect(u.searchParams.get('code_challenge')).toBe(challenge);
  expect(u.searchParams.get('redirect_uri')).toBe(origin+'/api/developer/connect');
  expect(JSON.stringify(r.data)).not.toContain(secret);expect(row().poll_hash).not.toBe(secret);
 });
 it('completes browser consent with an encrypted single-use handoff and no copied pass',async()=>{
  const {handler,row}=fixture();await handler({method:'POST',body:body(),headers:{}},response());
  const approved=response();await handler({method:'GET',query:{state:row().state,code},headers:{}},approved);
  expect(approved.data).toContain('There is no pass to copy');expect(approved.data).not.toContain(code);
  const poll=response();await handler({method:'GET',query:{state:row().state},headers:{authorization:'Bearer '+secret}},poll);
  expect(poll.statusCode).toBe(200);expect(JSON.stringify(poll.data)).not.toContain(code);
  expect(privateDecrypt({key:keys.privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(poll.data.sealed_code,'base64url')).toString()).toBe(code);
  const again=response();await handler({method:'GET',query:{state:row().state},headers:{authorization:'Bearer '+secret}},again);expect(again.statusCode).toBe(410);
 });
 it('rejects another requester, wrong proof and callback replay',async()=>{
  const {handler,row,store}=fixture();await handler({method:'POST',body:body(),headers:{}},response());
  const wrong=response();await handler({method:'GET',query:{state:row().state},headers:{authorization:'Bearer '+'x'.repeat(43)}},wrong);expect(wrong.statusCode).toBe(410);
  store.codeProof=async()=>({client_id:'other',redirect_uri:origin+'/api/developer/connect',code_challenge:challenge,code_challenge_method:'S256'});
  const denied=response();await handler({method:'GET',query:{state:row().state,code},headers:{}},denied);expect(denied.statusCode).toBe(400);expect(row().status).toBe('pending');
 });
 it('requires the exact registered callback and hides internal failures',async()=>{
  const {store}=fixture();const handler=createHandoff({store,origin,getClient:async()=>({redirect_uris:['https://attacker.example']})});
  const r=response();await handler({method:'POST',body:body(),headers:{}},r);expect(r.statusCode).toBe(400);expect(r.data.error).toBe('invalid_client');
  const f=createHandoff({store,origin,getClient:async()=>{throw Error('SECRET');}});const fail=response();await f({method:'POST',body:body(),headers:{}},fail);expect(JSON.stringify(fail.data)).not.toContain('SECRET');
 });
 it('rejects foreign fields, invalid keys, missing proof and invalid origins',()=>{
  expect(()=>validateStart({...body(),production:true})).toThrow();
  expect(()=>validateStart({...body(),poll_hash:'secret'})).toThrow();
  expect(()=>validateStart({...body(),public_key:'fake'})).toThrow();
  expect(()=>createHandoff({origin:'http://service.example'})).toThrow();
 });
});
