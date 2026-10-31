import {describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {registry} from '../../src/tools/index.js';
import {dispatchReadOnlyTool,listMcpTools} from '../../src/core/mcp-server.js';
import {inspectOwnerAccountChange} from '../../src/vercel/owner-approvals.js';
const issuer='team_ALPHA';
const target='team_BETA';
const parse=r=>JSON.parse(r.content[0].text);
function fixture({betaDefault=false}={}){
  const store=new Map(),replay=new Map(),env={
    VERCEL_ENV:'production',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')
  };
  const rows=[
    {id:issuer,label:'Alpha',scope:'team',team_slug:'alpha',token_last4:'1234',
      is_default:false,production_enabled:false},
    {id:target,label:'Beta',scope:'team',team_slug:'beta',token_last4:'5678',
      is_default:betaDefault,production_enabled:true}
  ];
  const db={
    listVercelAccounts:vi.fn(async()=>rows),
    getAccountRemovalFacts:vi.fn(async id=>{
      const row=rows.find(r=>r.id===id);
      if(!row)return null;
      return {...row,project_id:null,account_count:rows.length,live_tokens:2,
        live_passes:1,pending_codes:1,pending_inputs:0,pending_secrets:0,protections:2};
    }),
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
    removeOwnerAccount:vi.fn(async()=>'removed')
  };
  const connection={account:issuer,mode:'production',profile:'full',listing:'catalog'};
  const call=(args,c=connection,e=env)=>dispatchReadOnlyTool({
    registry,name:'vercel_remove_account',args,connection:c,db,env:e
  });
  return {db,env,store,connection,call};
}
describe('AUD-AA guarded account-removal proposal',()=>{
  it('is guarded and hidden in non-full profiles, including direct invocation',async()=>{
    const f=fixture();
    const tool=registry.tools.find(x=>x.name==='vercel_remove_account');
    expect(tool.writeContract).toMatchObject({production:true,targets:true});
    expect(listMcpTools(registry,{profile:'full'}).map(x=>x.name)).toContain(tool.name);
    for(const profile of ['read_only','everyday']){
      expect(listMcpTools(registry,{profile}).map(x=>x.name)).not.toContain(tool.name);
      expect((await f.call({account:target,confirm:true},{...f.connection,profile})).isError).toBe(true);
    }
    expect(f.db.insertOneTimeSecret).not.toHaveBeenCalled();
  });
  it('dry-run plan names the row, its posture and the cascade counts, and issues nothing',async()=>{
    const f=fixture();
    const plan=parse(await f.call({account:target,dryRun:true}));
    expect(plan.status).toBe('preview');
    expect(plan.preview).toContain('Beta');
    expect(plan.preview).toContain('token ending 5678');
    expect(plan.preview).toContain('2 active connection tokens');
    expect(plan.preview).toContain('1 pass');
    expect(plan.preview).toContain('2 account-scoped protection rules');
    expect(plan.preview).toContain('Production is switched on for this account');
    expect(plan.preview).toContain('Audit history and purchase records are kept for 400 days');
    expect(f.store.size).toBe(0);
    expect(f.db.removeOwnerAccount).not.toHaveBeenCalled();
  });
  it('issues exactly one encrypted remove envelope on confirm and never mutates',async()=>{
    const f=fixture();
    expect(parse(await f.call({account:target})).status).toBe('needs_confirmation');
    expect(f.store.size).toBe(0);
    const response=parse(await f.call({account:target,confirm:true}));
    expect(response).toMatchObject({status:'awaiting_owner_approval',confirmed:false,
      ownerApprovalRequired:true,reviewAt:'/api/vercel/setup'});
    expect(response.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.store.get(response.reference).ciphertext).not.toContain(target);
    expect(parse(await f.call({account:target,confirm:true})).reference).toBe(response.reference);
    expect(f.store.size).toBe(1);
    const found=await inspectOwnerAccountChange({db:f.db,env:f.env,
      account:issuer,reference:response.reference});
    expect(found).toMatchObject({action:'remove',targetAccount:target,
      connectionRef:null,limitCents:null});
    expect(f.db.removeOwnerAccount).not.toHaveBeenCalled();
  });
  it('refuses the default account while others remain, with the remedy, and issues nothing',async()=>{
    const f=fixture({betaDefault:true});
    for(const args of [{account:target,dryRun:true},{account:target,confirm:true}]){
      expect(parse(await f.call(args)).status).toBe('refused_by_guard');
    }
    expect(f.store.size).toBe(0);
    expect(f.db.removeOwnerAccount).not.toHaveBeenCalled();
  });
  it('refuses unknown, malformed or injected targets',async()=>{
    const f=fixture();
    for(const args of [
      {account:'team_GONE',confirm:true},
      {account:'x',confirm:true},
      {account:target,connectionRef:'conn_0123456789abcdef0123',confirm:true},
      {account:target,confirm:'yes'}
    ]) expect(parse(await f.call(args)).status).toBe('refused_by_guard');
    expect(f.store.size).toBe(0);
    expect(f.db.removeOwnerAccount).not.toHaveBeenCalled();
  });
  it('discloses self-removal in the plan instead of gating it',async()=>{
    const f=fixture();
    const plan=parse(await f.call({account:target,dryRun:true},
      {...f.connection,account:target}));
    expect(plan.status).toBe('preview');
    expect(plan.preview).toContain('THIS connection is using');
    expect(plan.preview).toContain('this connection stops working');
  });
  it('rejects preview modes and deployments before envelope issuance',async()=>{
    const f=fixture();
    expect(parse(await f.call({account:target,confirm:true},
      {...f.connection,mode:'preview'})).status).toBe('refused_by_guard');
    expect(parse(await f.call({account:target,confirm:true},f.connection,
      {...f.env,VERCEL_ENV:'preview'})).status).toBe('refused_by_guard');
    expect(f.store.size).toBe(0);
    expect(f.db.removeOwnerAccount).not.toHaveBeenCalled();
  });
});
