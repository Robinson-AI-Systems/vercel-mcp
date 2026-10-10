// Core-imports check: src/core/ is contract-generic (the hub extracts it into robinson-mcp-core), so no file under it
// may import from src/vercel/ or src/tools/, import a Vercel package, or mention api.vercel.com.
import fs from 'node:fs';
import path from 'node:path';

const SPECIFIER = /(?:\bimport\s+(?:[^'"]*?\sfrom\s+)?|\bexport\s+[^'"]*?\sfrom\s+|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return /\.(?:c|m)?js$/.test(entry.name) ? [full] : [];
  });
}

/** @returns {{ files: number, failures: string[] }} */
export function checkCoreImports(root) {
  const core = path.join(root, 'src', 'core');
  const forbidden = [path.join(root, 'src', 'vercel'), path.join(root, 'src', 'tools')];
  const failures = [];
  const files = listFiles(core);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    if (/api\.vercel\.com/.test(text)) failures.push(`${rel}: mentions api.vercel.com`);
    for (const [, spec] of text.matchAll(SPECIFIER)) {
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        if (forbidden.some((dir) => target === dir || target.startsWith(dir + path.sep))) {
          failures.push(`${rel}: imports ${spec} (Vercel-specific code)`);
        }
      } else if (/^(?:@vercel\/|vercel$)/.test(spec)) failures.push(`${rel}: imports package ${spec}`);
    }
  }
  return { files: files.length, failures };
}

function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const { files, failures } = checkCoreImports(root);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Core imports: ${files} file(s) in src/core, none Vercel-specific`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
