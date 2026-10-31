import {describe,it,expect} from 'vitest';
import handler from '../../api/index.js';
import { FRONT_DOOR_PRODUCT_NAME } from '../../src/front-door.js';
import { registry } from '../../src/tools/index.js';
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
  // O-6 (fleet naming, 2026-10-30): the front-door pages carry the fleet
  // product name as page presentation; SERVICE_DISPLAY_NAME is unchanged.
  expect(FRONT_DOOR_PRODUCT_NAME).toBe('Vercel Unleashed by Robinson AI Systems');
  expect(response.payload).toContain('<title>'+FRONT_DOOR_PRODUCT_NAME+'</title>');
  expect(response.payload).toContain('<h1>'+FRONT_DOOR_PRODUCT_NAME+'</h1>');
  expect(response.payload).not.toContain('Robinson Vercel MCP');
  expect(response.payload).toContain('does not certify live provider or RTC acceptance');
  expect(response.payload).not.toContain('Status: setup required');
  expect(response.payload).not.toMatch(/DATABASE_URL|TOKEN_ENCRYPTION_KEY|ADMIN_PASSPHRASE|vcp_[a-zA-Z0-9_-]{12,}/);
 });
 it('renders live registry counts, endpoint paths, branding and the connection link',()=>{
  const response={headers:{},statusCode:null,payload:'',
    setHeader(name,value){this.headers[name]=value;return this;},
    status(code){this.statusCode=code;return this;},
    send(body){this.payload=body;return this;}};
  handler({},response);
  expect(response.payload).toContain('Registered tools: ' + registry.tools.length);
  expect(response.payload).toContain('Available by connection profile: read-only ');
  expect(response.payload).toContain('<code>/api/mcp</code>');
  expect(response.payload).toContain('<code>/.well-known/oauth-authorization-server</code>');
  expect(response.payload).toContain('#00B67A');
  expect(response.payload).toContain('#006E56');
  expect(response.payload).toContain('href="/connection"');
  expect(response.payload).toContain('not affiliated with or endorsed by Vercel');
 });
});
