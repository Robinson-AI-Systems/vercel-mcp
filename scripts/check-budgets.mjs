// Token-budget check, starting form (C-2 adds per-profile and compact-listing budgets, docs/designs/BATCH-C.md).
// Checks every registered tool: listing description ≤160 characters; the whole listing ≤20,000 estimated tokens.
//   node scripts/check-budgets.mjs [--print]
export const DESCRIPTION_MAX = 160;
export const LISTING_TOKENS_MAX = 20000;
export const estimateTokens = (value) => Math.ceil(JSON.stringify(value).length / 4);

/** @returns {string[]} failures */
export function checkBudgets(tools) {
  const failures = [];
  for (const t of tools) {
    const length = (t.description || '').length;
    if (!length) failures.push(`${t.name}: missing description`);
    if (length > DESCRIPTION_MAX) failures.push(`${t.name}: description ${length} characters (max ${DESCRIPTION_MAX})`);
  }
  const listing = tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));
  const tokens = estimateTokens(listing);
  if (tokens > LISTING_TOKENS_MAX) failures.push(`tool listing ~${tokens} tokens (max ${LISTING_TOKENS_MAX})`);
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  if (!registry.tools.length) {
    console.log('Token budgets: 0 tools registered — nothing to check');
    return;
  }
  const failures = checkBudgets(registry.tools);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Token budgets pass for ${registry.tools.length} tools`);
  if (process.argv.includes('--print')) console.log(`Listing estimated tokens: ${estimateTokens(registry.tools)}`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
