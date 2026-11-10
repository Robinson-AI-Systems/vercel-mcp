import { describe, it, expect } from 'vitest';
import handler from '../../api/index.js';
import connectionHandler from '../../api/connection.js';
import { iconBytes } from '../../src/brand-assets.js';

function render(handlerFn, req) {
  const response = { headers: {}, statusCode: null, payload: '',
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.payload = body; return this; } };
  handlerFn(req, response);
  return response;
}
const home = () => render(handler, { headers: { accept: 'text/html' }, query: {} });

describe('AUD-BW home page per-client instructions', () => {
  it('serves one section per client, in the blueprint order', () => {
    const { payload } = home();
    const heads = ['<h2>Muse</h2>', '<h2>Claude (web, desktop and phone app)</h2>',
      '<h2>ChatGPT</h2>', '<h2>Claude Code</h2>', '<h2>Cursor</h2>'];
    let at = -1;
    for (const h of heads) {
      const i = payload.indexOf(h);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    expect(payload).toContain('<code class="addr" id="address">https://vercel.robinsonaisystems.com/api/mcp</code>');
    expect(payload).toContain('claude mcp add --transport http vercel-unleashed https://vercel.robinsonaisystems.com/api/mcp');
    expect(payload).toContain('"vercel-unleashed": { "url": "https://vercel.robinsonaisystems.com/api/mcp" }');
    expect(payload).toContain('.cursor/mcp.json');
  });

  it('keeps the Client ID paste step in the Muse section ONLY', () => {
    const { payload } = home();
    const doc = 'https://vercel.robinsonaisystems.com/.well-known/muse-client.json';
    expect(payload.split(doc).length - 1).toBe(1);
    const museAt = payload.indexOf('<h2>Muse</h2>');
    const claudeAt = payload.indexOf('<h2>Claude (web, desktop and phone app)</h2>');
    const docAt = payload.indexOf(doc);
    expect(docAt).toBeGreaterThan(museAt);
    expect(docAt).toBeLessThan(claudeAt);
    expect(payload).toContain('Client Secret: leave blank.');
    // D-006 MC-8: the main instruction is plain `muse`, inside the Muse section.
    const museIdAt = payload.indexOf('<code class="addr" id="muse-client-id">muse</code>');
    expect(museIdAt).toBeGreaterThan(museAt);
    expect(museIdAt).toBeLessThan(docAt);
    // Every other client: blank boxes, outcome-level wording (AUD-BW
    // correction: no claim about this server's registration endpoint).
    expect(payload.split('identifies itself automatically').length - 1).toBe(2);
    expect(payload).not.toContain('registers itself');
    expect(payload).not.toContain('register itself');
  });

  it('keeps the program JSON status byte-shape unchanged', () => {
    const r = render(handler, { headers: {}, query: {} });
    const info = JSON.parse(r.payload);
    expect(info.status).toBe('service-online');
    expect(info.endpoint).toBe('/api/mcp');
  });

  it('links the instructions from /connection with the same split', () => {
    const r = render(connectionHandler, {});
    expect(r.payload).toContain('href="/#connect"');
    expect(r.payload).toContain('Muse only: if Muse asks for a Client ID');
    expect(r.payload).toContain('identifies itself automatically');
    expect(r.payload).not.toContain('registers itself');
  });
});

describe('AUD-BW Vercel Unleashed product mark (UNLEASHED-BRAND-SPEC §7)', () => {
  it('serves the assigned mark at the icon routes, 256 and 64', () => {
    for (const [size, dim] of [[256, 256], [64, 64]]) {
      const r = render(handler, { headers: {}, query: { brand_icon: String(size) } });
      expect(r.headers['Content-Type']).toBe('image/png');
      const bytes = iconBytes(size);
      expect(Buffer.compare(r.payload, bytes)).toBe(0);
      // PNG signature + IHDR dimensions of the served derivative.
      expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
      expect(bytes.readUInt32BE(16)).toBe(dim);
      expect(bytes.readUInt32BE(20)).toBe(dim);
    }
  });

  it('declares the product mark as the page icon and header logo', () => {
    const { payload } = home();
    expect(payload).toContain('<link rel="icon" type="image/png" href="/brand/icon-256.png">');
    expect(payload).toContain('<img src="/brand/icon-256.png"');
  });
});
