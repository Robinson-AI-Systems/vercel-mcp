// O-4: billing and activity reads. Billing is READ-ONLY by design (O6) and
// IN-12: spend alerts and every form of spend control belong to Vercel's
// Spend Management — these tools read and report, they never set a budget,
// an alert, a pause, a plan or a payment method.
//
// The charges and commitments endpoints answer FOCUS v1.3 JSON Lines; the
// client decodes them through the bounded line reader ({jsonl: true}).
// Amounts arrive as decimal dollars and are reported as integer cents plus
// a formatted display string (money is stored in cents, shown in dollars).
import {readProvider} from '../vercel/provider.js';
import {credentialLike} from '../core/util.js';

const PROFILES = ['read_only', 'everyday', 'full'];

// Stored defaults from the design (BATCH-O O6) until an owner-settings
// surface exists — the same named-constant pattern as the O-2 seat price.
export const PRO_MONTHLY_CREDIT_CENTS = 2000;
export const MONTHLY_TARGET_CENTS = 2000;

function safe(value) {
  if (typeof value !== 'string' || credentialLike(value)) return null;
  return value;
}

function result(value) {
  return {content: [{type: 'text', text: JSON.stringify(value)}]};
}

function readEntry(entry) {
  const {properties, ...rest} = entry;
  return {...rest, inputSchema: {type: 'object', additionalProperties: false,
      properties: properties ?? {}},
    annotations: {readOnlyHint: true, destructiveHint: false,
      idempotentHint: true, openWorldHint: true}};
}

export function displayOf(cents) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

// Decimal dollars (possibly fractional cents) -> integer cents + display.
export function moneyOf(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {cents: null, display: null};
  const cents = Math.round(value * 100);
  return {cents, display: displayOf(cents)};
}

function teamAccount(account) {
  if (!account?.team_id || !['team', 'full'].includes(account.scope)) {
    throw new Error('Billing and activity reads need a team-scoped connection.');
  }
  return account;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function windowOf(args) {
  const now = new Date();
  const from = args?.from ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const to = args?.to ?? now.toISOString();
  if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to) ||
      Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw new Error('from and to must be ISO dates (e.g. 2026-10-01) or timestamps.');
  }
  if (Date.parse(from) > Date.parse(to)) throw new Error('from must not be after to.');
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000) {
    throw new Error('Billing windows are limited to 366 days; narrow the period.');
  }
  return {from, to};
}

async function chargeRecords(ctx, args) {
  const {client, account} = await readProvider(ctx);
  teamAccount(account);
  const {from, to} = windowOf(args);
  const page = await client.request('billing_charges',
    {query: {from, to, teamId: account.team_id}}, {jsonl: true});
  return {records: Array.isArray(page?.records) ? page.records : [], from, to};
}

function chargeLine(row) {
  const billed = moneyOf(row?.BilledCost);
  const effective = moneyOf(row?.EffectiveCost);
  const tags = row?.Tags && typeof row.Tags === 'object' ? row.Tags : {};
  return {
    service: safe(row?.ServiceName), provider: safe(row?.ServiceProviderName),
    category: safe(row?.ChargeCategory), sku: safe(row?.SkuId),
    project: safe(tags.ProjectName) ?? null, projectId: safe(tags.ProjectId) ?? null,
    billedCents: billed.cents, billedDisplay: billed.display,
    effectiveCents: effective.cents, effectiveDisplay: effective.display,
    currency: safe(row?.BillingCurrency),
    periodStart: safe(row?.ChargePeriodStart), periodEnd: safe(row?.ChargePeriodEnd),
    quantity: typeof row?.ConsumedQuantity === 'number' ? row.ConsumedQuantity : null,
    unit: safe(row?.ConsumedUnit)};
}

async function listCharges(args, ctx) {
  const {records, from, to} = await chargeRecords(ctx, args);
  const lines = records.map(chargeLine);
  return result({from, to, count: lines.length,
    charges: lines.slice(0, 200), truncated: lines.length > 200,
    note: lines.length > 200 ?
      'Only the first 200 lines are listed; vercel_billing_summary totals the whole window.' : undefined});
}

async function listCommitments(args, ctx) {
  const {client, account} = await readProvider(ctx);
  teamAccount(account);
  const page = await client.request('billing_commitments',
    {query: {teamId: account.team_id}}, {jsonl: true});
  const rows = Array.isArray(page?.records) ? page.records : [];
  const commitments = rows.map(row => {
    const cost = moneyOf(row?.ContractCommitmentCost);
    return {
      id: safe(row?.ContractCommitmentId), category: safe(row?.ContractCommitmentCategory),
      type: safe(row?.ContractCommitmentType),
      costCents: cost.cents, costDisplay: cost.display,
      quantity: typeof row?.ContractCommitmentQuantity === 'number' ? row.ContractCommitmentQuantity : null,
      unit: safe(row?.ContractCommitmentUnit), currency: safe(row?.BillingCurrency),
      description: safe(row?.ContractCommitmentDescription),
      periodStart: safe(row?.ContractCommitmentPeriodStart), periodEnd: safe(row?.ContractCommitmentPeriodEnd),
      contractPeriodStart: safe(row?.ContractPeriodStart), contractPeriodEnd: safe(row?.ContractPeriodEnd)};
  });
  return result({commitments, count: commitments.length,
    note: commitments.length === 0 ?
      'No commitment records were returned. Commitments are an Enterprise contract feature; the standard Pro plan credit does not appear as a commitment record.' : undefined});
}

async function billingSummary(args, ctx) {
  const {records, from, to} = await chargeRecords(ctx, args);
  let effectiveTotal = 0, billedTotal = 0, creditsTotal = 0;
  const byService = new Map(), byProject = new Map();
  for (const row of records) {
    const line = chargeLine(row);
    const eff = line.effectiveCents ?? 0, bil = line.billedCents ?? 0;
    effectiveTotal += eff; billedTotal += bil;
    if (line.category === 'Credit') creditsTotal += eff;
    const svc = line.service ?? 'Unspecified service';
    byService.set(svc, (byService.get(svc) ?? 0) + eff);
    const proj = line.project ?? 'No project tag';
    byProject.set(proj, (byProject.get(proj) ?? 0) + eff);
  }
  const ranked = map => [...map.entries()]
    .map(([name, cents]) => ({name, effectiveCents: cents, effectiveDisplay: displayOf(cents)}))
    .sort((a, b) => Math.abs(b.effectiveCents) - Math.abs(a.effectiveCents));
  return result({from, to, lines: records.length,
    effectiveTotalCents: effectiveTotal, effectiveTotalDisplay: displayOf(effectiveTotal),
    billedTotalCents: billedTotal, billedTotalDisplay: displayOf(billedTotal),
    creditLinesCents: creditsTotal, creditLinesDisplay: displayOf(creditsTotal),
    byService: ranked(byService), byProject: ranked(byProject),
    against: {
      proMonthlyCreditCents: PRO_MONTHLY_CREDIT_CENTS,
      proMonthlyCreditDisplay: displayOf(PRO_MONTHLY_CREDIT_CENTS),
      overCreditCents: Math.max(0, effectiveTotal - PRO_MONTHLY_CREDIT_CENTS),
      monthlyTargetCents: MONTHLY_TARGET_CENTS,
      monthlyTargetDisplay: displayOf(MONTHLY_TARGET_CENTS),
      overTargetCents: Math.max(0, effectiveTotal - MONTHLY_TARGET_CENTS),
      note: 'The Pro monthly credit and the monthly target are the stored defaults ($20 each) from the design; they are comparison figures, not live plan reads. Spend alerts and controls live in Vercel Spend Management, which this server only reports (IN-12).'}});
}

const activityProps = {
  types: {type: 'string', minLength: 1, maxLength: 500},
  limit: {type: 'integer', minimum: 1, maximum: 100},
  withPayload: {type: 'boolean'}};

async function listActivity(args, ctx) {
  const {client, account} = await readProvider(ctx);
  teamAccount(account);
  const query = {teamId: account.team_id};
  if (args?.types !== undefined) {
    if (typeof args.types !== 'string' || !args.types) throw new Error('types must be a comma-delimited string.');
    query.types = args.types;
  }
  if (args?.limit !== undefined) {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
      throw new Error('limit must be an integer between 1 and 100.');
    }
    query.limit = args.limit;
  }
  const wantPayload = args?.withPayload === true;
  if (wantPayload) query.withPayload = 'true';
  const page = await client.request('events_list', {query});
  const rows = Array.isArray(page?.events) ? page.events : [];
  const events = rows.map(row => {
    const out = {
      id: safe(row?.id),
      createdAt: typeof row?.createdAt === 'number' ? new Date(row.createdAt).toISOString() : null,
      text: safe(row?.text), type: safe(row?.type),
      principalId: safe(row?.principalId),
      entityCount: Array.isArray(row?.entities) ? row.entities.length : 0};
    if (wantPayload) {
      if (row?.payload && typeof row.payload === 'object') {
        const text = JSON.stringify(row.payload);
        out.payload = text.length <= 1000 ? row.payload : undefined;
        if (text.length > 1000) out.payloadOmitted = 'payload too large to show';
      } else out.payload = null;
    }
    return out;
  });
  return result({events, count: events.length});
}

export const billingTools = {
  tools: [
    readEntry({name: 'vercel_billing_list_charges', writes: false, area: 'billing', profiles: PROFILES,
      description: 'Billing charge lines (FOCUS) for a period: service, project, billed and effective cost in cents and dollars.',
      properties: {from: {type: 'string', minLength: 10, maxLength: 40}, to: {type: 'string', minLength: 10, maxLength: 40}}}),
    readEntry({name: 'vercel_billing_list_commitments', writes: false, area: 'billing', profiles: PROFILES,
      description: 'Contract commitments (Enterprise) and their periods and costs. Empty on plans without commitments.'}),
    readEntry({name: 'vercel_billing_summary', writes: false, area: 'billing', profiles: PROFILES,
      description: 'This period so far: totals by service and project against the Pro monthly credit and your monthly target.',
      properties: {from: {type: 'string', minLength: 10, maxLength: 40}, to: {type: 'string', minLength: 10, maxLength: 40}}}),
    readEntry({name: 'vercel_activity_list', writes: false, area: 'activity', profiles: PROFILES,
      description: 'Team activity log: who did what, when. Payloads are only included when withPayload is set.',
      properties: activityProps})
  ],
  handlers: {
    vercel_billing_list_charges: (args, ctx) => listCharges(args ?? {}, ctx),
    vercel_billing_list_commitments: (args, ctx) => listCommitments(args ?? {}, ctx),
    vercel_billing_summary: (args, ctx) => billingSummary(args ?? {}, ctx),
    vercel_activity_list: (args, ctx) => listActivity(args ?? {}, ctx)
  }
};
