import {describe,it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {checkedReceiver,syntheticEvent,syntheticSignature,signedPreviewPost}
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
