import { describe, it, expect } from 'vitest';
import { workflowDomainTools } from '../../src/tools/workflow-domain.js';

const handler = workflowDomainTools.handlers.vercel_workflow_setup_custom_domain;
const parse = (r) => JSON.parse(r.content[0].text);

function fakeDb() {
  const rows = [];
  const replay = new Map();
  return { rows,
    async recordChange(e) { rows.push(e); return rows.length; },
    requestReplayStore: () => ({
      claim: async ({ key }) => {
        if (replay.has(key)) return replay.get(key);
        replay.set(key, { state: 'pending' });
        return { state: 'claimed', claimId: 'c1' };
      },
      complete: async ({ key, result }) => {
        replay.set(key, { state: 'completed', result }); },
      release: async ({ key }) => { replay.delete(key); }
    }),
    async getTodaySpendCents() { return 0; },
    async getVercelAccountSafe() { return null; },
    async getPurchasePolicy() { return null; },
    async listProtectedResources() { return []; },
    async listKnownApps() { return []; },
    async listBlobStoreConnections() { return []; } };
}

// A fake composed world. state: attached row, config, zone (null =
// external DNS), certs, and a refuseAttach switch.
function fakeRegistry(state) {
  const dispatched = [];
  const writeFake = (name, effect) => async (_ctx, args) => {
    dispatched.push({ name, args });
    if (args.dryRun === true) {
      return { content: [{ type: 'text', text: JSON.stringify({
        status: 'preview', preview: `${name} preview` }) }] };
    }
    const out = effect(args);
    return { content: [{ type: 'text', text: JSON.stringify(out) }] };
  };
  const registry = { async dispatchTool(name, args) {
    switch (name) {
    case 'vercel_project_get':
      return { content: [{ type: 'text', text: JSON.stringify(
        { id: 'prj_1', name: 'Site' }) }] };
    case 'vercel_domain_list_project_domains':
      return { content: [{ type: 'text', text: JSON.stringify(
        { domains: state.attached ? [state.attached] : [] }) }] };
    case 'vercel_domain_check_config':
      return { content: [{ type: 'text', text: JSON.stringify(state.config) }] };
    case 'vercel_dns_list':
      if (!state.zone) throw new Error('zone not found on Vercel');
      return { content: [{ type: 'text', text: JSON.stringify(
        { domain: 'example.com', records: state.zone }) }] };
    case 'vercel_cert_list':
      return { content: [{ type: 'text', text: JSON.stringify(
        { certificates: state.certs }) }] };
    case 'vercel_domain_attach_to_project':
      return writeFake(name, () => {
        if (state.refuseAttach) return { status: 'refused_by_guard',
          confirmed: false,
          reason: 'Domain is attached to a different project' };
        state.attached = { name: 'www.example.com',
          apexName: 'example.com', verified: true };
        return { status: 'applied', confirmed: true };
      })(null, args);
    case 'vercel_dns_create_record':
      return writeFake(name, () => {
        state.zone.push({ name: args.name, type: args.type,
          value: args.value });
        // The recommended record existing is what fixes the config.
        state.config = { ...state.config, misconfigured: false };
        return { status: 'applied', confirmed: true };
      })(null, args);
    case 'vercel_cert_issue':
      return writeFake(name, () => {
        state.certs = [{ cns: ['www.example.com'] }];
        return { status: 'applied', confirmed: true };
      })(null, args);
    default: throw new Error(`unexpected ${name}`);
    } } };
  return { registry, dispatched };
}

const baseState = () => ({ attached: null,
  config: { misconfigured: true, configuredBy: null,
    recommendedCNAME: ['cname.vercel-dns.com'], recommendedIPv4: ['76.76.21.21'],
    acceptedChallenges: ['http-01'] },
  zone: [], certs: [], refuseAttach: false });

function ctxFor(db, registry) {
  return { db, connection: { account: 'acct', mode: 'production',
      profile: 'full' },
    env: {}, fetchImpl: async () => { throw new Error('no fetch'); },
    dispatchTool: (n, a) => registry.dispatchTool(n, a) };
}
const callArgs = (over = {}) => ({ description:
  { project: 'prj_1', domain: 'www.example.com', outsideApp: true, ...over },
  requestKey: 'wf-domain-key-0001' });

describe('workflow setup_custom_domain (W-4)', () => {
  it('attaches, creates the recommended CNAME and issues the certificate', async () => {
    const db = fakeDb(); const state = baseState();
    const { registry, dispatched } = fakeRegistry(state);
    const dry = parse(await handler({ ...callArgs(), dryRun: true },
      ctxFor(db, registry)));
    expect(dry.status).toBe('preview');
    expect(dry.preview).toContain('Vercel hosts the DNS');
    const out = parse(await handler(
      { ...callArgs(), confirm: true }, ctxFor(db, registry)));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(out.receipt.recordsCreated)
      .toEqual(['CNAME www → cname.vercel-dns.com (zone example.com)']);
    expect(out.receipt.certificate).toBe('issued');
    const steps = dispatched.filter((d) => d.args.confirm === true)
      .map((d) => d.name);
    expect(steps).toEqual(['vercel_domain_attach_to_project',
      'vercel_dns_create_record', 'vercel_cert_issue']);
    const create = dispatched.find((d) => d.name === 'vercel_dns_create_record');
    expect(create.args).toMatchObject({ domain: 'example.com', name: 'www',
      type: 'CNAME', value: 'cname.vercel-dns.com' });
    expect(create.args.requestKey).toMatch(/-s2$/);
  });

  it('does nothing when the domain is already fully set up', async () => {
    const db = fakeDb(); const state = baseState();
    state.attached = { name: 'www.example.com', apexName: 'example.com',
      verified: true };
    state.config = { ...state.config, misconfigured: false };
    state.certs = [{ cns: ['www.example.com'] }];
    const { registry, dispatched } = fakeRegistry(state);
    const dry = parse(await handler({ ...callArgs(), dryRun: true },
      ctxFor(db, registry)));
    expect(dry.preview).toContain('Nothing to do');
    const out = parse(await handler({ ...callArgs(), confirm: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(true);
    expect(dispatched.filter((d) => d.args.confirm === true)).toEqual([]);
  });

  it('stops after attach with exact needs-you records on external DNS', async () => {
    const db = fakeDb(); const state = baseState();
    state.zone = null;
    const { registry, dispatched } = fakeRegistry(state);
    const out = parse(await handler({ ...callArgs(), confirm: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    expect(out.receipt).toBeUndefined();
    // C-8: the stop evidence is the journaled verification report.
    expect(db.rows[0].after.needsYou).toEqual([
      'Create this record at your DNS host: CNAME www → cname.vercel-dns.com (zone example.com)']);
    expect(dispatched.some((d) => d.name === 'vercel_cert_issue'))
      .toBe(false);
  });

  it('stops with the attach refusal reason journaled', async () => {
    const db = fakeDb(); const state = baseState();
    state.refuseAttach = true;
    const { registry } = fakeRegistry(state);
    const out = parse(await handler({ ...callArgs(), confirm: true },
      ctxFor(db, registry)));
    expect(out.status).toBe('applied');
    expect(out.confirmed).toBe(false);
    expect(out.receipt).toBeUndefined();
    expect(db.rows[0].after.stoppedAt.reason)
      .toBe('Domain is attached to a different project');
  });
});
