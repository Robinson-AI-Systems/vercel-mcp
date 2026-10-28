// AUD-D (design D-D, VMCP-010): the Global Config family shapes through the
// shared delivery path. output() redacts at the result store's cap instead
// of throwing at the 8 KB inline bound inside the handler, so an oversized
// family result reaches the dispatcher's stored-handle fallback — the same
// contract as every other family — and inline-sized results are unchanged.
import { describe, it, expect, vi } from 'vitest';
import { output } from '../../src/tools/globalconfig-common.js';
import { compact } from '../../src/core/util.js';
import { shapeStoredMcpResult } from '../../src/vercel/result-delivery.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';
import { registry } from '../../src/tools/index.js';

const owner = 'resown_' + 'a'.repeat(64), other = 'resown_' + 'b'.repeat(64);
const conn = { account: 'team_ALPHA', profile: 'read_only', mode: 'preview',
  listing: 'catalog', resultOwner: owner };
const parse = r => JSON.parse(r.content[0].text);
function fixture() {
  const map = new Map();
  const db = {
    putResult: vi.fn(async ({ account, owner: o, body, summary }) => {
      const handle = 'res_' + 'e'.repeat(32);
      map.set(handle, { account, owner: o, body, summary });
      return { handle, expiresAt: '2026-10-12T00:00:00Z' };
    }),
    getResult: vi.fn(async ({ account, owner: o, handle }) => {
      const row = map.get(handle);
      return row?.owner === o && row.account === account ? row : null;
    })
  };
  return { db, map };
}

describe('AUD-D globalconfig shared delivery (VMCP-010)', () => {
  it('output() no longer throws on an oversized family result', () => {
    const big = { store: 'ecfg_FAKE', items: Array.from({ length: 200 }, (_, i) =>
      ({ key: 'key_' + i, data: 'v'.repeat(80) })) };
    expect(Buffer.byteLength(JSON.stringify(big))).toBeGreaterThan(8192);
    expect(() => output(big)).not.toThrow();
  });
  it('an oversized globalconfig read returns the stored-handle contract, readable only by the same connection', async () => {
    const { db } = fixture();
    const big = { store: 'ecfg_FAKE', items: Array.from({ length: 200 }, (_, i) =>
      ({ key: 'key_' + i, data: 'v'.repeat(80) })) };
    const shaped = await shapeStoredMcpResult(output(big), {
      connection: conn, db, readOnly: true, tool: 'vercel_globalconfig_list_items'
    });
    const receipt = parse(shaped);
    expect(receipt.status).toBe('stored');
    expect(receipt.handle).toMatch(/^res_[a-f0-9]{32}$/);
    const first = await dispatchReadOnlyTool({ registry, name: 'vercel_get_result',
      args: { handle: receipt.handle, page: 0, fields: 'store' }, connection: conn, db });
    expect(parse(first).records[0].store).toBe('ecfg_FAKE');
    expect(parse(first).count).toBe(1);
    const forbidden = await dispatchReadOnlyTool({ registry, name: 'vercel_get_result',
      args: { handle: receipt.handle }, connection: { ...conn, resultOwner: other }, db });
    expect(forbidden.isError).toBe(true);
  });
  it('inline-sized family output is byte-identical to the previous self-shaped form', () => {
    const small = { store: 'ecfg_FAKE', name: 'Fixture', itemCount: 3 };
    expect(output(small).content[0].text).toBe(JSON.stringify(compact(small)));
  });
  it('output() still redacts credential-shaped values at the store cap', () => {
    const shaped = output({ note: 'contains vcp_FAKE_secret_identifier', token: 'vcp_FAKE_x' });
    expect(shaped.content[0].text).not.toContain('vcp_FAKE_secret_identifier');
    expect(parse(shaped).token).toBe('[hidden]');
  });
});
