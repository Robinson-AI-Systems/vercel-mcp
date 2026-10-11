import { describe, it, expect } from 'vitest';
import { checkWrites, catalogSafety } from '../../scripts/check-writes.mjs';
import { registry } from '../../src/tools/index.js';
import { readFileSync } from 'node:fs';

const tick = String.fromCharCode(96);
const catalog = [
  '| Tool | What it does | Safety | Audience | Profile | App | Card |',
  '|---|---|---|---|---|---|---|',
  '| ' + tick + 'vercel_sample_read' + tick + ' | Read | — | B | R | — | fixture |',
  '| ' + tick + 'vercel_sample_write' + tick + ' | Write | P | B | E | — | fixture |',
  '| ' + tick + 'vercel_sample_paid' + tick + ' | Paid | $ Cp A 1x | O | F | — | fixture |'
].join('\n');
const write = { name: 'vercel_sample_write', writes: true,
  inputSchema: { properties: { dryRun: { type: 'boolean' }, confirm: { type: 'boolean' } } },
  writeContract: { production: true, targets: true } };
const paid = { ...write, name: 'vercel_sample_paid',
  writeContract: { production: true, targets: true, spend: true, access: true, secretOut: true } };

describe('B-7 static write safety contracts', () => {
  it('passes every registered real tool against the authoritative catalog', () => {
    const actual = readFileSync('docs/TOOL-CATALOG.md', 'utf8');
    expect(checkWrites(registry.tools, actual)).toEqual([]);
  });
  it('parses risk only from actual catalog rows', () => {
    expect(catalogSafety(catalog).get('vercel_sample_paid')).toBe('$ Cp A 1x');
    expect(catalogSafety('a description mentioning ' + tick + 'vercel_sample_paid' + tick)).toEqual(new Map());
  });
  it('rejects tools missing names or writes metadata', () => {
    expect(checkWrites([{ name:'wrong' }],catalog)).toEqual(expect.arrayContaining([
      'wrong: name must start with vercel_', 'wrong: must declare writes: true or false'
    ]));
  });
  it('rejects write tools missing dryRun, confirm or a complete contract', () => {
    expect(checkWrites([{ ...write, inputSchema:{properties:{}} }],catalog))
      .toContain('vercel_sample_write: write tool missing dryRun/confirm inputs');
    expect(checkWrites([{ ...write, writeContract:null }],catalog))
      .toContain('vercel_sample_write: write tool missing its declared write contract (defineWrite)');
    expect(checkWrites([{ ...write, writeContract:{targets:true} }],catalog))
      .toContain('vercel_sample_write: write contract missing production() declaration');
    expect(checkWrites([{ ...write, writeContract:{production:true} }],catalog))
      .toContain('vercel_sample_write: write contract missing targets() declaration');
  });
  it('rejects catalog mismatches for both reads and writes', () => {
    expect(checkWrites([{...write,writes:false}],catalog))
      .toContain('vercel_sample_write: catalog Safety mark disagrees with writes declaration');
    expect(checkWrites([{...write,name:'vercel_sample_read'}],catalog))
      .toContain('vercel_sample_read: catalog Safety mark disagrees with writes declaration');
  });
  it('demands dollar, access and one-time-secret declarations for each safety mark', () => {
    for(const [field,label] of [['spend','spend()'],['access','access()'],['secretOut','secretOut']]) {
      const candidate={...paid, writeContract:{...paid.writeContract,[field]:false}};
      expect(checkWrites([candidate],catalog).some(msg=>msg.includes('requires '+label))).toBe(true);
    }
  });
  it('rejects risk metadata or secret outputs without matching contracts', () => {
    expect(checkWrites([{...write,risk:{spend:true}}],catalog))
      .toContain('vercel_sample_write: spend risk missing spend() contract');
    expect(checkWrites([{...write,risk:{access:true}}],catalog))
      .toContain('vercel_sample_write: access risk missing access() contract');
    expect(checkWrites([{...write,secretOut:true}],catalog))
      .toContain('vercel_sample_write: secret output missing secretOut contract');
    expect(checkWrites([{...write,writeContract:{...write.writeContract,spend:true}}],catalog))
      .toContain('vercel_sample_write: unexpected spend() declaration absent from catalog Safety');
  });
  it('passes correctly declared reads and ordinary and risky writes', () => {
    expect(checkWrites([{name:'vercel_sample_read',writes:false},write,paid],catalog)).toEqual([]);
  });
});
