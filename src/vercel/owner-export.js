// O-5b (VMCP-021): the owner's data export. This module composes the
// export object; the AUD-AT tool vercel_export_owner_data owns the
// journaled delivery (the setup page that used to own the download
// was deleted by AUD-AV).
//
// The export is built exclusively from the db layer's safe metadata reads,
// and every section passes through an explicit allowlist projection:
// no row is ever copied wholesale, so token values, token ciphertext,
// token hashes, pass bearers and secret material cannot reach the export
// even if a future db read grows a sensitive column. A unit test plants
// secret-shaped fields in fake rows and asserts their absence.
const ACCOUNT_ID = /^[a-zA-Z0-9_/-]{3,256}$/;
const ACCOUNT_FIELDS = ['id', 'team_id', 'team_slug', 'label', 'scope',
  'project_id', 'project_name', 'production_enabled', 'is_default',
  'token_last4', 'token_expires_at', 'token_no_expiry', 'spend_limit_cents',
  'purchase_budget_cents', 'purchase_grant_required'];
const CONNECTION_FIELDS = ['id', 'client_id', 'vercel_account', 'mode',
  'profile', 'listing', 'kind', 'created_at', 'last_used_at', 'expires_at',
  'revoked_at'];
const PASS_FIELDS = ['pass_id', 'mode', 'areas', 'rate_limit_per_minute',
  'expires_at', 'revoked_at', 'created_at'];
const PROTECTED_FIELDS = ['kind', 'match', 'note', 'source'];
const CHANGE_FIELDS = ['id', 'at', 'tool', 'project_id', 'mode', 'summary',
  'dry_run', 'production', 'spend_cents'];
export const EXPORT_CHANGES_LIMIT = 500;
const CONNECTIONS_LIMIT = 20;

function pick(row, fields) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const field of fields) {
    if (row[field] !== undefined) out[field] = row[field];
  }
  return out;
}
// One failing read marks its section unavailable; it never fabricates
// data and never fails the whole export. The subject account's own
// metadata is the exception: an export missing its subject is false,
// so that read is not guarded.
async function section(read) {
  try { return await read(); }
  catch { return { unavailable: true, reason: 'read_failed' }; }
}

export async function buildOwnerExport({ db, account, now = () => new Date() }) {
  if (typeof account !== 'string' || !ACCOUNT_ID.test(account) ||
    typeof db?.listVercelAccounts !== 'function') {
    throw new TypeError('Owner export unavailable');
  }
  const accounts = await db.listVercelAccounts();
  const subject = (accounts || []).find(row => row?.id === account);
  if (!subject) throw new TypeError('Owner export account unavailable');
  const exportedAt = now();
  const connections = await section(async () => {
    const rows = await db.listAccountConnections({
      account, includeRevoked: true, limit: CONNECTIONS_LIMIT });
    return { limit: CONNECTIONS_LIMIT, truncated: rows.length >= CONNECTIONS_LIMIT,
      rows: rows.map(row => pick(row, CONNECTION_FIELDS)) };
  });
  const passes = await section(async () =>
    (await db.listRtcPasses(account)).map(row => pick(row, PASS_FIELDS)));
  const protectedResources = await section(async () =>
    (await db.listProtectedResources(account)).map(row => pick(row, PROTECTED_FIELDS)));
  const knownApps = await section(async () =>
    (await db.listKnownApps(account)).map(row => pick(row,
      ['id', 'name', 'status', 'account', 'source', 'profile', 'updatedAt'])));
  const blobStores = await section(async () =>
    (await db.listBlobStoreConnections(account)).map(row => pick(row,
      ['account', 'storeId', 'label', 'access', 'tokenLast4', 'createdAt', 'updatedAt'])));
  const settings = await section(async () => {
    const policy = await db.getPurchasePolicy(account);
    const strictness = await db.getProductionEnableStrictness(account);
    return {
      purchaseBudgetCents: policy?.budgetCents ?? null,
      purchaseGrantRequired: policy?.grantRequired ?? null,
      productionEnableStrictness: strictness ?? null
    };
  });
  const changes = await section(async () => {
    const { total, rows } = await db.exportChanges({
      account, limit: EXPORT_CHANGES_LIMIT });
    return { total, included: rows.length,
      truncated: total > rows.length,
      rows: rows.map(row => pick(row, CHANGE_FIELDS)) };
  });
  return {
    format: 'vercel-by-robinson-ai-systems-owner-export',
    version: 1,
    exportedAt: exportedAt instanceof Date ? exportedAt.toISOString() : String(exportedAt),
    account,
    subject: pick(subject, ACCOUNT_FIELDS),
    connections, passes, protectedResources, settings, knownApps, blobStores,
    changes,
    notes: [
      'Metadata only: token values, pass bearers, secret values and ciphertext are never exported.',
      'Connections are capped at the ' + CONNECTIONS_LIMIT + ' most recent; ' +
        'the change log is capped at the ' + EXPORT_CHANGES_LIMIT + ' most recent entries per account.'
    ]
  };
}
