// AUD-BE: CAP-1's generated operation ledger. The builder reads the
// pinned snapshot through the runtime's own index and joins the living
// records; these tests pin the census, one anchor per disposition, the
// CAP-1 validation (duplicate/orphan/missing-row) and drift detection.
import { describe, expect, it } from 'vitest';
import { buildLedger, validateLedger } from '../../scripts/operation-ledger.mjs';
import { OPS } from '../../src/vercel/operations.js';

const ledger = buildLedger();
const byOp = new Map(ledger.rows.map((row) => [row.operation, row]));

describe('operation ledger build', () => {
  it('enumerates the pinned snapshot plus the SDK-only Blob workflows', () => {
    expect(ledger.snapshot.operations).toBe(451);
    expect(ledger.counts).toMatchObject({ rest: 451, sdk: 4, total: 455 });
    expect(ledger.checkedDate).toBe('2026-10-11');
    expect(ledger.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('has unique operation keys and unique method/path pairs', () => {
    expect(byOp.size).toBe(ledger.rows.length);
    const pairs = ledger.rows.filter((row) => row.source === 'rest')
      .map((row) => `${row.method} ${row.path}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('pins the disposition census', () => {
    expect(ledger.counts.byDisposition).toEqual({
      credential_refused: 21,
      dedicated_transport: 3,
      documented_only: 96,
      hand_built: 78,
      operations_table: 115,
      universal_read_audited: 10,
      universal_write: 132
    });
  });

  it('resolves every OPS key onto a snapshot row (no orphans)', () => {
    const named = new Set(ledger.rows.flatMap((row) => row.implementation.opsKeys));
    for (const key of Object.keys(OPS)) expect(named.has(key)).toBe(true);
  });

  it('records the snapshot credential declarations verbatim', () => {
    // Measured from the pinned snapshot: 412 operations declare
    // bearerToken, 39 declare no authentication, none declare oauth2.
    expect(ledger.rows.filter((row) => row.credentials.bearerToken === 'documented').length).toBe(412);
    expect(ledger.rows.filter((row) => row.credentials.noneRequired).length).toBe(39);
    expect(ledger.rows.filter((row) => row.credentials.oauth2 === 'documented').length).toBe(0);
    expect(ledger.rows.every((row) => row.credentials.integrationInstallation === 'unknown')).toBe(true);
  });

  it('carries the undetermined fields as recorded unknowns, never invented', () => {
    for (const row of ledger.rows) {
      expect(row.permissions).toBe('unknown');
      expect(row.ownerUnit).toBeNull();
      expect(row.liveProof).toBe('not_recorded');
      expect(row.tests.response).toBe('not_recorded');
    }
    expect(ledger.gaps.map((gap) => gap.field)).toContain('permissions');
  });
});

describe('operation ledger anchor rows', () => {
  it('hand-built: createDeployment names its curated tool and OPS key', () => {
    const row = byOp.get('createDeployment');
    expect(row.implementation.disposition).toBe('hand_built');
    expect(row.implementation.handBuiltTool).toBe('vercel_deploy_create_from_git');
    expect(row.implementation.opsKeys).toContain('deployments_create');
    expect(row.tests.requestShape).toBe('pinned_table');
    expect(row.sideEffects.changes).toBe(true);
  });

  it('audited universal read: listFlags', () => {
    const row = byOp.get('listFlags');
    expect(row.implementation.disposition).toBe('universal_read_audited');
    expect(row.tests.requestShape).toBe('universal_at_call');
    expect(row.sideEffects.changes).toBe(false);
  });

  it('dedicated transport: the Sandbox fs read bypasses the OPS table', () => {
    const row = ledger.rows.find((r) => r.path === '/v2/sandboxes/sessions/{sessionId}/fs/read');
    expect(row.implementation.disposition).toBe('dedicated_transport');
    expect(row.implementation.dedicatedTransport).toBe('src/vercel/sandbox-binary.js');
  });

  it('credential-refused: a KMS signing-key activation has no executable route', () => {
    const row = byOp.get('activateKmsSigningKey');
    expect(row.implementation.disposition).toBe('credential_refused');
    expect(row.sideEffects.credentialReturn).toBe(true);
  });

  it('documented only: an analytics aggregate read is missing engineering', () => {
    const row = byOp.get('aggregateEvents');
    expect(row.implementation.disposition).toBe('documented_only');
    expect(row.tests.requestShape).toBe('none');
  });

  it('universal write: an unversioned transfer acceptance executes via the guarded door', () => {
    const row = byOp.get('acceptProjectTransferRequest');
    expect(row.implementation.disposition).toBe('universal_write');
    expect(row.version).toBeNull();
    expect(row.tests.requestShape).toBe('universal_at_call');
  });

  it('OPS readOnly pins a POST read as no side effect (registrar search)', () => {
    const row = ledger.rows.find((r) => r.implementation.opsKeys.includes('registrar_search'));
    expect(row.method).toBe('POST');
    expect(row.sideEffects.changes).toBe(false);
  });

  it('SDK rows: blob.put is a hand-built store-token workflow', () => {
    const row = byOp.get('blob.put');
    expect(row.source).toBe('sdk');
    expect(row.implementation.disposition).toBe('hand_built');
    expect(row.implementation.handBuiltTool).toBe('vercel_blob_put');
    expect(row.credentials.resourceSpecific).toBe('documented');
    expect(row.sideEffects.changes).toBe(true);
  });

  it('names the OPS entries with no dispatch evidence as findings', () => {
    expect(ledger.findings.undispatchedOpsKeys).toEqual([
      'firewall_config_get_version',
      'registrar_contact_schema'
    ]);
  });
});

describe('operation ledger validation', () => {
  it('passes a fresh build', () => {
    expect(validateLedger(buildLedger())).toEqual([]);
  });

  it('fails a tampered row (drift)', () => {
    const tampered = structuredClone(ledger);
    tampered.rows.find((row) => row.operation === 'createDeployment')
      .implementation.disposition = 'documented_only';
    const failures = validateLedger(tampered);
    expect(failures.some((f) => f.includes('createDeployment'))).toBe(true);
  });

  it('fails a duplicated row', () => {
    const duplicated = structuredClone(ledger);
    duplicated.rows.push(duplicated.rows[0]);
    expect(validateLedger(duplicated).some((f) => f.includes('duplicate'))).toBe(true);
  });

  it('fails a missing row', () => {
    const missing = structuredClone(ledger);
    missing.rows = missing.rows.filter((row) => row.operation !== 'listFlags');
    expect(validateLedger(missing).some((f) => f.includes('listFlags'))).toBe(true);
  });
});
