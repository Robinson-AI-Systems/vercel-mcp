import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createOAuthRevocation} from '../../src/core/oauth-revocation.js';
const origin='https://mcp.example.test';
function response(){return {statusCode:200,headers:{},body:'',
  setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},
  send(v){this.body=v;return this;},end(){return this;}};}
export function runOAuthRevocationContract(label,makeDb,{allowBasic=false}={}){
 describe('RFC7009 '+label,()=>{
  async function fixture(method='client_secret_post',existingDb=null){
   const db=existingDb??await makeDb(),id=randomUUID(),secret='FAKE-client-secret-'+id;
   await db.createOAuthClient({clientId:id,clientSecret:method==='none'?null:secret,
    tokenEndpointAuthMethod:method,redirectUris:['https://client.example.test/callback']});
   const access='FAKE-access-'+id,refresh='FAKE-refresh-'+id;
   await db.createAccessToken({clientId:id,accessToken:access,refreshToken:refresh,profile:'full',listing:'compact'});
   const h=createOAuthRevocation({db,env:{PUBLIC_BASE_URL:origin},allowBasic});
   const credentials={client_id:id,...(method==='none'?{}:{client_secret:secret})};
   const call=async(body={},headers={},method='POST')=>{
    const res=response();await h({method,headers,body},res);return res;
   };
   return {db,id,secret,access,refresh,credentials,call};
  }
  it('revokes only the selected current grant and stops its refresh',async()=>{
   const f=await fixture();
   await f.db.createAccessToken({clientId:f.id,accessToken:f.access+'-sibling',refreshToken:f.refresh+'-sibling'});
   const res=await f.call({...f.credentials,token:f.access});
   expect(res.statusCode).toBe(200);expect(res.body).toBe('');
   expect(res.headers['Cache-Control']).toBe('no-store');
   expect(await f.db.getAccessToken(f.access)).toBeNull();
   expect(await f.db.getTokenByRefreshToken(f.refresh)).toBeNull();
   expect(await f.db.rotateRefreshToken({clientId:f.id,refreshToken:f.refresh,
    accessToken:'FAKE-replayed-access',newRefreshToken:'FAKE-replayed-refresh'})).toBeNull();
   expect(await f.db.getAccessToken(f.access+'-sibling')).not.toBeNull();
  });
  it('does not let a different authenticated client revoke a known foreign token',async()=>{
   const f=await fixture(),other=await fixture('client_secret_post',f.db);
   const foreign=await f.call({...f.credentials,token:other.refresh});
   const missing=await f.call({...f.credentials,token:'FAKE-unknown'});
   expect(foreign.statusCode).toBe(200);expect(missing.statusCode).toBe(200);
   expect(foreign.body).toBe(missing.body);
   expect(await other.db.getTokenByRefreshToken(other.refresh)).not.toBeNull();
   expect(await f.db.getAccessToken(f.access)).not.toBeNull();
  });
  it('supports public-client disconnect, searches both token types and is idempotent',async()=>{
   const f=await fixture('none');
   for(const hint of ['access_token','unsupported-hint']){
    const r=await f.call({...f.credentials,token:f.refresh,token_type_hint:hint});
    expect(r.statusCode).toBe(200);expect(r.body).toBe('');
   }
   expect(await f.db.getAccessToken(f.access)).toBeNull();
   expect(await f.db.getTokenByRefreshToken(f.refresh)).toBeNull();
  });
  it('allows expired access credentials to revoke their still-active refresh',async()=>{
   const f=await fixture();
   await f.db.createAccessToken({clientId:f.id,accessToken:f.access+'-old',
    refreshToken:f.refresh+'-old',ttlSeconds:-10});
   expect(await f.db.getAccessToken(f.access+'-old')).toBeNull();
   expect(await f.db.getTokenByRefreshToken(f.refresh+'-old')).not.toBeNull();
   expect((await f.call({...f.credentials,token:f.access+'-old'})).statusCode).toBe(200);
   expect(await f.db.getTokenByRefreshToken(f.refresh+'-old')).toBeNull();
  });
  it('requires the persisted client authentication method without downgrade or mixed mechanisms',async()=>{
   const f=await fixture(),publicClient=await fixture('none');
   for(const args of [{client_id:f.id,token:f.access},
    {...f.credentials,client_secret:'FAKE-wrong',token:f.access}])
    expect((await f.call(args)).statusCode).toBe(401);
   expect((await f.call({...f.credentials,token:f.access},{authorization:'Basic FAKE'})).statusCode).toBe(401);
   expect((await publicClient.call({...publicClient.credentials,client_secret:'',token:publicClient.access})).statusCode).toBe(401);
   expect(await f.db.getAccessToken(f.access)).not.toBeNull();
   expect(await publicClient.db.getAccessToken(publicClient.access)).not.toBeNull();
  });
  it('refuses GET, malformed bodies and a foreign resource before revocation',async()=>{
   const f=await fixture();
   expect((await f.call({...f.credentials,token:f.access},{},'GET')).statusCode).toBe(405);
   expect((await f.call({...f.credentials})).statusCode).toBe(400);
   expect((await f.call({...f.credentials,token:f.access,resource:'https://foreign.example.test/api/mcp'})).statusCode).toBe(400);
   expect(await f.db.getAccessToken(f.access)).not.toBeNull();
  });
  it('fails closed and never returns raw storage errors or credentials',async()=>{
   const f=await fixture(),res=response();
   const h=createOAuthRevocation({db:{getOAuthClient:async()=>{throw Error('FAKE-private-storage-detail');}}});
   await h({method:'POST',headers:{},body:{...f.credentials,token:f.access}},res);
   expect(res.statusCode).toBe(503);expect(res.body).toBe(JSON.stringify({error:'temporarily_unavailable'}));
   expect(res.body).not.toContain(f.secret);expect(res.body).not.toContain(f.access);
  });
  if(allowBasic)it('supports persisted confidential Basic clients and rejects body ambiguity',async()=>{
   const f=await fixture('client_secret_basic');
   const headers={authorization:'Basic '+Buffer.from(f.id+':'+f.secret).toString('base64')};
   expect((await f.call({...f.credentials,token:f.access},headers)).statusCode).toBe(401);
   expect((await f.call({client_id:'FAKE-other-client',token:f.access},headers)).statusCode).toBe(401);
   expect((await f.call({token:f.access},headers)).statusCode).toBe(200);
   expect(await f.db.getTokenByRefreshToken(f.refresh)).toBeNull();
  });
 });
}
