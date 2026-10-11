#!/usr/bin/env node
// Compare two real OpenAPI snapshots. Does not reconstruct or rewrite either file.
import fs from 'node:fs';
const paths = process.argv.slice(2);
if (paths.length !== 2) {
  console.error('Usage: node scripts/openapi-diff.mjs OLD.json NEW.json');
  process.exitCode = 2;
} else {
  const [oldSpec, newSpec] = paths.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);
  const extract = spec => new Map(Object.entries(spec.paths || {}).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => methods.has(method))
      .map(([method, data]) => [method.toUpperCase() + ' ' + path, JSON.stringify(data)])));
  const before = extract(oldSpec), after = extract(newSpec);
  const added = [...after.keys()].filter(key => !before.has(key));
  const removed = [...before.keys()].filter(key => !after.has(key));
  const changed = [...after.keys()].filter(key => before.has(key) && before.get(key) !== after.get(key));
  for (const [name, values] of [['ADDED', added], ['REMOVED', removed], ['CHANGED', changed]]) {
    console.log(name + ': ' + values.length);
    for (const key of values.slice(0, 50)) console.log('  ' + key);
    if (values.length > 50) console.log('  ... ' + (values.length - 50) + ' more');
  }
}
