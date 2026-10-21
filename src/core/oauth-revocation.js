// RFC7009 service-token revocation. No provider credential or admin fallback.
import {hashToken,secretsMatch} from './oauth.js';
import {only,paramsOf,publicOrigin,send} from './http.js';

export function createOAuthRevocation({db,env=process.env,allowBasic=false}){
  return async function revoke(req,res){
    if(!only(res,req,['POST']))return;
    let p;
    try{p=paramsOf(req);}catch{return send(res,400,{error:'invalid_request'});}
    if(typeof p.token!=='string'||p.token.length<1||p.token.length>256||
      (p.token_type_hint!==undefined&&(typeof p.token_type_hint!=='string'||p.token_type_hint.length>128)))
      return send(res,400,{error:'invalid_request'});
    try{
      if(p.resource!==undefined&&p.resource!==publicOrigin(env)+'/api/mcp')
        return send(res,400,{error:'invalid_target'});
      const header=req.headers?.authorization;
      let basic=null;
      if(allowBasic&&typeof header==='string'){
        const match=/^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
        if(match){
          const bytes=Buffer.from(match[1],'base64'),text=bytes.toString('utf8');
          const colon=text.indexOf(':');
          if(bytes.toString('base64')===match[1]&&colon>0&&colon===text.lastIndexOf(':'))
            basic={id:text.slice(0,colon),secret:text.slice(colon+1)};
        }
      }
      const clientId=basic?.id??p.client_id;
      const client=typeof clientId==='string'&&clientId.length>0&&clientId.length<=256
        ?await db.getOAuthClient(clientId):null;
      const method=client?.token_endpoint_auth_method??'client_secret_post';
      const publicClient=method==='none'&&header===undefined&&
        client?.client_secret_hash===null&&p.client_secret===undefined;
      const postClient=method==='client_secret_post'&&header===undefined&&
        typeof p.client_secret==='string'&&p.client_secret.length>0&&
        secretsMatch(hashToken(p.client_secret),client?.client_secret_hash);
      const basicClient=allowBasic&&method==='client_secret_basic'&&basic&&
        (p.client_id===undefined||p.client_id===clientId)&&p.client_secret===undefined&&
        basic.secret.length>0&&secretsMatch(hashToken(basic.secret),client?.client_secret_hash);
      if(!client||!(publicClient||postClient||basicClient)){
        if(header!==undefined&&allowBasic)res.setHeader('WWW-Authenticate','Basic realm="OAuth revocation"');
        return send(res,401,{error:'invalid_client'});
      }
      // Ignore token_type_hint: both supported types must be searched. The
      // store checks current client ownership and connector kind atomically.
      await db.revokeOAuthToken({token:p.token,clientId});
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      return res.status(200).end();
    }catch{
      // Fail closed without exposing a token, SQL or database error details.
      return send(res,503,{error:'temporarily_unavailable'});
    }
  };
}
