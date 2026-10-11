import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../../src/core/secret-box.js';
import { checkProductionWrite, requestProductionEnable, approveProductionEnable, disableProduction } from '../../src/tools/production-guard.js';
import { handleSetup } from '../../src/vercel/setup.js';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';

const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  ADMIN_PASSPHRASE: 'fixture-secret-owner-password' };
const conn = { account: 'team_FAKE', profile: 'full', mode: 'preview', listing: 'compact' };
function fixture() {
  const secrets = new Map(), audits = [], revoked = [];
  let enabled = false, badLogins = 0, seq = 0;
  const db = {
    listVercelAccounts: async () => [{ id: 'team_FAKE', label: 'Fixture', production_enabled: enabled }],
    async insertOneTimeSecret(row) { secrets.set(row.id, { ...row, vercel_account: row.account }); },
    async consumeOneTimeSecret({ id, account }) {
      const row = secrets.get(id);
      if (!row || row.account !== account || row.expiresAt.getTime() <= Date.now()) return null;
      secrets.delete(id); return row;
    },
    async setProductionEnabled(id, value) { if (id !== 'team_FAKE') return false; enabled = value; return true; },
    async revokeProductionTokens(account) { revoked.push(account); return 1; },
    async recordChange(entry) { audits.push(entry); return ++seq; },
    async recordLoginAttempt() { return ++seq; },
    async countRecentFailedLogins() { return badLogins++; },
    async markLoginAttemptSucceeded() {}
  };
  const opts = { db, env, connection: conn, confirm: true };
  return { db, opts, audits, revoked, secrets, isEnabled: () => enabled };
}
function mockRes() {
  return { headers: {}, statusCode: null, body: '', setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
    status(code){this.statusCode=code;return this;},send(x){this.body=x;return this;},
    json(x){this.body=JSON.stringify(x);return this;},end(){return this;} };
}
describe('B-2 two-step production permission', () => {
  it('blocks unsafe live changes and requires confirm in production mode', () => {
    expect(checkProductionWrite({ connection: conn, production: { production: true } }).status).toBe('refused_by_guard');
    expect(checkProductionWrite({ connection: { ...conn, mode: 'production' }, production: { production: true } }).status).toBe('needs_confirmation');
    expect(checkProductionWrite({ connection: { ...conn, mode: 'production' }, production: { production: true }, confirm: true }).mode).toBe('PRODUCTION');
    expect(checkProductionWrite({ connection: conn, production: null }).status).toBe('refused_by_guard');
  });
  it('requests approval but cannot enable until the owner reenters password on setup', async () => {
    const f = fixture();
    expect((await requestProductionEnable({ ...f.opts, confirm: false })).status).toBe('needs_confirmation');
    expect((await requestProductionEnable({ ...f.opts, dryRun: true })).status).toBe('preview');
    const request = await requestProductionEnable(f.opts);
    expect(request.status).toBe('awaiting_owner_passphrase');
    expect(f.isEnabled()).toBe(false);
    const csrf = 'q'.repeat(43);
    const cookie = 'rmcp_owner=' + encryptSecret(JSON.stringify({ csrf, exp: Date.now()+600000 }), 'setup:session', env);
    const req = body => ({ method: 'POST', headers: { cookie, 'x-real-ip': '127.0.0.1' }, body });
    const noCsrf = mockRes();
    await handleSetup(req({ action: 'approve_production', id: request.reference,
      account: 'team_FAKE', passphrase: env.ADMIN_PASSPHRASE }), noCsrf, { db:f.db, env });
    expect(noCsrf.statusCode).toBe(403);
    const wrong = mockRes();
    await handleSetup(req({ action: 'approve_production',csrf,id:request.reference,
      account:'team_FAKE', passphrase:'wrong' }), wrong, { db:f.db, env });
    expect(wrong.statusCode).toBe(401);
    expect(f.isEnabled()).toBe(false);
    const good = mockRes();
    await handleSetup(req({ action:'approve_production',csrf,id:request.reference,
      account:'team_FAKE',passphrase:env.ADMIN_PASSPHRASE }),good,{db:f.db,env});
    expect(good.statusCode).toBe(200);
    expect(f.isEnabled()).toBe(true);
    expect(f.audits.some(x=>x.production===true)).toBe(true);
    expect((await approveProductionEnable({db:f.db,env,account:'team_FAKE',reference:request.reference})).status).toBe('refused_by_guard');
  });
  it('rejects preview deployments, expired and wrong-account references', async () => {
    const f=fixture();
    expect((await requestProductionEnable({ ...f.opts,env:{...env,VERCEL_ENV:'preview'} })).status).toBe('refused_by_guard');
    expect((await requestProductionEnable({ ...f.opts,connection:{...conn,profile:'read_only'} })).status).toBe('refused_by_guard');
    const ref=await requestProductionEnable(f.opts);
    expect((await approveProductionEnable({db:f.db,env,account:'another',reference:ref.reference})).status).toBe('refused_by_guard');
    const entry=f.secrets.get(ref.reference);entry.expiresAt=new Date(Date.now()-1);
    expect((await approveProductionEnable({db:f.db,env,account:'team_FAKE',reference:ref.reference})).status).toBe('refused_by_guard');
    expect(f.isEnabled()).toBe(false);
  });
  it('disabling is confirmed, durable and revokes production bearer tokens', async () => {
    const f=fixture();
    expect((await disableProduction({db:f.db,connection:conn})).status).toBe('needs_confirmation');
    expect((await disableProduction({db:f.db,connection:{...conn,profile:'read_only'},confirm:true})).status).toBe('refused_by_guard');
    const result=await disableProduction({db:f.db,connection:conn,confirm:true});
    expect(result.status).toBe('disabled');
    expect(f.revoked).toEqual(['team_FAKE']);
    expect(f.audits).toHaveLength(1);
  });
  it('only exposes explicitly allowlisted local owner admin tools to full connections', async () => {
    const db=fixture().db;
    expect(registry.tools.filter(x=>x.writes && x.localAdmin).map(x=>x.name))
      .toEqual(['vercel_enable_production','vercel_disable_production','vercel_set_default_account','vercel_set_spend_limit','vercel_revoke_connection']);
    expect(registry.tools.filter(x=>x.writes && x.guardedWrite).map(x=>x.name))
      .toEqual(['vercel_project_create']);
    expect((await dispatchReadOnlyTool({registry,name:'vercel_enable_production',connection:{...conn,profile:'read_only'},db})).isError).toBe(true);
    const r=await dispatchReadOnlyTool({registry,name:'vercel_enable_production',args:{dryRun:true},connection:conn,db});
    // The test runner is not a production Vercel deployment, so the
    // exposed tool must refuse even an eligible full-profile caller.
    expect(r.isError).toBe(true);
  });
});
