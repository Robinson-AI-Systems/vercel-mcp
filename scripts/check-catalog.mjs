// Catalog check: docs/TOOL-CATALOG.md stays internally consistent and the code never registers a tool the catalog
// does not list. Checks: each "## … — N" section has exactly N tool rows; every tool name starts with `vercel_` and
// appears once; the Totals table's "Hand-built total" and "All tools" match the rows; every registered tool is listed.
import fs from 'node:fs';

const CATALOG = new URL('../docs/TOOL-CATALOG.md', import.meta.url);

/** @returns {{ sections: { title: string, declared: number|null, tools: string[] }[], totals: Record<string, number> }} */
export function parseCatalog(text) {
  const sections = [];
  const totals = {};
  let current = null;
  let inTotals = false;
  for (const line of text.split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      inTotals = heading[1].trim() === 'Totals';
      const declared = / — (\d+)\b/.exec(heading[1]);
      current = inTotals ? null : { title: heading[1].trim(), declared: declared ? Number(declared[1]) : null, tools: [] };
      if (current) sections.push(current);
      continue;
    }
    const row = /^\| `(vercel_[a-z0-9_]+)` \|/.exec(line) || /^\| `([^`]+)` \|/.exec(line);
    if (row && current) current.tools.push(row[1]);
    const total = /^\| \*\*(Hand-built total|All tools)\*\* \| \*\*(\d+)\*\* \|/.exec(line);
    if (total && inTotals) totals[total[1]] = Number(total[2]);
  }
  return { sections, totals };
}

/** @returns {string[]} failures */
export function checkCatalog(text, registeredNames = []) {
  const { sections, totals } = parseCatalog(text);
  const failures = [];
  const seen = new Set();
  let all = 0;
  let universal = 0;
  for (const s of sections) {
    if (s.declared !== null && s.declared !== s.tools.length) {
      failures.push(`"${s.title}" says ${s.declared} tools but lists ${s.tools.length}`);
    }
    for (const name of s.tools) {
      if (!/^vercel_[a-z0-9_]+$/.test(name)) failures.push(`${name}: tool names must start with vercel_ (snake case)`);
      if (seen.has(name)) failures.push(`${name}: listed twice`);
      seen.add(name);
    }
    all += s.tools.length;
    if (/universal tools/i.test(s.title)) universal += s.tools.length;
  }
  if (!all) failures.push('no tool rows found — has the table format changed?');
  if (totals['Hand-built total'] !== all - universal) {
    failures.push(`Totals: Hand-built total says ${totals['Hand-built total']} but the tables list ${all - universal}`);
  }
  if (totals['All tools'] !== all) failures.push(`Totals: All tools says ${totals['All tools']} but the tables list ${all}`);
  for (const name of registeredNames) {
    if (!seen.has(name)) failures.push(`${name}: registered in src/tools but missing from docs/TOOL-CATALOG.md`);
  }
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  const text = fs.readFileSync(CATALOG, 'utf8');
  const failures = checkCatalog(text, registry.tools.map((t) => t.name));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    const all = parseCatalog(text).sections.reduce((n, s) => n + s.tools.length, 0);
    console.log(`Catalog check passed: ${all} catalog tools, ${registry.tools.length} registered`);
  }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
