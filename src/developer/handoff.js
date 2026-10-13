// Mobile OAuth handoff; owner consent and native token exchange remain authoritative.
// The polling client holds the PKCE verifier, RSA private key and polling secret.
import {createHash,createPublicKey,publicEncrypt,constants,randomBytes} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const token=/^[A-Za-z0-9_-]{43}$/;
const clientPattern=/^[A-Za-z0-9_-]{8,128}$/;
const profiles=new Set(['read_only','everyday','full']);
export const callbackPath='/api/developer/connect';
export function validateStart(p){
  if(!p||typeof p!=='object'||Array.isArray(p)||
    Object.keys(p).some(k=>!['client_id','challenge','poll_hash','public_key','profile'].includes(k))||
    !clientPattern.test(p.client_id||'')||!token.test(p.challenge||'')||
    !/^[a-f0-9]{64}$/.test(p.poll_hash||'')||!profiles.has(p.profile)||
    typeof p.public_key!=='string'||p.public_key.length>1000)throw Error('invalid_request');
  const key=createPublicKey(p.public_key);
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength!==2048)
    throw Error('invalid_request');
  return {...p,public_key:key.export({type:'spki',format:'pem'})};
}
export function createHandoff({store,origin,getClient,now=()=>Date.now()}){
  const base=new URL(origin);
  if(base.protocol!=='https:'||base.origin!==origin||base.username||base.password)throw Error('invalid_origin');
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const json=(status,value)=>res.status(status).json(value);
    const page=(status,text)=>res.status(status).send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Developer connection</title></head><body><h1>Developer connection</h1><p>'+text+'</p></body></html>');
    try{
      if(req.method==='POST'){
        const p=validateStart(req.body);
        const client=await getClient(p.client_id);
        if(!client?.redirect_uris?.includes(origin+callbackPath))return json(400,{error:'invalid_client'});
        const state=random(), expires=new Date(now()+600000);
        const ip=digest(String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim());
        if(!await store.start({...p,state,ip,expires}))return json(429,{error:'rate_limited'});
        const u=new URL('/api/oauth/authorize',origin);
        const q={client_id:p.client_id,redirect_uri:origin+callbackPath,response_type:'code',
          code_challenge:p.challenge,code_challenge_method:'S256',resource:origin+'/api/mcp',
          state,profile:p.profile,listing:'compact'};
        for(const [k,v]of Object.entries(q))u.searchParams.set(k,v);
        return json(201,{request_id:state,authorization_url:u.href,expires_at:expires.toISOString(),poll_after_seconds:5});
      }
      if(req.method!=='GET'){res.setHeader('Allow','GET, POST');return json(405,{error:'method_not_allowed'});}
      const q=req.query||{};
      if(!token.test(q.state||'')||Object.keys(q).some(k=>!['state','code','error'].includes(k)))return json(400,{error:'invalid_request'});
      if(q.code!==undefined||q.error!==undefined){
        const row=await store.find(q.state);
        if(!row||new Date(row.expires_at).getTime()<=now())return page(410,'This connection request expired. Ask your agent for a new link.');
        if(q.error!==undefined){await store.deny(q.state);return page(200,'Connection was not authorized. Return to your chat.');}
        if(!token.test(q.code))return page(400,'The authorization response was invalid. No connection was saved.');
        // Verify the native code, client, redirect and PKCE before accepting a callback.
        const proof=await store.codeProof(q.code);
        if(!proof||proof.client_id!==row.client_id||proof.redirect_uri!==origin+callbackPath||
          proof.code_challenge!==row.challenge||proof.code_challenge_method!=='S256')
          return page(400,'The authorization did not match this agent request. No connection was saved.');
        const sealed=publicEncrypt({key:row.public_key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(q.code)).toString('base64url');
        if(!await store.approve(q.state,sealed))return page(409,'This connection request was already handled. Return to your chat.');
        return page(200,'Authorization saved. Return to your chat; your agent can finish connecting automatically. There is no pass to copy.');
      }
      const secret=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers?.authorization||'')?.[1];
      if(!secret)return json(401,{error:'unauthorized'});
      const result=await store.poll(q.state,digest(secret));
      if(!result)return json(410,{error:'request_unavailable'});
      if(result.status==='pending')return json(202,{status:'authorization_pending'});
      if(result.status==='denied')return json(403,{error:'access_denied'});
      return json(200,{status:'authorized',sealed_code:result.sealed_code});
    }catch{return json(400,{error:'invalid_request'});}
  };
}
