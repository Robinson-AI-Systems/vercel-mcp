import {describe,it,expect,vi} from 'vitest';
import {visibleToProfile,listProfileTools} from '../../src/core/profiles.js';
import {defineWrite,bindGuardedWrite} from '../../src/core/write.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import {listMcpTools} from '../../src/core/mcp-server.js';
import {registry} from '../../src/tools/index.js';
import {readProvider,writeProvider,transportReplayKey} from '../../src/vercel/provider.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE_TEAM',profile:'everyday',mode:'preview'};
const token={token:'vcp_FAKE_write',account:{id:connection.account,team_id:'team_FAKE',scope:'team'}};
const db={getAccountCredential:async()=>({}),requestReplayStore:()=>({claim:async()=>({state:'claimed',claimId:'fake'}),complete:async()=>{}})};
describe('D-1 fail-closed provider write gateway',()=>{
  it('keeps routine writes hidden without an explicit fully declared contract',()=>{
    const base={name:'vercel_test',writes:true,profiles:['everyday','full'],guardedWrite:true};
    const spec={name:'vercel_test',before:async()=>({}),preview:async()=>'',
      production:async()=>({production:false}),targets:async()=>[{kind:'project',id:'fixture'}],
      apply:async()=>({}),verify:async()=>({confirmed:true})};
    const written=defineWrite(spec);
    const trusted={...base,writeContract:written.writeContract};
    for(const profile of ['read_only','everyday','full']){
      expect(visibleToProfile({...base,writeContract:{}},profile)).toBe(false);
      expect(visibleToProfile({...base,writeContract:{production:true,targets:true}},profile)).toBe(false);
      expect(visibleToProfile(trusted,profile)).toBe(profile!=='read_only');
    }
    const handler=bindGuardedWrite(written,x=>x,x=>x);
    expect(()=>mergeNamespaces([{tools:[trusted],handlers:{vercel_test:()=>null}}]))
      .toThrow(/Untrusted guarded-write/);
    expect(mergeNamespaces([{tools:[trusted],handlers:{vercel_test:handler}}]).tools).toHaveLength(1);
    expect(visibleToProfile({...trusted,guardedWrite:false},'full')).toBe(false);
    expect(visibleToProfile({...trusted,localAdmin:true},'everyday')).toBe(false);
    const items=listProfileTools({tools:[trusted]},'everyday');
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('guardedWrite');
    expect(items[0]).not.toHaveProperty('writeContract');
  });
  it('marks routine MCP writes as writes without injecting read selectors',()=>{
    const rows=listMcpTools(registry,{profile:'full',listing:'catalog'});
    for(const name of ['vercel_project_create','vercel_project_update_settings',
      'vercel_project_add_member','vercel_project_remove_member']){
      const row=rows.find(x=>x.name===name);
      expect(row.annotations.readOnlyHint).toBe(false);
      expect(row.annotations.idempotentHint).toBe(false);
      expect(row.inputSchema.properties).not.toHaveProperty('fields');
      expect(row.inputSchema.properties).not.toHaveProperty('detail');
      expect(row).not.toHaveProperty('writes');
    }
  });
  it('uses a stable separate transport claim without exposing the logical key',()=>{
    const key='rmcp_FAKE_logical_request';
    expect(transportReplayKey(key)).toMatch(/^transport_[a-f0-9]{64}$/);
    expect(transportReplayKey(key)).toBe(transportReplayKey(key));
    expect(transportReplayKey(key)).not.toContain(key);
    expect(transportReplayKey(key,'projects_create',{body:{name:'a'}}))
      .not.toBe(transportReplayKey(key,'projects_create',{body:{name:'b'}}));
    expect(transportReplayKey(key,'projects_create',{body:{name:'a'}}))
      .not.toBe(transportReplayKey(key,'projects_update',{body:{name:'a'}}));
    expect(transportReplayKey(key,'projects_create',{body:{name:'a'}},'first'))
      .not.toBe(transportReplayKey(key,'projects_create',{body:{name:'a'}},'second'));
    expect(transportReplayKey(key,'projects_create',{body:{name:'a',framework:'vite'}}))
      .toBe(transportReplayKey(key,'projects_create',{body:{framework:'vite',name:'a'}}));
    for(const bad of ['', 'too', '../../unsafe'])expect(()=>transportReplayKey(bad)).toThrow();
  });
  it('executes and replays multiple mutations under one logical key separately',async()=>{
    loadToken.mockResolvedValue(token);
    const completed=new Map(),calls=[];
    const replay={
      claim:async({key})=>completed.has(key)?{state:'completed',result:completed.get(key)}:
        {state:'claimed',claimId:key},
      complete:async({key,result})=>{completed.set(key,result);}
    };
    const writer=await writeProvider({connection,db:{...db,requestReplayStore:()=>replay},
      fetchImpl:async(_url,options)=>{
        const body=JSON.parse(options.body);calls.push(body.name);
        return new Response(JSON.stringify({id:'prj_FAKE_'+body.name,name:body.name}),
          {status:200,headers:{'content-type':'application/json'}});
      }});
    const opts={requestKey:'rmcp_FAKE_shared_logical',tool:'vercel_project_create',
      shapeResult:r=>({id:r.id,name:r.name})};
    const first=await writer.write('projects_create',{body:{name:'alpha'}},opts);
    const second=await writer.write('projects_create',{body:{name:'beta'}},opts);
    expect(first.name).toBe('alpha');expect(second.name).toBe('beta');
    expect(await writer.write('projects_create',{body:{name:'alpha'}},opts)).toEqual(first);
    expect(calls).toEqual(['alpha','beta']);
  });
  it('refuses missing replay durability before an HTTP call',async()=>{
    loadToken.mockResolvedValue(token);
    await expect(writeProvider({db:{...db,requestReplayStore:undefined},connection}))
      .rejects.toThrow(/Durable transport/);
  });
  it('separates read-only binding and rejects write profiles before provider mutation',async()=>{
    loadToken.mockResolvedValue(token);
    const read=await readProvider({db,connection});
    expect(read.account.id).toBe(connection.account);
    await expect(writeProvider({db,connection:{...connection,profile:'read_only'}}))
      .rejects.toThrow(/write-capable/);
    const writer=await writeProvider({db,connection});
    expect(()=>writer.read('projects_create',{})).toThrow(/Read-back/);
    expect(()=>writer.write('projects_list',{},{
      requestKey:'rmcp_FAKE_key',tool:'vercel_test',shapeResult:x=>x
    })).toThrow(/Guarded mutation/);
    expect(()=>writer.write('projects_create',{},{
      requestKey:'bad',tool:'vercel_test',shapeResult:x=>x
    })).toThrow(/logical replay/);
  });
});
