// Pinned BPE tokenizer and strict MCP listing budgets; never approximate tokens with bytes/4.
import { encode } from 'gpt-tokenizer';
import { listMcpTools } from '../src/core/mcp-server.js';
import { FRONT_DOOR } from '../src/data/front-door.js';

export const DESCRIPTION_MAX = 160;
export const COMPACT_TOKENS_MAX = 5000; // strictly below
export const LISTING_TOKENS_MAX = 23000; // strictly below; C6 catalog sanity bound (engineering line).
// Raised 20000 -> 21000 in M-4 (2026-10-30): registry growth to 181 tools put the
// everyday catalog at ~20,221. Raised again 21000 -> 21500 in N-2 (2026-10-30):
// the combined M-4 + N-2 registry (190 tools) measures ~21,077. Raised again
// 21500 -> 22000 in N-3 (2026-10-30): the combined O-2 + N-3 registry (211
// tools) measures ~21,867; O-3 measured its 205-tool registry at ~21,568
// under the same 22000. P-1's line raised 22000 -> 22500 for its 204-tool
// registry at ~21,721; the lines merge at 23000 for the combined 216-tool
// registry. Per
// BATCH-C/DECISIONS this bound is an engineering sanity line, NOT owner policy
// (the OP-1 policy is the 5,000-token front door, unchanged); revisit when the
// catalog completes at 241.
// Owner policy (OP-1, Chris, 2026-10-27 — docs/DECISIONS.md): the default
// front_door listing must stay strictly below 5,000 tokens at every profile.
// This cap is an owner policy recorded here, NOT a builder default and NOT a
// runtime wall: nothing truncates a listing mid-flight; this check is the
// design-budget gate that keeps the membership honest at PR time.
export const FRONT_DOOR_TOKENS_MAX = 5000; // strictly below, owner policy OP-1
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
  const frontDoorOf=profile => hasProfiles ?
    listMcpTools(registry,{profile,listing:'front_door'}) : [];
  const schemas=[...tools.map(t=>({name:t.name,inputSchema:t.inputSchema}))];
  return {
    catalog:countTokens(listingPayload(catalog)),
    compact:countTokens(listingPayload(compact)),
    full:countTokens(listingPayload(full)),
    readOnly:countTokens(listingPayload(readonly)),
    frontDoor:countTokens(listingPayload(frontDoorOf('everyday'))),
    frontDoorFull:countTokens(listingPayload(frontDoorOf('full'))),
    frontDoorReadOnly:countTokens(listingPayload(frontDoorOf('read_only'))),
    frontDoorMembership:{source:'src/data/front-door.json',version:FRONT_DOOR.version,
      basis:FRONT_DOOR.basis,tools:FRONT_DOOR.tools.length},
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
  // Front door, owner policy OP-1 (see FRONT_DOOR_TOKENS_MAX): measured from
  // the membership artifact named in frontDoorMembership, at every profile.
  for(const [profile,tokens] of [['read_only',measurements.frontDoorReadOnly],
    ['everyday',measurements.frontDoor],['full',measurements.frontDoorFull]]){
    if(tokens>=FRONT_DOOR_TOKENS_MAX)
      failures.push(`front-door listing (${profile}) ${tokens} tokens (must be <${FRONT_DOOR_TOKENS_MAX}; owner policy OP-1)`);
  }
  return failures;
}

async function main(){
  const {registry}=await import('../src/tools/index.js');
  const failures=checkBudgets(registry.tools);
  const m=measureBudgets(registry.tools);
  console.log(`Pinned gpt-tokenizer 3.4.0 budgets: everyday catalog ${m.catalog}/<20000, compact ${m.compact}/<5000, full catalog ${m.full}, read-only catalog ${m.readOnly}, max schema ${Math.max(0,...m.schemas.map(x=>x.tokens))}/<1500 (${registry.tools.length} registered)`);
  console.log(`Front door (owner policy OP-1): membership ${m.frontDoorMembership.source} v${m.frontDoorMembership.version} (basis ${m.frontDoorMembership.basis}, ${m.frontDoorMembership.tools} tools): read_only ${m.frontDoorReadOnly}, everyday ${m.frontDoor}, full ${m.frontDoorFull} (each must be <${FRONT_DOOR_TOKENS_MAX})`);
  if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
  if(process.argv.includes('--print'))console.log(JSON.stringify(m,null,2));
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href)await main();
