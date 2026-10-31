#!/usr/bin/env node
// Generate CAP-1's operation ledger: docs/operation-ledger.json (the
// machine-readable rows) and docs/OPERATION-LEDGER.md (the family gap
// report). Run after the snapshot, the OPS table, the hand-built map or
// a universal-door policy changes; `npm run check` fails if the
// committed artifacts differ from a fresh build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger, renderGapReport } from './operation-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledger = buildLedger();
fs.writeFileSync(path.join(ROOT, 'docs/operation-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'docs/OPERATION-LEDGER.md'), renderGapReport(ledger));
console.log(`Operation ledger generated: ${ledger.counts.total} rows ` +
  `(${ledger.counts.rest} snapshot + ${ledger.counts.sdk} SDK), ` +
  `dispositions ${JSON.stringify(ledger.counts.byDisposition)}`);
