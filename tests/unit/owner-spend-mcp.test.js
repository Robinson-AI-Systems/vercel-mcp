import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
const account='team_ALPHA';
function fixture(){
  const store=new Map(),replay=new Map(),env={
    VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')
  };
  const db={
    listVercelAccounts:vi.fn(async()=>[{id:account,spend_limit_cents:0}]),
    listProtectedResources:vi.fn(async()=>[]),
    insertOneTimeSecret:vi.fn(async row=>store.set(row.id,{...row,vercel_account:row.account})),
    getOwnerApprovalRequest:vi.fn(async({account:a,reference})=>{
      const row=store.get(reference);return row?.vercel_account===a && row.expiresAt.getTime()>Date.now()?row:null;
    }),
    requestReplayStore:()=>({claim:async({key})=>{
      if(replay.has(key))return replay.get(key);
      replay.set(key,{state:'pending'});return {state:'claimed',claimId:'claimed_FAKE'};
    },complete:async({key,result})=>replay.set(key,{state:'completed',result})}),
    consumeOneTimeSecret:vi.fn(async({id,account:a})=>{
      const row=store.get(id);if(!row || row.vercel_account!==a)return null;
      store.delete(id);return row;
    }),
    recordChange:vi.fn(async()=>{}),setOwnerSpendLimit:vi.fn(async()=>true)
  };
  const connection={account,mode:'production',profile:'full',listing:'catalog'};
  const call=(args,c=connection,e=env)=>dispatchReadOnlyTool({
    registry,name:'vercel_set_spend_limit',args,connection:c,db,env:e
  });
  return {db,env,store,connection,call};
}
const parse=r=>JSON.parse(r.content[0].text);
describe('B-8b owner spend-limit approval tool',()=>{
  it('registers only full access with a declared guarded write',()=>{
    expect(listMcpTools(registry,{profile:'full'}).map(t=>t.name)).toContain('vercel_set_spend_limit');
    for(const profile of ['read_only','everyday']){
      expect(listMcpTools(registry,{profile}).map(t=>t.name)).not.toContain('vercel_set_spend_limit');
    }
    const tool=registry.tools.find(t=>t.name==='vercel_set_spend_limit');
    expect(tool.writeContract).toMatchObject({production:true,targets:true});
  });
  it('requires explicit confirmation and separate owner approval at both $0 and $11.25',async()=>{
    for(const cents of [0,1125]){
      const f=fixture();
      expect(parse(await f.call({limitCents:cents,dryRun:true})).status).toBe('preview');
      expect(parse(await f.call({limitCents:cents})).status).toBe('needs_confirmation');
      expect(f.store.size).toBe(0);
      const approved=parse(await f.call({limitCents:cents,confirm:true}));
      expect(approved.status).toBe('awaiting_owner_approval');
      expect(approved.confirmed).toBe(false);
      expect(approved.preview).toContain(cents===0?'$0.00':'$11.25');
      expect(f.store.size).toBe(1);
      expect(f.store.get(approved.reference).ciphertext).not.toContain('1125');
      expect(parse(await f.call({limitCents:cents,confirm:true})).reference).toBe(approved.reference);
      expect(f.db.setOwnerSpendLimit).not.toHaveBeenCalled();
    }
  });
  it('refuses preview, nonfull, forged selector, fractional/invalid/overflow cents and no server',async()=>{
    const f=fixture();
    for(const args of [
      {limitCents:-1,confirm:true},{limitCents:1.5,confirm:true},
      {limitCents:2147483648,confirm:true},{limitCents:'1125',confirm:true},
      {limitCents:1125,confirm:'yes'},{limitCents:0,account:'team_OTHER',confirm:true}
    ]) expect(parse(await f.call(args)).status).toBe('refused_by_guard');
    for(const profile of ['read_only','everyday'])
      expect((await f.call({limitCents:0,confirm:true},{...f.connection,profile})).isError).toBe(true);
    expect(parse(await f.call({limitCents:0,confirm:true},{...f.connection,mode:'preview'})).status)
      .toBe('refused_by_guard');
    expect(parse(await f.call({limitCents:0,confirm:true},f.connection,
      {...f.env,VERCEL_ENV:'preview'})).status).toBe('refused_by_guard');
    expect(f.db.setOwnerSpendLimit).not.toHaveBeenCalled();
    expect(f.store.size).toBe(0);
  });
});
