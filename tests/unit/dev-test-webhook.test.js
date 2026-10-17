import {describe,it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {encryptSecret,decryptSecret} from '../../src/core/secret-box.js';
import {checkedReceiver,syntheticEvent,syntheticSignature,signedPreviewPost,webhookSecretPurpose}
  from '../../src/tools/dev-test-webhook.js';
const base={runId:'run_20261016_abcdef',project:'prj_sample123',
  deployment:'dpl_preview123',event:'deployment.succeeded',key:'test_request_key_123',at:1792189000000};
const host='preview-one.vercel.app';
describe('V-5 exact signed synthetic receipts',()=>{
  it('uses the official HMAC-SHA1 over the identical transmitted raw body',()=>{
    const body=Buffer.from(JSON.stringify(syntheticEvent(base)));
    const secret='s'.repeat(64);
    expect(syntheticSignature(body,secret)).toBe(createHmac('sha1',secret).update(body).digest('hex'));
    expect(syntheticEvent(base).payload.synthetic).toBe(true);
    expect(syntheticEvent(base).payload.target).toBe('preview');
    expect(syntheticEvent({...base,key:'another-request'}).id).not.toBe(syntheticEvent(base).id);
  });
  it('requires exact attested preview origin; no userinfo, redirects, private IP or query',()=>{
    expect(checkedReceiver('https://'+host+'/api/test',host).pathname).toBe('/api/test');
    for(const url of ['http://'+host+'/api','https://example.org/api',
      'https://internal.local/api','https://'+host+'.evil.org/api',
      'https://'+host+'/api?auth=x','https://'+host+'/a/../b',
      'https://'+host+'/api#secret','https://'+host+':8443/api',
      'https://u:p@'+host+'/api','https://'+host+'/%2Fapi']){
      expect(()=>checkedReceiver(url,host)).toThrow();
    }
  });
  it('refuses mixed DNS before invoking transport, and does not expose the signer',async()=>{
    const url=checkedReceiver('https://'+host+'/api',host);
    const bytes=Buffer.from('{}'),secret='k'.repeat(64);
    let sent=0;
    await expect(signedPreviewPost(url,bytes,secret,{
      lookupImpl:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],
      requestImpl:()=>{sent++;throw Error('should not dispatch');}
    })).rejects.toThrow();
    expect(sent).toBe(0);
    await expect(signedPreviewPost(url,bytes,secret,{
      lookupImpl:async()=>[{address:'127.0.0.1',family:4}],
      requestImpl:()=>{sent++;throw Error('should not dispatch');}
    })).rejects.toThrow();
    expect(sent).toBe(0);
  });
});

describe('V-5 per-run private key encryption',()=>{
  it('encrypts and opens an exact run key with provider-safe purpose binding',()=>{
    const runId='run_20261016_abcdef1234',key='k'.repeat(64);
    const purpose=webhookSecretPurpose(runId);
    expect(purpose).toMatch(/^dev-webhook:[a-f0-9]{32}:webhook-secret$/);
    const env={TOKEN_ENCRYPTION_KEY:'a'.repeat(64)};
    const ciphertext=encryptSecret(key,purpose,env);
    expect(ciphertext).not.toContain(key);
    expect(decryptSecret(ciphertext,purpose,env)).toBe(key);
    expect(()=>decryptSecret(ciphertext,webhookSecretPurpose('run_20261016_fffffff'),env)).toThrow();
    expect(()=>webhookSecretPurpose('another_run')).toThrow();
  });
});

describe('V-5 actual pinned transport and one-shot HTTP result',()=>{
  function fakeRequest(status,calls){
    return (url,options,callback)=>{
      calls.push({url,options});
      const req=new EventEmitter();
      req.destroy=error=>req.emit('error',error);
      req.end=bytes=>{
        calls.at(-1).bytes=Buffer.from(bytes);
        const res=new PassThrough();res.statusCode=status;
        callback(res);res.end();
      };
      return req;
    };
  }
  const good=async()=>[{address:'8.8.8.8',family:4}];
  it('signs the exact transmitted bytes and pins selected DNS without leaking raw body in receipt',async()=>{
    const calls=[],secret='k'.repeat(64);
    const result=await signedPreviewPost(checkedReceiver('https://'+host+'/api/test',host),
      Buffer.from(JSON.stringify(syntheticEvent(base))),secret,{
        lookupImpl:good,requestImpl:fakeRequest(202,calls)});
    expect(result).toEqual({status:202,acknowledged:true});
    expect(calls).toHaveLength(1);
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.agent).toBe(false);
    expect(calls[0].options.servername).toBe(host);
    expect(calls[0].options.headers['x-vercel-signature']).toBe(
      createHmac('sha1',secret).update(calls[0].bytes).digest('hex'));
    const addr=await new Promise((resolve,reject)=>calls[0].options.lookup(
      host,{},(error,address,family)=>error?reject(error):resolve({address,family})));
    expect(addr).toEqual({address:'8.8.8.8',family:4});
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(base.deployment);
  });
  it('never follows redirect and never automatically retries denied or non-2xx delivery',async()=>{
    for(const status of [301,307,429,500]){
      const calls=[];
      await expect(signedPreviewPost(checkedReceiver('https://'+host+'/api/test',host),
        Buffer.from('{}'),'x'.repeat(64),{
          lookupImpl:good,requestImpl:fakeRequest(status,calls)})).rejects.toThrow();
      expect(calls).toHaveLength(1);
    }
  });
});
