import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../../src/core/secret-box.js';
import { makeFakeVercel } from '../../test/helpers/fake-vercel.js';
import { recheckStoredToken } from '../../src/vercel/tokens.js';
import { registry } from '../../src/tools/index.js';
import { dispatchReadOnlyTool } from '../../src/core/mcp-server.js';

const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const accountId = 'team_FAKE_a/prj_FAKE_a';
const token = 'vcp_FAKE_probe_12345678';
const connection = { account: accountId, mode: 'preview', profile: 'read_only', listing: 'compact' };
function fixture({ broad = false, incomplete = false, missing = false, expired = false } = {}) {
  const db = {
    getAccountCredential: vi.fn(async id => id === accountId && !missing ? {
      id: accountId, team_id: 'team_FAKE_a', project_id: 'prj_FAKE_a',
      scope: 'project', token_expires_at: expired ? '2020-01-01T00:00:00Z' : null,
      token_enc: encryptSecret(token, 'token:' + accountId, env)
    } : null),
    upsertVercelAccount: vi.fn(), logChange: vi.fn()
  };
  const api = makeFakeVercel();
  api.when('GET','/v2/user').resolves({user:{id:'user_FAKE'}});
  api.when('GET','/v2/teams').resolves({teams:[{id:'team_FAKE_a',slug:'fixture-a'},
    ...(broad ? [{id:'team_FAKE_b',slug:'fixture-b'}] : [])]});
  api.when('GET','/v10/projects').resolves({
    projects:[{id:'prj_FAKE_a',name:'fixture-a'}],
    pagination:{next:incomplete ? 'next_FAKE' : null}
  });
  const call = (args = {}) => dispatchReadOnlyTool({
    registry, name:'vercel_check_token', args, connection, db, env, fetchImpl:api.fetch
  });
  return {db,api,call};
}
describe('B-8b read-only stored-token recheck',()=>{
  it('probes only the authenticated stored scope with three GETs and no mutations',async()=>{
    const {db,api,call}=fixture();
    const result=await call();
    expect(result.isError).not.toBe(true);
    const body=JSON.parse(result.content[0].text);
    expect(body).toMatchObject({teamId:'team_FAKE_a',projectId:'prj_FAKE_a',
      storedScope:'project',access:'read_verified',scopeVerified:false,
      writePermissions:'unknown',expiryVerified:false,persisted:false,
      visibleTeamCount:1,visibleProjectCount:1});
    expect(result.content[0].text).not.toContain(token);
    expect(result.content[0].text).not.toContain('token_enc');
    expect(api.calls).toHaveLength(3);
    expect(api.calls.map(x=>x.method)).toEqual(['GET','GET','GET']);
    expect(api.calls.every(x=>x.query.teamId==='team_FAKE_a')).toBe(true);
    expect(db.getAccountCredential).toHaveBeenCalledWith(accountId);
    expect(db.upsertVercelAccount).not.toHaveBeenCalled();
    expect(db.logChange).not.toHaveBeenCalled();
  });
  it('rejects unknown account, bearer, permission and write flags before looking up credentials',async()=>{
    const {db,api,call}=fixture();
    for (const args of [{account:'team_FAKE_b'},{token},{allowFull:true},
      {confirm:true},{dryRun:true},{extra:1},[], 'not-an-object']) {
      const result=await call(args);
      expect(result.isError).toBe(true);
    }
    expect(db.getAccountCredential).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(0);
  });
  it('refuses broadened visibility, incomplete pages and missing or expired stored credentials',async()=>{
    for(const flags of [{broad:true},{incomplete:true},{missing:true},{expired:true}]) {
      const {db,api,call}=fixture(flags);
      const result=await call();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).not.toContain(token);
      expect(db.upsertVercelAccount).not.toHaveBeenCalled();
      expect(api.calls.every(x=>x.method==='GET')).toBe(true);
      if(flags.missing || flags.expired) expect(api.calls).toHaveLength(0);
    }
  });
  it('never allows caller selection of another account, even when another credential exists',async()=>{
    const {db,api,call}=fixture();
    const result=await call({account:'team_FAKE_b'});
    expect(result.isError).toBe(true);
    expect(db.getAccountCredential).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(0);
  });
  it('returns safe generic failure for a provider denial or malformed response',async()=>{
    for(const body of [null,{unexpected:'provider secret'}]) {
      const {db,api}=fixture();
      const failing=async(url,options)=>{
        if(new URL(url).pathname==='/v2/user') {
          return body === null ?
            new Response(JSON.stringify({error:{code:'forbidden',message:'DO_NOT_LEAK'}}),
              {status:403,headers:{'content-type':'application/json'}}) :
            new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
        }
        return api.fetch(url,options);
      };
      const result=await dispatchReadOnlyTool({registry,name:'vercel_check_token',
        args:{},connection,db,env,fetchImpl:failing});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).not.toContain('DO_NOT_LEAK');
      expect(result.content[0].text).not.toContain(token);
      expect(db.upsertVercelAccount).not.toHaveBeenCalled();
    }
  });
  it('rejects an absent account ID and keeps the catalog read-only in all profiles',async()=>{
    const {db,api}=fixture();
    await expect(recheckStoredToken({db,accountId:'',env,fetchImpl:api.fetch})).rejects.toThrow();
    expect(api.calls).toHaveLength(0);
    const tool=registry.tools.find(x=>x.name==='vercel_check_token');
    expect(tool).toMatchObject({writes:false,profiles:['read_only','everyday','full']});
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });
});
