// Shared behavioral contract for every future guarded Vercel write tool.
// Production tools should run this suite with their own fake provider adapters.
import { describe, it, expect } from 'vitest';
import { defineWrite, writeRequestKey } from '../../src/core/write.js';
import { spendPreflight } from '../../src/vercel/spend.js';

export function sampleWrite(options = {}) {
  const provider = [];
  const audits = [];
  const rows = new Map();
  const spec = {
    name: 'fixture_update',
    risk: { spend: Boolean(options.spend), access: Boolean(options.access) },
    before: async () => ({ version: 'before' }),
    preview: async args => 'Change fixture to ' + (args.name || 'updated'),
    targets: args => [{ kind: 'project', id: 'prj_FAKE', protected: Boolean(args.protected),
      appOwned: Boolean(args.appOwned) }],
    production: args => ({ production: Boolean(args.live), why: args.live ? 'Changes a live site' : 'Preview only' }),
    apply: async args => { provider.push(args.name || 'updated'); return { version: 'after' }; },
    verify: async args => ({ confirmed: options.verifyUnknown ? undefined : !args.mismatch }),
    spend: options.spend ? async () => ({ cents: options.cents ?? 500, recurring: false,
      description: 'Fixture operation' }) : undefined,
    access: options.access ? async () => ({ widens: true, who: 'fixture user', what: 'fixture role' }) : undefined,
    inverse: () => ({ tool: 'fixture_restore', args: { version: 'before' } })
  };
  const ctx = {
    connection: { account: 'account_FAKE', mode: 'preview', profile: 'everyday' },
    now: () => 600000,
    guardProtected: async targets => targets[0].protected ?
      { blocked: true, reason: 'Protected resource' } : { blocked: false },
    guardApp: async targets => targets[0].appOwned ?
      { blocked: true, reason: 'App-owned resource' } : { blocked: false },
    shape: value => JSON.parse(JSON.stringify(value)),
    audit: async entry => { audits.push(entry); },
    spendLimitCents: options.spendLimitCents ?? 0,
    spentTodayCents: 0,
    checkSpend: async (declaration, confirm) => spendPreflight({
      declaration, confirm,
      spendLimitCents: ctx.spendLimitCents, spentTodayCents: ctx.spentTodayCents
    }),
    replayStore: {
      async claim({ key }) {
        if (rows.has(key)) return rows.get(key);
        rows.set(key, { state: 'pending' });
        return { state: 'claimed', claimId: 'claim_FAKE' };
      },
      async complete({ key, result }) { rows.set(key, { state: 'completed', result }); },
      async release({key,claimId}){
        if(claimId==='claim_FAKE'&&rows.get(key)?.state==='pending'){
          rows.delete(key);return true;
        }
        return false;
      }
    }
  };
  return { spec, tool: defineWrite(spec), ctx, provider, audits, rows };
}

// Fake *independently authenticated* owner approval for contract tests only.
// No daily limit or AI confirm can set this DB-owned approval status.
export function attachFakeOwnerPurchase(ctx,initiallyApproved=true) {
  const state={status:initiallyApproved?'approved':'pending'};
  ctx.db={
    requestPurchaseIntent:async()=>({reference:'12345678-1234-1234-1234-123456789abc',
      status:state.status,expiresAt:new Date(Date.now()+600000).toISOString()}),
    getPurchaseIntent:async()=>({status:state.status,
      ceiling_cents:Number.MAX_SAFE_INTEGER,approved_at:new Date(),
      expires_at:new Date(Date.now()+600000),
      consumed_at:state.status==='consumed'?new Date():null}),
    consumePurchaseIntent:async()=>{if(state.status!=='approved')return false;
      state.status='consumed';return true;}
  };
  return state;
}
export function runWriteContract(label, factory = sampleWrite) {
  describe('eight guarded write contract categories: ' + label, () => {
    it('1 dry run is preview-only and recorded', async () => {
      const f = factory();
      const result = await f.tool.run({ name: 'new', dryRun: true }, f.ctx);
      expect(result.status).toBe('preview');
      expect(f.provider).toHaveLength(0);
      expect(f.audits[0].dryRun).toBe(true);
    });
    it('2 requires explicit confirmation before calling provider', async () => {
      const f = factory();
      expect((await f.tool.run({ name: 'new' }, f.ctx)).status).toBe('needs_confirmation');
      expect(f.provider).toHaveLength(0);
    });
    it('3 executes once and returns stored result for same request key', async () => {
      const f = factory();
      const args = { name: 'new', confirm: true };
      expect((await f.tool.run(args, f.ctx)).confirmed).toBe(true);
      expect((await f.tool.run(args, f.ctx)).confirmed).toBe(true);
      expect(f.provider).toHaveLength(1);
      expect(f.audits).toHaveLength(1);
    });
    it('4 read-back mismatch and unknown outcome are never reported confirmed', async () => {
      const a = factory();
      expect((await a.tool.run({ confirm: true, mismatch: true }, a.ctx)).confirmed).toBe(false);
      const b = sampleWrite({ verifyUnknown: true });
      expect((await b.tool.run({ confirm: true }, b.ctx)).confirmed).toBeNull();
    });
    it('5 protected and app-owned targets are refused before apply', async () => {
      const a = factory();
      expect((await a.tool.run({ confirm: true, protected: true }, a.ctx)).status).toBe('refused_by_guard');
      expect((await a.tool.run({ confirm: true, appOwned: true }, a.ctx)).status).toBe('refused_by_guard');
      expect(a.provider).toHaveLength(0);
    });
    it('6 preview mode cannot make a production change; production needs confirm', async () => {
      const a = factory();
      expect((await a.tool.run({ live: true, confirm: true }, a.ctx)).status).toBe('refused_by_guard');
      a.ctx.connection.mode = 'production';
      expect((await a.tool.run({ live: true }, a.ctx)).status).toBe('needs_confirmation');
      const allowed = await a.tool.run({ live: true, confirm: true }, a.ctx);
      expect(allowed.mode).toBe('PRODUCTION');
    });
    it('7 paid writes reject AI confirmation and daily limit without a one-use owner purchase', async () => {
      const a=sampleWrite({spend:true});
      expect((await a.tool.run({confirm:true},a.ctx)).status).toBe('refused_by_guard');
      a.ctx.spendLimitCents=1000;
      const p=await a.tool.run({dryRun:true},a.ctx);
      expect(p.moneyLine).toContain('$5.00 USD');
      expect((await a.tool.run({confirm:true,requestKey:'ownerInvoiceFake01'},a.ctx)).status)
        .toBe('refused_by_guard');
      const owner=attachFakeOwnerPurchase(a.ctx,false);
      const args={confirm:true,requestKey:'ownerInvoiceFake01'};
      expect((await a.tool.run(args,a.ctx)).status).toBe('awaiting_owner_approval');
      expect(a.provider).toHaveLength(0);
      owner.status='approved';
      expect((await a.tool.run(args,a.ctx)).confirmed).toBe(true);
      expect(a.provider).toHaveLength(1);
    });
    it('8 access widening requires confirm; read-only profile cannot write', async () => {
      const a = sampleWrite({ access: true });
      expect((await a.tool.run({}, a.ctx)).status).toBe('needs_confirmation');
      a.ctx.connection.profile = 'read_only';
      expect((await a.tool.run({ confirm: true }, a.ctx)).status).toBe('refused_by_guard');
      expect(a.provider).toHaveLength(0);
    });
  });
}
export { writeRequestKey };
