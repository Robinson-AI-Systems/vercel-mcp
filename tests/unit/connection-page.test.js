import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import handler from '../../api/connection.js';
import { FRONT_DOOR_PRODUCT_NAME } from '../../src/front-door.js';

function render(){
  const response={headers:{},statusCode:null,payload:'',
    setHeader(name,value){this.headers[name]=value;return this;},
    status(code){this.statusCode=code;return this;},
    send(body){this.payload=body;return this;}};
  handler({},response);
  return response;
}

describe('O-6 connection page (RAS MCP Standard, Branded front door)',()=>{
 it('renders the My connection page under the fleet product name',()=>{
  const r=render();
  expect(r.statusCode).toBe(200);
  expect(r.headers['Cache-Control']).toBe('no-store');
  expect(r.payload).toContain('<title>My connection — '+FRONT_DOOR_PRODUCT_NAME+'</title>');
  expect(r.payload).toContain('<h1>My connection</h1>');
  expect(r.payload).toContain('#00B67A');
 });
 it('gives the connect routes for each client class, branded address only',()=>{
  const {payload}=render();
  expect(payload).toContain('https://vercel.robinsonaisystems.com');
  expect(payload).toContain('https://vercel.robinsonaisystems.com/.well-known/muse-client.json');
  expect(payload).toContain('custom connector');
  expect(payload).toContain('scoped pass');
  // Instructions name the branded address only — the deployment address
  // never appears as an instruction on the public pages.
  expect(payload).not.toContain('vercel-mcp-liard');
 });
 it('states the Standard content plainly: identity, secrets, can/cannot, posture, disconnect',()=>{
  const {payload}=render();
  expect(payload).toContain('claims your existing identity');
  expect(payload).toContain('never creates a Vercel account');
  expect(payload).toContain('never in chat');
  expect(payload).toContain('What a connection can do');
  expect(payload).toContain('What it cannot do');
  expect(payload).toContain('cannot touch another account');
  expect(payload).toContain('not affiliated with or endorsed by Vercel');
  expect(payload).toContain('does not certify live provider or RTC acceptance');
  expect(payload).toContain('no public sign-up');
  expect(payload).toContain('revoke the connection or pass');
  expect(payload).toContain('takes effect at once');
  expect(payload).not.toMatch(/DATABASE_URL|TOKEN_ENCRYPTION_KEY|ADMIN_PASSPHRASE|vcp_[a-zA-Z0-9_-]{12,}/);
 });
 it('is routed at /connection by a vercel.json rewrite, like the well-known routes',()=>{
  const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
  expect(config.rewrites).toContainEqual({source:'/connection',destination:'/api/connection'});
 });
});
