import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { oneTimeSecrets } from '../../src/core/one-time-secrets.js';
import { handleSetup, PROTECTED_DEFAULTS } from '../../src/vercel/setup.js';

const env = { ADMIN_PASSPHRASE: 'fixture-owner-passphrase',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
function response() {
  const headers = {};
  return {
    headers, statusCode: 200, body: '', finished: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = JSON.stringify(value); return this; },
    end() { this.finished = true; return this; }
  };
}
function request(method, body, cookie) {
  return { method, body, query: {}, headers: {
    'x-real-ip': '127.0.0.1', ...(cookie ? { cookie } : {})
  } };
}
function harness() {
  const db = createFakeDb({ accounts: [{ id: 'team_FAKE', team_id: 'team_FAKE',
    team_slug: 'fixture', label: 'Fixture', scope: 'team' }] });
  const protectedProjects = [];
  const pending = new Map(), once = new Map();
  db.seedProtectedProjects = vi.fn(async names => { protectedProjects.push(...names); });
  db.insertPendingInput = async row => { pending.set(row.id, row); };
  db.consumePendingInput = async ({ id, account, kind }) => {
    const row = pending.get(id);
    if (!row || row.account !== account || row.kind !== kind) return null;
    pending.delete(id);
    return { ...row, vercel_account: row.account };
  };
  db.insertOneTimeSecret = async row => { once.set(row.id, row); };
  db.consumeOneTimeSecret = async ({ id, account }) => {
    const row = once.get(id);
    if (!row || row.account !== account) return null;
    once.delete(id);
    return { ...row, vercel_account: row.account };
  };
  const provider = vi.fn(async ({ token, teamId }) => ({
    id: teamId, scope: 'team', last4: token.slice(-4)
  }));
  const call = async (method, body, cookie, opts = {}) => {
    const res = response();
    await handleSetup(request(method, body, cookie), res, { db, env, storeTokenFn: provider, ...opts });
    return res;
  };
  return { db, call, provider, pending, once, protectedProjects };
}
function csrfFrom(html) {
  return html.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
}
async function signIn(h) {
  const logged = await h.call('POST', { action: 'login', passphrase: env.ADMIN_PASSPHRASE });
  expect(logged.statusCode).toBe(303);
  const cookie = logged.headers['set-cookie'].split(';')[0];
  const page = await h.call('GET', null, cookie);
  expect(page.statusCode).toBe(200);
  return { cookie, csrf: csrfFrom(page.body) };
}

describe('A-5 owner-only setup security', () => {
  it('never shows account details or secret forms before sign-in', async () => {
    const h = harness();
    const res = await h.call('GET');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Administrator sign in');
    expect(res.body).not.toContain('fixture');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect((await h.call('POST', { action: 'pending_input' })).statusCode).toBe(403);
  });
  it('counts wrong passphrases in the database and locks repeated attempts', async () => {
    const h = harness();
    for (let n = 0; n < 5; n++) {
      const r = await h.call('POST', { action: 'login', passphrase: 'bad' });
      expect(r.statusCode).toBe(401);
    }
    const locked = await h.call('POST', { action: 'login', passphrase: env.ADMIN_PASSPHRASE });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBe('900');
  });
  it('sets a Secure HttpOnly SameSite cookie, CSRF guards all actions, seeds protection', async () => {
    const h = harness();
    const auth = await signIn(h);
    expect(auth.cookie).not.toContain(env.ADMIN_PASSPHRASE);
    const req = await h.call('POST', { action: 'add_token',
      token: 'vcp_FAKEcredential_1234', teamId: 'team_FAKE' }, auth.cookie);
    expect(req.statusCode).toBe(403);
    const save = await h.call('POST', { action: 'add_token', csrf: auth.csrf,
      token: 'vcp_FAKEcredential_1234', teamId: 'team_FAKE' }, auth.cookie);
    expect(save.statusCode).toBe(200);
    expect(save.body).not.toContain('vcp_FAKEcredential_1234');
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.provider.mock.calls[0][0].allowFull).toBe(false);
    expect(h.protectedProjects).toEqual(PROTECTED_DEFAULTS);
  });
  it('accepts pending inputs and reveals an owner secret only once', async () => {
    const h = harness();
    const auth = await signIn(h);
    const receipt = await h.call('POST', { action: 'pending_input', csrf: auth.csrf,
      account: 'team_FAKE', kind: 'env_value', label: 'sample',
      value: 'fixture-value' }, auth.cookie);
    expect(receipt.body).not.toContain('fixture-value');
    expect(h.pending.size).toBe(1);
    const issue = await oneTimeSecrets({ db: h.db, env }).issue({
      account: 'team_FAKE', kind: 'temporary', value: '<fixture-secret>'
    });
    const view = await h.call('POST', { action: 'reveal', csrf: auth.csrf,
      account: 'team_FAKE', id: issue.id }, auth.cookie);
    expect(view.statusCode).toBe(200);
    expect(view.body).toContain('&lt;fixture-secret&gt;');
    expect(view.body).not.toContain('<fixture-secret>');
    const second = await h.call('POST', { action: 'reveal', csrf: auth.csrf,
      account: 'team_FAKE', id: issue.id }, auth.cookie);
    expect(second.statusCode).toBe(404);
    const signOut = await h.call('POST', { action: 'logout', csrf: auth.csrf }, auth.cookie);
    expect(signOut.statusCode).toBe(303);
    expect(signOut.headers['set-cookie']).toContain('Max-Age=0');
  });
  it('rechecks only an owner-selected stored account after login and CSRF without exposing credentials', async () => {
    const h = harness(), check = vi.fn(async () => ({
      access:'read_verified', visibleTeamCount:1, scopeVerified:false
    }));
    const unsigned = await h.call('POST', { action:'recheck_token', account:'team_FAKE' },
      null, { recheckTokenFn:check });
    expect(unsigned.statusCode).toBe(403);
    const auth = await signIn(h);
    const wrongCsrf = await h.call('POST', { action:'recheck_token',
      account:'team_FAKE', csrf:'wrong' }, auth.cookie, { recheckTokenFn:check });
    expect(wrongCsrf.statusCode).toBe(403);
    const other = await h.call('POST', { action:'recheck_token',
      account:'team_OTHER', csrf:auth.csrf }, auth.cookie, { recheckTokenFn:check });
    expect(other.statusCode).toBe(403);
    expect(check).not.toHaveBeenCalled();
    const success = await h.call('POST', { action:'recheck_token', account:'team_FAKE',
      csrf:auth.csrf }, auth.cookie, { recheckTokenFn:check });
    expect(success.statusCode).toBe(200);
    expect(check).toHaveBeenCalledWith({db:h.db,accountId:'team_FAKE',env});
    expect(success.body).toContain('Write permissions and expiry remain unverified');
    expect(success.body).not.toContain('read_verified');
    expect(success.body).not.toContain(env.TOKEN_ENCRYPTION_KEY);
    expect((await h.call('GET',null,auth.cookie)).body).toContain('Recheck stored token read access');
    const failed = await h.call('POST', {action:'recheck_token',account:'team_FAKE',
      csrf:auth.csrf},auth.cookie,{recheckTokenFn:async()=>{throw new Error('DO_NOT_ECHO_PROVIDER');}});
    expect(failed.statusCode).toBe(400);
    expect(failed.body).not.toContain('DO_NOT_ECHO_PROVIDER');
  });
  it('changes default only with owner session, CSRF, explicit confirmation and fresh passphrase',async()=>{
    const h = harness(), change = vi.fn(async()=>true);
    h.db.setDefaultOwnerAccount = change;
    const body = {action:'set_default_account',account:'team_FAKE',confirm:'yes',
      passphrase:env.ADMIN_PASSPHRASE};
    expect((await h.call('POST',body,null,{env:{...env,VERCEL_ENV:'production'}})).statusCode).toBe(403);
    const auth=await signIn(h);
    const prod={...env,VERCEL_ENV:'production'};
    expect((await h.call('POST',{...body,csrf:'invalid'},auth.cookie,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...body,csrf:auth.csrf,confirm:'no'},auth.cookie,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...body,csrf:auth.csrf,account:'team_OTHER'},auth.cookie,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...body,csrf:auth.csrf},auth.cookie)).statusCode).toBe(403);
    expect(change).not.toHaveBeenCalled();
    const wrong=await h.call('POST',{...body,csrf:auth.csrf,passphrase:'incorrect'},auth.cookie,{env:prod});
    expect(wrong.statusCode).toBe(401);
    expect(change).not.toHaveBeenCalled();
    const good=await h.call('POST',{...body,csrf:auth.csrf},auth.cookie,{env:prod});
    expect(good.statusCode).toBe(200);
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith('team_FAKE');
    expect(good.body).toContain('existing connections remain unchanged');
    expect(good.body).not.toContain(env.ADMIN_PASSPHRASE);
    expect(good.body).not.toContain(env.TOKEN_ENCRYPTION_KEY);
    const page=await h.call('GET',null,auth.cookie);
    expect(page.body).toContain('Default account for new connections');
  });
  it('never claims success when the database rejects or cannot verify owner selection',async()=>{
    const h=harness();
    const auth=await signIn(h), prod={...env,VERCEL_ENV:'production'};
    const body={action:'set_default_account',account:'team_FAKE',confirm:'yes',
      csrf:auth.csrf,passphrase:env.ADMIN_PASSPHRASE};
    const denied=await h.call('POST',body,auth.cookie,{
      env:prod,db:{...h.db,setDefaultOwnerAccount:vi.fn(async()=>false)}
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.body).not.toContain('updated');
    const errored=await h.call('POST',body,auth.cookie,{
      env:prod,db:{...h.db,setDefaultOwnerAccount:async()=>{throw Error('DO_NOT_ECHO_DATABASE');}}
    });
    expect(errored.statusCode).toBe(400);
    expect(errored.body).not.toContain('DO_NOT_ECHO_DATABASE');
  });
  it('requires independent owner proof for exact dollar spend limits without provider writes', async () => {
    const h = harness(), write = vi.fn(async () => true);
    h.db.setOwnerSpendLimit = write;
    const auth = await signIn(h), prod = {...env, VERCEL_ENV:'production'};
    const body = {action:'set_spend_limit',account:'team_FAKE',confirm:'yes',
      csrf:auth.csrf,passphrase:env.ADMIN_PASSPHRASE,limitDollars:'11.25'};
    const attempt = (payload, cookie=auth.cookie, extra={env:prod}) =>
      h.call('POST',payload,cookie,extra);
    expect((await attempt(body,null)).statusCode).toBe(403);
    expect((await attempt({...body,csrf:'wrong'})).statusCode).toBe(403);
    expect((await attempt({...body,account:'team_OTHER'})).statusCode).toBe(403);
    expect((await attempt({...body,confirm:'no'})).statusCode).toBe(403);
    // Production and preview are separate server trust boundaries.
    expect((await h.call('POST',body,auth.cookie)).statusCode).toBe(403);
    for (const invalid of ['-1','1.234','1e2','21474836.48','01','Infinity','NaN','']) {
      expect((await attempt({...body,limitDollars:invalid})).statusCode).toBe(403);
    }
    expect((await attempt({...body,passphrase:'incorrect'})).statusCode).toBe(401);
    expect(write).not.toHaveBeenCalled();
    const yes=await attempt(body);
    expect(yes.statusCode).toBe(200);
    expect(yes.body).toContain('$11.25');
    expect(yes.body).toContain('No spending');
    expect(write).toHaveBeenCalledWith('team_FAKE',1125);
    const zero=await attempt({...body,limitDollars:'0.00'});
    expect(zero.statusCode).toBe(200);
    expect(write).toHaveBeenLastCalledWith('team_FAKE',0);
    expect(h.provider).not.toHaveBeenCalled();
    expect(yes.body).not.toContain(env.ADMIN_PASSPHRASE);
    expect(yes.body).not.toContain(env.TOKEN_ENCRYPTION_KEY);
  });
  it('does not report spend-limit success when verification fails or exceptions occur',async()=>{
    const h=harness(),auth=await signIn(h),prod={...env,VERCEL_ENV:'production'};
    const body={action:'set_spend_limit',account:'team_FAKE',confirm:'yes',csrf:auth.csrf,
      passphrase:env.ADMIN_PASSPHRASE,limitDollars:'1.01'};
    const no=await h.call('POST',body,auth.cookie,{env:prod,
      db:{...h.db,setOwnerSpendLimit:async()=>false}});
    expect(no.statusCode).toBe(409);
    const fail=await h.call('POST',body,auth.cookie,{env:prod,
      db:{...h.db,setOwnerSpendLimit:async()=>{throw Error('DO_NOT_ECHO_DB');}}});
    expect(fail.statusCode).toBe(400);
    expect(fail.body).not.toContain('DO_NOT_ECHO_DB');
  });
  it('revokes exactly the selected connector after session, CSRF and fresh passphrase',async()=>{
    const h=harness(),revoke=vi.fn(async()=>true);
    h.db.revokeOwnerConnection=revoke;
    h.db.listAccountConnections=async()=>[{
      id:'conn_0123456789abcdef0123',vercel_account:'team_FAKE',kind:'connector',revoked_at:null
    }];
    const auth=await signIn(h),prod={...env,VERCEL_ENV:'production'};
    const payload={action:'revoke_connection',account:'team_FAKE',confirm:'yes',
      connectionRef:'conn_0123456789abcdef0123',csrf:auth.csrf,passphrase:env.ADMIN_PASSPHRASE};
    expect((await h.call('POST',payload,null,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,csrf:'wrong'},auth.cookie,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',payload,auth.cookie)).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,account:'team_OTHER'},auth.cookie,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,confirm:'no'},auth.cookie,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,connectionRef:'invalid'},auth.cookie,{env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,passphrase:'wrong'},auth.cookie,{env:prod})).statusCode).toBe(401);
    expect(revoke).not.toHaveBeenCalled();
    const yes=await h.call('POST',payload,auth.cookie,{env:prod});
    expect(yes.statusCode).toBe(200);
    expect(revoke).toHaveBeenCalledWith({account:'team_FAKE',connectionId:'conn_0123456789abcdef0123'});
    expect(yes.body).toContain('independently verified');
    expect(yes.body).not.toContain(env.ADMIN_PASSPHRASE);
    expect((await h.call('GET',null,auth.cookie)).body).toContain('conn_0123456789abcdef0123');
    expect(h.provider).not.toHaveBeenCalled();
  });
  it('never reports unverified or failed revocation as success',async()=>{
    const h=harness(),auth=await signIn(h),prod={...env,VERCEL_ENV:'production'};
    const data={action:'revoke_connection',account:'team_FAKE',confirm:'yes',
      connectionRef:'conn_0123456789abcdef0123',csrf:auth.csrf,passphrase:env.ADMIN_PASSPHRASE};
    const denied=await h.call('POST',data,auth.cookie,{env:prod,
      db:{...h.db,revokeOwnerConnection:async()=>false}});
    expect(denied.statusCode).toBe(409);
    const errored=await h.call('POST',data,auth.cookie,{env:prod,
      db:{...h.db,revokeOwnerConnection:async()=>{throw Error('NEVER_ECHO');}}});
    expect(errored.statusCode).toBe(400);
    expect(errored.body).not.toContain('NEVER_ECHO');
  });
  it('reviews exact pending request only after session and CSRF in production',async()=>{
    const h=harness(), auth=await signIn(h), prod={...env,VERCEL_ENV:'production'};
    const reference='01234567-89ab-4cde-8012-3456789abcde';
    const reader=vi.fn(async()=>({version:1,issuerAccount:'team_FAKE',action:'spend',
      targetAccount:null,connectionRef:null,limitCents:1125}));
    const payload={action:'review_owner_request',account:'team_FAKE',reference,csrf:auth.csrf};
    expect((await h.call('POST',payload,null,{env:prod,inspectOwnerChangeFn:reader})).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,csrf:'wrong'},auth.cookie,
      {env:prod,inspectOwnerChangeFn:reader})).statusCode).toBe(403);
    expect((await h.call('POST',payload,auth.cookie,{inspectOwnerChangeFn:reader})).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,account:'team_OTHER'},auth.cookie,
      {env:prod,inspectOwnerChangeFn:reader})).statusCode).toBe(403);
    expect((await h.call('POST',{...payload,reference:'bad'},auth.cookie,
      {env:prod,inspectOwnerChangeFn:reader})).statusCode).toBe(403);
    expect(reader).not.toHaveBeenCalled();
    const ok=await h.call('POST',payload,auth.cookie,{env:prod,inspectOwnerChangeFn:reader});
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('$11.25');
    expect(ok.body).toContain('no account change has been approved or applied');
    expect(reader).toHaveBeenCalledWith({db:h.db,env:prod,account:'team_FAKE',reference});
    expect(h.provider).not.toHaveBeenCalled();
    expect((await h.call('POST',payload,auth.cookie,{env:prod,
      inspectOwnerChangeFn:async()=>null})).statusCode).toBe(404);
    const bad=await h.call('POST',payload,auth.cookie,{env:prod,
      inspectOwnerChangeFn:async()=>{throw Error('SECRET_INTERNAL_ERROR');}});
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain('SECRET_INTERNAL_ERROR');
  });
  it('applies an owner request only after independent session/CSRF/confirmation/passphrase',async()=>{
    const h=harness(),auth=await signIn(h),prod={...env,VERCEL_ENV:'production'};
    const reference='01234567-89ab-4cde-8012-3456789abcde';
    const request={version:1,issuerAccount:'team_FAKE',action:'spend',
      targetAccount:null,connectionRef:null,limitCents:1125};
    const inspect=vi.fn(async()=>request),consume=vi.fn(async()=>request);
    const apply=vi.fn(async()=>({status:'applied',confirmed:true}));
    const body={action:'approve_owner_request',account:'team_FAKE',reference,
      csrf:auth.csrf,confirm:'yes',passphrase:env.ADMIN_PASSPHRASE};
    const funcs={inspectOwnerChangeFn:inspect,consumeOwnerChangeFn:consume,applyApprovedChangeFn:apply};
    expect((await h.call('POST',body,null,{...funcs,env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...body,csrf:'bad'},auth.cookie,{...funcs,env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',body,auth.cookie,funcs)).statusCode).toBe(403);
    expect((await h.call('POST',{...body,account:'team_OTHER'},auth.cookie,{...funcs,env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...body,reference:'bad'},auth.cookie,{...funcs,env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...body,confirm:'no'},auth.cookie,{...funcs,env:prod})).statusCode).toBe(403);
    expect((await h.call('POST',{...body,passphrase:'wrong'},auth.cookie,{...funcs,env:prod})).statusCode).toBe(401);
    expect(inspect).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    const ok=await h.call('POST',body,auth.cookie,{...funcs,env:prod});
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('independently verified');
    expect(apply).toHaveBeenCalledWith({db:h.db,request});
    expect(h.provider).not.toHaveBeenCalled();
    expect(ok.body).not.toContain(env.ADMIN_PASSPHRASE);
  });
  it('refuses exhausted, changed, and unverified approvals without claiming success',async()=>{
    const h=harness(),auth=await signIn(h),prod={...env,VERCEL_ENV:'production'};
    const request={version:1,issuerAccount:'team_FAKE',action:'default',
      targetAccount:'team_FAKE',connectionRef:null,limitCents:null};
    const body={action:'approve_owner_request',account:'team_FAKE',
      reference:'01234567-89ab-4cde-8012-3456789abcde',
      csrf:auth.csrf,confirm:'yes',passphrase:env.ADMIN_PASSPHRASE};
    const base={env:prod,inspectOwnerChangeFn:async()=>request};
    const missing=await h.call('POST',body,auth.cookie,{...base,consumeOwnerChangeFn:async()=>null});
    expect(missing.statusCode).toBe(409);
    const changed=await h.call('POST',body,auth.cookie,{...base,
      consumeOwnerChangeFn:async()=>({...request,targetAccount:'team_OTHER'})});
    expect(changed.statusCode).toBe(409);
    const unverified=await h.call('POST',body,auth.cookie,{...base,
      consumeOwnerChangeFn:async()=>request,
      applyApprovedChangeFn:async()=>({status:'unverified',confirmed:false})});
    expect(unverified.statusCode).toBe(409);
    expect(unverified.body).not.toContain('independently verified');
    const providerError=await h.call('POST',body,auth.cookie,{...base,
      consumeOwnerChangeFn:async()=>request,
      applyApprovedChangeFn:async()=>{throw Error('NEVER_ECHO_INTERNAL');}});
    expect(providerError.statusCode).toBe(400);
    expect(providerError.body).not.toContain('NEVER_ECHO_INTERNAL');
  });
  it('fails closed when owner secrets are missing', async () => {
    const h = harness(), res = await h.call('GET', null, null,
      { env: { ADMIN_PASSPHRASE: env.ADMIN_PASSPHRASE } });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('fixture');
  });
});
