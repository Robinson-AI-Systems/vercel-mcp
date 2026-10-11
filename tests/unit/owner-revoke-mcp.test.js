import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
const account='team_ALPHA';
const target='conn_0123456789abcdef0123';
const another='conn_abcdef0123456789abcd';
const parse=r=>JSON.parse(r.content[0].text);
function fixture(){
  const store=new Map(),replay=new Map(),env={
    VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')
  };
  let current=target;
  const db={
    listVercelAccounts:vi.fn(async()=>[{id:account},{id:'team_BETA'}]),
    listAccountConnections:vi.fn(async({account:a})=>a===account?[
      {id:current,vercel_account:account,kind:'connector',revoked_at:null},
      {id:another,vercel_account:account,kind:'connector',revoked_at:null}
    ]:[]),
    listProtectedResources:vi.fn(async()=>[]),
    insertOneTimeSecret:vi.fn(async row=>store.set(row.id,{...row,vercel_account:row.account})),
    consumeOneTimeSecret:vi.fn(async({id,account:a})=>{
      const row=store.get(id);if(!row || row.vercel_account!==a)return null;
      store.delete(id);return row;
    }),
    getOwnerApprovalRequest:vi.fn(async({account:a,reference})=>{
      const row=store.get(reference);
      return row?.vercel_account===a && row.expiresAt.getTime()>Date.now()?row:null;
    }),
    requestReplayStore:()=>({claim:async({key})=>{
      if(replay.has(key))return replay.get(key);
      replay.set(key,{state:'pending'});return {state:'claimed',claimId:'claimed_FAKE'};
    },complete:async({key,result})=>replay.set(key,{state:'completed',result})}),
    recordChange:vi.fn(async()=>{}),
    revokeOwnerConnection:vi.fn(async()=>true)
  };
  const connection={account,mode:'production',profile:'full',listing:'catalog'};
  const call=(args,c=connection,e=env)=>dispatchReadOnlyTool({
    registry,name:'vercel_revoke_connection',args,connection:c,db,env:e
  });
  return {db,env,store,connection,call,refresh:()=>{current='conn_11111111111111111111';}};
}
describe('B-8b guarded connector revocation proposal',()=>{
  it('is guarded and hidden in non-full profiles, including direct invocation',async()=>{
    const f=fixture();
    const tool=registry.tools.find(x=>x.name==='vercel_revoke_connection');
    expect(tool.writeContract).toMatchObject({production:true,targets:true});
    expect(listMcpTools(registry,{profile:'full'}).map(x=>x.name)).toContain(tool.name);
    for(const profile of ['read_only','everyday']){
      expect(listMcpTools(registry,{profile}).map(x=>x.name)).not.toContain(tool.name);
      expect((await f.call({connectionId:target,confirm:true},{...f.connection,profile})).isError).toBe(true);
    }
    expect(f.db.insertOneTimeSecret).not.toHaveBeenCalled();
  });
  it('issues encrypted one-use exact-ref owner request without revoking any token',async()=>{
    const f=fixture();
    expect(parse(await f.call({connectionId:target,dryRun:true})).status).toBe('preview');
    expect(parse(await f.call({connectionId:target})).status).toBe('needs_confirmation');
    expect(f.store.size).toBe(0);
    const response=parse(await f.call({connectionId:target,confirm:true}));
    expect(response).toMatchObject({status:'awaiting_owner_approval',confirmed:false,
      ownerApprovalRequired:true,reviewAt:'/api/vercel/setup'});
    expect(response.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.store.get(response.reference).ciphertext).not.toContain(target);
    expect(parse(await f.call({connectionId:target,confirm:true})).reference).toBe(response.reference);
    expect(f.store.size).toBe(1);
    expect(f.db.revokeOwnerConnection).not.toHaveBeenCalled();
  });
  it('refuses stale, foreign, malformed or injected connector references',async()=>{
    const f=fixture();
    for(const args of [
      {connectionId:'conn_'+'f'.repeat(20),confirm:true},
      {connectionId:'conn_'+'z'.repeat(20),confirm:true},
      {connectionId:target,account:'team_BETA',confirm:true},
      {connectionId:target,confirm:'yes'}
    ]) expect(parse(await f.call(args)).status).toBe('refused_by_guard');
    f.refresh();
    expect(parse(await f.call({connectionId:target,confirm:true})).status).toBe('refused_by_guard');
    expect(f.store.size).toBe(0);
    expect(f.db.revokeOwnerConnection).not.toHaveBeenCalled();
  });
  it('rejects preview modes and deployments before approval envelope issuance',async()=>{
    const f=fixture();
    expect(parse(await f.call({connectionId:target,confirm:true},
      {...f.connection,mode:'preview'})).status).toBe('refused_by_guard');
    expect(parse(await f.call({connectionId:target,confirm:true},f.connection,
      {...f.env,VERCEL_ENV:'preview'})).status).toBe('refused_by_guard');
    expect(f.store.size).toBe(0);
    expect(f.db.revokeOwnerConnection).not.toHaveBeenCalled();
  });
});
