// Pinned BPE tokenizer and strict MCP listing budgets; never approximate tokens with bytes/4.
import { encode } from 'gpt-tokenizer';
import { listMcpTools } from '../src/core/mcp-server.js';

export const DESCRIPTION_MAX = 160;
export const COMPACT_TOKENS_MAX = 5000; // strictly below
export const LISTING_TOKENS_MAX = 20000; // strictly below
export const SCHEMA_TOKENS_MAX = 1500; // strictly below
export const countTokens = value => encode(JSON.stringify(value ?? null)).length;
// Retain the old export name for check consumers, but return real BPE tokens.
export const estimateTokens = countTokens;
const listingPayload = list => list.map(({name,description,inputSchema,annotations}) =>
  ({name,description,inputSchema,annotations}));

export function measureBudgets(tools) {
  const registry={tools};
  const hasProfiles=tools.every(t=>Array.isArray(t.profiles));
  const catalog=hasProfiles ?
    listMcpTools(registry,{profile:'everyday',listing:'catalog'}) : tools;
  const compact=hasProfiles ?
    listMcpTools(registry,{profile:'everyday',listing:'compact'}) : [];
  const full=hasProfiles ?
    listMcpTools(registry,{profile:'full',listing:'catalog'}) : tools;
  const readonly=hasProfiles ?
    listMcpTools(registry,{profile:'read_only',listing:'catalog'}) : tools;
  const schemas=[...tools.map(t=>({name:t.name,inputSchema:t.inputSchema}))];
  return {
    catalog:countTokens(listingPayload(catalog)),
    compact:countTokens(listingPayload(compact)),
    full:countTokens(listingPayload(full)),
    readOnly:countTokens(listingPayload(readonly)),
    schemas:schemas.map(t=>({name:t.name,tokens:countTokens(t.inputSchema??{})}))
  };
}

/** @returns {string[]} all violations; use exactly the MCP-advertised schemas. */
export function checkBudgets(tools) {
  const failures=[];
  for(const t of tools){
    const length=(t.description||'').length;
    if(!length)failures.push(`${t.name}: missing description`);
    if(length>DESCRIPTION_MAX)
      failures.push(`${t.name}: description ${length} characters (max ${DESCRIPTION_MAX})`);
  }
  const measurements=measureBudgets(tools);
  for(const item of measurements.schemas){
    if(item.tokens>=SCHEMA_TOKENS_MAX)
      failures.push(`${item.name}: schema ${item.tokens} tokens (must be <${SCHEMA_TOKENS_MAX})`);
  }
  if(measurements.compact>=COMPACT_TOKENS_MAX)
    failures.push(`compact listing ${measurements.compact} tokens (must be <${COMPACT_TOKENS_MAX})`);
  if(measurements.catalog>=LISTING_TOKENS_MAX)
    failures.push(`tool listing ~${measurements.catalog} tokens (max ${LISTING_TOKENS_MAX})`);
  return failures;
}

async function main(){
  const {registry}=await import('../src/tools/index.js');
  const failures=checkBudgets(registry.tools);
  const m=measureBudgets(registry.tools);
  console.log(`Pinned gpt-tokenizer 3.4.0 budgets: everyday catalog ${m.catalog}/<20000, compact ${m.compact}/<5000, full catalog ${m.full}, read-only catalog ${m.readOnly}, max schema ${Math.max(0,...m.schemas.map(x=>x.tokens))}/<1500 (${registry.tools.length} registered)`);
  if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
  if(process.argv.includes('--print'))console.log(JSON.stringify(m,null,2));
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href)await main();
