import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {handleRtcApi} from '../../src/rtc/api.js';

const pass='Bearer rtc_pass_'+randomBytes(32).toString('base64url');
function response(){
  return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
    status(code){this.statusCode=code;return this;},
    send(body){this.body=JSON.parse(body);return this;}};
}
describe('RTC serverless pre-auth database boundary',()=>{
  it('never constructs SQL for missing, forged or coerced bearer headers',async()=>{
    const factory=vi.fn(()=>{throw new Error('Must not touch database');});
    for(const auth of [undefined,'Bearer access_token',
      ['Bearer '+pass],{toString:()=>pass},'Bearer rtc_pass_short']){
      const res=response();
      await handleRtcApi({method:'GET',headers:{authorization:auth}},res,'list',
        {dbFactory:factory});
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('permission');
      expect(res.headers['Cache-Control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain('rtc_pass_');
    }
    expect(factory).not.toHaveBeenCalled();
  });
  it('refuses unsupported methods and routes before database initialization',async()=>{
    const factory=vi.fn();
    for(const [route,method,status,code] of [
      ['list','POST',400,'invalid_args'],['invoke','GET',400,'invalid_args'],
      ['batch','PATCH',400,'invalid_args'],['unknown','GET',404,'not_found']]){
      const res=response();
      await handleRtcApi({method,headers:{authorization:pass}},res,route,
        {dbFactory:factory});
      expect(res.statusCode).toBe(status);
      expect(res.body.error.code).toBe(code);
    }
    expect(factory).not.toHaveBeenCalled();
  });
  it('initializes and delegates genuine pass-shaped requests for DB verification',async()=>{
    const initSchema=vi.fn(async()=>{});
    const authorizeRtcPass=vi.fn(async()=>({status:'pass_revoked'}));
    const factory=vi.fn(()=>({initSchema,authorizeRtcPass}));
    const res=response();
    await handleRtcApi({method:'GET',headers:{authorization:pass}},res,'whoami',
      {dbFactory:factory,toolRegistry:{tools:[],handlers:{}}});
    expect(factory).toHaveBeenCalledOnce();
    expect(initSchema).toHaveBeenCalledOnce();
    expect(authorizeRtcPass).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('pass_revoked');
  });
  it('uses neutral error envelopes on database outages',async()=>{
    const factory=vi.fn(()=>({initSchema:async()=>{throw Error('Database private detail');}}));
    const res=response();
    await handleRtcApi({method:'GET',headers:{authorization:pass}},res,'list',
      {dbFactory:factory});
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('Database private detail');
  });
});
