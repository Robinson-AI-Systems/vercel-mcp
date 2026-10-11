// Secret scan: fails when any tracked file holds something shaped like a real credential or a real Vercel/Neon ID.
// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-secrets.mjs @ e2f90e8 (Vercel patterns added).
// Reports the file and the kind only — never the matched value.
//   node scripts/check-secrets.mjs              scan every file `git ls-files` lists (what CI checks out)
//   node scripts/check-secrets.mjs --file a b   scan the named files only
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const FAKE = /FAKE/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'example.test', 'example.com', 'host']);

// Vercel's unmodified public API document includes a real-ID-shaped example.
// Only this exact reviewed upstream blob is exempt, never a modified copy.
export const PINNED_OPENAPI = Object.freeze({
  path: 'vendor/vercel-openapi/openapi-2026-10-11.json',
  sha256: 'af1db6e9c95e446468f0c3974653298afe8079db03ee2872429a65cb60a72544'
});
export function isPinnedOpenApiSnapshot(path, bytes) {
  return path === PINNED_OPENAPI.path &&
    createHash('sha256').update(bytes).digest('hex') === PINNED_OPENAPI.sha256;
}

// [kind, pattern, may a value containing FAKE be exempt?]
const RULES = [
  // Vercel access tokens: personal (vcp_), integration (vci_), app access/refresh (vca_/vcr_), API keys (vck_).
  ['Vercel token', /\bvc[pikar]_[A-Za-z0-9_-]{20,}/g, true],
  ['Vercel Blob token', /\bvercel_blob_rw_[A-Za-z0-9_]{16,}/g, true],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{12,}/g, false],
  ['Stripe test key', /\b(?:sk|rk)_test_[A-Za-z0-9]{12,}/g, true],
  ['webhook secret', /\bwhsec_[A-Za-z0-9+/=]{12,}/g, true],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/g, false],
  ['Vercel ID', /\b(?:team|prj|dpl)_[A-Za-z0-9]{20,}\b/g, true],
  ['Neon endpoint ID', /\bep-[a-z]+-[a-z]+-[a-z0-9]{6,}\b/g, false]
];
const DB_URL = /postgres(?:ql)?:\/\/[^\s/@:]+:([^\s/@]+)@\[?([A-Za-z0-9][A-Za-z0-9.:-]*?)\]?(?::\d+)?(?=[/?\s'"`]|$)/gi;

/** @returns {string[]} the distinct kinds of sensitive material found in `text` */
export function scanText(text) {
  const found = new Set();
  for (const [kind, pattern, fakeAllowed] of RULES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (fakeAllowed && FAKE.test(match[0])) continue;
      found.add(kind);
    }
  }
  DB_URL.lastIndex = 0;
  for (const match of text.matchAll(DB_URL)) {
    if (!LOCAL_HOSTS.has(match[2].toLowerCase())) found.add('database URL with a password');
  }
  return [...found];
}

/** @returns {{ path: string, types: string[] }[]} */
export function scanFiles(paths) {
  const failures = [];
  for (const path of paths) {
    if (!fs.existsSync(path) || !fs.statSync(path).isFile()) continue;
    const bytes = fs.readFileSync(path);
    if (isPinnedOpenApiSnapshot(path, bytes)) continue; // exact public snapshot, verified by hash
    if (bytes.includes(0)) continue; // binary
    const types = scanText(bytes.toString('utf8'));
    if (types.length) failures.push({ path, types });
  }
  return failures;
}

export function trackedFiles(cwd = process.cwd()) {
  return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function main() {
  const paths = process.argv[2] === '--file' ? process.argv.slice(3) : trackedFiles();
  if (!paths.length) {
    console.error('Secret scan: no files to scan (is this a git checkout?)');
    process.exitCode = 1;
    return;
  }
  const failures = scanFiles(paths);
  if (failures.length) {
    for (const issue of failures) console.error(`Sensitive material detected in ${issue.path}: ${issue.types.join(', ')}`);
    console.error('Use fake values only (vcp_FAKE…, vercel_blob_rw_FAKE…, team_FAKE…). Never commit a real one.');
    process.exitCode = 1;
  } else console.log(`Secret scan passed (${paths.length} tracked files)`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
