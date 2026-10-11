#!/usr/bin/env node
// Search the pinned official JSON, not the SDK. Output is intentionally bounded.
import fs from 'node:fs';

const file = new URL('../vendor/vercel-openapi/openapi-2026-10-11.json', import.meta.url);
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const words = process.argv.slice(2).join(' ').toLowerCase().trim().split(/\s+/).filter(Boolean);
if (!words.length) {
  console.error('Usage: node scripts/openapi-find.mjs "<operation words>"');
  process.exitCode = 2;
} else {
  let printed = 0;
  const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue;
      const searchable = [method, path, op.operationId, op.summary, op.description, ...(op.tags || [])].join(' ').toLowerCase();
      if (!words.every(word => searchable.includes(word))) continue;
      const params = [...(pathItem.parameters || []), ...(op.parameters || [])].map(p =>
        p.$ref ? p.$ref.split('/').at(-1) : p.name + ':' + p.in).join(', ');
      console.log(method.toUpperCase(), path, '|', String(op.summary || op.operationId || '').slice(0, 100),
        '| parameters:', params.slice(0, 240));
      if (++printed >= 20) break;
    }
    if (printed >= 20) break;
  }
  if (!printed) console.log('No matching operations.');
}
