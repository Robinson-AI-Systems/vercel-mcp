// Batch U (U4): the spend-operations table for the universal tools.
// An operation is a spend when Vercel charges for it or it commits the
// account to future charges. The table names snapshot operationIds
// (verified against the vendored snapshot, 2026-10-30); the heuristic
// below is the design's safe default for operations the table does not
// name yet: an unknown operation whose summary or path mentions buying,
// purchasing, renewing, upgrading, credits, billing, a plan or an
// invoice — or that creates a team, a store or a sandbox, or changes a
// project's resourceConfig — is treated as spend until the table rules
// on it. Classification only: the price of a universal spend is never
// invented here (B3 leaves unquantified spend at cents: null).
const TABLE = Object.freeze({
  // Registrar: buying, transferring in and renewing are one-time charges;
  // switching auto-renew on commits the account to future renewals.
  buySingleDomain: { recurring: false, reason: 'Domain purchase' },
  buyDomains: { recurring: false, reason: 'Domain purchase' },
  transferInDomain: { recurring: false, reason: 'Domain transfer-in' },
  renewDomain: { recurring: false, reason: 'Domain renewal' },
  updateDomainAutoRenew: { recurring: true, reason: 'Domain auto-renewal' },
  // POST /v1/billing/buy — prepaid credits are a direct charge.
  buyCredits: { recurring: false, reason: 'Credit purchase' },
  // Store creation can start a paid storage plan.
  createStorageStoresBlob: { recurring: false, reason: 'Blob store creation' },
  createIntegrationStoreDirect: { recurring: false, reason: 'Integration store creation' },
  // Team creation starts plan terms for another team (also hand-built;
  // the universal tool refuses it earlier by name — the table entry keeps
  // the classification true for discovery and any future caller).
  createTeam: { recurring: false, reason: 'Team creation' },
  // Analytics and Speed Insights are paid add-on toggles.
  createWebInsightsToggle: { recurring: true, reason: 'Web Analytics toggle' },
  createSpeedInsightsToggle: { recurring: true, reason: 'Speed Insights toggle' },
  // Drains bill per volume delivered.
  createDrain: { recurring: false, reason: 'Drain creation' },
  createConfigurableLogDrain: { recurring: false, reason: 'Log drain creation' },
  createLogDrain: { recurring: false, reason: 'Integration log drain creation' },
  // Rolling-release configuration is a paid release feature (hand-built;
  // classified here for the same reason as createTeam).
  updateRollingReleaseConfig: { recurring: false, reason: 'Rolling-release configuration' },
  // Sandbox creation bills compute (hand-built for V4; the versioned
  // siblings are the same product surface).
  createSandboxesV4: { recurring: false, reason: 'Sandbox creation' },
  createSandboxesV3: { recurring: false, reason: 'Sandbox creation' },
  createSandboxesV2: { recurring: false, reason: 'Sandbox creation' },
  // Inviting a member or moving one to a paid role can add a seat charge;
  // the amount depends on the role and plan Vercel applies.
  inviteUserToTeam: { recurring: false, reason: 'Team member invite' },
  updateTeamMember: { recurring: false, reason: 'Team member role change' },
  // Observability Plus is a paid per-project add-on.
  updateObservabilityConfigurationProject: { recurring: true, reason: 'Observability Plus setting' }
});
const SPEND_WORDS = /buy|purchase|renew|upgrade|credit|billing|plan|invoice/i;
const SPEND_SHAPES = /create.*(?:team|store|sandbox)|resourceconfig/i;
/**
 * Classify one indexed operation row ({op, method, path, summary}).
 * Returns {spend: true, recurring, reason} or null. Reads are never
 * spend: money only moves on a write.
 */
export function spendOperation(row) {
  if (!row || typeof row.op !== 'string' || ['GET', 'HEAD'].includes(row.method)) return null;
  const known = TABLE[row.op];
  if (known) return { spend: true, recurring: known.recurring, reason: known.reason };
  const text = row.path + ' ' + row.op + ' ' + String(row.summary || '');
  if (SPEND_WORDS.test(text) || SPEND_SHAPES.test(text)) {
    return { spend: true, recurring: false, reason: 'Possible charge (unlisted operation)' };
  }
  return null;
}
export const spendTable = TABLE;
