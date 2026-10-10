// Write-safety check, starting form (B-7 adds the full declaration rules from docs/designs/BATCH-B.md §3).
// Checks every registered tool: a `vercel_` name; an explicit `writes` boolean; a write tool takes `dryRun` and
// `confirm` and declares its write contract. With no tools registered it says so and passes.
/** @returns {string[]} failures */
export function checkWrites(tools) {
  const failures = [];
  for (const tool of tools) {
    const name = tool?.name || '(unnamed)';
    if (!/^vercel_[a-z0-9_]+$/.test(name)) failures.push(`${name}: name must start with vercel_`);
    if (typeof tool.writes !== 'boolean') failures.push(`${name}: must declare writes: true or false`);
    if (tool.writes) {
      const p = tool.inputSchema?.properties;
      if (!p?.dryRun || !p?.confirm) failures.push(`${name}: write tool missing dryRun/confirm inputs`);
      if (!tool.writeContract) failures.push(`${name}: write tool missing its declared write contract (defineWrite)`);
    }
  }
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  if (!registry.tools.length) {
    console.log('Write safety: 0 tools registered — nothing to check');
    return;
  }
  const failures = checkWrites(registry.tools);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Write safety: ${registry.tools.length} tools checked`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
