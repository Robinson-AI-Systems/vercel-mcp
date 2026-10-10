// DRIFT-PROTOCOL checklist B, the part CI can enforce: a PR that changes code must also update the living docs.
// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-docs-updated.mjs @ e2f90e8.
// A PR that changes api/, src/ or scripts/ must change docs/STATUS.md and a PR card or work-index.json, and
// docs/TOOL-CATALOG.md when a tool module under src/tools/ changes — unless the PR body says
// "Docs-update: not needed — <reason>". The PR body is read from GITHUB_EVENT_PATH; the base from BASE_SHA.
// Locally (no BASE_SHA) it compares against origin/main when that ref exists.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const EXCEPTION = /Docs-update: not needed — .{8,}/;

/** @returns {string[]} what is missing (empty = pass) */
export function missingDocs(changed, body = '') {
  const has = (path) => changed.includes(path);
  const code = changed.some((path) => /^(api|src|scripts)\//.test(path));
  const tools = changed.some((path) => /^src\/tools\/(?!index\.js$)/.test(path));
  if (!code || EXCEPTION.test(body || '')) return [];
  const missing = [];
  if (!has('docs/STATUS.md')) missing.push('docs/STATUS.md');
  if (!changed.some((path) => /^docs\/pr-cards\/(?!README\.md$|validate-index\.py$)/.test(path))) {
    missing.push('a PR card or docs/pr-cards/work-index.json');
  }
  if (tools && !has('docs/TOOL-CATALOG.md')) missing.push('docs/TOOL-CATALOG.md');
  return missing;
}

function gitOk(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function main() {
  let base = process.env.BASE_SHA || '';
  if (base && !/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid BASE_SHA');
  if (!base) base = gitOk(['merge-base', 'origin/main', 'HEAD']) || '';
  if (!base) {
    console.log('Docs check: no PR base (push to main, or no origin/main locally) — diff rule not applicable.');
    return;
  }
  const changed = (gitOk(['diff', '--name-only', base, 'HEAD', '--']) ?? '').split('\n').filter(Boolean);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath && fs.existsSync(eventPath) ? JSON.parse(fs.readFileSync(eventPath, 'utf8')) : null;
  const missing = missingDocs(changed, event?.pull_request?.body || '');
  if (missing.length) {
    console.error(`Docs check failed: code changed but not ${missing.join(', ')} (DRIFT-PROTOCOL checklist B).`);
    process.exitCode = 1;
  } else console.log(`Docs reconciliation check passed (${changed.length} changed files)`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
