import {describe,it,expect} from 'vitest';
import handler from '../../api/index.js';
describe('public landing cannot claim account setup or connected acceptance',()=>{
 it('advertises the hosted endpoint without exposing account/secrets or pretending connected proof',()=>{
  const response={headers:{},statusCode:null,payload:'',
    setHeader(name,value){this.headers[name]=value;return this;},
    status(code){this.statusCode=code;return this;},
    send(body){this.payload=body;return this;}};
  handler({},response);
  expect(response.statusCode).toBe(200);
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(response.payload).toContain('Status: hosted service endpoint');
  expect(response.payload).toContain('does not certify live provider or RTC acceptance');
  expect(response.payload).not.toContain('Status: setup required');
  expect(response.payload).not.toMatch(/DATABASE_URL|TOKEN_ENCRYPTION_KEY|ADMIN_PASSPHRASE|vcp_[a-zA-Z0-9_-]{12,}/);
 });
});
