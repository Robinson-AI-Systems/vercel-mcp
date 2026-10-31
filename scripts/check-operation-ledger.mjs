// Ledger check: docs/operation-ledger.json must pass CAP-1's validation
// (duplicate/orphan/missing-row) and equal a fresh build from the living
// records, and docs/OPERATION-LEDGER.md must equal the generated gap
// report. Regenerate with `node scripts/generate-operation-ledger.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGapReport, validateLedger } from './operation-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'docs/operation-ledger.json');
const REPORT = path.join(ROOT, 'docs/OPERATION-LEDGER.md');

function main() {
  const failures = [];
  let ledger = null;
  try {
    ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  } catch (error) {
    failures.push(`docs/operation-ledger.json unreadable: ${error.message}`);
  }
  if (ledger) {
    failures.push(...validateLedger(ledger));
    let report = '';
    try {
      report = fs.readFileSync(REPORT, 'utf8');
    } catch (error) {
      failures.push(`docs/OPERATION-LEDGER.md unreadable: ${error.message}`);
    }
    if (report && report !== renderGapReport(ledger)) {
      failures.push('docs/OPERATION-LEDGER.md differs from the generated gap report (stale or hand-edited)');
    }
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    console.error('Regenerate with: node scripts/generate-operation-ledger.mjs');
    process.exitCode = 1;
  } else {
    console.log(`Operation ledger check passed: ${ledger.counts.total} rows ` +
      `(${ledger.counts.rest} snapshot + ${ledger.counts.sdk} SDK), no drift`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
