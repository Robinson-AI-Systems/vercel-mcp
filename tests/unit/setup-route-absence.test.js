// AUD-AV: the setup route is deleted, not relocated (owner ruling,
// sign-in cleanup dossier §2.6). The route files must not exist and
// no source or route file may reference the route string — the
// tree-wide grep pin, mirroring AUD-AW's link-scan pattern.
// Historical docs and pr-cards may keep the string; src/ and api/
// may not.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

describe('AUD-AV setup route absence', () => {
  it('the route file and the page handler do not exist', () => {
    expect(existsSync(join(ROOT, 'api/vercel/setup.js'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/vercel/setup.js'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/core/pending-inputs.js'))).toBe(false);
  });

  it('no file under src/ or api/ references the deleted route', () => {
    const offenders = [];
    for (const dir of ['src', 'api']) {
      for (const file of jsFiles(join(ROOT, dir))) {
        if (readFileSync(file, 'utf8').includes('/api/vercel/setup')) {
          offenders.push(file.slice(ROOT.length));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
