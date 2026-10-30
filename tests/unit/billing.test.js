// O-4: billing + activity reads. The fake fetch answers the billing
// endpoints with real JSON Lines bodies so the client's bounded JSONL
// reader is exercised end to end; money must land as integer cents.
import {describe, it, expect, vi} from 'vitest';

vi.mock('../../src/vercel/tokens.js', async (importOriginal) => {
  const original = await importOriginal();
  return {...original, loadToken: async () => ({
    token: 'vcp_FAKEtesttoken',
    account: {id: 'team_ONE', team_id: 'team_ONE', slug: 'one', scope: 'team',
      label: 'One', is_default: true}})};
});

import {billingTools, moneyOf, PRO_MONTHLY_CREDIT_CENTS} from '../../src/tools/billing.js';
import {makeVercelClient} from '../../src/vercel/client.js';

const line = (over = {}) => JSON.stringify({
  BilledCost: 12.34, BillingCurrency: 'USD', ChargeCategory: 'Usage',
  ChargePeriodEnd: '2026-10-31', ChargePeriodStart: '2026-10-01',
  ConsumedQuantity: 42, ConsumedUnit: 'GB', EffectiveCost: 12.34,
  PricingCategory: 'Standard', PricingCurrency: 'USD', PricingQuantity: 42,
  PricingUnit: 'GB', ServiceName: 'Bandwidth', ServiceProviderName: 'Vercel',
  SkuId: 'sku_bw', Tags: {ProjectId: 'prj_ABC', ProjectName: 'Site'}, ...over});
const CHARGES = [
  line(),
  line({ServiceName: 'Serverless Functions', SkuId: 'sku_fn', BilledCost: 30, EffectiveCost: 28.5}),
  line({ServiceName: 'Pro plan credit', ChargeCategory: 'Credit', SkuId: 'sku_credit',
    BilledCost: -20, EffectiveCost: -20, Tags: {}})
].join('\n') + '\n';
const COMMITMENT = JSON.stringify({
  BillingCurrency: 'USD', ContractCommitmentCategory: 'Spend',
  ContractCommitmentCost: 20, ContractCommitmentDescription: 'Pro monthly',
  ContractCommitmentId: 'cc_1', ContractCommitmentPeriodEnd: '2026-11-01',
  ContractCommitmentPeriodStart: '2026-10-01', ContractCommitmentQuantity: 1,
  ContractCommitmentType: 'Recurring', ContractCommitmentUnit: 'USD',
  ContractId: 'ct_1', ContractPeriodEnd: '2027-10-01', ContractPeriodStart: '2026-10-01'});
const EVENTS = {events: [
  {id: 'ev_1', createdAt: 1761830400000, text: 'Deployed Site to production',
   principalId: 'user_1', type: 'deployment-created', entities: [{start: 0, end: 4}],
   payload: {region: 'iad1'}},
  {id: 'ev_2', createdAt: 1761830500000, text: 'Updated environment variables',
   principalId: 'user_2', type: 'env-updated', entities: []}]};

function makeCtx({charges = CHARGES, commitments = '', events = EVENTS} = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push({path: u.pathname, query: Object.fromEntries(u.searchParams)});
    if (u.pathname === '/v1/billing/charges') {
      return new Response(charges, {status: 200, headers: {'content-type': 'application/jsonl'}});
    }
    if (u.pathname === '/v1/billing/contract-commitments') {
      return new Response(commitments, {status: 200, headers: {'content-type': 'application/jsonl'}});
    }
    if (u.pathname === '/v3/events') {
      return new Response(JSON.stringify(events), {status: 200,
        headers: {'content-type': 'application/json'}});
    }
    return new Response(JSON.stringify({error: {code: 'not_found'}}), {status: 404,
      headers: {'content-type': 'application/json'}});
  };
  const ctx = {connection: {id: 'conn_1', account: 'team_ONE', profile: 'full',
      mode: 'production', kind: 'connector'},
    env: {TOKEN_ENCRYPTION_KEY: '00'.repeat(32)}, fetchImpl,
    db: {getAccountCredential: async () => ({account: {id: 'team_ONE'}}),
      listProtectedResources: async () => []}};
  return {ctx, calls};
}
const parse = r => JSON.parse(r.content[0].text);
const call = (name, args, ctx) => billingTools.handlers[name](args, ctx);

describe('O-4 billing reads', () => {
  it('money converts decimal dollars to integer cents with display', () => {
    expect(moneyOf(12.34)).toEqual({cents: 1234, display: '$12.34'});
    expect(moneyOf(-20)).toEqual({cents: -2000, display: '-$20.00'});
    expect(moneyOf('x')).toEqual({cents: null, display: null});
    expect(PRO_MONTHLY_CREDIT_CENTS).toBe(2000);
  });

  it('lists charges through the JSONL path with project tags and cents', async () => {
    const {ctx, calls} = makeCtx();
    const out = parse(await call('vercel_billing_list_charges',
      {from: '2026-10-01', to: '2026-10-31'}, ctx));
    expect(calls[0].path).toBe('/v1/billing/charges');
    expect(calls[0].query).toMatchObject({from: '2026-10-01', to: '2026-10-31', teamId: 'team_ONE'});
    expect(out.count).toBe(3);
    expect(out.charges[0]).toMatchObject({service: 'Bandwidth', project: 'Site',
      projectId: 'prj_ABC', billedCents: 1234, billedDisplay: '$12.34', effectiveCents: 1234});
    expect(out.charges[2].project).toBeNull();
  });

  it('summarizes the window by service and project against credit and target', async () => {
    const {ctx} = makeCtx();
    const out = parse(await call('vercel_billing_summary',
      {from: '2026-10-01', to: '2026-10-31'}, ctx));
    expect(out.effectiveTotalCents).toBe(2084); // 1234 + 2850 - 2000
    expect(out.creditLinesCents).toBe(-2000);
    expect(out.byService[0]).toMatchObject({name: 'Serverless Functions', effectiveCents: 2850});
    expect(out.byProject.find(p => p.name === 'Site')?.effectiveCents).toBe(4084);
    expect(out.against).toMatchObject({proMonthlyCreditCents: 2000,
      overCreditCents: 84, monthlyTargetCents: 2000, overTargetCents: 84});
  });

  it('refuses an inverted or oversized window before any call', async () => {
    const {ctx, calls} = makeCtx();
    await expect(call('vercel_billing_list_charges',
      {from: '2026-11-01', to: '2026-10-01'}, ctx)).rejects.toThrow(/after to/);
    expect(calls).toHaveLength(0);
  });

  it('commitments: a Spend record projects; an empty stream is honest', async () => {
    const one = parse(await call('vercel_billing_list_commitments', {},
      makeCtx({commitments: COMMITMENT}).ctx));
    expect(one.commitments[0]).toMatchObject({category: 'Spend', costCents: 2000,
      costDisplay: '$20.00', type: 'Recurring'});
    const none = parse(await call('vercel_billing_list_commitments', {}, makeCtx().ctx));
    expect(none.count).toBe(0);
    expect(none.note).toMatch(/Enterprise contract feature/);
  });

  it('activity projects the log and gates payloads behind withPayload', async () => {
    const plain = parse(await call('vercel_activity_list', {}, makeCtx().ctx));
    expect(plain.events[0]).toMatchObject({text: 'Deployed Site to production',
      entityCount: 1, type: 'deployment-created'});
    expect(plain.events[0].payload).toBeUndefined();
    const withP = parse(await call('vercel_activity_list', {withPayload: true}, makeCtx().ctx));
    expect(withP.events[0].payload).toEqual({region: 'iad1'});
  });

  it('the client refuses the jsonl option for non-billing operations', async () => {
    const {ctx} = makeCtx();
    const client = makeVercelClient({token: 'vcp_FAKEtesttoken',
      account: {id: 'team_ONE', team_id: 'team_ONE', scope: 'team'},
      fetchImpl: ctx.fetchImpl});
    await expect(client.request('teams_get', {path: {teamId: 'team_ONE'}}, {jsonl: true}))
      .rejects.toThrow(/JSONL reads apply only/);
  });
});
