import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../../src/core/secret-box.js';
import { checkProductionWrite, requestProductionEnable, approveProductionEnable, disableProduction } from '../../src/tools/production-guard.js';
import { productionTools } from '../../src/tools/production.js';
import { handleSetup } from '../../src/vercel/setup.js';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';

const env = { VERCEL_ENV: 'production', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  ADMIN_PASSPHRASE: 'fixture-secret-owner-password' };
const conn = { account: 'team_FAKE', profile: 'full', mode: 'preview', listing: 'compact' };
function fixture(strictness = 'word') {
  const secrets = new Map(), audits = [], revoked = [];
  let enabled = false, badLogins = 0, seq = 0;
  const db = {
    listVercelAccounts: async () => [{ id: 'team_FAKE', label: 'Fixture', production_enabled: enabled,
      production_enable_strictness: strictness }],
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
describe('B-2 production permission (AUD-B: word default, passphrase strictness)', () => {
  it('blocks unsafe live changes and requires confirm in production mode', () => {
    expect(checkProductionWrite({ connection: conn, production: { production: true } }).status).toBe('refused_by_guard');
    expect(checkProductionWrite({ connection: { ...conn, mode: 'production' }, production: { production: true } }).status).toBe('needs_confirmation');
    expect(checkProductionWrite({ connection: { ...conn, mode: 'production' }, production: { production: true }, confirm: true }).mode).toBe('PRODUCTION');
    expect(checkProductionWrite({ connection: conn, production: null }).status).toBe('refused_by_guard');
  });
  it('AUD-B word strictness (default): confirm enables on the owner word, no passphrase consumed', async () => {
    const f = fixture('word');
    expect((await requestProductionEnable({ ...f.opts, confirm: false })).status).toBe('needs_confirmation');
    const dry = await requestProductionEnable({ ...f.opts, dryRun: true });
    expect(dry.status).toBe('preview');
    expect(dry.strictness).toBe('word');
    expect(f.isEnabled()).toBe(false);
    const result = await requestProductionEnable(f.opts);
    expect(result).toEqual({ status: 'enabled', account: 'team_FAKE',
      productionEnabled: true, strictness: 'word' });
    expect(f.isEnabled()).toBe(true);
    // No receipt was issued or consumed: the secrets store stays empty.
    expect(f.secrets.size).toBe(0);
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({ tool: 'vercel_enable_production',
      production: true, dryRun: false });
    expect(f.audits[0].summary).toContain('Owner word confirmed');
    expect((await requestProductionEnable(f.opts)).status).toBe('already_enabled');
  });
  it('AUD-B: a missing strictness value reads as the word default', async () => {
    const f = fixture();
    f.db.listVercelAccounts = async () => [{ id: 'team_FAKE', label: 'Fixture',
      production_enabled: f.isEnabled() }];
    const result = await requestProductionEnable(f.opts);
    expect(result.status).toBe('enabled');
    expect(result.strictness).toBe('word');
  });
  it('AUD-B: the A12 preview-deployment block and pass refusal fire in both strictness modes', async () => {
    for (const strictness of ['word', 'passphrase']) {
      const f = fixture(strictness);
      expect((await requestProductionEnable({ ...f.opts,
        env: { ...env, VERCEL_ENV: 'preview' } })).status).toBe('refused_by_guard');
      expect((await requestProductionEnable({ ...f.opts,
        connection: { ...conn, profile: 'read_only' } })).status).toBe('refused_by_guard');
      expect(f.isEnabled()).toBe(false);
      expect(f.secrets.size).toBe(0);
    }
  });
  it('AUD-B: strictness cannot be set through the tool; the attempt is refused', async () => {
    const f = fixture('word');
    const refused = await productionTools.handlers.vercel_enable_production(
      { confirm: true, strictness: 'passphrase' }, { connection: conn, db: f.db, env });
    expect(refused.isError).toBe(true);
    const payload = JSON.parse(refused.content[0].text);
    expect(payload.status).toBe('refused_by_guard');
    expect(payload.reason).toContain('setup page');
    expect(f.isEnabled()).toBe(false);
    const viaTool = await productionTools.handlers.vercel_enable_production(
      { confirm: true }, { connection: conn, db: f.db, env });
    expect(JSON.parse(viaTool.content[0].text).status).toBe('enabled');
    expect(f.isEnabled()).toBe(true);
  });
  it('AUD-B: setup approve_production reports a word team as word-enabled, consuming no receipt', async () => {
    const f = fixture('word');
    const csrf = 'q'.repeat(43);
    const cookie = 'rmcp_owner=' + encryptSecret(JSON.stringify({ csrf, exp: Date.now()+600000 }), 'setup:session', env);
    const res = mockRes();
    await handleSetup({ method: 'POST', headers: { cookie, 'x-real-ip': '127.0.0.1' },
      body: { action: 'approve_production', csrf, id: 'no-receipt-needed',
        account: 'team_FAKE', passphrase: env.ADMIN_PASSPHRASE } }, res, { db: f.db, env });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('word strictness');
    expect(res.body).toContain('no setup receipt is needed');
    expect(f.isEnabled()).toBe(false);
    expect(f.secrets.size).toBe(0);
  });
  it('passphrase strictness: requests approval but cannot enable until the owner reenters password on setup', async () => {
    const f = fixture('passphrase');
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
    const f=fixture('passphrase');
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
      .toEqual(['vercel_set_working_box','vercel_enable_production','vercel_disable_production','vercel_set_default_account','vercel_set_spend_limit','vercel_revoke_connection','vercel_remove_account','vercel_create_pass']);
    expect(registry.tools.filter(x=>x.writes && x.guardedWrite).map(x=>x.name))
      .toEqual(['vercel_project_create','vercel_project_update_settings','vercel_project_add_member','vercel_project_remove_member','vercel_project_pause','vercel_project_unpause','vercel_project_delete','vercel_project_transfer','vercel_project_set_build_resources','vercel_rolling_update_config','vercel_rolling_start','vercel_rolling_approve_stage','vercel_rolling_complete','vercel_deploy_promote','vercel_deploy_rollback','vercel_alias_assign','vercel_alias_delete','vercel_deploy_cancel','vercel_deploy_delete','vercel_deploy_redeploy','vercel_deploy_create_from_git','vercel_deploy_create_from_files','vercel_shared_env_set','vercel_shared_env_delete','vercel_globalconfig_create','vercel_globalconfig_patch_items','vercel_globalconfig_delete','vercel_globalconfig_create_token','vercel_globalconfig_restore_backup','vercel_globalconfig_revoke_tokens','vercel_globalconfig_set_schema','vercel_environment_create','vercel_environment_update','vercel_environment_delete','vercel_env_set','vercel_env_delete','vercel_env_copy','vercel_env_set_many','vercel_env_delete_many','vercel_team_update_profile','vercel_team_create','vercel_team_delete', 'vercel_team_update_security', 'vercel_team_set_default_protection','vercel_api_write','vercel_dev_seed','vercel_dev_cleanup','vercel_dev_preview_branch','vercel_dev_wire_preview_env','vercel_dev_alias_preview','vercel_dev_create_bypass','vercel_dev_send_test_webhook',
      'vercel_dev_sandbox_create','vercel_dev_sandbox_run','vercel_dev_sandbox_write_files',
      'vercel_dev_sandbox_stop','vercel_domain_add_to_team','vercel_domain_update',
      'vercel_domain_remove_from_team','vercel_domain_attach_to_project',
      'vercel_domain_update_project_domain','vercel_domain_detach_from_project',
      'vercel_domain_verify_project_domain','vercel_analytics_set_web_analytics',
      'vercel_analytics_set_speed_insights','vercel_drain_create','vercel_drain_delete',
      'vercel_drain_update','vercel_drain_test','vercel_webhook_create',
      'vercel_webhook_delete',
      'vercel_protection_set_vercel_auth',
      'vercel_protection_set_password','vercel_protection_set_trusted_ips',
      'vercel_protection_create_bypass','vercel_protection_revoke_bypass',
      'vercel_alias_set_shareable_link']);    expect((await dispatchReadOnlyTool({registry,name:'vercel_enable_production',connection:{...conn,profile:'read_only'},db})).isError).toBe(true);
    const r=await dispatchReadOnlyTool({registry,name:'vercel_enable_production',args:{dryRun:true},connection:conn,db});
    // The test runner is not a production Vercel deployment, so the
    // exposed tool must refuse even an eligible full-profile caller.
    expect(r.isError).toBe(true);
  });
});
