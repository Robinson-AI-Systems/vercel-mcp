// CAP-1's generated operation ledger (AUD-BE, commissioned 2026-10-31).
// Builds one machine-readable row per operation in the pinned OpenAPI
// snapshot plus the SDK-only Blob workflows, from the server's own living
// records — never from a hand-maintained list:
//   enumeration + documented credential declarations: the vendored snapshot,
//     reached through src/vercel/openapi-index.js (the runtime's own index);
//   implementation evidence: src/vercel/operations.js (the pinned OPS table),
//     src/vercel/hand-built-map.js (operationId -> curated tool),
//     src/vercel/api-read-policy.js (the audited universal-read set),
//     src/vercel/sandbox-binary.js (the dedicated binary transport), and a
//     literal-reference scan of src/ for OPS dispatch files;
//   side-effect classification: the universal doors' own classifiers
//     (spend-operations.js, secret-operations.js).
// Fields no repo source records are carried as explicit unknowns (see
// GAPS below) — CAP-1's acceptance asks that every credential uncertainty
// stay visible, not that it be filled in. There is deliberately no
// generation date in the output: CAP-1's "checked date" is the snapshot's
// own retrieval date, and a dated artifact could never regenerate
// byte-identically for the drift check (scripts/check-operation-ledger.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiIndex, apiMetadata } from '../src/vercel/openapi-index.js';
import { readOpenApi } from '../src/vercel/openapi-validation.js';
import { OPENAPI_SNAPSHOT } from '../src/vercel/client.js';
import { OPS } from '../src/vercel/operations.js';
import { handBuiltReads, handBuiltWrites } from '../src/vercel/hand-built-map.js';
import { secretOperation, secretWriteOperation } from '../src/vercel/secret-operations.js';
import { spendOperation } from '../src/vercel/spend-operations.js';
import { auditedReadOps } from '../src/vercel/api-read-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const READ_METHODS = new Set(['GET', 'HEAD']);

// The dedicated Sandbox binary transport (src/vercel/sandbox-binary.js)
// builds these three URLs literally; they are implemented operations with
// no OPS-table entry and no hand-built-map entry. fs/mkdir is NOT among
// them (the transport binds only kinds read/write) and keeps its generic
// classification.
const DEDICATED_TRANSPORT = new Map([
  ['POST /v2/sandboxes/sessions/{sessionId}/fs/read', 'src/vercel/sandbox-binary.js'],
  ['POST /v2/sandboxes/sessions/{sessionId}/fs/write', 'src/vercel/sandbox-binary.js'],
  ['GET /v2/sandboxes/sessions/{sessionId}/cmd/{cmdId}/logs', 'src/vercel/sandbox-binary.js']
]);

// CAP-1 scope names "documented official SDK-only interfaces (including
// Blob)". The Blob file surface has no snapshot rows; blobOps() in
// src/vercel/blob.js wraps exactly these four functions of the pinned
// @vercel/blob package, one curated tool each (src/tools/blob.js).
const SDK_ROWS = [
  { operation: 'blob.list', sdkFunction: 'list', tool: 'vercel_blob_list', changes: false, summary: 'List files in a connected Blob store' },
  { operation: 'blob.head', sdkFunction: 'head', tool: 'vercel_blob_head', changes: false, summary: 'Read the metadata of one file in a connected Blob store' },
  { operation: 'blob.put', sdkFunction: 'put', tool: 'vercel_blob_put', changes: true, summary: 'Upload a file to a connected Blob store' },
  { operation: 'blob.del', sdkFunction: 'del', tool: 'vercel_blob_delete', changes: true, summary: 'Delete files from a connected Blob store' }
];

const GAPS = [
  { field: 'permissions', recordedAs: 'unknown',
    reason: 'No repo source or snapshot field records per-operation permissions, roles or entitlements; CAP-1\'s field is carried as an explicit unknown until a sourced entitlement table exists.' },
  { field: 'ownerUnit', recordedAs: null,
    reason: 'Per-operation owner units live only in prose batch dossiers; docs/TOOL-CATALOG.md sections are functional families, not units, so no machine-readable mapping exists to generate from.' },
  { field: 'tests.response', recordedAs: 'not_recorded',
    reason: 'Request shapes are validated against the pinned snapshot (tests.requestShape), but no per-operation response-test record exists in the repo.' },
  { field: 'liveProof', recordedAs: 'not_recorded',
    reason: 'Live acceptance is CAP-5\'s track by design; this ledger pins source evidence only and claims no live parity.' },
  { field: 'credentials.integrationInstallation', recordedAs: 'unknown',
    reason: 'The snapshot\'s bearerToken scheme does not distinguish personal, team-scoped and integration-installation tokens.' },
  { field: 'credentials.resourceSpecific', recordedAs: 'unknown on REST rows',
    reason: 'Resource-specific credentials (Blob store read-write tokens, Global Config tokens, Gateway keys) are not snapshot security schemes; the SDK rows, whose route is the store token, record documented.' }
];

let corpusCache;
function srcCorpus() {
  if (corpusCache) return corpusCache;
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })(path.join(ROOT, 'src'));
  corpusCache = files
    .filter((file) => file !== path.join(ROOT, 'src/vercel/operations.js'))
    .map((file) => ({ rel: path.relative(ROOT, file), text: fs.readFileSync(file, 'utf8') }));
  return corpusCache;
}

/** Files under src/ that literally reference an OPS key (dispatch evidence). */
export function dispatchFilesFor(opKey) {
  const quoted = [`'${opKey}'`, `"${opKey}"`, '`' + opKey + '`'];
  return srcCorpus()
    .filter(({ text }) => quoted.some((q) => text.includes(q)))
    .map(({ rel }) => rel)
    .sort();
}

function buildRestRow(row, opsKeys, keyDispatch) {
  const meta = apiMetadata(row);
  const isRead = READ_METHODS.has(row.method);
  const handBuiltTool = handBuiltReads[row.op] ?? handBuiltWrites[row.op] ?? null;
  const dedicatedTransport = DEDICATED_TRANSPORT.get(`${row.method} ${row.path}`) ?? null;
  const secret = isRead ? secretOperation(row) : secretWriteOperation(row);
  let disposition;
  if (handBuiltTool) disposition = 'hand_built';
  else if (opsKeys.length) disposition = 'operations_table';
  else if (dedicatedTransport) disposition = 'dedicated_transport';
  else if (secret) disposition = 'credential_refused';
  else if (!isRead) disposition = 'universal_write';
  else if (auditedReadOps.has(row.op)) disposition = 'universal_read_audited';
  else disposition = 'documented_only';

  const security = Array.isArray(row.doc.security) ? row.doc.security : [];
  const schemes = new Set(security.flatMap((entry) => Object.keys(entry)));
  const parameters = [...(row.pathItem.parameters || []), ...(row.doc.parameters || [])];
  const scopedFlags = opsKeys.map((key) => OPS[key].teamScoped !== false);
  // The OPS table pins readOnly on a few POST reads (registrar search /
  // bulk price, observability query): those are not side effects.
  const opsReadOnly = opsKeys.some((key) => OPS[key].readOnly === true);
  const dispatchFiles = [...new Set(opsKeys.flatMap((key) => keyDispatch.get(key) || []))].sort();
  const requestShape = opsKeys.length || handBuiltTool
    ? 'pinned_table'
    : disposition === 'universal_write' || disposition === 'universal_read_audited'
      ? 'universal_at_call'
      : 'none';
  return {
    operation: row.op,
    source: 'rest',
    method: row.method,
    path: row.path,
    version: /^\/v(\d+)\//.exec(row.path)?.[0].slice(1, -1) ?? null,
    family: row.tags[0] ?? null,
    tags: [...row.tags],
    summary: meta.summary,
    deprecated: row.doc.deprecated === true,
    credentials: {
      bearerToken: schemes.has('bearerToken') ? 'documented' : 'not_documented',
      oauth2: schemes.has('oauth2') ? 'documented' : 'not_documented',
      integrationInstallation: 'unknown',
      resourceSpecific: 'unknown',
      noneRequired: security.length === 0
    },
    scope: {
      teamIdQueryParam: parameters.some((p) => p.in === 'query' && p.name === 'teamId'),
      opsTeamScoped: !opsKeys.length ? null
        : scopedFlags.every(Boolean) ? 'scoped'
        : scopedFlags.every((flag) => !flag) ? 'unscoped'
        : 'mixed'
    },
    sideEffects: {
      changes: isRead ? false : !opsReadOnly,
      spends: spendOperation(row) !== null,
      credentialReturn: secret
    },
    implementation: {
      disposition,
      opsKeys: [...opsKeys],
      handBuiltTool,
      dedicatedTransport,
      dispatchFiles
    },
    tests: { requestShape, response: 'not_recorded' },
    permissions: 'unknown',
    ownerUnit: null,
    liveProof: 'not_recorded'
  };
}

function buildSdkRow(def) {
  return {
    operation: def.operation,
    source: 'sdk',
    method: null,
    path: null,
    version: null,
    family: 'blob',
    tags: ['blob'],
    summary: def.summary,
    deprecated: false,
    credentials: {
      bearerToken: 'not_documented',
      oauth2: 'not_documented',
      integrationInstallation: 'unknown',
      resourceSpecific: 'documented',
      noneRequired: false
    },
    scope: { teamIdQueryParam: null, opsTeamScoped: null },
    sideEffects: { changes: def.changes, spends: false, credentialReturn: false },
    implementation: {
      disposition: 'hand_built',
      opsKeys: [],
      handBuiltTool: def.tool,
      dedicatedTransport: null,
      dispatchFiles: ['src/tools/blob.js', 'src/vercel/blob.js'],
      sdk: { package: '@vercel/blob', function: def.sdkFunction, wrapper: 'src/vercel/blob.js' }
    },
    tests: { requestShape: 'none', response: 'not_recorded' },
    permissions: 'unknown',
    ownerUnit: null,
    liveProof: 'not_recorded'
  };
}

/** Build the complete ledger from the repo's living records. Deterministic. */
export function buildLedger() {
  const index = apiIndex();
  const spec = readOpenApi();
  const host = new URL(spec.servers?.[0]?.url || 'https://api.vercel.com').hostname;
  const byMethodPath = new Map(index.map((row) => [`${row.method} ${row.path}`, row]));
  const opsByRow = new Map();
  const keyDispatch = new Map();
  for (const [key, op] of Object.entries(OPS)) {
    keyDispatch.set(key, dispatchFilesFor(key));
    const row = byMethodPath.get(`${op.method} ${op.path}`);
    if (row) {
      if (!opsByRow.has(row.op)) opsByRow.set(row.op, []);
      opsByRow.get(row.op).push(key);
    }
  }
  const rows = index.map((row) => {
    const built = buildRestRow(row, opsByRow.get(row.op) || [], keyDispatch);
    built.host = host;
    return built;
  });
  for (const def of SDK_ROWS) {
    const built = buildSdkRow(def);
    built.host = null;
    rows.push(built);
  }
  rows.sort((a, b) => a.operation.localeCompare(b.operation));
  const byDisposition = {};
  for (const row of rows) byDisposition[row.implementation.disposition] =
    (byDisposition[row.implementation.disposition] || 0) + 1;
  const undispatchedOpsKeys = Object.keys(OPS)
    .filter((key) => (keyDispatch.get(key) || []).length === 0)
    .sort();
  return {
    artifact: 'vercel-mcp operation ledger (CAP-1, built by AUD-BE)',
    ledgerVersion: 1,
    generatedBy: 'scripts/generate-operation-ledger.mjs',
    checkedDate: OPENAPI_SNAPSHOT.date,
    snapshot: {
      file: 'vendor/vercel-openapi/openapi-2026-10-11.json',
      sourceUrl: 'https://vercel.com/openapi.json',
      date: OPENAPI_SNAPSHOT.date,
      sha256: OPENAPI_SNAPSHOT.sha256,
      operations: OPENAPI_SNAPSHOT.operations
    },
    counts: {
      rest: index.length,
      sdk: SDK_ROWS.length,
      total: rows.length,
      byDisposition: Object.fromEntries(Object.entries(byDisposition).sort(([a], [b]) => a.localeCompare(b)))
    },
    findings: { undispatchedOpsKeys },
    gaps: GAPS,
    rows
  };
}

/**
 * CAP-1's validation: duplicate / orphan / missing-row checks plus drift
 * against a fresh build. Returns failure strings (empty = valid).
 */
export function validateLedger(ledger) {
  const failures = [];
  if (!ledger || !Array.isArray(ledger.rows)) return ['ledger has no rows array'];
  const seenOps = new Set();
  const seenMethodPath = new Set();
  for (const row of ledger.rows) {
    if (seenOps.has(row.operation)) failures.push(`${row.operation}: duplicate row`);
    seenOps.add(row.operation);
    if (row.source === 'rest') {
      const key = `${row.method} ${row.path}`;
      if (seenMethodPath.has(key)) failures.push(`${key}: duplicate method/path row`);
      seenMethodPath.add(key);
    }
  }
  const index = apiIndex();
  if (ledger.rows.filter((row) => row.source === 'rest').length !== index.length) {
    failures.push(`rest rows ${ledger.rows.filter((row) => row.source === 'rest').length} != snapshot operations ${index.length} (missing or extra rows)`);
  }
  for (const row of index) {
    if (!seenOps.has(row.op)) failures.push(`${row.op}: snapshot operation missing from ledger`);
  }
  const byMethodPath = new Map(index.map((row) => [`${row.method} ${row.path}`, row]));
  for (const [key, op] of Object.entries(OPS)) {
    if (!byMethodPath.has(`${op.method} ${op.path}`)) {
      failures.push(`${key}: OPS entry is an orphan — no snapshot operation at ${op.method} ${op.path}`);
    }
  }
  for (const row of ledger.rows) {
    for (const key of row.implementation.opsKeys) {
      if (!Object.hasOwn(OPS, key)) failures.push(`${row.operation}: names unknown OPS key ${key}`);
    }
    const mapped = handBuiltReads[row.operation] ?? handBuiltWrites[row.operation];
    if (mapped && (row.implementation.disposition !== 'hand_built' || row.implementation.handBuiltTool !== mapped)) {
      failures.push(`${row.operation}: hand-built map names ${mapped} but the row disagrees`);
    }
  }
  for (const op of Object.keys({ ...handBuiltReads, ...handBuiltWrites })) {
    if (!seenOps.has(op)) failures.push(`${op}: hand-built operation missing from ledger`);
  }
  const recomputed = {};
  for (const row of ledger.rows) recomputed[row.implementation.disposition] =
    (recomputed[row.implementation.disposition] || 0) + 1;
  if (JSON.stringify(ledger.counts?.byDisposition) !== JSON.stringify(
    Object.fromEntries(Object.entries(recomputed).sort(([a], [b]) => a.localeCompare(b))))) {
    failures.push('header byDisposition counts do not match the rows');
  }
  // Drift: the committed ledger must equal a fresh build from the living
  // records, row for row.
  const fresh = buildLedger();
  const freshByOp = new Map(fresh.rows.map((row) => [row.operation, row]));
  let drift = 0;
  for (const row of ledger.rows) {
    const freshRow = freshByOp.get(row.operation);
    if (!freshRow || JSON.stringify(freshRow) !== JSON.stringify(row)) {
      if (drift < 10) failures.push(`${row.operation}: row differs from a fresh build (stale or hand-edited)`);
      drift++;
    }
  }
  for (const freshRow of fresh.rows) {
    if (!seenOps.has(freshRow.operation)) failures.push(`${freshRow.operation}: fresh build has a row the ledger lacks`);
  }
  if (JSON.stringify(ledger.findings) !== JSON.stringify(fresh.findings)) {
    failures.push('header findings differ from a fresh build');
  }
  if (JSON.stringify(ledger.counts) !== JSON.stringify(fresh.counts)) {
    failures.push('header counts differ from a fresh build');
  }
  return failures;
}

const DISPOSITION_TEXT = {
  hand_built: 'A curated tool owns this operation\'s contract (hand-built map, or an OPS dispatch the map names).',
  operations_table: 'Pinned in the OPS table and dispatched from source (see the ledger\'s dispatchFiles); no single curated owner is recorded in the hand-built map.',
  dedicated_transport: 'Implemented by the dedicated Sandbox binary transport (src/vercel/sandbox-binary.js), outside the OPS table.',
  universal_write: 'No hand-built route; the universal write door (vercel_api_write) classifies and executes it under the guarded write lifecycle.',
  universal_read_audited: 'No hand-built route; the universal read door (vercel_api_read) has an audited scope/output policy for this family.',
  credential_refused: 'The universal doors refuse credential-returning operations and no hand-built route exists — missing engineering: a secret-safe hand-built workflow.',
  documented_only: 'Documented in the snapshot only; the universal read door has no audited policy for this family yet — missing engineering.'
};

function cell(text) {
  return String(text ?? '').replaceAll('|', '/');
}

/** The generated family gap report (docs/OPERATION-LEDGER.md content). */
export function renderGapReport(ledger) {
  const { counts, snapshot } = ledger;
  const rest = ledger.rows.filter((row) => row.source === 'rest');
  const families = new Map();
  for (const row of rest) {
    const name = row.family ?? '(untagged)';
    if (!families.has(name)) families.set(name, []);
    families.get(name).push(row);
  }
  const lines = [];
  lines.push('# Operation ledger — family gap report');
  lines.push('');
  lines.push('GENERATED by `node scripts/generate-operation-ledger.mjs` from the pinned');
  lines.push('OpenAPI snapshot and the server\'s own living records (OPS table, hand-built');
  lines.push('map, universal-door policies). Do not hand-edit: `npm run check` regenerates');
  lines.push('and compares. The machine-readable rows are in');
  lines.push('[operation-ledger.json](operation-ledger.json); the build contract and the');
  lines.push('named undetermined fields are on the [AUD-BE card](pr-cards/AUD-BE.md).');
  lines.push('');
  lines.push(`Snapshot: \`${snapshot.file}\` — retrieved ${snapshot.date} from`);
  lines.push(`${snapshot.sourceUrl}, SHA-256 \`${snapshot.sha256}\`,`);
  lines.push(`${snapshot.operations} operations. Checked date for every row is the`);
  lines.push('snapshot\'s own date (CAP-1: rows are linked to the schema revision and');
  lines.push('its checked date).');
  lines.push('');
  lines.push('## Coverage (source evidence only)');
  lines.push('');
  lines.push(`Denominator: the ${counts.rest} operations of the pinned snapshot, plus`);
  lines.push(`${counts.sdk} SDK-only workflows (Blob files) = ${counts.total} rows. These are`);
  lines.push('source-parity counts against that pinned denominator — no live parity is');
  lines.push('measured here (live proof is CAP-5\'s track) and no percentage of');
  lines.push('"the Vercel API" beyond the pinned snapshot is claimed.');
  lines.push('');
  lines.push('| Disposition | Rows | Meaning |');
  lines.push('|---|---:|---|');
  for (const [name, n] of Object.entries(counts.byDisposition)) {
    lines.push(`| \`${name}\` | ${n} | ${cell(DISPOSITION_TEXT[name])} |`);
  }
  lines.push('');
  lines.push('## Families');
  lines.push('');
  lines.push('| Family | Rows | Hand-built | OPS table | Dedicated | Universal | Credential-refused | Documented only |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  const universal = new Set(['universal_write', 'universal_read_audited']);
  for (const name of [...families.keys()].sort()) {
    const rows = families.get(name);
    const count = (d) => rows.filter((row) => row.implementation.disposition === d).length;
    const uni = rows.filter((row) => universal.has(row.implementation.disposition)).length;
    lines.push(`| ${cell(name)} | ${rows.length} | ${count('hand_built')} | ${count('operations_table')} | ${count('dedicated_transport')} | ${uni} | ${count('credential_refused')} | ${count('documented_only')} |`);
  }
  lines.push('');
  const listSection = (title, intro, rows, render) => {
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(intro);
    lines.push('');
    if (!rows.length) lines.push('None.');
    for (const row of rows) lines.push(`- ${render(row)}`);
    lines.push('');
  };
  listSection('Missing engineering — documented-only reads',
    'Documented reads no audited universal-read policy covers yet. Each is a\ncandidate family for a future audited policy or a hand-built tool.',
    rest.filter((row) => row.implementation.disposition === 'documented_only'),
    (row) => `\`${row.operation}\` — ${row.method} ${row.path} (${cell(row.family ?? 'untagged')})`);
  listSection('Missing engineering — credential-refused operations',
    'Operations the universal doors refuse because they return credentials,\nwith no hand-built route. Each needs a secret-safe hand-built workflow\nbefore it can be executed.',
    rest.filter((row) => row.implementation.disposition === 'credential_refused'),
    (row) => `\`${row.operation}\` — ${row.method} ${row.path} (${cell(row.family ?? 'untagged')})`);
  listSection('Deprecated in the pinned snapshot',
    'The snapshot itself marks these deprecated — the retired-disposition\nevidence CAP-1 asks for, recorded from the source.',
    rest.filter((row) => row.deprecated),
    (row) => `\`${row.operation}\` — ${row.method} ${row.path} — disposition \`${row.implementation.disposition}\``);
  lines.push('## OPS table findings');
  lines.push('');
  if (ledger.findings.undispatchedOpsKeys.length) {
    lines.push('These OPS entries have no literal reference anywhere else in `src/` —');
    lines.push('pinned in the table but with no dispatch evidence the generator can see:');
    lines.push('');
    for (const key of ledger.findings.undispatchedOpsKeys) lines.push(`- \`${key}\``);
  } else {
    lines.push('Every OPS entry has at least one literal dispatch reference in `src/`.');
  }
  lines.push('');
  lines.push('## SDK-only workflows (no snapshot rows)');
  lines.push('');
  lines.push('| Operation | Tool | Changes state | Route |');
  lines.push('|---|---|---|---|');
  for (const row of ledger.rows.filter((r) => r.source === 'sdk')) {
    lines.push(`| \`${row.operation}\` | \`${row.implementation.handBuiltTool}\` | ${row.sideEffects.changes ? 'yes' : 'no'} | @vercel/blob \`${row.implementation.sdk.function}\` via src/vercel/blob.js, store read-write token |`);
  }
  lines.push('');
  lines.push('## Undetermined fields (recorded, not invented)');
  lines.push('');
  for (const gap of ledger.gaps) {
    lines.push(`- **${gap.field}** — recorded as \`${gap.recordedAs}\`. ${gap.reason}`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
