// Enforce safety declarations against documented catalog risk marks.
import { readFileSync } from 'node:fs';
const WRITE_MARKS = new Set(['P', 'Cp', 'PR', 'C', 'D', '$', 'A', '1x']);
export function catalogSafety(text) {
  const safety = new Map(), tick = String.fromCharCode(96);
  const toolName = new RegExp('^' + tick + '(vercel_[a-z0-9_]+)' + tick + '$');
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('| ' + tick + 'vercel_')) continue;
    const cells = line.split('|').map(cell => cell.trim());
    const found = toolName.exec(cells[1] || '');
    if (found && cells.length >= 5) safety.set(found[1], cells[3]);
  }
  return safety;
}
function markSet(safety) {
  return new Set(String(safety).split(/\s+/).filter(s => WRITE_MARKS.has(s)));
}
export function checkWrites(tools, catalogText = '') {
  const failures = [], marks = catalogSafety(catalogText);
  for (const tool of tools) {
    const name = tool?.name || '(unnamed)';
    if (!/^vercel_[a-z0-9_]+$/.test(name)) failures.push(name + ': name must start with vercel_');
    if (typeof tool?.writes !== 'boolean') {
      failures.push(name + ': must declare writes: true or false');
      continue;
    }
    const safety = marks.get(name), risks = safety === undefined ? null : markSet(safety);
    if (risks && (risks.size > 0) !== tool.writes) {
      failures.push(name + ': catalog Safety mark disagrees with writes declaration');
    }
    if (!tool.writes) continue;
    const props = tool.inputSchema?.properties;
    if (!props?.dryRun || !props?.confirm) failures.push(name + ': write tool missing dryRun/confirm inputs');
    if (!tool.writeContract) {
      failures.push(name + ': write tool missing its declared write contract (defineWrite)');
      continue;
    }
    for (const field of ['production','targets']) {
      if (tool.writeContract[field] !== true) failures.push(name + ': write contract missing ' + field + '() declaration');
    }
    for (const [mark,field,label] of [['$','spend','spend()'],['A','access','access()'],['1x','secretOut','secretOut']]) {
      if (risks?.has(mark) && !tool.writeContract[field]) {
        failures.push(name + ': catalog ' + mark + ' requires ' + label + ' declaration');
      }
      if (risks && !risks.has(mark) && tool.writeContract[field]) {
        failures.push(name + ': unexpected ' + label + ' declaration absent from catalog Safety');
      }
    }
    if (tool.risk?.spend && !tool.writeContract.spend) failures.push(name + ': spend risk missing spend() contract');
    if (tool.risk?.access && !tool.writeContract.access) failures.push(name + ': access risk missing access() contract');
    if (tool.secretOut && !tool.writeContract.secretOut) failures.push(name + ': secret output missing secretOut contract');
  }
  return failures;
}
async function main() {
  const { registry } = await import('../src/tools/index.js');
  const catalog = readFileSync(new URL('../docs/TOOL-CATALOG.md', import.meta.url), 'utf8');
  const failures = checkWrites(registry.tools, catalog);
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('Write safety: ' + registry.tools.length + ' declarations match catalog');
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) await main();
