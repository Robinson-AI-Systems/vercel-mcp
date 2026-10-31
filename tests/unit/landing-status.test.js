import {describe,it,expect} from 'vitest';
import handler, { publicInfo } from '../../api/index.js';
import { FRONT_DOOR_PRODUCT_NAME, FRONT_DOOR_TAGLINE } from '../../src/front-door.js';
import { registry } from '../../src/tools/index.js';

function render(req={}){
  const response={headers:{},statusCode:null,payload:'',
    setHeader(name,value){this.headers[name]=value;return this;},
    status(code){this.statusCode=code;return this;},
    send(body){this.payload=body;return this;}};
  handler({headers:{},query:{},...req},response);
  return response;
}

describe('public landing cannot claim account setup or connected acceptance',()=>{
 it('serves programs a plain JSON status that claims no connected proof',()=>{
  const r=render();
  expect(r.statusCode).toBe(200);
  expect(r.headers['Cache-Control']).toBe('no-store');
  const info=JSON.parse(r.payload);
  expect(info).toMatchObject({name:FRONT_DOOR_PRODUCT_NAME,status:'service-online',
    tools:registry.tools.length,oauth:'/.well-known/oauth-authorization-server',
    endpoint:'/api/mcp',health:'/api/health',deployed_source_sha:null});
  expect(info.note).toContain('not provider setup, OAuth consent or RTC acceptance');
  expect(r.payload).not.toMatch(/DATABASE_URL|TOKEN_ENCRYPTION_KEY|ADMIN_PASSPHRASE|vcp_[a-zA-Z0-9_-]{12,}/);
  expect(publicInfo('a'.repeat(40)).deployed_source_sha).toBe('a'.repeat(40));
  expect(publicInfo('not-a-sha').deployed_source_sha).toBe(null);
 });
 it('serves browsers the dark fleet front door with the lockup, facts and honesty posture',()=>{
  const r=render({headers:{accept:'text/html,application/xhtml+xml'}});
  expect(r.statusCode).toBe(200);
  expect(r.headers['Content-Type']).toContain('text/html');
  expect(r.payload).toContain('<title>'+FRONT_DOOR_PRODUCT_NAME+'</title>');
  // Fleet lockup: logo + product name + tagline (owner design rule 2026-10-30).
  expect(r.payload).toContain('<img src="/brand/icon-256.png"');
  expect(r.payload).toContain('<b>'+FRONT_DOOR_PRODUCT_NAME+'</b>');
  expect(r.payload).toContain(FRONT_DOOR_TAGLINE);
  expect(FRONT_DOOR_TAGLINE).toBe('Practical software. More capable AI.');
  // Dark composition tokens from the fleet brand sheet.
  expect(r.payload).toContain('--bg:#0C0C0C');
  expect(r.payload).toContain('--surface:#1E1E1E');
  expect(r.payload).toContain('#00B67A');
  expect(r.payload).toContain('Status: hosted service endpoint');
  expect(r.payload).toContain('Registered tools: ' + registry.tools.length);
  expect(r.payload).toContain('Available by connection profile: read-only ');
  expect(r.payload).toContain('<code>/api/mcp</code>');
  expect(r.payload).toContain('<code>/.well-known/oauth-authorization-server</code>');
  // Bordered address box carries the branded server address.
  expect(r.payload).toContain('<code class="addr" id="address">https://vercel.robinsonaisystems.com/api/mcp</code>');
  expect(r.payload).toContain('href="/connection"');
  expect(r.payload).toContain('does not certify live provider or RTC acceptance');
  expect(r.payload).toContain('<small>Not affiliated with or endorsed by Vercel.</small>');
  // AUD-AK: the shared footer carries the fleet standard disclaimer block
  // verbatim (protection pass 2026-10-30 §7(b)) — non-affiliation,
  // availability/change and provider-terms elements.
  expect(r.payload).toContain('Vercel Unleashed is an independent service by Robinson AI Systems and is not affiliated with or endorsed by Vercel. Availability, features and tools can change at any time, and Vercel can change or limit the service this tool works through — this page describes things as they stand today, not a promise about tomorrow. Vercel Unleashed works through your own Vercel account, and Vercel\'s own terms govern that account.');
  // The as-is sentence belongs to /connection only.
  expect(r.payload).not.toContain('Vercel Unleashed is provided as-is');
  expect(r.payload).not.toContain('Robinson Vercel MCP');
  expect(r.payload).not.toContain('Status: setup required');
  expect(r.payload).not.toMatch(/DATABASE_URL|TOKEN_ENCRYPTION_KEY|ADMIN_PASSPHRASE|vcp_[a-zA-Z0-9_-]{12,}/);
 });
 it('serves the fleet icon from the same function, as PNG bytes',()=>{
  const r=render({query:{brand_icon:'256'}});
  expect(r.statusCode).toBe(200);
  expect(r.headers['Content-Type']).toBe('image/png');
  expect(Buffer.isBuffer(r.payload)).toBe(true);
  expect(r.payload.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  const small=render({query:{brand_icon:'64'}});
  expect(small.payload.length).toBeLessThan(r.payload.length);
 });
});
