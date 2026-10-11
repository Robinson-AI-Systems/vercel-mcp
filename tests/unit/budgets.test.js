import {describe,it,expect} from 'vitest';
import {checkBudgets,measureBudgets,countTokens,COMPACT_TOKENS_MAX,LISTING_TOKENS_MAX} from '../../scripts/check-budgets.mjs';
import {registry} from '../../src/tools/index.js';
const profiles=['read_only','everyday','full'];
const sample=(name,blob='')=>({
  name,description:'Read fixture resource',writes:false,profiles,
  inputSchema:{type:'object',properties:{blob:{type:'string',description:blob}},additionalProperties:false}
});
describe('C-2c pinned tokenizer budgets',()=>{
  it('counts BPE tokens, not the old JSON characters divided by four',()=>{
    const fixture={a:'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'};
    expect(countTokens(fixture)).toBeGreaterThan(0);
    expect(countTokens(fixture)).not.toBe(Math.ceil(JSON.stringify(fixture).length/4));
  });
  it('keeps all shipped profile listings and schemas below strict ceilings',()=>{
    const m=measureBudgets(registry.tools);
    expect(m.compact).toBeLessThan(COMPACT_TOKENS_MAX);
    expect(m.catalog).toBeLessThan(LISTING_TOKENS_MAX);
    expect(Math.max(...m.schemas.map(s=>s.tokens))).toBeLessThan(1500);
    expect(checkBudgets(registry.tools)).toEqual([]);
  });
  it('fails a planted 161-character description',()=>{
    expect(checkBudgets([sample('vercel_x'),{...sample('vercel_y'),description:'x'.repeat(161)}]))
      .toContain('vercel_y: description 161 characters (max 160)');
  });
  it('fails oversize schemas, including for tools excluded from everyday discovery',()=>{
    const tools=[{...sample('vercel_owner'),profiles:['full'],
      inputSchema:{type:'object',description:'0123456789'.repeat(2000)}}];
    expect(checkBudgets(tools).some(x=>x.includes('schema')&&x.includes('vercel_owner'))).toBe(true);
  });
  it('enforces the compact limit on allowed workflow discovery tools',()=>{
    const tools=Array.from({length:18},(_,i)=>sample(`vercel_workflow_fixture_${i}`,'y'.repeat(4500)));
    const m=measureBudgets(tools);
    expect(m.compact).toBeGreaterThanOrEqual(COMPACT_TOKENS_MAX);
    expect(checkBudgets(tools).some(x=>x.startsWith('compact listing'))).toBe(true);
  });
  it('enforces the everyday catalog limit even when compact remains small',()=>{
    const tools=Array.from({length:75},(_,i)=>sample(`vercel_resource_fixture_${i}`,'y'.repeat(4500)));
    const m=measureBudgets(tools);
    expect(m.catalog).toBeGreaterThanOrEqual(LISTING_TOKENS_MAX);
    expect(m.compact).toBeLessThan(COMPACT_TOKENS_MAX);
    expect(checkBudgets(tools).some(x=>x.startsWith('tool listing'))).toBe(true);
  });
});
