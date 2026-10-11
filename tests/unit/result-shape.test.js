import { describe, it, expect } from 'vitest';
import { compact, credentialLike } from '../../src/core/util.js';
import { shapeVercelResult, shapeMcpResult } from '../../src/vercel/shape.js';

describe('B-5 fail-closed result presentation', () => {
  it('hides nested secret fields and embedded credential shapes', () => {
    const shaped = compact({ value: 'ordinary', decryptedValue: 'plaintext',
      token: 'FAKE_access', nested: [{ bypass: 'FAKE_bypass', password: 'FAKE_password' },
        { note: 'contains vcp_FAKE_secret_identifier' }], settings: { safe: 'hello' } });
    expect(shaped.value).toBe('[hidden]');
    expect(shaped.decryptedValue).toBe('[hidden]');
    expect(shaped.token).toBe('[hidden]');
    expect(shaped.nested[0].bypass).toBe('[hidden]');
    expect(shaped.nested[0].password).toBe('[hidden]');
    expect(shaped.nested[1].note).toBe('[hidden]');
    expect(shaped.settings.safe).toBe('hello');
  });

  it('adds Denver time on both sides of daylight-saving change and preserves integer cents', () => {
    const obj = compact({ beforeAt: Date.parse('2026-11-01T08:30:00Z'),
      afterAt: Date.parse('2026-11-01T09:30:00Z'), amountCents: 12345,
      spend_limit_cents: -50 });
    expect(obj.beforeAt_local).toContain('MDT');
    expect(obj.afterAt_local).toContain('MST');
    expect(obj.amountCents).toBe(12345);
    expect(obj.amountCents_display).toBe('$123.45');
    expect(obj.spend_limit_cents_display).toBe('-$0.50');
  });

  it('recognizes credentials and rejects cycles or oversized results rather than truncating', () => {
    expect(credentialLike('vcp_FAKE_credential')).toBe(true);
    expect(credentialLike('ordinary-config')).toBe(false);
    const circular = {}; circular.loop = circular;
    expect(() => compact(circular)).toThrow(/Cyclic/);
    expect(() => compact({ note: 'normal'.repeat(2000) })).toThrow(/safe response limit/);
  });

  it('keeps a production banner and redacts JSON embedded in MCP text', () => {
    const plain = shapeVercelResult({ authCode: 'FAKEcode' }, { mode: 'preview' });
    expect(plain.authCode).toBe('[hidden]');
    const out = shapeMcpResult({ content: [{ type: 'text', text:
      JSON.stringify({ records: [{ secret: 'FAKEpassword' }] }) }] },
    { connection: { mode: 'production' } });
    const value = JSON.parse(out.content[0].text);
    expect(value.mode).toBe('PRODUCTION');
    expect(value.result.records[0].secret).toBe('[hidden]');
  });
});
