import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {requestOwnerAccountChange,consumeOwnerAccountChange} from '../../src/vercel/owner-approvals.js';
const env={VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
function fixture(){
  const stored=new Map(),audit=[];
  const db={
    listVercelAccounts:vi.fn(async()=>[{id:'team_ALPHA'},{id:'team_BETA'}]),
    listAccountConnections:vi.fn(async({account})=>account==='team_ALPHA'?
      [{id:'conn_0123456789abcdef0123',vercel_account:'team_ALPHA',kind:'connector',revoked_at:null}]:[]),
    insertOneTimeSecret:vi.fn(async row=>stored.set(row.id,row)),
    consumeOneTimeSecret:vi.fn(async({id,account})=>{
      const row=stored.get(id);
      if(!row || row.vercel_account!==account || row.expires_at.getTime()<Date.now()) return null;
      stored.delete(id);return row;
    }),
    recordChange:vi.fn(async row=>audit.push(row))
  };
  const connection={account:'team_ALPHA',mode:'preview',profile:'full'};
  const request=(args,c=connection,e=env)=>requestOwnerAccountChange({db,connection:c,args,env:e});
  return {db,connection,stored,audit,request};
}
describe('durable owner-change request envelope',()=>{
  it('proposes three action types but never applies any account mutation',async()=>{
    const f=fixture();
    const changes=[
      {action:'default',targetAccount:'team_BETA',confirm:true},
      {action:'spend',limitCents:1125,confirm:true},
      {action:'revoke',connectionRef:'conn_0123456789abcdef0123',confirm:true}
    ];
    for(const args of changes){
      const response=await f.request(args);
      expect(response.status).toBe('awaiting_owner_approval');
      expect(response.confirmed).toBe(false);
      expect(response.ownerApprovalRequired).toBe(true);
      expect(response.reference).toMatch(/^[0-9a-f-]{36}$/);
      expect(Date.parse(response.expiresAt)).toBeGreaterThan(Date.now());
      const stored=[...f.stored.values()].at(-1);
      expect(stored.ciphertext).not.toContain('team_BETA');
      expect(stored.ciphertext).not.toContain('1125');
      expect(stored.ciphertext).not.toContain('conn_');
      expect((await consumeOwnerAccountChange({db:f.db,env,account:'team_ALPHA',
        reference:response.reference})).action).toBe(args.action);
      expect(await consumeOwnerAccountChange({db:f.db,env,account:'team_ALPHA',
        reference:response.reference})).toBeNull();
    }
    expect(f.audit).toHaveLength(3);
    expect(f.audit.every(x=>x.dryRun===true && x.production===false)).toBe(true);
    expect(JSON.stringify(f.audit)).not.toContain('conn_');
  });
  it('keeps dry run and missing confirm as no-storage previews',async()=>{
    const f=fixture(), args={action:'spend',limitCents:0};
    expect((await f.request({...args,dryRun:true})).status).toBe('preview');
    expect((await f.request(args)).status).toBe('needs_confirmation');
    expect(f.stored.size).toBe(0);
    expect(f.db.recordChange).not.toHaveBeenCalled();
  });
  it('rejects caller impersonation, injected selectors, wrong tenant and invalid limits',async()=>{
    const f=fixture();
    const base={action:'spend',limitCents:0,confirm:true};
    for(const args of [{...base,account:'team_BETA'}, {...base,limitCents:1.5},
      {...base,limitCents:-1},{...base,limitCents:2147483648},
      {...base,limitCents:'1125'}, {...base,isOwner:true},
      {...base,confirm:'yes'},{action:'default',targetAccount:'team_UNK',confirm:true},
      {action:'revoke',connectionRef:'conn_'+'0'.repeat(20),confirm:true},
      {action:'revoke',connectionRef:'conn_'+ 'z'.repeat(20),confirm:true}]){
      expect((await f.request(args)).status).toBe('refused_by_guard');
    }
    for(const c of [{...f.connection,profile:'read_only'},
      {...f.connection,profile:'everyday'},
      {...f.connection,account:'team_BETA'},
      {...f.connection,mode:'invalid'}]){
      const attempt=await f.request({action:'spend',limitCents:0,confirm:true},c);
      if(c.account==='team_BETA' && c.profile==='full' && c.mode==='preview') {
        expect(attempt.status).toBe('awaiting_owner_approval'); // owner approval still mandatory
      } else expect(attempt.status).toBe('refused_by_guard');
    }
    expect((await f.request(base,f.connection,{...env,VERCEL_ENV:'preview'})).status)
      .toBe('refused_by_guard');
  });
  it('expires, scopes and consumes encrypted payload without reuse',async()=>{
    const f=fixture(),result=await f.request({action:'default',targetAccount:'team_BETA',confirm:true});
    expect(await consumeOwnerAccountChange({db:f.db,env,account:'team_BETA',
      reference:result.reference})).toBeNull();
    expect((await consumeOwnerAccountChange({db:f.db,env,account:'team_ALPHA',
      reference:result.reference})).targetAccount).toBe('team_BETA');
    expect(await consumeOwnerAccountChange({db:f.db,env,account:'team_ALPHA',
      reference:result.reference})).toBeNull();
  });
});
