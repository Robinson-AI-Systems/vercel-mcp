import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';

const account='team_ALPHA',target='team_BETA';
function fixture(){
  const rows=new Map(),replays=new Map(),env={
    VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')
  };
  const db={
    listVercelAccounts:vi.fn(async()=>[{id:account},{id:target}]),
    listProtectedResources:vi.fn(async()=>[]),
    insertOneTimeSecret:vi.fn(async row=>rows.set(row.id,{...row,vercel_account:row.account})),
    getOwnerApprovalRequest:vi.fn(async({account:a,reference})=>{
      const row=rows.get(reference);
      return row?.vercel_account===a && row.expiresAt.getTime()>Date.now()?row:null;
    }),
    consumeOneTimeSecret:vi.fn(async({id,account:a})=>{
      const row=rows.get(id);if(!row || row.vercel_account!==a)return null;
      rows.delete(id);return row;
    }),
    recordChange:vi.fn(async()=>{}),
    setDefaultOwnerAccount:vi.fn(async()=>true),
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(replays.has(key)) return replays.get(key);
        replays.set(key,{state:'pending'});
        return {state:'claimed',claimId:'claimed_FAKE'};
      },
      complete:async({key,result})=>replays.set(key,{state:'completed',result})
    })
  };
  const connection={account,mode:'production',profile:'full',listing:'catalog'};
  const call=(args,c=connection,e=env)=>dispatchReadOnlyTool({
    registry,name:'vercel_set_default_account',args,connection:c,db,env:e
  });
  return {db,env,rows,connection,call};
}
const parse=output=>JSON.parse(output.content[0].text);
describe('B-8b default owner-approval MCP door',()=>{
  it('exposes only to full profile; read-only and everyday never dispatch',async()=>{
    const f=fixture();
    for(const profile of ['read_only','everyday']){
      expect(listMcpTools(registry,{profile}).map(x=>x.name)).not.toContain('vercel_set_default_account');
      const r=await f.call({account:target,confirm:true},{...f.connection,profile});
      expect(r.isError).toBe(true);
    }
    expect(listMcpTools(registry,{profile:'full'}).map(x=>x.name)).toContain('vercel_set_default_account');
    expect(f.db.insertOneTimeSecret).not.toHaveBeenCalled();
  });
  it('previews without mutation, then issues one encrypted exact-target owner reference',async()=>{
    const f=fixture();
    expect(parse(await f.call({account:target,dryRun:true})).status).toBe('preview');
    expect(parse(await f.call({account:target})).status).toBe('needs_confirmation');
    expect(f.rows.size).toBe(0);
    const result=parse(await f.call({account:target,confirm:true}));
    expect(result).toMatchObject({status:'awaiting_owner_approval',confirmed:false,
      ownerApprovalRequired:true,reviewAt:'/api/vercel/setup'});
    expect(result.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.rows.get(result.reference).ciphertext).not.toContain(target);
    expect(parse(await f.call({account:target,confirm:true})).reference).toBe(result.reference);
    expect(f.rows.size).toBe(1);
    expect(f.db.setDefaultOwnerAccount).not.toHaveBeenCalled();
  });
  it('rejects preview mode/server, unknown account, forged selectors and bad flags',async()=>{
    const f=fixture();
    const attempts=[
      f.call({account:target,confirm:true},{...f.connection,mode:'preview'}),
      f.call({account:target,confirm:true},f.connection,{...f.env,VERCEL_ENV:'preview'}),
      f.call({account:'team_UNKNOWN',confirm:true}),
      f.call({account:target,confirm:'yes'}),
      f.call({account:target,confirm:true,isOwner:true}),
      f.call({account:target,confirm:true,limitCents:100})
    ];
    for(const x of await Promise.all(attempts)){
      const result=parse(x);expect(result.status).toBe('refused_by_guard');
    }
    expect(f.db.insertOneTimeSecret).not.toHaveBeenCalled();
    expect(f.db.setDefaultOwnerAccount).not.toHaveBeenCalled();
  });
});
